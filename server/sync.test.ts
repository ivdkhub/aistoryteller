import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as db from './db.ts';
import {
  configureSync,
  mergeItem,
  pullNow,
  pushNow,
  recordDelete,
  stopSync,
  syncDataDir,
  syncMediaFiles,
  translatePath,
  type NodeSnapshot,
} from './sync.ts';

let tmpRoot = '';
let syncDir = '';

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'storyteller-sync-'));
  syncDir = path.join(tmpRoot, 'gdrive');
  fs.mkdirSync(syncDir, { recursive: true });
  db.openDb(path.join(tmpRoot, 'local.db'));
  db.setWriteHook((ev) => {
    if (ev.type === 'delete') recordDelete(ev.ids);
  });
});

afterEach(() => {
  stopSync();
  db.setWriteHook(null);
});

describe('mergeItem (fusione campo per campo senza conflitti)', () => {
  it('unisce modifiche simultanee a campi diversi dello stesso elemento', () => {
    const base = db.create('shot', {
      code: 'EP01_S01',
      title: 'Titolo base',
      imagePrompt: 'Prompt base',
      videoPrompt: 'Video base',
      status: 'todo',
    });

    // Socio A modifica imagePrompt a t=10
    const local = {
      ...base,
      imagePrompt: 'Prompt aggiornato da Socio A',
      updatedAt: '2026-10-30T10:00:10.000Z',
    };

    // Socio B modifica videoPrompt e status a t=12
    const remote = {
      ...base,
      videoPrompt: 'Video aggiornato da Socio B',
      status: 'video' as const,
      updatedAt: '2026-10-30T10:00:12.000Z',
    };

    const { merged, changedLocally } = mergeItem(local, remote, base as unknown as Record<string, unknown>);
    expect(changedLocally).toBe(true);
    expect(merged).toMatchObject({
      imagePrompt: 'Prompt aggiornato da Socio A',
      videoPrompt: 'Video aggiornato da Socio B',
      status: 'video',
      updatedAt: '2026-10-30T10:00:12.000Z',
    });
  });

  it('usa Last-Write-Wins se entrambi i soci modificano lo stesso campo', () => {
    const base = db.create('idea', { title: 'Vecchia', description: 'Base' });
    const local = { ...base, title: 'Titolo locale', updatedAt: '2026-10-30T10:00:05.000Z' };
    const remote = { ...base, title: 'Titolo remoto più recente', updatedAt: '2026-10-30T10:00:09.000Z' };

    const { merged } = mergeItem(local, remote, base as unknown as Record<string, unknown>);
    expect((merged as typeof base).title).toBe('Titolo remoto più recente');
  });
});

describe('translatePath (portabilità dei percorsi tra i due PC)', () => {
  it('rimappa i percorsi della cartella Google Drive del socio su quella locale', () => {
    const translated = translatePath(
      'G:\\My Drive\\TeamFolder\\BankError\\EP01\\EP01_S01.png',
      'G:\\My Drive\\TeamFolder',
      [],
      'C:\\Users\\ivdk\\Google Drive\\TeamFolder',
      [],
    );
    expect(translated).toBe(path.join('C:\\Users\\ivdk\\Google Drive\\TeamFolder', 'BankError', 'EP01', 'EP01_S01.png'));
  });
});

describe('sincronizzazione continua su cartella condivisa', () => {
  it('esporta lo snapshot locale, importa quello del socio e propaga le eliminazioni (tombstones)', async () => {
    const acc = db.create('account', { name: 'Studio', handle: '@studio' });
    const toDelete = db.create('idea', { accountId: acc.id, title: 'Da cancellare' });

    const status = await configureSync({
      folder: syncDir,
      nodeName: 'Socio 1',
      getContentRoots: () => [syncDir],
    });
    expect(status.enabled).toBe(true);
    expect(status.state).toBe('idle');

    // Simula lo snapshot scritto dal Socio 2 nella cartella condivisa Google Drive
    const remoteIdeaId = 'idea-socio-2';
    const peerSnap: NodeSnapshot = {
      app: 'ai-story-teller-sync',
      version: 1,
      nodeId: 'peer9999',
      nodeName: 'Socio 2',
      rootPath: 'G:\\My Drive\\Shared',
      contentRoots: ['G:\\My Drive\\Shared'],
      updatedAt: new Date(Date.now() + 5000).toISOString(),
      items: [
        {
          id: remoteIdeaId,
          kind: 'idea',
          accountId: acc.id,
          projectId: '',
          title: 'Idea dal Socio 2',
          description: 'Sincronizzata via Drive',
          tags: ['drive'],
          status: 'inbox',
          createdAt: new Date().toISOString(),
          updatedAt: new Date(Date.now() + 5000).toISOString(),
        },
      ],
      tombstones: {
        [toDelete.id]: new Date(Date.now() + 5000).toISOString(),
      },
    };

    const peerFile = path.join(syncDataDir(syncDir), 'snapshot-peer9999.json');
    fs.writeFileSync(peerFile, JSON.stringify(peerSnap), 'utf8');

    const res = await pullNow(false);
    expect(res.applied).toBe(1);
    expect(res.deleted).toBe(1);

    // L'idea del Socio 2 è ora nel DB locale e quella eliminata dal Socio 2 è sparita
    expect(db.get('idea', remoteIdeaId)?.title).toBe('Idea dal Socio 2');
    expect(db.get('idea', toDelete.id)).toBeUndefined();

    // Un secondo pull senza modifiche al file non rilegge nulla (0 applicati)
    const second = await pullNow(false);
    expect(second.applied).toBe(0);
    expect(second.deleted).toBe(0);

    // Eliminazione locale genera un tombstone nello snapshot locale
    db.remove(remoteIdeaId);
    await pushNow();
    const ownFiles = fs.readdirSync(syncDataDir(syncDir)).filter((f) => f.startsWith('snapshot-') && !f.includes('peer9999'));
    const ownSnap = JSON.parse(fs.readFileSync(path.join(syncDataDir(syncDir), ownFiles[0]), 'utf8')) as NodeSnapshot;
    expect(ownSnap.tombstones[remoteIdeaId]).toBeTruthy();
  });

  it('sincronizza i file media caricati tra cartella condivisa e data/media', async () => {
    await configureSync({ folder: syncDir, nodeName: 'Socio 1' });
    const sharedMediaFile = path.join(syncDataDir(syncDir), 'media', 'generale', 'generale', 'test-socio.png');
    fs.mkdirSync(path.dirname(sharedMediaFile), { recursive: true });
    fs.writeFileSync(sharedMediaFile, 'contenuto-immagine');

    const copied = syncMediaFiles();
    expect(copied).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(db.MEDIA_DIR, 'generale', 'generale', 'test-socio.png'))).toBe(true);
  });
});
