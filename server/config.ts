// Configurazione: config.json (valori distribuiti con l'app) + config.local.json (impostazioni di questo PC).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ROOT = path.join(import.meta.dirname, '..');
const BASE_FILE = path.join(ROOT, 'config.json');
const LOCAL_FILE = path.join(ROOT, 'config.local.json');

export interface Config {
  port: number;
  /** Cartelle da cui l'app può leggere immagini, video e documenti ("~" = cartella utente). */
  allowedRoots: string[];
}

function readJson(file: string): Partial<Config> {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`${path.basename(file)} non è un JSON valido: ${(err as Error).message}`);
  }
}

export function expandHome(p: string) {
  return path.resolve(p.replace(/^~(?=$|[\\/])/, os.homedir()));
}

export function loadConfig(): Config {
  const base = readJson(BASE_FILE);
  const local = readJson(LOCAL_FILE);
  return {
    port: Number(process.env.PORT ?? local.port ?? base.port ?? 5178),
    allowedRoots: (local.allowedRoots ?? base.allowedRoots ?? ['~']).map(expandHome),
  };
}

/** Salva le cartelle consentite nelle impostazioni locali (le altre chiavi restano). */
export function saveAllowedRoots(roots: string[]): string[] {
  const clean = [...new Set(roots.map((r) => r.trim()).filter(Boolean).map(expandHome))];
  const local = readJson(LOCAL_FILE);
  fs.writeFileSync(LOCAL_FILE, JSON.stringify({ ...local, allowedRoots: clean }, null, 2) + '\n', 'utf8');
  return clean;
}

export function appVersion(): string {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  } catch {
    return '';
  }
}
