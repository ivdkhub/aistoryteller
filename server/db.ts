// Archivio SQLite: una tabella "items" con colonne indice per le relazioni e i dati in JSON.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaults, KINDS, type Item, type ItemByKind, type Kind } from '../shared/types.ts';

export const DATA_DIR = path.resolve(process.env.STORYTELLER_DATA ?? path.join(import.meta.dirname, '..', 'data'));
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DB_FILE = path.join(DATA_DIR, 'storyteller.db');

/** Colonne indice: chiave nei dati → colonna SQL. */
const LINKS = {
  accountId: 'account_id',
  projectId: 'project_id',
  episodeId: 'episode_id',
  shotId: 'shot_id',
  characterId: 'character_id',
} as const;
export type LinkKey = keyof typeof LINKS;

let db: DatabaseSync;

export function openDb(file = DB_FILE): DatabaseSync {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (file === DB_FILE) backup();
  db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      account_id TEXT, project_id TEXT, episode_id TEXT, shot_id TEXT, character_id TEXT,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS items_kind ON items(kind);
    CREATE INDEX IF NOT EXISTS items_project ON items(project_id);
    CREATE INDEX IF NOT EXISTS items_episode ON items(episode_id);
    CREATE INDEX IF NOT EXISTS items_account ON items(account_id);
  `);
  return db;
}

/** Copia del database all'avvio, una al giorno, tenendo le ultime 14. */
function backup() {
  if (!fs.existsSync(DB_FILE)) return;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const target = path.join(BACKUP_DIR, `storyteller-${new Date().toISOString().slice(0, 10)}.db`);
  if (!fs.existsSync(target)) fs.copyFileSync(DB_FILE, target);
  const old = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).sort().slice(0, -14);
  for (const f of old) fs.rmSync(path.join(BACKUP_DIR, f));
}

interface Row {
  id: string;
  kind: Kind;
  data: string;
  created_at: string;
  updated_at: string;
}

function fromRow(row: Row): Item {
  const data = JSON.parse(row.data);
  return { ...defaults(row.kind), ...data, id: row.id, kind: row.kind, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function isKind(k: string): k is Kind {
  return (KINDS as string[]).includes(k);
}

export function get<K extends Kind>(kind: K, id: string): ItemByKind[K] | undefined {
  const row = db.prepare('SELECT * FROM items WHERE id = ? AND kind = ?').get(id, kind) as Row | undefined;
  return row ? (fromRow(row) as ItemByKind[K]) : undefined;
}

export function getAny(id: string): Item | undefined {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as Row | undefined;
  return row ? fromRow(row) : undefined;
}

export function list<K extends Kind>(kind: K, filter: Partial<Record<LinkKey, string>> = {}): ItemByKind[K][] {
  const where = ['kind = ?'];
  const params: string[] = [kind];
  for (const [key, col] of Object.entries(LINKS)) {
    const v = filter[key as LinkKey];
    if (v === '') where.push(`${col} IS NULL`);
    else if (v !== undefined) {
      where.push(`${col} = ?`);
      params.push(v);
    }
  }
  const rows = db.prepare(`SELECT * FROM items WHERE ${where.join(' AND ')} ORDER BY created_at`).all(...params) as unknown as Row[];
  return rows.map(fromRow) as ItemByKind[K][];
}

export function all(): Item[] {
  return (db.prepare('SELECT * FROM items ORDER BY created_at').all() as unknown as Row[]).map(fromRow);
}

/** Completa le relazioni a monte: da shot → episodio → progetto → account. */
function fillLinks(data: Record<string, unknown>) {
  if (data.shotId && !data.episodeId) {
    const s = get('shot', String(data.shotId));
    if (s) data.episodeId = s.episodeId;
  }
  if (data.episodeId && !data.projectId) {
    const e = get('episode', String(data.episodeId));
    if (e) data.projectId = e.projectId;
  }
  if (data.projectId && !data.accountId) {
    const p = get('project', String(data.projectId));
    if (p) data.accountId = p.accountId;
  }
}

function linkValues(data: Record<string, unknown>) {
  return Object.keys(LINKS).map((k) => (data[k] ? String(data[k]) : null));
}

function strip(data: Record<string, unknown>) {
  const { id: _id, kind: _kind, createdAt: _c, updatedAt: _u, ...rest } = data;
  return rest;
}

export function create<K extends Kind>(kind: K, input: Partial<ItemByKind[K]>, opts: { id?: string; createdAt?: string } = {}): ItemByKind[K] {
  const data: Record<string, unknown> = { ...defaults(kind), ...strip(input as Record<string, unknown>) };
  fillLinks(data);
  const id = opts.id ?? randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO items (id, kind, account_id, project_id, episode_id, shot_id, character_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, kind, ...linkValues(data), JSON.stringify(data), opts.createdAt ?? now, now);
  return get(kind, id)!;
}

export function update<K extends Kind>(kind: K, id: string, patch: Partial<ItemByKind[K]>): ItemByKind[K] | undefined {
  const current = get(kind, id);
  if (!current) return undefined;
  const data: Record<string, unknown> = { ...strip(current as unknown as Record<string, unknown>), ...strip(patch as Record<string, unknown>) };
  fillLinks(data);
  db.prepare(
    'UPDATE items SET account_id = ?, project_id = ?, episode_id = ?, shot_id = ?, character_id = ?, data = ?, updated_at = ? WHERE id = ?',
  ).run(...linkValues(data), JSON.stringify(data), new Date().toISOString(), id);
  return get(kind, id);
}

/** Elimina un elemento e tutto ciò che ne dipende. */
export function remove(id: string): number {
  const res = db
    .prepare('DELETE FROM items WHERE id = ? OR account_id = ? OR project_id = ? OR episode_id = ? OR shot_id = ?')
    .run(id, id, id, id, id);
  return Number(res.changes);
}

export function search(q: string, limit = 60): Item[] {
  const like = `%${q.replace(/[%_]/g, (c) => '\\' + c)}%`;
  const rows = db
    .prepare("SELECT * FROM items WHERE data LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?")
    .all(like, limit) as unknown as Row[];
  return rows.map(fromRow);
}

export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Sostituisce o fonde l'intero archivio (import JSON). */
export function importAll(items: Item[], mode: 'merge' | 'replace') {
  transaction(() => {
    if (mode === 'replace') db.exec('DELETE FROM items');
    for (const it of items) {
      if (!isKind(it.kind)) continue;
      db.prepare('DELETE FROM items WHERE id = ?').run(it.id);
      create(it.kind, it as never, { id: it.id, createdAt: it.createdAt });
    }
  });
}
