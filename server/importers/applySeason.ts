// Applica al database una stagione letta da parseSeason. Idempotente: abbina per nome/codice.
import fs from 'node:fs';
import path from 'node:path';
import * as db from '../db.ts';
import { updateShot } from '../service.ts';
import { applyScan } from '../scanner.ts';
import { parseSeason, referencedCharacters, type ParsedCharacter, type ParsedSeason } from './bankError.ts';
import type { Character, Episode, RefImage, Shot } from '../../shared/types.ts';

export interface SeasonImportOptions {
  filePath: string;
  /** Account esistente; se manca se ne crea uno con newAccountName. */
  accountId?: string;
  newAccountName?: string;
  newAccountHandle?: string;
  /** Progetto esistente da aggiornare; se manca si cerca per titolo nell'account. */
  projectId?: string;
  /** Crea/aggiorna il profilo satellite (es. @fatfinger.jen). */
  satellite: boolean;
}

const VIDEO_AVOID =
  "showing the protagonist's face, talking or open mouths, lip movement, camera shake, morphing hands, extra fingers, warped text, flickering";

export function readSeason(filePath: string): ParsedSeason {
  if (!fs.existsSync(filePath)) throw new Error(`File non trovato: ${filePath}`);
  return parseSeason(fs.readFileSync(filePath, 'utf8'));
}

function seasonTitle(s: ParsedSeason) {
  return s.title.replace(/\s*—\s*STAGIONE\s*\d+.*$/i, '').trim() || s.title;
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

export interface SeasonPreview {
  title: string;
  version: string;
  folder: string;
  styles: string[];
  characters: { name: string; image: boolean; variants: number; voiceOnly: boolean; exists: boolean }[];
  episodes: { code: string; title: string; shots: number; satellite: boolean; exists: boolean }[];
  satellite: ParsedSeason['satellite'];
  existingProjectId: string;
}

/** Immagini di riferimento: scheda principale + varianti trovate nella cartella. */
function characterImages(c: ParsedCharacter, folder: string, files: string[]): RefImage[] {
  const images: RefImage[] = [];
  const add = (file: string, label: string) => {
    const full = path.join(folder, file);
    if (files.includes(file) && !images.some((i) => i.path === full)) images.push({ path: full, label });
  };
  if (c.imageFile) add(c.imageFile, 'Scheda');
  for (const v of c.variants) add(v.file, v.label);
  if (!c.imageFile) return images;
  const prefixes = [c.name.toUpperCase()];
  const parts = c.imageFile.replace(/\.[^.]+$/, '').split('_');
  if (parts.length >= 2) prefixes.push(`${parts[0]}_${parts[1]}_`.toUpperCase());
  for (const f of files) {
    const up = f.toUpperCase();
    if (!/\.(png|jpe?g|webp)$/i.test(f) || !prefixes.some((p) => up.startsWith(p))) continue;
    const base = c.imageFile.replace(/\.[^.]+$/, '');
    const stem = f.replace(/\.[^.]+$/, '');
    const label = stem.startsWith(base) ? stem.slice(base.length).replace(/^[_\s-]+/, '') : stem.replace(/^[^_-]+[_\s-]+(\d+[_\s-]+)?/, '');
    add(f, label.replace(/_/g, ' ').trim() || 'Variante');
  }
  return images;
}

function rootFiles(folder: string): string[] {
  try {
    return fs.readdirSync(folder, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

function findProject(opts: SeasonImportOptions, season: ParsedSeason) {
  if (opts.projectId) return db.get('project', opts.projectId);
  if (!opts.accountId) return undefined;
  return db.list('project', { accountId: opts.accountId }).find((p) => p.title === seasonTitle(season));
}

export function previewSeason(opts: SeasonImportOptions): SeasonPreview {
  const season = readSeason(opts.filePath);
  const folder = path.dirname(opts.filePath);
  const files = rootFiles(folder);
  const project = findProject(opts, season);
  const chars = project ? db.list('character', { projectId: project.id }) : [];
  const eps = project ? db.list('episode', { projectId: project.id }) : [];
  return {
    title: seasonTitle(season),
    version: season.version,
    folder,
    styles: season.styles.map((s) => s.name),
    characters: season.characters.map((c) => ({
      name: c.name,
      image: characterImages(c, folder, files).length > 0,
      variants: Math.max(0, characterImages(c, folder, files).length - 1),
      voiceOnly: c.voiceOnly,
      exists: chars.some((x) => x.name === c.name),
    })),
    episodes: season.episodes.map((e) => ({
      code: e.code, title: e.title, shots: e.shots.length, satellite: e.satellite, exists: eps.some((x) => x.code === e.code),
    })),
    satellite: season.satellite,
    existingProjectId: project?.id ?? '',
  };
}

export function applySeason(opts: SeasonImportOptions): { projectId: string; accountId: string; scanned: number } {
  const season = readSeason(opts.filePath);
  const folder = path.dirname(opts.filePath);
  const files = rootFiles(folder);

  const result = db.transaction(() => {
    // Account e progetto
    let accountId = opts.accountId ?? '';
    if (!accountId) {
      accountId = db.create('account', {
        name: opts.newAccountName || titleCase(seasonTitle(season)),
        handle: opts.newAccountHandle ?? '',
        niche: 'Serie interattiva',
      }).id;
    }
    const existing = findProject({ ...opts, accountId }, season);
    const projectData = {
      accountId,
      title: seasonTitle(season),
      type: 'characters' as const,
      status: 'production' as const,
      logline: season.version,
      bible: season.bible,
      folder,
    };
    const project = existing ? db.update('project', existing.id, projectData)! : db.create('project', projectData);
    const projectId = project.id;

    // Stili
    const styles = db.list('style', { projectId });
    const upsertStyle = (name: string, data: Parameters<typeof db.create<'style'>>[1]) => {
      const s = styles.find((x) => x.name === name);
      if (s) db.update('style', s.id, data);
      else db.create('style', { ...data, name, projectId });
    };
    for (const s of season.styles) upsertStyle(s.name, { target: 'image', prefix: s.prefix });
    if (!styles.some((s) => s.target === 'video')) {
      upsertStyle('Kling / Flow image-to-video', { target: 'video', prefix: '', avoid: VIDEO_AVOID, params: 'image-to-video, 9:16, 5 s (8 s su Flow), audio a volume 0' });
    }

    // Personaggi
    const existingChars = db.list('character', { projectId });
    const charIds: string[] = [];
    for (const c of season.characters) {
      const current = existingChars.find((x) => x.name === c.name);
      const images = characterImages(c, folder, files);
      const data: Partial<Character> = {
        projectId,
        name: c.name,
        age: c.age,
        role: c.role,
        fixedDescription: c.fixedDescription,
        arc: c.arc,
        voiceOnly: c.voiceOnly,
        continuityRules: c.name === 'TU' ? season.continuityRules.filter((r) => /\bTU\b/.test(r)) : current?.continuityRules ?? [],
        voice: { ...(current?.voice ?? { tool: 'ElevenLabs', name: '', design: '', description: '' }), description: c.voice },
        notes: [c.imageNote, ...c.variants.filter((v) => v.description).map((v) => `${v.label}: "${v.description}"`)].filter(Boolean).join('\n'),
      };
      // Le immagini aggiunte a mano restano: si uniscono a quelle trovate.
      const merged = [...images, ...(current?.images ?? []).filter((i) => !images.some((x) => x.path === i.path))];
      data.images = merged;
      charIds.push(current ? db.update('character', current.id, data)!.id : db.create('character', data).id);
    }

    // Profilo satellite
    let satelliteId = '';
    if (opts.satellite && season.satellite?.handle) {
      const handle = season.satellite.handle;
      const jen = season.characters.findIndex((c) => handle.toUpperCase().includes(c.name.split(/\s+/)[0].toUpperCase()));
      const existingSat = db.list('account').find((a) => a.handle === handle);
      const satData = {
        name: jen !== -1 ? titleCase(season.characters[jen].name) : handle,
        handle,
        niche: 'Profilo personaggio',
        bio: season.satellite.intro,
        notes: season.satellite.altHandle ? `Handle alternativo: ${season.satellite.altHandle}` : '',
        parentAccountId: accountId,
        linkedCharacterId: jen !== -1 ? charIds[jen] : '',
        color: '#e07a9b',
      };
      satelliteId = existingSat ? db.update('account', existingSat.id, satData)!.id : db.create('account', satData).id;
    }

    // Episodi e inquadrature
    const existingEps = db.list('episode', { projectId });
    const existingShots = db.list('shot', { projectId });
    const epIdByNumber = new Map<number, string>();
    for (const e of season.episodes) {
      const current = existingEps.find((x) => x.code === e.code);
      const data: Partial<Episode> = {
        projectId,
        code: e.code,
        number: e.number,
        title: e.title,
        format: e.format,
        info: e.info,
        voices: e.voices,
        vote: { ...e.vote, winner: e.vote.winner || current?.vote.winner || '', percent: e.vote.percent || current?.vote.percent || '' },
        branches: e.branches,
        stateVars: { ...(current?.stateVars ?? {}), ...e.stateVars },
        script: e.script,
        caption: e.caption || current?.caption || '',
        notes: e.notes,
        publishAccountId: e.satellite ? satelliteId : '',
        linkedEpisodeId: e.linkedEpisode ? epIdByNumber.get(e.linkedEpisode) ?? '' : '',
      };
      if (!current) data.status = e.produced ? 'published' : e.shots.length ? 'production' : 'writing';
      const episode = current ? db.update('episode', current.id, data)! : db.create('episode', data);
      if (!e.satellite) epIdByNumber.set(e.number, episode.id);

      e.shots.forEach((s, order) => {
        const cur = existingShots.find((x) => x.code === s.code);
        const charIdx = referencedCharacters(s.refs, season.characters);
        const data: Partial<Shot> = {
          episodeId: episode.id,
          code: s.code,
          title: s.title,
          order,
          refs: s.refs,
          imagePrompt: s.imagePrompt,
          animPriority: s.animPriority,
          animation: s.animation,
          graphics: s.graphics,
          note: [s.note, s.file ? `File: ${s.file}` : ''].filter(Boolean).join('\n'),
          editing: s.editing,
          noImage: s.noImage,
          characterIds: cur?.characterIds.length ? cur.characterIds : charIdx.map((i) => charIds[i]),
        };
        if (cur) updateShot(cur.id, data);
        else db.create('shot', data);
      });
    }
    return { projectId, accountId };
  });

  // Lo scanner collega i file già generati e aggiorna lo stato delle inquadrature.
  let scanned = 0;
  try {
    scanned = applyScan(result.projectId);
  } catch {
    // Cartella non leggibile: l'import resta valido comunque.
  }
  return { ...result, scanned };
}
