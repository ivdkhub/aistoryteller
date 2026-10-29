// Server MCP di AI Story Teller per Claude Code (stdio).
// Lavora direttamente sull'archivio locale: l'app aperta nel browser si aggiorna da sola.
import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as db from './db.ts';
import { updateShot } from './service.ts';
import { applyScan, scanProject } from './scanner.ts';
import { applySeason, previewSeason } from './importers/applySeason.ts';
import { episodeMarkdown, timelineCsv } from './exporters.ts';
import { createFolders, overview, planFolders, projectTree, upsertStructure, type StructureSpec } from './structure.ts';
import { episodeProgress } from '../shared/progress.ts';
import { checkShot } from '../shared/consistency.ts';
import { storyStates } from '../shared/story.ts';
import { generationQueue } from '../shared/queue.ts';
import { defaultPackDir, elevenLabsScript, remotionPack, remotionTimeline } from './production.ts';
import { attachmentsFor, buildImagePrompt, buildVideoPrompt } from '../shared/compose.ts';
import { defaults, KINDS, type Item, type Kind } from '../shared/types.ts';

db.openDb();

const server = new McpServer({ name: 'ai-story-teller', version: '1.0.0' });

const kind = z.enum(KINDS as [Kind, ...Kind[]]).describe(
  'Tipo di elemento: account, project (progetto), character (personaggio), style (stile di prompt), episode (episodio o post), shot (inquadratura), prompt (storico prompt), idea.',
);
const anyObject = z.record(z.string(), z.any());

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 1) }] };
}

/** Avvolge ogni strumento: gli errori tornano a Claude come testo leggibile. */
function tool<S extends z.ZodRawShape>(name: string, description: string, shape: S, run: (args: z.infer<z.ZodObject<S>>) => unknown) {
  const callback = async (args: unknown) => {
    try {
      return ok(await run(args as z.infer<z.ZodObject<S>>));
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Errore: ${(err as Error).message}` }], isError: true };
    }
  };
  server.registerTool(name, { description, inputSchema: shape }, callback as never);
}

/** Riduce un elemento ai campi richiesti (per risposte compatte). */
function pick(item: Item, fields?: string[]) {
  if (!fields?.length) return item;
  const out: Record<string, unknown> = { id: item.id };
  for (const f of fields) out[f] = (item as unknown as Record<string, unknown>)[f];
  return out;
}

// --- Lettura -----------------------------------------------------------------

tool('panoramica', 'Elenca tutti gli account Instagram con i loro progetti (tipo, stato, cartella, numero di personaggi, episodi e inquadrature). Punto di partenza per orientarsi.', {}, () => overview());

tool(
  'schema_campi',
  'Mostra i campi di ogni tipo di elemento con i valori di default e i valori ammessi. Da consultare prima di creare o modificare elementi.',
  { tipo: kind.optional() },
  ({ tipo }) => {
    const kinds = tipo ? [tipo] : KINDS;
    return {
      campi: Object.fromEntries(kinds.map((k) => [k, defaults(k)])),
      valori_ammessi: {
        'project.type': ['base', 'characters', 'ai_influencer'],
        'project.status': ['idea', 'production', 'published', 'archived'],
        'episode.format': ['reel', 'carousel', 'post', 'story'],
        'episode.status': ['idea', 'writing', 'production', 'editing', 'ready', 'published'],
        'episode.publishDate': 'YYYY-MM-DDTHH:mm (ora locale)',
        'episode.checklist': 'chiavi delle tappe spuntate a mano: script, prompts, images, videos, audio, edit, revisions, caption',
        'project.stateDefs': 'variabili della storia: [{"name":"TRACE","start":12,"startEpisode":2,"min":5,"max":95,"unit":"%"}]',
        'episode.vote.effects': 'effetto di ogni opzione sulle variabili: {"MOVE":{"TRACE":29},"FREEZE":{"TRACE":0}}',
        'episode.linkedEpisodeId': 'per i post satellite: id dell\'episodio principale a cui sono legati',
        'shot.status': ['todo', 'image', 'video', 'edited', 'discarded'],
        'shot.animPriority': ['', 'alta', 'media', 'bassa'],
        'style.target': ['image', 'video'],
        'prompt.type': ['image', 'video', 'voice', 'other'],
        'prompt.outcome': ['draft', 'used', 'discarded', 'previous'],
        'idea.status': ['inbox', 'develop', 'used', 'discarded'],
        file: 'percorsi assoluti su disco (es. C:\\...\\EP02_S05.png) oppure "media/..." per i file caricati nell\'app',
      },
    };
  },
);

tool(
  'albero_progetto',
  'Struttura completa di un progetto: personaggi, stili, episodi con percentuale di avanzamento e prossima tappa; con inquadrature=true elenca anche le inquadrature in sintesi.',
  { projectId: z.string(), inquadrature: z.boolean().optional() },
  ({ projectId, inquadrature }) => projectTree(projectId, { shots: inquadrature }),
);

tool(
  'elenca',
  'Elenca gli elementi di un tipo, filtrabili per account, progetto, episodio, inquadratura o personaggio. Usa "campi" per ricevere solo alcuni campi (consigliato per inquadrature e prompt, che sono lunghi).',
  {
    tipo: kind,
    accountId: z.string().optional(),
    projectId: z.string().optional().describe('Stringa vuota = elementi senza progetto (es. stili generali).'),
    episodeId: z.string().optional(),
    shotId: z.string().optional(),
    characterId: z.string().optional(),
    campi: z.array(z.string()).optional().describe('Es. ["code","title","status"]'),
  },
  ({ tipo, campi, ...filter }) => db.list(tipo, filter).map((i) => pick(i, campi)),
);

tool(
  'leggi',
  'Legge un elemento completo. Indica l\'id, oppure projectId + code per episodi e inquadrature (es. "EP02" o "EP02_S07"), oppure projectId + name per un personaggio.',
  { tipo: kind, id: z.string().optional(), projectId: z.string().optional(), code: z.string().optional(), name: z.string().optional() },
  ({ tipo, id, projectId, code, name }) => {
    if (id) {
      const item = db.get(tipo, id);
      if (!item) throw new Error(`${tipo} non trovato: ${id}`);
      return item;
    }
    if (!projectId) throw new Error('Indica id, oppure projectId con code o name.');
    const items = db.list(tipo, { projectId }) as Item[];
    const found = items.find((i) =>
      code ? (i as { code?: string }).code?.toUpperCase() === code.toUpperCase() : name ? (i as { name?: string }).name?.toUpperCase() === name.toUpperCase() : false,
    );
    if (!found) throw new Error(`Nessun ${tipo} con ${code ? `code ${code}` : `name ${name}`} nel progetto.`);
    return found;
  },
);

tool('cerca', 'Ricerca testuale in tutto l\'archivio (personaggi, prompt, inquadrature, episodi, idee…). Restituisce tipo, id e titolo.', { testo: z.string().min(2) }, ({ testo }) =>
  db.search(testo).map((i) => {
    const r = i as unknown as Record<string, string>;
    return { tipo: i.kind, id: i.id, titolo: r.title || r.name || r.code || r.handle, code: r.code, projectId: r.projectId, episodeId: r.episodeId };
  }),
);

tool(
  'avanzamento_episodio',
  'Avanzamento della produzione di un episodio: percentuale, tappe (copione, prompt, immagini, animazioni, voce e audio, montaggio, revisioni, caption, pubblicato) e prossima tappa.',
  { episodeId: z.string() },
  ({ episodeId }) => {
    const e = db.get('episode', episodeId);
    if (!e) throw new Error(`Episodio non trovato: ${episodeId}`);
    const p = episodeProgress(e, db.list('shot', { episodeId }));
    return { episodio: `${e.code} ${e.title}`, percentuale: p.percent, prossima: p.next?.label ?? null, tappe: p.steps };
  },
);

// --- Scrittura ---------------------------------------------------------------

tool(
  'crea',
  'Crea un elemento. I collegamenti a monte si completano da soli (es. basta episodeId per un\'inquadratura). Per strutture con molti elementi usa crea_struttura.',
  { tipo: kind, dati: anyObject.describe('Campi dell\'elemento: vedi schema_campi.') },
  ({ tipo, dati }) => db.create(tipo, dati as never),
);

tool(
  'modifica',
  'Modifica uno o più campi di un elemento: si fonde con i valori esistenti, i campi non indicati restano invariati. Se cambi il prompt di un\'inquadratura, la versione precedente va nello storico.',
  { tipo: kind, id: z.string(), modifiche: anyObject.describe('Solo i campi da cambiare, es. {"caption": "...", "status": "editing"}') },
  ({ tipo, id, modifiche }) => {
    const item = tipo === 'shot' ? updateShot(id, modifiche as never) : db.update(tipo, id, modifiche as never);
    if (!item) throw new Error(`${tipo} non trovato: ${id}`);
    return item;
  },
);

tool(
  'elimina',
  'Elimina un elemento e tutto ciò che ne dipende (es. un episodio con le sue inquadrature e i prompt). I file sul disco non vengono toccati. Operazione irreversibile: chiedi conferma all\'utente prima di usarla.',
  { tipo: kind, id: z.string() },
  ({ tipo, id }) => {
    if (!db.get(tipo, id)) throw new Error(`${tipo} non trovato: ${id}`);
    return { eliminati: db.remove(id) };
  },
);

tool(
  'crea_struttura',
  [
    'Crea o aggiorna in un colpo solo un\'intera struttura: account, progetto, stili, personaggi, episodi con inquadrature, idee.',
    'Abbina gli elementi esistenti (account per handle/nome, progetto per titolo, stili e personaggi per nome, episodi e inquadrature per code) e aggiorna solo i campi indicati: si può rilanciare senza creare doppioni.',
    'Formato: {"account": {"name","handle",...} oppure "accountId", "project": {"title","type":"base|characters|ai_influencer","logline","bible",...} oppure "projectId",',
    '"styles": [{"name","target":"image|video","prefix","avoid","params"}], "characters": [{"name","age","role","fixedDescription","personality","arc","continuityRules":[...],"voice":{...}}],',
    '"episodes": [{"code":"EP01","title","format","status","script","caption","hashtags","publishDate","vote":{"options":[...]},',
    '"shots": [{"code":"EP01_S01","title","characters":["NOME"],"refs","imagePrompt","videoPrompt","animPriority","animation","graphics","line","note"}]}], "ideas": [{"title","description","tags":[...]}]}.',
  ].join(' '),
  { struttura: anyObject },
  ({ struttura }) => upsertStructure(struttura as StructureSpec),
);

tool(
  'componi_prompt',
  'Compone i prompt come il composer dell\'app: prefisso di stile + descrizioni fisse dei personaggi (con immagini di riferimento numerate) + scena; prompt video con regole di continuità e riga Avoid. Con shotId e applica=true scrive i prompt nell\'inquadratura; con salva=true li aggiunge allo storico.',
  {
    projectId: z.string(),
    personaggi: z.array(z.string()).optional().describe('Nomi dei personaggi in scena, nell\'ordine delle immagini di riferimento.'),
    stileImmagine: z.string().optional().describe('Nome o id dello stile immagine (default: il primo del progetto).'),
    stileVideo: z.string().optional(),
    scena: z.string().optional().describe('Descrizione della scena, in inglese.'),
    movimento: z.string().optional().describe('Movimento per il prompt video, in inglese.'),
    riferimenti: z.array(z.string()).optional().describe('Altre immagini di riferimento, es. "EP01_S09.png (ambiente)".'),
    shotId: z.string().optional(),
    applica: z.boolean().optional(),
    salva: z.boolean().optional(),
  },
  (a) => {
    const styles = [...db.list('style', { projectId: a.projectId }), ...db.list('style', { projectId: '' })];
    const findStyle = (target: 'image' | 'video', key?: string) =>
      styles.find((s) => s.target === target && key && (s.id === key || s.name.toLowerCase() === key.toLowerCase())) ?? styles.find((s) => s.target === target);
    const chars = db.list('character', { projectId: a.projectId });
    const cast = (a.personaggi ?? []).map((n) => {
      const c = chars.find((x) => x.name.toUpperCase() === n.toUpperCase()) ?? chars.find((x) => x.name.toUpperCase().split(/[\s.]+/).includes(n.toUpperCase()));
      if (!c) throw new Error(`Personaggio "${n}" non trovato.`);
      return c;
    });
    const imageStyle = findStyle('image', a.stileImmagine);
    const videoStyle = findStyle('video', a.stileVideo);
    const refs = a.riferimenti ?? [];
    const imagePrompt = a.scena ? buildImagePrompt(imageStyle, cast, refs, a.scena) : '';
    const videoPrompt = a.movimento ? buildVideoPrompt(videoStyle, cast, a.movimento) : '';
    const attachments = attachmentsFor(cast, refs);
    if (a.shotId && a.applica) {
      const patch: Record<string, unknown> = { characterIds: cast.map((c) => c.id), refs: attachments.map((x, i) => `${i + 1}) ${x}`).join(' ') };
      if (imagePrompt) patch.imagePrompt = imagePrompt;
      if (videoPrompt) patch.videoPrompt = videoPrompt;
      if (!updateShot(a.shotId, patch)) throw new Error(`Inquadratura non trovata: ${a.shotId}`);
    }
    if (a.salva) {
      for (const [type, text, style] of [['image', imagePrompt, imageStyle], ['video', videoPrompt, videoStyle]] as const) {
        if (!text) continue;
        db.create('prompt', {
          projectId: a.projectId, shotId: a.shotId ?? '', characterId: cast.length === 1 ? cast[0].id : '',
          title: `${type === 'image' ? 'Immagine' : 'Video'} · ${(a.scena ?? a.movimento ?? '').slice(0, 50)}`,
          type, tool: type === 'image' ? 'Nano Banana Pro' : 'Kling', params: style?.params ?? '', text, negative: style?.avoid ?? '',
          notes: attachments.length ? `Riferimenti: ${attachments.map((x, i) => `${i + 1}) ${x}`).join(' ')}` : '',
        });
      }
    }
    return { stileImmagine: imageStyle?.name, stileVideo: videoStyle?.name, promptImmagine: imagePrompt, promptVideo: videoPrompt, allegati: attachments };
  },
);

// --- Import, file ed export --------------------------------------------------

tool(
  'importa_serie',
  'Importa un documento di stagione (formato "Bank Error": PERSONAGGI, VOCI, STILE, episodi "EP. n", inquadrature "EPxx_Syy · titolo" con PROMPT/ANIMAZIONE/NOTA...). Con anteprima=true mostra cosa verrebbe creato senza scrivere. Reimportare aggiorna senza doppioni e collega i file della cartella.',
  {
    filePath: z.string(),
    accountId: z.string().optional().describe('Account esistente; se manca ne viene creato uno.'),
    nuovoAccount: z.string().optional().describe('Nome del nuovo account.'),
    satellite: z.boolean().optional().describe('Crea anche il profilo satellite del personaggio (default true).'),
    anteprima: z.boolean().optional(),
  },
  (a) => {
    const opts = { filePath: a.filePath, accountId: a.accountId, newAccountName: a.nuovoAccount, satellite: a.satellite ?? true };
    return a.anteprima ? previewSeason(opts) : applySeason(opts);
  },
);

tool(
  'scansiona_cartella',
  'Legge la cartella collegata al progetto e abbina i file EPxx_Syy*.png / *_VID.mp4 alle inquadrature (crea anche quelle che esistono solo come file). Con applica=false mostra solo gli abbinamenti.',
  { projectId: z.string(), applica: z.boolean().optional() },
  ({ projectId, applica }) => {
    if (applica === false) {
      const r = scanProject(projectId);
      return { cartella: r.folder, file: r.files, abbinamenti: r.matches.map((m) => ({ code: m.code, immagine: m.image, video: m.video, stato: m.status, varianti: m.alternates.length, scarti: m.discarded.length })) };
    }
    return { aggiornate: applyScan(projectId) };
  },
);

tool(
  'esporta_episodio',
  'Esporta un episodio come markdown (scheda, copione, inquadrature con prompt, nel formato del documento di stagione) oppure come CSV della timeline di montaggio. Con filePath lo scrive anche su disco.',
  { episodeId: z.string(), formato: z.enum(['markdown', 'csv', 'elevenlabs']).optional(), filePath: z.string().optional() },
  ({ episodeId, formato, filePath }) => {
    const e = db.get('episode', episodeId);
    if (!e) throw new Error(`Episodio non trovato: ${episodeId}`);
    const text = formato === 'csv' ? timelineCsv(e) : formato === 'elevenlabs' ? elevenLabsScript(e) : episodeMarkdown(e);
    if (filePath) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, text, 'utf8');
      return `Scritto in ${filePath} (${text.length} caratteri).`;
    }
    return text;
  },
);

tool(
  'piano_cartelle',
  'Propone la struttura di cartelle locali di un progetto letta da AI Story Teller: <radice>/<Progetto>/PROGETTO.md, Personaggi/<NOME>.md, una cartella per episodio con <CODICE>.md e sottocartelle (scartate, audio, deliverables). Non scrive nulla.',
  { projectId: z.string(), radice: z.string().describe('Cartella in cui creare quella del progetto.'), sottocartelle: z.array(z.string()).optional() },
  ({ projectId, radice, sottocartelle }) => {
    const plan = planFolders(projectId, radice, sottocartelle);
    return { cartellaProgetto: plan.projectDir, elementi: plan.entries.map((e) => `${e.exists ? '=' : '+'} ${e.type === 'dir' ? '[dir] ' : ''}${e.path}`) };
  },
);

tool(
  'crea_cartelle',
  'Crea sul disco le cartelle del progetto e le schede .md (progetto, personaggi, episodi) come in piano_cartelle; i file esistenti restano, salvo sovrascrivi=true. Collega la cartella al progetto se non ne aveva una, così lo scanner può abbinare i file generati.',
  { projectId: z.string(), radice: z.string(), sovrascrivi: z.boolean().optional(), sottocartelle: z.array(z.string()).optional() },
  ({ projectId, radice, sovrascrivi, sottocartelle }) => createFolders(projectId, radice, { overwrite: sovrascrivi, subfolders: sottocartelle }),
);

tool(
  'controlla_coerenza',
  'Controlla la coerenza dei personaggi nelle inquadrature di un episodio o di un progetto: regole di continuità violate (es. volto mostrato), personaggi nei riferimenti ma non segnati, prompt che riprendono poco la descrizione fissa. Gli avvisi "warn" vanno ricontrollati, gli "info" sono note.',
  { episodeId: z.string().optional(), projectId: z.string().optional(), soloAvvisi: z.boolean().optional() },
  ({ episodeId, projectId, soloAvvisi }) => {
    const episode = episodeId ? db.get('episode', episodeId) : undefined;
    const pid = episode?.projectId ?? projectId;
    if (!pid) throw new Error('Indica episodeId o projectId.');
    const characters = db.list('character', { projectId: pid });
    const shots = episodeId ? db.list('shot', { episodeId }) : db.list('shot', { projectId: pid });
    return shots
      .filter((s) => s.status !== 'discarded')
      .map((s) => ({ id: s.id, code: s.code, issues: checkShot(s, characters).filter((i) => !soloAvvisi || i.level === 'warn') }))
      .filter((r) => r.issues.length);
  },
);

tool(
  'stato_storia',
  'Linea della storia di un progetto: per ogni episodio i valori delle variabili (es. TRACE) all\'inizio, le opzioni di voto con il loro effetto e il valore che ne risulta, il vincitore. Le variabili si definiscono in project.stateDefs, gli effetti in episode.vote.effects (modificabili con modifica).',
  { projectId: z.string() },
  ({ projectId }) => {
    const project = db.get('project', projectId);
    if (!project) throw new Error(`Progetto non trovato: ${projectId}`);
    const main = db.list('episode', { projectId }).filter((e) => !e.publishAccountId);
    return { variabili: project.stateDefs, episodi: storyStates(project.stateDefs ?? [], main) };
  },
);

tool(
  'lista_generazione',
  'Inquadrature che aspettano un\'immagine (tipo "image") o un video (tipo "video"), nell\'ordine di produzione, con prompt, riferimenti da allegare e avvisi di coerenza.',
  { projectId: z.string(), tipo: z.enum(['image', 'video']).optional(), episodeId: z.string().optional(), limite: z.number().optional() },
  ({ projectId, tipo, episodeId, limite }) => {
    const kind = tipo ?? 'image';
    const characters = db.list('character', { projectId });
    const queue = generationQueue(db.list('shot', { projectId }), db.list('episode', { projectId }), kind).filter((s) => !episodeId || s.episodeId === episodeId);
    return {
      totale: queue.length,
      inquadrature: queue.slice(0, limite ?? 20).map((s) => ({
        id: s.id,
        code: s.code,
        titolo: s.title,
        prompt: kind === 'image' ? s.imagePrompt : s.videoPrompt,
        movimento: kind === 'video' ? s.animation : undefined,
        priorita: s.animPriority || undefined,
        allegati:
          kind === 'image'
            ? s.characterIds.map((id) => characters.find((c) => c.id === id)).filter(Boolean).map((c) => c!.images[0]?.path ?? `${c!.name} (senza scheda)`)
            : [s.imageFile].filter(Boolean),
        riferimenti: s.refs || undefined,
        avvisi: checkShot(s, characters).filter((i) => i.level === 'warn').map((i) => i.text),
      })),
    };
  },
);

tool(
  'pacchetto_remotion',
  'Crea il pacchetto Remotion di un episodio: copia immagini e video in public/img e public/vid (nomi S01.png, S05_VID.mp4…), genera src/data/timeline.generated.ts con tempi stimati dal copione e il copione per ElevenLabs. Senza cartella usa <cartella progetto>\\<EPxx>\\remotion-pack-<EPxx>. Con anteprima=true mostra solo la sequenza.',
  { episodeId: z.string(), cartella: z.string().optional(), sovrascrivi: z.boolean().optional(), anteprima: z.boolean().optional() },
  ({ episodeId, cartella, sovrascrivi, anteprima }) => {
    const e = db.get('episode', episodeId);
    if (!e) throw new Error(`Episodio non trovato: ${episodeId}`);
    if (anteprima) {
      const t = remotionTimeline(e);
      return { cartella: cartella ?? defaultPackDir(e), durata: t.total, senzaFile: t.skipped, inquadrature: t.shots.map(({ source, ...s }) => ({ ...s, file: source })) };
    }
    return remotionPack(e, cartella ?? defaultPackDir(e), { overwrite: sovrascrivi });
  },
);

tool('esporta_backup', 'Scrive un backup completo dell\'archivio in JSON nel percorso indicato.', { filePath: z.string() }, ({ filePath }) => {
  const items = db.all();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ app: 'ai-story-teller', version: 1, exportedAt: new Date().toISOString(), items }, null, 1), 'utf8');
  return `Backup di ${items.length} elementi scritto in ${filePath}.`;
});

// --- Comandi pronti (in Claude Code compaiono come comandi slash) ------------

server.registerPrompt(
  'importa_cartella',
  {
    description: 'Legge una cartella di lavoro locale (idee, copioni, schede, prompt, immagini) e la importa in AI Story Teller.',
    argsSchema: { cartella: z.string().describe('Percorso della cartella da importare'), account: z.string().optional().describe('Account di destinazione (nome o handle)') },
  },
  ({ cartella, account }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: [
          `Importa in AI Story Teller il lavoro che si trova in "${cartella}".`,
          '1. Chiama panoramica per vedere account e progetti esistenti' + (account ? ` e usa l'account "${account}" (crealo se non esiste).` : ' e chiedimi su quale account importare se non è ovvio.'),
          '2. Leggi i file della cartella (markdown, testo, documenti di stagione) e ricava: progetto (titolo, tipo, logline, bibbia), stili di prompt, personaggi con descrizione fissa in inglese, regole di continuità e voce, episodi con copione, caption e voto, inquadrature con prompt immagine/video, idee sparse.',
          '3. Se c\'è un documento di stagione nel formato "Bank Error" usa importa_serie con anteprima=true e poi senza anteprima; altrimenti costruisci la struttura e usa crea_struttura (consulta schema_campi per i campi).',
          '4. Collega la cartella al progetto (campo folder con modifica) e lancia scansiona_cartella per abbinare immagini e video EPxx_Syy.',
          '5. Prima di scrivere mostrami un riepilogo di cosa creerai; alla fine dimmi cosa è stato creato o aggiornato e cosa manca (es. personaggi senza scheda immagine).',
        ].join('\n'),
      },
    }],
  }),
);

server.registerPrompt(
  'prepara_cartelle',
  {
    description: 'Crea in locale le cartelle di un progetto di AI Story Teller (schede .md di progetto, personaggi ed episodi, sottocartelle per gli asset).',
    argsSchema: { progetto: z.string().describe('Titolo o id del progetto'), radice: z.string().describe('Cartella in cui creare quella del progetto') },
  },
  ({ progetto, radice }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: [
          `Prepara in locale le cartelle del progetto "${progetto}" dentro "${radice}".`,
          '1. Trova il progetto con panoramica.',
          '2. Mostrami il risultato di piano_cartelle e chiedimi conferma.',
          '3. Poi usa crea_cartelle (senza sovrascrivere i file esistenti) e dimmi dove salvare immagini e video perché lo scanner li riconosca (nomi EPxx_Syy.png e EPxx_Syy_VID.mp4 nella cartella dell\'episodio).',
        ].join('\n'),
      },
    }],
  }),
);

await server.connect(new StdioServerTransport());
