// Server locale: API REST + interfaccia compilata (dist/).
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import * as db from './db.ts';
import { updateShot } from './service.ts';
import { applyScan, episodeCuts, scanProject } from './scanner.ts';
import { applySeason, previewSeason, type SeasonImportOptions } from './importers/applySeason.ts';
import { episodeMarkdown, timelineCsv } from './exporters.ts';
import { defaultPackDir, elevenLabsScript, remotionPack, remotionTimeline } from './production.ts';
import { appVersion, loadConfig, ROOT, saveAllowedRoots } from './config.ts';
import type { Item, Kind } from '../shared/types.ts';

const config = loadConfig();

db.openDb();
seed();

const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 50 * 1024 * 1024 });
await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } });

// Solo la pagina dell'app può usare le API: niente richieste da altri siti aperti nel browser
// (Origin estraneo) né da nomi host diversi da localhost (DNS rebinding).
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
app.addHook('onRequest', async (req, reply) => {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
  const origin = req.headers.origin;
  if (!LOCAL_HOSTS.has(host) || (origin && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin))) {
    return reply.status(403).send({ error: 'Richiesta non consentita: AI Story Teller accetta solo richieste da questo computer.' });
  }
});

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

function kindParam(k: string): Kind {
  if (!db.isKind(k)) throw Object.assign(new Error(`Tipo sconosciuto: ${k}`), { statusCode: 400 });
  return k;
}

/** Risolve un percorso "media/..." o assoluto, solo dentro le cartelle consentite. */
function resolveFile(p: string): string {
  const full = p.startsWith('media/') ? path.join(db.DATA_DIR, p) : path.resolve(p);
  const roots = [db.MEDIA_DIR, ...config.allowedRoots].map((r) => path.resolve(r).toLowerCase() + path.sep);
  if (!roots.some((r) => (full.toLowerCase() + path.sep).startsWith(r))) {
    throw Object.assign(new Error('Percorso fuori dalle cartelle consentite: aggiungila in Import e backup → Cartelle dei contenuti.'), { statusCode: 403 });
  }
  return full;
}

app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
  reply.status(err.statusCode ?? 500).send({ error: err.message });
});

// --- CRUD generico ---------------------------------------------------------
app.get<{ Params: { kind: string }; Querystring: Record<string, string> }>('/api/items/:kind', (req) => {
  const { accountId, projectId, episodeId, shotId, characterId } = req.query;
  return db.list(kindParam(req.params.kind), { accountId, projectId, episodeId, shotId, characterId });
});

app.get<{ Params: { kind: string; id: string } }>('/api/items/:kind/:id', (req, reply) => {
  const item = db.get(kindParam(req.params.kind), req.params.id);
  return item ?? reply.status(404).send({ error: 'Non trovato' });
});

app.post<{ Params: { kind: string }; Body: Partial<Item> }>('/api/items/:kind', (req) => {
  return db.create(kindParam(req.params.kind), req.body as never);
});

app.patch<{ Params: { kind: string; id: string }; Body: Partial<Item> }>('/api/items/:kind/:id', (req, reply) => {
  const kind = kindParam(req.params.kind);
  const item = kind === 'shot' ? updateShot(req.params.id, req.body as never) : db.update(kind, req.params.id, req.body as never);
  return item ?? reply.status(404).send({ error: 'Non trovato' });
});

app.delete<{ Params: { kind: string; id: string } }>('/api/items/:kind/:id', (req) => {
  kindParam(req.params.kind);
  return { deleted: db.remove(req.params.id) };
});

app.get<{ Querystring: { q?: string } }>('/api/search', (req) => {
  const q = (req.query.q ?? '').trim();
  return q.length < 2 ? [] : db.search(q);
});

// --- File e media ----------------------------------------------------------
app.get<{ Querystring: { path: string } }>('/api/file', async (req, reply) => {
  const full = resolveFile(req.query.path ?? '');
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return reply.status(404).send({ error: 'File non trovato' });
  const size = fs.statSync(full).size;
  const type = MIME[path.extname(full).toLowerCase()] ?? 'application/octet-stream';
  reply.header('Content-Type', type).header('Accept-Ranges', 'bytes').header('Cache-Control', 'no-cache');
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    reply.status(206).header('Content-Range', `bytes ${start}-${end}/${size}`).header('Content-Length', end - start + 1);
    return reply.send(fs.createReadStream(full, { start, end }));
  }
  reply.header('Content-Length', size);
  return reply.send(fs.createReadStream(full));
});

app.post<{ Querystring: { projectId?: string } }>('/api/upload', async (req) => {
  const file = await req.file();
  if (!file) throw Object.assign(new Error('Nessun file'), { statusCode: 400 });
  const project = req.query.projectId ? db.get('project', req.query.projectId) : undefined;
  const rel = path.posix.join('media', project?.accountId ?? 'generale', project?.id ?? 'generale');
  const dir = path.join(db.DATA_DIR, rel);
  fs.mkdirSync(dir, { recursive: true });
  const safe = file.filename.replace(/[<>:"/\\|?*]/g, '_');
  const name = `${Date.now().toString(36)}-${safe}`;
  await pipeline(file.file, fs.createWriteStream(path.join(dir, name)));
  return { path: `${rel}/${name}` };
});

/** Elenco delle sottocartelle per scegliere la cartella di un progetto. */
app.get<{ Querystring: { path?: string } }>('/api/fs', (req) => {
  const roots = config.allowedRoots;
  if (!req.query.path) return { path: '', parent: '', dirs: roots, files: [] };
  const dir = resolveFile(req.query.path);
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const parent = path.dirname(dir);
  return {
    path: dir,
    parent: roots.some((r) => path.resolve(r).toLowerCase() === dir.toLowerCase()) ? '' : parent,
    dirs: entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules').map((e) => path.join(dir, e.name)),
    files: entries.filter((e) => e.isFile()).map((e) => path.join(dir, e.name)),
  };
});

// --- Import / export -------------------------------------------------------
app.get('/api/export', (_req, reply) => {
  const stamp = new Date().toISOString().slice(0, 10);
  reply.header('Content-Disposition', `attachment; filename="ai-story-teller-${stamp}.json"`);
  return { app: 'ai-story-teller', version: 1, exportedAt: new Date().toISOString(), items: db.all() };
});

app.post<{ Body: { items: Item[]; mode?: 'merge' | 'replace' } }>('/api/import/json', (req) => {
  if (!Array.isArray(req.body?.items)) throw Object.assign(new Error('File di backup non valido'), { statusCode: 400 });
  db.importAll(req.body.items, req.body.mode === 'replace' ? 'replace' : 'merge');
  return { imported: req.body.items.length };
});

app.post<{ Body: SeasonImportOptions }>('/api/import/season/preview', (req) => previewSeason(req.body));
app.post<{ Body: SeasonImportOptions }>('/api/import/season/apply', (req) => applySeason(req.body));

app.get<{ Params: { id: string } }>('/api/projects/:id/scan', (req) => scanProject(req.params.id));
app.post<{ Params: { id: string } }>('/api/projects/:id/scan', (req) => ({ updated: applyScan(req.params.id) }));

app.get<{ Params: { id: string } }>('/api/episodes/:id/cuts', (req, reply) => {
  if (!db.get('episode', req.params.id)) return reply.status(404).send({ error: 'Non trovato' });
  return episodeCuts(req.params.id);
});

app.get<{ Params: { id: string } }>('/api/episodes/:id/remotion', (req, reply) => {
  const ep = db.get('episode', req.params.id);
  if (!ep) return reply.status(404).send({ error: 'Non trovato' });
  const { shots, total, skipped } = remotionTimeline(ep);
  return { dir: defaultPackDir(ep), shots: shots.length, total, skipped };
});

// Crea il pacchetto Remotion: scrive solo nelle cartelle dei contenuti o nell'archivio dell'app.
app.post<{ Params: { id: string }; Body: { dir?: string; overwrite?: boolean } }>('/api/episodes/:id/remotion', (req, reply) => {
  const ep = db.get('episode', req.params.id);
  if (!ep) return reply.status(404).send({ error: 'Non trovato' });
  const dir = path.resolve(req.body?.dir || defaultPackDir(ep));
  const roots = [db.DATA_DIR, ...config.allowedRoots].map((r) => path.resolve(r).toLowerCase() + path.sep);
  if (!roots.some((r) => (dir.toLowerCase() + path.sep).startsWith(r))) {
    throw Object.assign(new Error('La cartella del pacchetto deve stare dentro una delle cartelle dei contenuti.'), { statusCode: 403 });
  }
  return remotionPack(ep, dir, { overwrite: !!req.body?.overwrite });
});

app.get<{ Params: { id: string; format: string } }>('/api/episodes/:id/export.:format', (req, reply) => {
  const ep = db.get('episode', req.params.id);
  if (!ep) return reply.status(404).send({ error: 'Non trovato' });
  const base = `${ep.code || 'episodio'}_${ep.title}`.replace(/[<>:"/\\|?*]/g, '_');
  if (req.params.format === 'csv') {
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${encodeURIComponent(base)}_timeline.csv"`);
    return timelineCsv(ep);
  }
  if (req.params.format === 'elevenlabs') {
    reply.header('Content-Type', 'text/plain; charset=utf-8').header('Content-Disposition', `attachment; filename="${encodeURIComponent(ep.code || 'episodio')}_doppiaggio_ElevenLabs.txt"`);
    return elevenLabsScript(ep);
  }
  reply.header('Content-Type', 'text/markdown; charset=utf-8').header('Content-Disposition', `attachment; filename="${encodeURIComponent(base)}.md"`);
  return episodeMarkdown(ep);
});

app.get('/api/config', () => ({
  version: appVersion(),
  dataDir: db.DATA_DIR,
  allowedRoots: config.allowedRoots.map((p) => ({ path: p, exists: fs.existsSync(p) })),
}));

app.put<{ Body: { allowedRoots: string[] } }>('/api/config/roots', (req) => {
  if (!Array.isArray(req.body?.allowedRoots)) throw Object.assign(new Error('Elenco di cartelle non valido'), { statusCode: 400 });
  config.allowedRoots = saveAllowedRoots(req.body.allowedRoots);
  return { allowedRoots: config.allowedRoots.map((p) => ({ path: p, exists: fs.existsSync(p) })) };
});
app.get('/api/changes', () => ({ stamp: db.stamp() }));

// --- Interfaccia -----------------------------------------------------------
const DIST = path.join(ROOT, 'dist');
if (fs.existsSync(DIST)) {
  await app.register(fastifyStatic, { root: DIST });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Non trovato' });
    return reply.sendFile('index.html');
  });
} else {
  app.setNotFoundHandler((_req, reply) =>
    reply.status(503).type('text/plain; charset=utf-8').send('Interfaccia non ancora compilata: avvia AI Story Teller con start.bat (oppure esegui "npm run build").'),
  );
}

/** Al primo avvio: stili generici disponibili in ogni progetto. */
function seed() {
  if (db.list('style', { projectId: '' }).length || db.all().length) return;
  db.create('style', {
    name: 'Cinematic 9:16',
    target: 'image',
    prefix: 'Photorealistic cinematic still, vertical 9:16, 35mm lens, shallow depth of field, soft natural light, subtle film grain. No text, no logos, no watermarks.',
  });
  db.create('style', {
    name: 'Selfie social',
    target: 'image',
    prefix: 'Vertical 9:16 smartphone front-camera selfie look, natural unpolished social media style, slight wide-angle distortion.',
  });
  db.create('style', {
    name: 'Image-to-video 9:16',
    target: 'video',
    params: 'image-to-video, 9:16, 5 s',
    avoid: 'camera shake, morphing hands, extra fingers, warped text, flickering, talking or open mouths',
  });
}

const port = config.port;
const url = `http://localhost:${port}`;
const openBrowser = () => process.env.OPEN_BROWSER === '1' && exec(`start "" ${url}`);
try {
  await app.listen({ port, host: '127.0.0.1' });
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
  // La porta è occupata: se è già AI Story Teller basta aprire il browser.
  const running = await fetch(`${url}/api/config`).then((r) => r.ok, () => false);
  if (running) {
    console.log(`AI Story Teller è già aperto: ${url}`);
    openBrowser();
    process.exit(0);
  }
  console.error(`La porta ${port} è usata da un altro programma. Scegli un'altra porta in config.local.json, es. { "port": 5179 }.`);
  process.exit(1);
}
console.log(`AI Story Teller ${appVersion()}: ${url}`);
openBrowser();
