// Export di produzione: copione per ElevenLabs e pacchetto per Remotion.
import fs from 'node:fs';
import path from 'node:path';
import * as db from './db.ts';
import { NARRATOR, parseScript, spokenWords, estimateSeconds, WORDS_PER_MINUTE, type ScriptLine } from '../shared/script.ts';
import type { Character, Episode, Shot } from '../shared/types.ts';

function shotsOf(episode: Episode): Shot[] {
  return db.list('shot', { episodeId: episode.id }).sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));
}

/** Personaggio che corrisponde a un nome di battuta ("KADE" → "MR. KADE", "TELLER" → scheda "BANK TELLER.png"). */
export function voiceCharacter(speaker: string, characters: Character[]): Character | undefined {
  const k = speaker.toUpperCase();
  return (
    characters.find((c) => c.name.toUpperCase() === k) ??
    characters.find((c) => c.name.toUpperCase().split(/[\s.]+/).includes(k)) ??
    characters.find((c) => c.images.some((i) => (i.path.split(/[\\/]/).pop() ?? '').toUpperCase().includes(k)))
  );
}

const RULE = '='.repeat(70);

/** Divide le battute in blocchi da generare separatamente (circa 3, interi, mai a metà riga). */
function blocks(lines: ScriptLine[]): ScriptLine[][] {
  const spoken = lines.filter((l) => !l.marker);
  if (spoken.length < 9) return [lines];
  const total = spoken.reduce((n, l) => n + spokenWords(l.text), 0);
  const out: ScriptLine[][] = [[]];
  let acc = 0;
  for (const l of lines) {
    out[out.length - 1].push(l);
    if (!l.marker) acc += spokenWords(l.text);
    if (out.length < 3 && acc >= (total / 3) * out.length) out.push([]);
  }
  return out.filter((b) => b.length);
}

/** Copione nel formato dei file *_doppiaggio_ElevenLabs.txt: voci, istruzioni, blocchi, battute per voce. */
export function elevenLabsScript(episode: Episode): string {
  const project = db.get('project', episode.projectId);
  const characters = db.list('character', { projectId: episode.projectId });
  const lines = parseScript(episode.script);
  const voices = [...new Set(lines.filter((l) => !l.marker).map((l) => l.speaker))];
  const secs = estimateSeconds(episode.script);
  const out: string[] = [];

  out.push(`${project?.title ?? ''} — ${episode.code} "${episode.title}" — TESTO PER ELEVENLABS`.trim());
  out.push(`Durata stimata del parlato: circa ${secs} s (${WORDS_PER_MINUTE} parole al minuto).`, '');

  out.push(RULE, 'VOCI', RULE);
  const pad = Math.max(...voices.map((v) => v.length), 8) + 2;
  const toDesign: [string, string][] = [];
  for (const v of voices) {
    const c = voiceCharacter(v, characters);
    const text = [c?.voice.name, c?.voice.description].filter(Boolean).join(' — ') || 'da scegliere';
    out.push(`${v.padEnd(pad)}${text}`);
    if (!c?.voice.name && c?.voice.design) toDesign.push([v, c.voice.design]);
  }
  if (toDesign.length) {
    out.push('', 'Prompt per Voice Design (voci ancora da scegliere):');
    for (const [v, d] of toDesign) out.push(`${v.padEnd(pad)}"${d}"`);
  }

  const parts = blocks(lines);
  out.push('', RULE, 'COME GENERARE', RULE);
  out.push(
    '1. Text to Dialogue, assegnando a ogni riga la sua voce' + (parts.length > 1 ? `; generare i ${parts.length} blocchi separatamente e unirli.` : '.'),
    '2. La prima riga (hook) va generata da sola 5-6 volte: deve partire forte e agganciare subito.',
    '3. Se una battuta non viene, rigenerarla da sola con la sua voce (vedi BATTUTE PER VOCE) e sostituirla in montaggio.',
    '4. Se la recitazione è troppo teatrale, togliere i tag dalle frasi neutre.',
    `5. Salvare in ${episode.code}\\audio\\: ${episode.code}_voce_completa.wav (+ eventuali battute singole: ${voices.filter((v) => v !== NARRATOR).map((v) => `${episode.code}_${v.toLowerCase().replace(/[^a-z0-9]+/g, '')}.wav`).join(', ')}).`,
  );

  parts.forEach((b, i) => {
    const first = b.find((l) => !l.marker)?.text.replace(/\[[^\]]*\]/g, '').trim().split(/\s+/).slice(0, 6).join(' ') ?? '';
    out.push('', RULE, parts.length > 1 ? `BLOCCO ${String.fromCharCode(65 + i)}  (da "${first}…")` : 'TESTO', RULE, '');
    for (const l of b) out.push(l.marker ? `\n${l.text}` : `${l.speaker}: ${l.text}`);
  });

  out.push('', RULE, 'BATTUTE PER VOCE (per generarle una voce alla volta)', RULE);
  for (const v of voices) {
    const c = voiceCharacter(v, characters);
    out.push('', `--- ${v}${c?.voice.name ? ` (${c.voice.name})` : ''} ---`);
    for (const l of lines) if (!l.marker && l.speaker === v) out.push(l.text);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

// --- Remotion ----------------------------------------------------------------

export interface RemotionShot {
  id: string;
  from: number;
  to: number;
  src: string;
  kind: 'image' | 'video';
  trimBefore?: number;
  move?: { scale: [number, number]; origin?: [number, number] };
  grade: 'day' | 'night' | 'cctv' | 'dark';
  note?: string;
  /** File di partenza (non va nel .ts). */
  source: string;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** "EP02_S07" → "S07"; i post satellite tengono il codice intero. */
function shortId(code: string, episodeCode: string) {
  return code.startsWith(`${episodeCode}_`) ? code.slice(episodeCode.length + 1) : code;
}

function grade(s: Shot): RemotionShot['grade'] {
  if (/cctv/i.test(s.code) || /security camera/i.test(s.imagePrompt)) return 'cctv';
  if (/\bnight\b|darkness/i.test(s.imagePrompt)) return 'night';
  return 'day';
}

/** Sequenza di montaggio con tempi stimati: battuta dell'inquadratura se c'è, altrimenti quota uguale del parlato. */
export function remotionTimeline(episode: Episode): { shots: RemotionShot[]; total: number; skipped: string[] } {
  const all = shotsOf(episode).filter((s) => s.status !== 'discarded');
  const usable = all.filter((s) => s.imageFile || s.videoFile);
  const skipped = all.filter((s) => !s.imageFile && !s.videoFile).map((s) => s.code);
  const spoken = estimateSeconds(episode.script);
  const byLine = usable.map((s) => (s.line ? (spokenWords(s.line) / WORDS_PER_MINUTE) * 60 + 0.6 : 0));
  const free = usable.filter((_, i) => !byLine[i]).length;
  const rest = Math.max(0, spoken - byLine.reduce((a, b) => a + b, 0));
  const share = free ? Math.max(1.5, spoken ? rest / free : 3) : 0;

  let t = 0;
  const shots = usable.map((s, i): RemotionShot => {
    const dur = Math.max(1.2, byLine[i] || share);
    const id = shortId(s.code, episode.code);
    // Se il video esiste è quello che va in montaggio.
    const video = !!s.videoFile;
    const source = video ? s.videoFile : s.imageFile;
    const ext = path.extname(source).toLowerCase() || (video ? '.mp4' : '.png');
    const trim = s.cut.match(/(\d+(?:[.,]\d+)?)\s*[–-]/);
    const shot: RemotionShot = {
      id: video ? `${id}_VID` : id,
      from: round(t),
      to: round(t + dur),
      src: video ? `vid/${id}_VID${ext}` : `img/${id}${ext}`,
      kind: video ? 'video' : 'image',
      grade: grade(s),
      note: [s.title, s.cut && `taglio: ${s.cut}`, s.editing].filter(Boolean).join(' · ') || undefined,
      source,
    };
    if (video) shot.trimBefore = trim ? Number(trim[1].replace(',', '.')) : 0;
    else shot.move = { scale: i % 2 ? [1.08, 1.0] : [1.0, 1.08], origin: [50, 45] };
    t += dur;
    return shot;
  });
  return { shots, total: round(t), skipped };
}

function timelineTs(episode: Episode, shots: RemotionShot[], total: number) {
  const body = shots
    .map(({ source: _s, ...s }) => `  ${JSON.stringify(s).replace(/"(\w+)":/g, '$1: ').replace(/,(?=\w+: )/g, ', ')},`)
    .join('\n');
  return `// Generato da AI Story Teller il ${new Date().toLocaleString('it-IT')} — ${episode.code} "${episode.title}".
// Tempi STIMATI dal copione (${WORDS_PER_MINUTE} parole/min): riallinearli ai sottotitoli della voce reale (captions.json)
// come nella timeline dell'EP02 (S(n), E(n), Wd(n, k)). Rigenerando il pacchetto questo file viene riscritto.

export type Move = {
  scale: [number, number];
  x?: [number, number];
  y?: [number, number];
  origin?: [number, number];
};

export type Shot = {
  id: string;
  from: number;
  to: number;
  src: string;
  kind: "image" | "video";
  trimBefore?: number;
  playbackRate?: number;
  move?: Move;
  grade?: "day" | "night" | "cctv" | "dark";
  note?: string;
};

export const TOTAL_SEC = ${total};

export const shots: Shot[] = [
${body}
];
`;
}

export interface PackResult {
  dir: string;
  copied: number;
  kept: number;
  shots: number;
  skipped: string[];
  total: number;
  files: string[];
}

/**
 * Crea (o aggiorna) un pacchetto Remotion per l'episodio: public/img, public/vid, src/data/timeline.generated.ts,
 * il copione per ElevenLabs e un README. I media già presenti non vengono sovrascritti, salvo overwrite.
 */
export function remotionPack(episode: Episode, dir: string, opts: { overwrite?: boolean } = {}): PackResult {
  const { shots, total, skipped } = remotionTimeline(episode);
  const files: string[] = [];
  let copied = 0;
  let kept = 0;
  for (const s of shots) {
    const target = path.join(dir, 'public', ...s.src.split('/'));
    if (fs.existsSync(target) && !opts.overwrite) {
      kept++;
      continue;
    }
    if (!fs.existsSync(s.source)) {
      skipped.push(`${s.id} (file non trovato: ${s.source})`);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(s.source, target);
    copied++;
  }
  const write = (rel: string, content: string) => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf8');
    files.push(p);
  };
  write(path.join('src', 'data', 'timeline.generated.ts'), timelineTs(episode, shots, total));
  if (episode.script.trim()) write(`${episode.code}_doppiaggio_ElevenLabs.txt`, elevenLabsScript(episode));
  write(
    'README_AI_STORY_TELLER.md',
    [
      `# Pacchetto Remotion — ${episode.code} "${episode.title}"`,
      '',
      `Generato da AI Story Teller il ${new Date().toLocaleString('it-IT')}.`,
      '',
      `- \`public/img\`, \`public/vid\`: ${shots.length} inquadrature copiate con i nomi della timeline (S01.png, S05_VID.mp4…).`,
      `- \`src/data/timeline.generated.ts\`: sequenza con tempi stimati (${total} s); da riallineare ai sottotitoli della voce reale.`,
      episode.script.trim() ? `- \`${episode.code}_doppiaggio_ElevenLabs.txt\`: copione per voce da generare in ElevenLabs.` : '',
      skipped.length ? `\nInquadrature senza file (da generare): ${skipped.join(', ')}.` : '',
      '',
      'Per usarlo in un progetto Remotion esistente: copia `public/` e importa `shots` da `timeline.generated.ts` al posto della timeline scritta a mano, poi chiedi a Claude Code di agganciare i tempi ai sottotitoli.',
    ].filter((l) => l !== '').join('\n') + '\n',
  );
  return { dir, copied, kept, shots: shots.length, skipped, total, files };
}

/** Cartella proposta per il pacchetto: dentro la cartella del progetto, accanto all'episodio. */
export function defaultPackDir(episode: Episode): string {
  const project = db.get('project', episode.projectId);
  const base = project?.folder ? path.join(project.folder, episode.code) : path.join(db.DATA_DIR, 'export');
  return path.join(base, `remotion-pack-${episode.code}`);
}
