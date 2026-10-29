// Operazioni "ad alto livello" pensate per Claude Code (server MCP):
// panoramica, albero di un progetto, creazione in blocco di una struttura, cartelle locali.
import fs from 'node:fs';
import path from 'node:path';
import * as db from './db.ts';
import { updateShot } from './service.ts';
import { episodeMarkdown } from './exporters.ts';
import { episodeProgress } from '../shared/progress.ts';
import { PROJECT_TYPE_LABEL, type Account, type Character, type Episode, type Idea, type Project, type Shot, type StylePreset } from '../shared/types.ts';

export function overview() {
  const projects = db.list('project');
  const episodes = db.list('episode');
  const shots = db.list('shot');
  return db.list('account').map((a) => ({
    id: a.id,
    name: a.name,
    handle: a.handle,
    parentAccountId: a.parentAccountId || undefined,
    projects: projects
      .filter((p) => p.accountId === a.id)
      .map((p) => ({
        id: p.id,
        title: p.title,
        type: p.type,
        status: p.status,
        folder: p.folder || undefined,
        characters: db.list('character', { projectId: p.id }).length,
        episodes: episodes.filter((e) => e.projectId === p.id).length,
        shots: shots.filter((s) => s.projectId === p.id).length,
      })),
  }));
}

/** Albero di un progetto: personaggi, stili, episodi con avanzamento e inquadrature in sintesi. */
export function projectTree(projectId: string, opts: { shots?: boolean } = {}) {
  const project = db.get('project', projectId);
  if (!project) throw new Error(`Progetto non trovato: ${projectId}`);
  const shots = db.list('shot', { projectId });
  const episodes = db.list('episode', { projectId }).sort((a, b) => Number(!!a.publishAccountId) - Number(!!b.publishAccountId) || a.number - b.number);
  return {
    project: { id: project.id, title: project.title, type: project.type, status: project.status, logline: project.logline, folder: project.folder, accountId: project.accountId },
    characters: db.list('character', { projectId }).map((c) => ({
      id: c.id, name: c.name, age: c.age, role: c.role, voiceOnly: c.voiceOnly || undefined, images: c.images.length, hasFixedDescription: !!c.fixedDescription,
    })),
    styles: [...db.list('style', { projectId }), ...db.list('style', { projectId: '' })].map((s) => ({ id: s.id, name: s.name, target: s.target, global: !s.projectId || undefined })),
    episodes: episodes.map((e) => {
      const es = shots.filter((s) => s.episodeId === e.id).sort((a, b) => a.order - b.order);
      const p = episodeProgress(e, es);
      return {
        id: e.id, code: e.code, title: e.title, status: e.status, format: e.format, publishDate: e.publishDate || undefined,
        publishAccountId: e.publishAccountId || undefined, progress: `${p.percent}%`, nextStep: p.next?.label,
        shots: opts.shots
          ? es.map((s) => ({ id: s.id, code: s.code, title: s.title, status: s.status, imagePrompt: !!s.imagePrompt, image: !!s.imageFile, video: !!s.videoFile }))
          : es.length,
      };
    }),
  };
}

// --- Creazione in blocco -----------------------------------------------------

type In<T> = Partial<Omit<T, 'id' | 'kind' | 'createdAt' | 'updatedAt'>> & { id?: string };
export interface ShotSpec extends In<Shot> {
  /** Nomi dei personaggi in scena (risolti negli id del progetto). */
  characters?: string[];
}
export interface EpisodeSpec extends In<Episode> {
  shots?: ShotSpec[];
}
export interface StructureSpec {
  accountId?: string;
  account?: In<Account>;
  projectId?: string;
  project?: In<Project>;
  styles?: In<StylePreset>[];
  characters?: In<Character>[];
  episodes?: EpisodeSpec[];
  ideas?: In<Idea>[];
}

const strip = <T extends { id?: string }>(o: T) => {
  const { id: _id, ...rest } = o;
  return rest;
};

/**
 * Crea o aggiorna una struttura completa in un'unica transazione.
 * Abbina: account per id/handle/nome, progetto per id/titolo, stili e personaggi per nome,
 * episodi per codice, inquadrature per codice. I campi non indicati restano invariati.
 */
export function upsertStructure(spec: StructureSpec) {
  return db.transaction(() => {
    const report = { created: [] as string[], updated: [] as string[] };
    const note = (created: boolean, label: string) => (created ? report.created : report.updated).push(label);

    // Account
    let account: Account | undefined = spec.accountId ? db.get('account', spec.accountId) : undefined;
    if (spec.accountId && !account) throw new Error(`Account non trovato: ${spec.accountId}`);
    if (!account && spec.account) {
      const a = spec.account;
      const found = db.list('account').find((x) => (a.handle && x.handle === a.handle) || (a.name && x.name === a.name));
      account = found ? db.update('account', found.id, strip(a)) : db.create('account', strip(a));
      note(!found, `account ${account!.name || account!.handle}`);
    } else if (account && spec.account) {
      account = db.update('account', account.id, strip(spec.account));
      note(false, `account ${account!.name || account!.handle}`);
    }

    // Progetto
    let project: Project | undefined = spec.projectId ? db.get('project', spec.projectId) : undefined;
    if (spec.projectId && !project) throw new Error(`Progetto non trovato: ${spec.projectId}`);
    if (!project && spec.project) {
      if (!account) throw new Error('Per creare un progetto serve un account (accountId oppure account).');
      const existing = db.list('project', { accountId: account.id }).find((p) => p.title === spec.project!.title);
      project = existing ? db.update('project', existing.id, strip(spec.project)) : db.create('project', { ...strip(spec.project), accountId: account.id });
      note(!existing, `progetto ${project!.title}`);
    } else if (project && spec.project) {
      project = db.update('project', project.id, strip(spec.project));
      note(false, `progetto ${project!.title}`);
    }
    if (!project && (spec.styles || spec.characters || spec.episodes)) throw new Error('Serve un progetto (projectId oppure project).');
    const projectId = project?.id ?? '';

    // Stili
    for (const s of spec.styles ?? []) {
      const cur = db.list('style', { projectId }).find((x) => x.id === s.id || x.name === s.name);
      if (cur) db.update('style', cur.id, strip(s));
      else db.create('style', { ...strip(s), projectId });
      note(!cur, `stile ${s.name}`);
    }

    // Personaggi
    for (const c of spec.characters ?? []) {
      const cur = db.list('character', { projectId }).find((x) => x.id === c.id || (!!c.name && x.name.toUpperCase() === c.name.toUpperCase()));
      if (cur) db.update('character', cur.id, strip(c));
      else db.create('character', { ...strip(c), projectId });
      note(!cur, `personaggio ${c.name}`);
    }
    const chars = projectId ? db.list('character', { projectId }) : [];
    const charIds = (names: string[]) =>
      names.map((n) => {
        const c = chars.find((x) => x.name.toUpperCase() === n.toUpperCase()) ?? chars.find((x) => x.name.toUpperCase().split(/[\s.]+/).includes(n.toUpperCase()));
        if (!c) throw new Error(`Personaggio "${n}" non trovato nel progetto.`);
        return c.id;
      });

    // Episodi e inquadrature
    for (const e of spec.episodes ?? []) {
      const { shots, ...epData } = e;
      const eps = db.list('episode', { projectId });
      const cur = eps.find((x) => x.id === e.id || (!!e.code && x.code === e.code));
      const number = e.number ?? cur?.number ?? Math.max(0, ...eps.map((x) => x.number)) + 1;
      const code = e.code ?? cur?.code ?? `${project?.type === 'characters' ? 'EP' : 'P'}${String(number).padStart(2, '0')}`;
      const episode = cur ? db.update('episode', cur.id, { ...strip(epData), code, number }) : db.create('episode', { ...strip(epData), code, number, projectId });
      note(!cur, `episodio ${code}`);
      const existingShots = db.list('shot', { episodeId: episode!.id });
      (shots ?? []).forEach((s, i) => {
        const { characters, ...shotData } = s;
        const sc = existingShots.find((x) => x.id === s.id || (!!s.code && x.code === s.code));
        const data: Partial<Shot> = { ...strip(shotData) };
        if (characters) data.characterIds = charIds(characters);
        if (data.order === undefined && !sc) data.order = existingShots.length + i;
        if (!data.code && !sc) data.code = `${code}_S${String(existingShots.length + i + 1).padStart(2, '0')}`;
        if (sc) updateShot(sc.id, data);
        else db.create('shot', { ...data, episodeId: episode!.id });
        note(!sc, `inquadratura ${data.code ?? sc?.code}`);
      });
    }

    // Idee
    for (const i of spec.ideas ?? []) {
      db.create('idea', { accountId: account?.id ?? '', projectId, ...strip(i) });
      note(true, `idea ${i.title}`);
    }

    return { accountId: account?.id, projectId: projectId || undefined, ...report };
  });
}

// --- Cartelle locali ---------------------------------------------------------

/** Nome valido come cartella o file su Windows. */
export function safeName(s: string) {
  return s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim() || 'senza-nome';
}

function characterMarkdown(c: Character) {
  const lines = [`# ${c.name}`, ''];
  const meta = [c.age && `Età: ${c.age}`, c.role && `Ruolo: ${c.role}`].filter(Boolean).join(' · ');
  if (meta) lines.push(meta, '');
  if (c.fixedDescription) lines.push('## Descrizione fissa (da incollare nei prompt)', '', `"${c.fixedDescription}"`, '');
  if (c.personality) lines.push('## Personalità', '', c.personality, '');
  if (c.arc) lines.push('## Arco narrativo', '', c.arc, '');
  if (c.continuityRules.length) lines.push('## Regole di continuità', '', ...c.continuityRules.map((r) => `- ${r}`), '');
  if (c.voice.name || c.voice.description || c.voice.design) {
    lines.push('## Voce', '', [c.voice.tool, c.voice.name].filter(Boolean).join(' — '), c.voice.description, c.voice.design && `Voice Design: ${c.voice.design}`, '');
  }
  if (c.images.length) lines.push('## Immagini di riferimento', '', ...c.images.map((i) => `- ${i.label}: ${i.path}`), '');
  if (c.notes) lines.push('## Note', '', c.notes, '');
  return lines.join('\n');
}

function projectMarkdown(p: Project) {
  const lines = [`# ${p.title}`, '', `Tipo: ${PROJECT_TYPE_LABEL[p.type]}`, ''];
  if (p.logline) lines.push(p.logline, '');
  const b = p.brand;
  const brand = Object.entries({ Persona: b.persona, 'Tono di voce': b.toneOfVoice, Valori: b.values, Pilastri: b.pillars, 'Da non fare': b.donts, Palette: b.palette, Outfit: b.outfits, Hashtag: b.hashtags }).filter(([, v]) => v);
  if (brand.length) lines.push('## Linee guida', '', ...brand.map(([k, v]) => `**${k}:** ${v}`), '');
  if (p.bible) lines.push('## Bibbia', '', p.bible, '');
  if (p.notes) lines.push('## Note', '', p.notes, '');
  return lines.join('\n');
}

export interface FolderEntry {
  path: string;
  type: 'dir' | 'file';
  exists: boolean;
  content?: string;
}

/** Struttura di cartelle proposta per un progetto, letta da AI Story Teller. */
export function planFolders(projectId: string, root: string, subfolders = ['scartate', 'audio', 'deliverables']): { projectDir: string; entries: FolderEntry[] } {
  const project = db.get('project', projectId);
  if (!project) throw new Error(`Progetto non trovato: ${projectId}`);
  const projectDir = path.resolve(root, safeName(project.title));
  const entries: FolderEntry[] = [];
  const dir = (p: string) => entries.push({ path: p, type: 'dir', exists: fs.existsSync(p) });
  const file = (p: string, content: string) => entries.push({ path: p, type: 'file', exists: fs.existsSync(p), content });

  dir(projectDir);
  file(path.join(projectDir, 'PROGETTO.md'), projectMarkdown(project));
  const characters = db.list('character', { projectId }).filter((c) => !c.voiceOnly);
  if (characters.length) {
    dir(path.join(projectDir, 'Personaggi'));
    for (const c of characters) file(path.join(projectDir, 'Personaggi', `${safeName(c.name)}.md`), characterMarkdown(c));
  }
  const accounts = db.list('account');
  for (const e of db.list('episode', { projectId }).sort((a, b) => a.number - b.number)) {
    const sat = e.publishAccountId ? accounts.find((a) => a.id === e.publishAccountId) : undefined;
    const base = sat ? path.join(projectDir, safeName(sat.handle || sat.name)) : projectDir;
    const epDir = path.join(base, safeName(e.code || e.title));
    if (sat && !entries.some((x) => x.path === base)) dir(base);
    dir(epDir);
    file(path.join(epDir, `${safeName(e.code || 'episodio')}.md`), episodeMarkdown(e));
    for (const s of subfolders) dir(path.join(epDir, s));
  }
  return { projectDir, entries };
}

/**
 * Crea sul disco le cartelle del progetto e le schede .md.
 * I file esistenti non vengono sovrascritti, salvo overwrite.
 */
export function createFolders(projectId: string, root: string, opts: { overwrite?: boolean; subfolders?: string[]; linkProject?: boolean } = {}) {
  const { projectDir, entries } = planFolders(projectId, root, opts.subfolders);
  const created: string[] = [];
  const skipped: string[] = [];
  for (const e of entries) {
    if (e.type === 'dir') {
      if (!e.exists) {
        fs.mkdirSync(e.path, { recursive: true });
        created.push(e.path);
      }
    } else if (!e.exists || opts.overwrite) {
      fs.mkdirSync(path.dirname(e.path), { recursive: true });
      fs.writeFileSync(e.path, e.content ?? '', 'utf8');
      created.push(e.path);
    } else skipped.push(e.path);
  }
  // Il progetto viene collegato alla cartella solo se non ne aveva già una.
  const linked = opts.linkProject !== false && !db.get('project', projectId)!.folder;
  if (linked) db.update('project', projectId, { folder: projectDir });
  return { projectDir, created, skipped, linked };
}
