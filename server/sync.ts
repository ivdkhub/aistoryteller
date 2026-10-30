// Sincronizzazione continua con una cartella condivisa (es. Google Drive per Desktop).
//
// Perché non si può mettere SQLite direttamente su Google Drive:
// Drive sincronizza file interi e non gestisce i lock di file-system (WAL/SHM). Se due PC
// aprono lo stesso .db, Drive crea copie in conflitto ("storyteller (1).db") o corrompe il file.
//
// Come funziona invece questa sincronizzazione:
// - Ogni PC mantiene il suo database SQLite locale velocissimo (`data/storyteller.db`).
// - Nella cartella condivisa (`<syncFolder>/.storyteller-sync/` oppure direttamente se dedicata)
//   teniamo:
//     1) `snapshot-<nodeId>.json`: lo stato corrente scritto da ciascun socio (nessun conflitto di
//        scrittura su Google Drive perché ogni nodo scrive solo il proprio file con rename atomico!).
//     2) `tombstones-<nodeId>.json`: le eliminazioni con timestamp (`id -> deletedAt`), così un
//        elemento eliminato da un socio non resuscita dall'altro.
//     3) `media/`: copia dei file caricati in `data/media/` (sincronizzati solo se mancanti, per dimensione/nome).
//     4) Percorsi portabili: i riferimenti dentro la cartella condivisa o nelle cartelle progetto
//        vengono rimappati automaticamente se i due PC hanno percorsi radice diversi (es. `G:\Il mio Drive\...` vs `C:\Users\socio\Google Drive\...`).
//
// Prestazioni:
// - Scrittura (push): debounce di 400 ms dopo una modifica locale, scrittura atomica su file `.tmp` + `rename` (< 5 ms).
// - Lettura (pull): `fs.watch` sulla cartella di sync (reazione immediata ~100-200 ms appena Google Drive
//   deposita il file del socio) + controllo leggero su `mtimeMs` ogni 1.5 s (zero letture JSON se i file non sono cambiati).
// - Risoluzione conflitti: Last-Write-Wins (LWW) per singolo elemento basato su `updatedAt` (e per
//   le inquadrature/episodi, merge intelligente a livello di campi modificati rispetto all'ultimo stato noto).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as db from './db.ts';
import type { Item, Kind } from '../shared/types.ts';

const SYNC_SUBDIR = '.storyteller-sync';
const DEBOUNCE_PUSH_MS = 350;
const POLL_INTERVAL_MS = 1500;
const MEDIA_SYNC_INTERVAL_MS = 10_000;

export interface Tombstone {
  id: string;
  deletedAt: string;
}

export interface NodeSnapshot {
  app: 'ai-story-teller-sync';
  version: 1;
  nodeId: string;
  nodeName: string;
  rootPath: string;
  contentRoots: string[];
  updatedAt: string;
  items: Item[];
  tombstones: Record<string, string>; // id -> ISO deletedAt
}

export interface PeerStatus {
  nodeId: string;
  nodeName: string;
  updatedAt: string;
  itemsCount: number;
}

export interface SyncStatus {
  enabled: boolean;
  folder: string;
  folderExists: boolean;
  nodeId: string;
  nodeName: string;
  state: 'disabled' | 'idle' | 'syncing' | 'error';
  lastPushAt: string;
  lastPullAt: string;
  lastChangeAt: string;
  error: string;
  peers: PeerStatus[];
  stats: {
    pushed: number;
    pulled: number;
    mediaCopied: number;
  };
}

interface LocalSyncMeta {
  nodeId: string;
  nodeName: string;
  tombstones: Record<string, string>;
  /** Ultima versione nota di ogni item per fare merge a livello di singolo campo quando due soci toccano campi diversi dello stesso elemento. */
  baseItems: Record<string, Record<string, unknown>>;
}

let syncFolder = '';
let nodeName = '';
let contentRootsGetter: () => string[] = () => [];
let meta: LocalSyncMeta = { nodeId: '', nodeName: '', tombstones: {}, baseItems: {} };

let watcher: fs.FSWatcher | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let mediaTimer: ReturnType<typeof setInterval> | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pullDebounce: ReturnType<typeof setTimeout> | null = null;

let state: SyncStatus['state'] = 'disabled';
let lastPushAt = '';
let lastPullAt = '';
let lastChangeAt = '';
let lastError = '';
let peers: PeerStatus[] = [];
const stats = { pushed: 0, pulled: 0, mediaCopied: 0 };

/** Cache di mtimeMs dei file dei peer per non rileggere JSON se non sono stati toccati da Drive. */
const peerMtimes = new Map<string, number>();
let lastKnownDbStamp = '';
let applyingRemote = false;

function metaFile(): string {
  return path.join(db.DATA_DIR, 'sync-meta.json');
}

function loadMeta(customNodeName?: string): LocalSyncMeta {
  try {
    const raw = JSON.parse(fs.readFileSync(metaFile(), 'utf8')) as Partial<LocalSyncMeta>;
    return {
      nodeId: raw.nodeId || randomUUID().slice(0, 8),
      nodeName: customNodeName || raw.nodeName || os.hostname() || 'PC',
      tombstones: raw.tombstones ?? {},
      baseItems: raw.baseItems ?? {},
    };
  } catch {
    return {
      nodeId: randomUUID().slice(0, 8),
      nodeName: customNodeName || os.hostname() || 'PC',
      tombstones: {},
      baseItems: {},
    };
  }
}

function saveMeta() {
  try {
    fs.mkdirSync(db.DATA_DIR, { recursive: true });
    const tmp = `${metaFile()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(meta), 'utf8');
    fs.renameSync(tmp, metaFile());
  } catch {
    // Ignora errori transitori
  }
}

/** Cartella effettiva dei metadati dentro la cartella condivisa. */
export function syncDataDir(folder = syncFolder): string {
  return path.join(folder, SYNC_SUBDIR);
}

/** Registra un'eliminazione locale perché venga propagata al socio. */
export function recordDelete(ids: string[], deletedAt = new Date().toISOString()) {
  if (!ids.length) return;
  for (const id of ids) {
    meta.tombstones[id] = deletedAt;
    delete meta.baseItems[id];
  }
  saveMeta();
  schedulePush();
}

/** Avvisa il motore di sync che c'è stata una modifica locale (da HTTP o MCP). */
export function notifyLocalWrite() {
  if (!syncFolder || applyingRemote) return;
  schedulePush();
}

export function schedulePush(delayMs = DEBOUNCE_PUSH_MS) {
  if (!syncFolder) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushNow();
  }, delayMs);
}

// --- Portabilità dei percorsi tra i due PC ------------------------------------

const normSlash = (p: string) => p.replace(/\\/g, '/');

/**
 * Converte un percorso assoluto del socio nel percorso corrispondente su questo PC,
 * se il file cade dentro la cartella Google Drive condivisa o dentro una delle cartelle contenuti.
 */
export function translatePath(
  filePath: string,
  remoteSyncRoot: string,
  remoteContentRoots: string[],
  localSyncRoot: string,
  localContentRoots: string[],
): string {
  if (!filePath || filePath.startsWith('media/')) return filePath;
  const norm = normSlash(filePath);

  // 1. Se su questo PC il percorso esiste già esattamente così, tienilo.
  if (fs.existsSync(filePath)) return filePath;

  // 2. Controlla se era dentro la cartella di sync del socio.
  if (remoteSyncRoot && localSyncRoot) {
    const rSync = normSlash(remoteSyncRoot).replace(/\/+$/, '');
    if (norm.toLowerCase().startsWith(rSync.toLowerCase() + '/')) {
      const rel = norm.slice(rSync.length + 1);
      return path.join(localSyncRoot, ...rel.split('/'));
    }
  }

  // 3. Controlla se era dentro una delle allowedRoots del socio e mappala sulla allowedRoot locale.
  for (let i = 0; i < remoteContentRoots.length; i++) {
    const rRoot = normSlash(remoteContentRoots[i]).replace(/\/+$/, '');
    if (!rRoot) continue;
    if (norm.toLowerCase().startsWith(rRoot.toLowerCase() + '/')) {
      const rel = norm.slice(rRoot.length + 1);
      // Cerca in quale radice locale esiste il file o la sottocartella, altrimenti usa la prima radice locale
      for (const lRoot of [localSyncRoot, ...localContentRoots].filter(Boolean)) {
        const candidate = path.join(lRoot, ...rel.split('/'));
        if (fs.existsSync(candidate)) return candidate;
      }
      const fallback = localContentRoots[i] ?? localContentRoots[0] ?? localSyncRoot;
      if (fallback) return path.join(fallback, ...rel.split('/'));
    }
  }

  return filePath;
}

/** Traduce tutti i campi percorso di un Item proveniente da un altro nodo. */
export function translateItemPaths(
  item: Item,
  remoteSyncRoot: string,
  remoteContentRoots: string[],
  localSyncRoot: string,
  localContentRoots: string[],
): Item {
  const tr = (p: string) => translatePath(p, remoteSyncRoot, remoteContentRoots, localSyncRoot, localContentRoots);
  const clone = structuredClone(item);
  if (clone.kind === 'project' && clone.folder) {
    clone.folder = tr(clone.folder);
  } else if (clone.kind === 'character' && Array.isArray(clone.images)) {
    clone.images = clone.images.map((img) => ({ ...img, path: tr(img.path) }));
  } else if (clone.kind === 'shot') {
    if (clone.imageFile) clone.imageFile = tr(clone.imageFile);
    if (clone.videoFile) clone.videoFile = tr(clone.videoFile);
    if (Array.isArray(clone.alternates)) clone.alternates = clone.alternates.map(tr);
  } else if (clone.kind === 'prompt' && clone.resultFile) {
    clone.resultFile = tr(clone.resultFile);
  } else if (clone.kind === 'account' && clone.avatar) {
    clone.avatar = tr(clone.avatar);
  }
  return clone;
}

// --- Merge Intelligente (Field-level + Last-Write-Wins) -----------------------

const META_KEYS = new Set(['id', 'kind', 'createdAt', 'updatedAt']);

/**
 * Unisce l'elemento locale e quello remoto.
 * - Se conosciamo `base` (lo stato dell'elemento all'ultima sincronizzazione) e sia il locale
 *   sia il remoto sono stati modificati dopo `base`, uniamo campo per campo: i campi cambiati
 *   solo dal remoto vengono presi dal remoto, quelli cambiati solo dal locale restano locali,
 *   e se entrambi hanno toccato lo stesso identico campo vince il più recente (`updatedAt`).
 * - Altrimenti vince l'elemento con `updatedAt` maggiore.
 */
export function mergeItem(local: Item, remote: Item, base?: Record<string, unknown>): { merged: Item; changedLocally: boolean } {
  if (JSON.stringify(local) === JSON.stringify(remote)) {
    return { merged: local, changedLocally: false };
  }

  const localTime = local.updatedAt || '';
  const remoteTime = remote.updatedAt || '';

  // Se abbiamo una base comune e entrambi sono cambiati rispetto alla base, facciamo field-level merge!
  if (base) {
    const lRec = local as unknown as Record<string, unknown>;
    const rRec = remote as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = { ...lRec };
    let changed = false;

    const allKeys = new Set([...Object.keys(lRec), ...Object.keys(rRec)]);
    for (const k of allKeys) {
      if (META_KEYS.has(k)) continue;
      const bVal = JSON.stringify(base[k]);
      const lVal = JSON.stringify(lRec[k]);
      const rVal = JSON.stringify(rRec[k]);

      if (lVal === rVal) continue;
      const localChanged = lVal !== bVal;
      const remoteChanged = rVal !== bVal;

      if (remoteChanged && !localChanged) {
        out[k] = structuredClone(rRec[k]);
        changed = true;
      } else if (remoteChanged && localChanged) {
        // Entrambi hanno toccato lo stesso campo: vince il timestamp più recente
        if (remoteTime > localTime) {
          out[k] = structuredClone(rRec[k]);
          changed = true;
        }
      }
    }

    const maxUpdated = remoteTime > localTime ? remoteTime : localTime;
    if (out.updatedAt !== maxUpdated) {
      out.updatedAt = maxUpdated;
      changed = true;
    }
    return { merged: out as unknown as Item, changedLocally: changed };
  }

  // Senza base: Last-Write-Wins puro
  if (remoteTime > localTime) {
    return { merged: remote, changedLocally: true };
  }
  return { merged: local, changedLocally: false };
}

// --- Push e Pull --------------------------------------------------------------

function snapshotFileFor(nodeId: string, dir = syncDataDir()): string {
  return path.join(dir, `snapshot-${nodeId}.json`);
}

function writeAtomicJson(target: string, data: unknown) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
  try {
    fs.renameSync(tmp, target);
  } catch {
    // Su Windows se Google Drive sta leggendo il file in quel millisecondo, copy + unlink funziona sempre
    fs.copyFileSync(tmp, target);
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignora
    }
  }
}

/** Scrive lo snapshot locale nella cartella condivisa. */
export async function pushNow(): Promise<boolean> {
  if (!syncFolder) return false;
  try {
    state = 'syncing';
    lastError = '';
    const dir = syncDataDir();
    fs.mkdirSync(dir, { recursive: true });

    const items = db.all();
    // Aggiorna baseItems per gli elementi correnti
    for (const it of items) {
      meta.baseItems[it.id] = structuredClone(it) as unknown as Record<string, unknown>;
    }
    saveMeta();

    const snap: NodeSnapshot = {
      app: 'ai-story-teller-sync',
      version: 1,
      nodeId: meta.nodeId,
      nodeName: meta.nodeName,
      rootPath: syncFolder,
      contentRoots: contentRootsGetter(),
      updatedAt: new Date().toISOString(),
      items,
      tombstones: meta.tombstones,
    };

    writeAtomicJson(snapshotFileFor(meta.nodeId, dir), snap);
    lastKnownDbStamp = db.stamp();
    lastPushAt = snap.updatedAt;
    stats.pushed++;
    state = 'idle';
    return true;
  } catch (err) {
    state = 'error';
    lastError = `Impossibile scrivere nella cartella condivisa: ${(err as Error).message}`;
    return false;
  }
}

/** Legge gli snapshot degli altri soci nella cartella condivisa e applica le novità in una sola transazione SQLite. */
export async function pullNow(force = false): Promise<{ applied: number; deleted: number }> {
  if (!syncFolder) return { applied: 0, deleted: 0 };
  const dir = syncDataDir();
  if (!fs.existsSync(dir)) {
    if (fs.existsSync(syncFolder)) {
      // Inizializza la sottocartella al primo aggancio
      await pushNow();
    }
    return { applied: 0, deleted: 0 };
  }

  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => /^snapshot-[a-z0-9_-]+\.json$/i.test(f));
  } catch (err) {
    state = 'error';
    lastError = `Impossibile leggere la cartella condivisa: ${(err as Error).message}`;
    return { applied: 0, deleted: 0 };
  }

  const ownFile = `snapshot-${meta.nodeId}.json`;
  const peerFiles = files.filter((f) => f !== ownFile);

  // Controlla mtimeMs: se nessun file del socio è cambiato e non è force, non facciamo nessun parse JSON!
  let anyFileModified = force;
  for (const f of peerFiles) {
    const full = path.join(dir, f);
    try {
      const mtime = fs.statSync(full).mtimeMs;
      if (peerMtimes.get(f) !== mtime) {
        anyFileModified = true;
      }
    } catch {
      // File appena rimosso o temporaneo
    }
  }

  if (!anyFileModified) {
    return { applied: 0, deleted: 0 };
  }

  state = 'syncing';
  lastError = '';
  const snapshots: NodeSnapshot[] = [];
  const nextPeers: PeerStatus[] = [];

  for (const f of peerFiles) {
    const full = path.join(dir, f);
    try {
      const st = fs.statSync(full);
      const raw = JSON.parse(fs.readFileSync(full, 'utf8')) as NodeSnapshot;
      if (raw?.app !== 'ai-story-teller-sync' || !Array.isArray(raw.items)) continue;
      peerMtimes.set(f, st.mtimeMs);
      snapshots.push(raw);
      nextPeers.push({
        nodeId: raw.nodeId,
        nodeName: raw.nodeName || raw.nodeId,
        updatedAt: raw.updatedAt,
        itemsCount: raw.items.length,
      });
    } catch {
      // Se Google Drive sta ancora finendo di scaricare il file, riproviamo al prossimo giro senza segnare il mtime
    }
  }

  peers = nextPeers.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!snapshots.length) {
    state = 'idle';
    lastPullAt = new Date().toISOString();
    return { applied: 0, deleted: 0 };
  }

  // 1. Unisci tutti i tombstones remoti
  let metaChanged = false;
  for (const snap of snapshots) {
    for (const [id, deletedAt] of Object.entries(snap.tombstones ?? {})) {
      if (!meta.tombstones[id] || deletedAt > meta.tombstones[id]) {
        meta.tombstones[id] = deletedAt;
        metaChanged = true;
      }
    }
  }

  // 2. Raccogli gli elementi remoti traducendo i percorsi
  const localRoots = contentRootsGetter();
  const remoteById = new Map<string, Item[]>();
  for (const snap of snapshots) {
    for (const rawItem of snap.items) {
      if (!db.isKind(rawItem.kind) || !rawItem.id) continue;
      const translated = translateItemPaths(rawItem, snap.rootPath, snap.contentRoots ?? [], syncFolder, localRoots);
      const list = remoteById.get(translated.id) ?? [];
      list.push(translated);
      remoteById.set(translated.id, list);
    }
  }

  // 3. Applica in un'unica transazione SQLite veloce
  let applied = 0;
  let deleted = 0;
  applyingRemote = true;
  try {
    const localItems = new Map(db.all().map((i) => [i.id, i]));

    db.transaction(() => {
      // Prima applica le eliminazioni (tombstones) se più recenti dell'elemento locale
      for (const [id, deletedAt] of Object.entries(meta.tombstones)) {
        const loc = localItems.get(id);
        if (loc && deletedAt >= (loc.updatedAt || '')) {
          deleted += db.remove(id, { silentSync: true });
          localItems.delete(id);
          delete meta.baseItems[id];
          metaChanged = true;
        }
      }

      // Poi unisci le creazioni e modifiche remote
      for (const [id, remotes] of remoteById.entries()) {
        // Ordina i remoti dal più vecchio al più recente
        remotes.sort((a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || ''));
        const newestRemote = remotes[remotes.length - 1];

        // Se c'è un tombstone più recente della modifica remota, ignora l'elemento
        const tomb = meta.tombstones[id];
        if (tomb && tomb >= (newestRemote.updatedAt || '')) continue;
        if (tomb && tomb < (newestRemote.updatedAt || '')) {
          delete meta.tombstones[id];
          metaChanged = true;
        }

        const loc = localItems.get(id);
        if (!loc) {
          db.upsertRaw(newestRemote);
          meta.baseItems[id] = structuredClone(newestRemote) as unknown as Record<string, unknown>;
          metaChanged = true;
          applied++;
        } else {
          const { merged, changedLocally } = mergeItem(loc, newestRemote, meta.baseItems[id]);
          if (changedLocally) {
            db.upsertRaw(merged);
            applied++;
          }
          meta.baseItems[id] = structuredClone(merged) as unknown as Record<string, unknown>;
          metaChanged = true;
        }
      }
    });
  } finally {
    applyingRemote = false;
  }

  if (metaChanged) saveMeta();
  lastKnownDbStamp = db.stamp();
  lastPullAt = new Date().toISOString();
  if (applied > 0 || deleted > 0) {
    lastChangeAt = lastPullAt;
    stats.pulled += applied + deleted;
    // Se durante il merge avevamo anche dati locali più recenti o fusi, aggiorniamo il nostro snapshot
    schedulePush(600);
  }
  state = 'idle';
  return { applied, deleted };
}

// --- Sincronizzazione rapida della cartella data/media -----------------------

function walkMedia(root: string, relDir = ''): { rel: string; full: string; size: number }[] {
  const out: { rel: string; full: string; size: number }[] = [];
  const current = path.join(root, relDir);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.endsWith('.tmp')) continue;
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    const full = path.join(root, ...rel.split('/'));
    if (e.isDirectory()) {
      out.push(...walkMedia(root, rel));
    } else if (e.isFile()) {
      try {
        out.push({ rel, full, size: fs.statSync(full).size });
      } catch {
        // ignora
      }
    }
  }
  return out;
}

/**
 * Sincronizza in modo incrementale i file caricati dall'app (`data/media` <-> `<syncFolder>/.storyteller-sync/media`).
 * Copia solo i file mancanti (i nomi in `data/media` hanno già timestamp univoco).
 */
export function syncMediaFiles(): number {
  if (!syncFolder || !fs.existsSync(syncFolder)) return 0;
  const sharedMedia = path.join(syncDataDir(), 'media');
  const localMedia = db.MEDIA_DIR;
  let copied = 0;

  try {
    const localFiles = walkMedia(localMedia);
    const sharedFiles = walkMedia(sharedMedia);
    const localMap = new Map(localFiles.map((f) => [f.rel, f]));
    const sharedMap = new Map(sharedFiles.map((f) => [f.rel, f]));

    // Locale -> Condivisa
    for (const f of localFiles) {
      const sh = sharedMap.get(f.rel);
      if (!sh || sh.size !== f.size) {
        const target = path.join(sharedMedia, ...f.rel.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(f.full, target);
        copied++;
      }
    }

    // Condivisa -> Locale
    for (const f of sharedFiles) {
      const loc = localMap.get(f.rel);
      if (!loc || loc.size !== f.size) {
        const target = path.join(localMedia, ...f.rel.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(f.full, target);
        copied++;
      }
    }
  } catch {
    // Non bloccare se un file media è in uso
  }

  if (copied > 0) stats.mediaCopied += copied;
  return copied;
}

// --- Ciclo di vita e Watcher --------------------------------------------------

export interface ConfigureSyncOptions {
  folder: string;
  nodeName?: string;
  getContentRoots?: () => string[];
}

export async function configureSync(opts: ConfigureSyncOptions): Promise<SyncStatus> {
  stopSync();
  if (opts.getContentRoots) contentRootsGetter = opts.getContentRoots;
  meta = loadMeta(opts.nodeName);
  if (opts.nodeName && opts.nodeName.trim()) {
    meta.nodeName = opts.nodeName.trim();
    saveMeta();
  }
  nodeName = meta.nodeName;
  syncFolder = opts.folder.trim();
  peerMtimes.clear();
  peers = [];

  if (!syncFolder) {
    state = 'disabled';
    lastError = '';
    return getSyncStatus();
  }

  state = 'idle';
  lastError = '';
  lastKnownDbStamp = db.stamp();

  if (!fs.existsSync(syncFolder)) {
    state = 'error';
    lastError = `Cartella condivisa non trovata: ${syncFolder}`;
  } else {
    // Primo pull (per unire subito il lavoro del socio) seguito da push del nostro stato
    await pullNow(true);
    await pushNow();
    syncMediaFiles();
    startWatchers();
  }

  return getSyncStatus();
}

function startWatchers() {
  const dir = syncDataDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    watcher = fs.watch(dir, { persistent: false }, (_eventType, filename) => {
      if (!filename || filename === `snapshot-${meta.nodeId}.json` || filename.endsWith('.tmp')) return;
      if (pullDebounce) clearTimeout(pullDebounce);
      pullDebounce = setTimeout(() => {
        pullDebounce = null;
        void pullNow(false);
      }, 120);
    });
    watcher.on('error', () => {
      // Se fs.watch fallisce su unità virtuali Google Drive, il polling leggero ogni 1.5s copre tutto
    });
  } catch {
    // Continua con il polling leggero
  }

  pollTimer = setInterval(() => {
    if (!syncFolder || !fs.existsSync(syncFolder)) return;
    // Controlla anche se un altro processo locale (es. server MCP di Claude Code) ha scritto nel DB SQLite
    const currentStamp = db.stamp();
    if (currentStamp !== lastKnownDbStamp && !applyingRemote) {
      lastKnownDbStamp = currentStamp;
      void pushNow();
    }
    void pullNow(false);
  }, POLL_INTERVAL_MS);

  mediaTimer = setInterval(() => {
    syncMediaFiles();
  }, MEDIA_SYNC_INTERVAL_MS);
}

export function stopSync() {
  if (watcher) {
    try {
      watcher.close();
    } catch {
      // ignora
    }
    watcher = null;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (mediaTimer) {
    clearInterval(mediaTimer);
    mediaTimer = null;
  }
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (pullDebounce) {
    clearTimeout(pullDebounce);
    pullDebounce = null;
  }
}

/** Forza una sincronizzazione immediata bidirezionale (pull + push + media). */
export async function syncNow(): Promise<SyncStatus> {
  if (!syncFolder) return getSyncStatus();
  if (!fs.existsSync(syncFolder)) {
    state = 'error';
    lastError = `Cartella condivisa non trovata: ${syncFolder}`;
    return getSyncStatus();
  }
  await pullNow(true);
  await pushNow();
  syncMediaFiles();
  if (!watcher && !pollTimer) startWatchers();
  return getSyncStatus();
}

export function getSyncStatus(): SyncStatus {
  return {
    enabled: !!syncFolder,
    folder: syncFolder,
    folderExists: !!syncFolder && fs.existsSync(syncFolder),
    nodeId: meta.nodeId,
    nodeName: nodeName || meta.nodeName,
    state: !syncFolder ? 'disabled' : state,
    lastPushAt,
    lastPullAt,
    lastChangeAt,
    error: lastError,
    peers,
    stats: { ...stats },
  };
}

/**
 * Ricerca automatica delle cartelle di Google Drive per Desktop installate su Windows/macOS,
 * utile per proporre con un clic la cartella all'utente.
 */
export function detectGoogleDriveFolders(): string[] {
  const found: string[] = [];
  const home = os.homedir();

  // Percorsi classici nella cartella utente
  const candidates = [
    path.join(home, 'Google Drive'),
    path.join(home, 'Il mio Drive'),
    path.join(home, 'My Drive'),
  ];

  // Su Windows, Google Drive per Desktop monta spesso un'unità virtuale (G:\Il mio Drive o G:\My Drive)
  if (process.platform === 'win32') {
    for (const letter of ['G', 'H', 'I', 'D', 'E', 'F', 'Z']) {
      candidates.push(`${letter}:\\Il mio Drive`);
      candidates.push(`${letter}:\\My Drive`);
      candidates.push(`${letter}:\\Drive condivisi`);
      candidates.push(`${letter}:\\Shared drives`);
    }
  }

  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) {
        found.push(path.resolve(c));
      }
    } catch {
      // ignora unità non pronte
    }
  }
  return [...new Set(found)];
}
