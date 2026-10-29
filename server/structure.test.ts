import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as db from './db.ts';
import { createFolders, planFolders, safeName, upsertStructure } from './structure.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyteller-'));

beforeAll(() => {
  db.openDb(path.join(dir, 'test.db'));
});

describe('upsertStructure', () => {
  it('crea una struttura completa e la aggiorna senza doppioni', () => {
    const first = upsertStructure({
      account: { name: 'Prova', handle: '@prova' },
      project: { title: 'Serie', type: 'characters' },
      characters: [{ name: 'ANNA', fixedDescription: 'red hair' }],
      episodes: [{ code: 'EP01', title: 'Pilot', shots: [{ title: 'Porta', characters: ['anna'] }, { title: 'Strada' }] }],
    });
    expect(first.created).toHaveLength(6);
    const shots = db.list('shot', { projectId: first.projectId });
    expect(shots.map((s) => s.code).sort()).toEqual(['EP01_S01', 'EP01_S02']);
    expect(shots.find((s) => s.code === 'EP01_S01')!.characterIds).toHaveLength(1);

    const second = upsertStructure({ accountId: first.accountId, project: { title: 'Serie' }, episodes: [{ code: 'EP01', caption: 'ciao', shots: [{ code: 'EP01_S02', status: 'image' }] }] });
    expect(second.created).toHaveLength(0);
    expect(db.list('episode', { projectId: first.projectId })[0]).toMatchObject({ title: 'Pilot', caption: 'ciao' });
    expect(db.list('shot', { projectId: first.projectId }).find((s) => s.code === 'EP01_S02')!.status).toBe('image');
  });

  it('segnala i personaggi inesistenti', () => {
    const { projectId } = upsertStructure({ account: { name: 'Prova' }, project: { title: 'Altro' } });
    expect(() => upsertStructure({ projectId, episodes: [{ code: 'EP01', shots: [{ characters: ['NESSUNO'] }] }] })).toThrow(/NESSUNO/);
  });
});

describe('cartelle locali', () => {
  it('pianifica e crea cartelle e schede senza sovrascrivere', () => {
    const { projectId } = upsertStructure({ account: { name: 'Prova' }, project: { title: 'Serie: "uno"?' }, characters: [{ name: 'BOB' }], episodes: [{ code: 'EP01' }] });
    const root = path.join(dir, 'cartelle');
    const plan = planFolders(projectId!, root);
    expect(plan.projectDir).toBe(path.join(root, safeName('Serie: "uno"?')));
    const res = createFolders(projectId!, root);
    expect(fs.existsSync(path.join(plan.projectDir, 'Personaggi', 'BOB.md'))).toBe(true);
    expect(fs.existsSync(path.join(plan.projectDir, 'EP01', 'scartate'))).toBe(true);
    expect(res.linked).toBe(true);
    expect(db.get('project', projectId!)!.folder).toBe(plan.projectDir);
    expect(createFolders(projectId!, root).created).toHaveLength(0);
  });
});
