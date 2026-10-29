// Avvio di AI Story Teller: controlla Node, installa le dipendenze, ricompila l'interfaccia se serve, avvia il server.
// JavaScript semplice (non TypeScript) così può dare un messaggio chiaro anche con versioni di Node vecchie.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN = [22, 18];

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < MIN[0] || (major === MIN[0] && minor < MIN[1])) {
  console.error(`Serve Node.js ${MIN.join('.')} o più recente (installato: ${process.versions.node}).`);
  console.error('Scarica la versione LTS da https://nodejs.org e riapri start.bat.');
  process.exit(1);
}

function run(args, label) {
  console.log(label);
  const r = spawnSync('npm', args, { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`Comando non riuscito: npm ${args.join(' ')}`);
    process.exit(1);
  }
}

const mtime = (p) => {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
};

/** Data di modifica più recente in una cartella (ricorsiva). */
function newest(p) {
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    return 0;
  }
  if (!st.isDirectory()) return st.mtimeMs;
  return Math.max(st.mtimeMs, ...fs.readdirSync(p).map((f) => newest(path.join(p, f))));
}

// Dipendenze: assenti o più vecchie del package-lock.json.
const installed = path.join(ROOT, 'node_modules', '.package-lock.json');
if (!fs.existsSync(installed) || mtime(path.join(ROOT, 'package-lock.json')) > mtime(installed)) {
  run(['ci', '--no-audit', '--no-fund'], 'Installo le dipendenze (solo la prima volta o dopo un aggiornamento)…');
}

// Interfaccia: assente o più vecchia dei sorgenti.
const built = mtime(path.join(ROOT, 'dist', 'index.html'));
const sources = Math.max(newest(path.join(ROOT, 'src')), newest(path.join(ROOT, 'shared')), mtime(path.join(ROOT, 'index.html')), mtime(path.join(ROOT, 'package-lock.json')));
if (!built || sources > built) run(['run', 'build'], 'Preparo l\'interfaccia…');

process.env.OPEN_BROWSER ??= '1';
await import(pathToFileURL(path.join(ROOT, 'server', 'index.ts')).href);
