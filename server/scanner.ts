// Scanner della cartella di progetto: abbina i file EPxx_Syy*.png / *_VID.mp4 alle inquadrature.
// Legge soltanto: non scrive mai nella cartella dei contenuti.
import fs from 'node:fs';
import path from 'node:path';
import * as db from './db.ts';
import type { Shot, ShotStatus } from '../shared/types.ts';

const SKIP = new Set(['node_modules', 'remotion', 'deliverables', 'audio', '.git', 'out', 'public', 'build', 'src']);
const DISCARD = /^(scartate|scartati|bloopers|_backup|backup)$/i;
const IMAGE = /\.(png|jpe?g|webp)$/i;
const VIDEO = /\.(mp4|mov|webm)$/i;

export interface FileEntry {
  path: string;
  name: string;
  discarded: boolean;
}

export function walk(root: string, maxDepth = 3): FileEntry[] {
  const out: FileEntry[] = [];
  const visit = (dir: string, depth: number, discarded: boolean) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < maxDepth && !SKIP.has(e.name.toLowerCase())) visit(full, depth + 1, discarded || DISCARD.test(e.name));
      } else if (IMAGE.test(e.name) || VIDEO.test(e.name)) {
        out.push({ path: full, name: e.name, discarded });
      }
    }
  };
  visit(root, 0, false);
  return out;
}

export interface ShotMatch {
  shotId: string;
  code: string;
  image: string;
  video: string;
  alternates: string[];
  discarded: string[];
  status: ShotStatus;
  changed: boolean;
}

const RANK: Record<ShotStatus, number> = { todo: 0, image: 1, video: 2, edited: 3, discarded: 4 };

/** Abbina i file alle inquadrature (codice più lungo che fa da prefisso del nome file). */
export function matchFiles(shots: Pick<Shot, 'id' | 'code' | 'imageFile' | 'videoFile' | 'status'>[], files: FileEntry[]): ShotMatch[] {
  const byLength = [...shots].sort((a, b) => b.code.length - a.code.length);
  const found = new Map<string, ShotMatch>();
  for (const f of files) {
    const stem = f.name.replace(/\.[^.]+$/, '');
    const shot = byLength.find((s) => {
      if (!s.code || !stem.toUpperCase().startsWith(s.code.toUpperCase())) return false;
      const next = stem[s.code.length];
      return next === undefined || next === '_' || next === ' ' || next === '-';
    });
    if (!shot) continue;
    let m = found.get(shot.id);
    if (!m) {
      m = { shotId: shot.id, code: shot.code, image: '', video: '', alternates: [], discarded: [], status: shot.status, changed: false };
      found.set(shot.id, m);
    }
    const rest = stem.slice(shot.code.length).toUpperCase();
    if (f.discarded) m.discarded.push(f.path);
    else if (VIDEO.test(f.name) && (rest === '' || rest === '_VID') && !m.video) m.video = f.path;
    else if (IMAGE.test(f.name) && rest === '' && !m.image) m.image = f.path;
    else m.alternates.push(f.path);
  }
  for (const m of found.values()) {
    // Senza un file "esatto", la prima variante non scartata fa da immagine/video principale.
    if (!m.image) {
      const i = m.alternates.findIndex((p) => IMAGE.test(p));
      if (i !== -1) m.image = m.alternates.splice(i, 1)[0];
    }
    if (!m.video) {
      const i = m.alternates.findIndex((p) => VIDEO.test(p));
      if (i !== -1) m.video = m.alternates.splice(i, 1)[0];
    }
    const shot = shots.find((s) => s.id === m.shotId)!;
    const target: ShotStatus = m.video ? 'video' : m.image ? 'image' : shot.status;
    m.status = RANK[target] > RANK[shot.status] && shot.status !== 'discarded' ? target : shot.status;
    m.changed = m.status !== shot.status || (!!m.image && m.image !== shot.imageFile) || (!!m.video && m.video !== shot.videoFile);
  }
  return [...found.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function scanProject(projectId: string): { folder: string; matches: ShotMatch[]; files: number } {
  const project = db.get('project', projectId);
  if (!project?.folder) throw new Error('Il progetto non ha una cartella collegata.');
  if (!fs.existsSync(project.folder)) throw new Error(`Cartella non trovata: ${project.folder}`);
  const files = walk(project.folder);
  return { folder: project.folder, matches: matchFiles(db.list('shot', { projectId }), files), files: files.length };
}

const DISCOVER = /^(EP\d{2})_(S\d+[a-z]?)(_CCTV)?(?=[_\s.-]|$)/i;

/**
 * Crea le inquadrature che hanno file su disco ma non esistono ancora
 * (es. un episodio già prodotto senza elenco di inquadrature nel documento).
 */
export function discoverShots(projectId: string): number {
  const project = db.get('project', projectId);
  if (!project?.folder || !fs.existsSync(project.folder)) return 0;
  const episodes = db.list('episode', { projectId });
  const shots = db.list('shot', { projectId });
  const known = new Set(shots.map((s) => s.code.toUpperCase()));
  const created = new Set<string>();
  for (const f of walk(project.folder)) {
    if (f.discarded) continue;
    const m = f.name.match(DISCOVER);
    if (!m) continue;
    const code = `${m[1]}_${m[2]}${m[3] ?? ''}`.toUpperCase().replace(/(S\d+)([A-Z])$/, (_, s, l) => s + l.toLowerCase());
    // Solo episodi senza inquadrature: negli altri il documento fa testo.
    const ep = episodes.find((e) => e.code.toUpperCase() === m[1].toUpperCase());
    if (!ep || known.has(code.toUpperCase()) || created.has(code) || shots.some((s) => s.episodeId === ep.id)) continue;
    created.add(code);
  }
  const sorted = [...created].sort();
  for (const code of sorted) {
    const ep = episodes.find((e) => code.startsWith(e.code))!;
    db.create('shot', { episodeId: ep.id, code, title: '', order: sorted.indexOf(code), note: 'Creata dallo scanner dai file su disco.' });
  }
  return sorted.length;
}

export function applyScan(projectId: string): number {
  discoverShots(projectId);
  const { matches } = scanProject(projectId);
  let n = 0;
  db.transaction(() => {
    for (const m of matches) {
      if (!m.changed && !m.alternates.length) continue;
      const shot = db.get('shot', m.shotId)!;
      db.update('shot', m.shotId, {
        imageFile: m.image || shot.imageFile,
        videoFile: m.video || shot.videoFile,
        alternates: [...new Set([...m.alternates, ...m.discarded])],
        status: m.status,
      });
      n++;
    }
  });
  return n;
}
