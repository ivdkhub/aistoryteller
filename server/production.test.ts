import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as db from './db.ts';
import { upsertStructure } from './structure.ts';
import { elevenLabsScript, remotionPack, remotionTimeline, voiceCharacter } from './production.ts';
import { generationQueue } from '../shared/queue.ts';
import { parseScript } from '../shared/script.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyteller-prod-'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let projectId = '';

beforeAll(() => {
  db.openDb(path.join(dir, 'test.db'));
  fs.writeFileSync(path.join(dir, 'EP01_S01.png'), PNG);
  fs.writeFileSync(path.join(dir, 'EP01_S02_VID.mp4'), 'video');
  const script = [
    '[loud] Nine point four million dollars!',
    'KADE: [calm] Long night. This one is yours.',
    '>>> RAMO MOVE',
    '[tense] You move the money.',
    '(nota di regia)',
    'TELLER: [awkward] Everything looks fine.',
  ].join('\n');
  projectId = upsertStructure({
    account: { name: 'Prova' },
    project: { title: 'Serie', type: 'characters' },
    characters: [
      { name: 'MR. KADE', voice: { tool: 'ElevenLabs', name: 'Kade deep', description: 'profonda', design: '' } },
      { name: 'LA CASSIERA', images: [{ path: 'C:\\x\\BANK TELLER.png', label: 'Scheda' }], voice: { tool: 'ElevenLabs', name: '', description: '', design: 'Woman in her fifties' } },
    ],
    episodes: [{
      code: 'EP01', title: 'Pilot', script,
      shots: [
        { code: 'EP01_S01', title: 'Hook', imageFile: path.join(dir, 'EP01_S01.png'), status: 'image', imagePrompt: 'night street, darkness' },
        { code: 'EP01_S02', title: 'Porta', videoFile: path.join(dir, 'EP01_S02_VID.mp4'), imageFile: path.join(dir, 'EP01_S01.png'), status: 'video', animPriority: 'alta', cut: 'usare 0,5–2,2 s' },
        { code: 'EP01_S03', title: 'Da fare', imagePrompt: 'p', animPriority: 'media' },
        { code: 'EP01_S04', title: 'Grafica', noImage: true },
      ],
    }],
  }).projectId!;
});

describe('copione', () => {
  it('distingue narratore, personaggi, rami e indicazioni di regia', () => {
    const lines = parseScript('[x] Ciao.\nKADE: [y] Salve.\n>>> RAMO A\n(regia)');
    expect(lines.map((l) => l.speaker || l.text)).toEqual(['NARRATOR', 'KADE', '>>> RAMO A']);
  });

  it('abbina le voci ai personaggi anche per parola o per scheda', () => {
    const chars = db.list('character', { projectId });
    expect(voiceCharacter('KADE', chars)?.name).toBe('MR. KADE');
    expect(voiceCharacter('TELLER', chars)?.name).toBe('LA CASSIERA');
  });

  it('esporta il testo per ElevenLabs con voci, design e battute per voce', () => {
    const ep = db.list('episode', { projectId })[0];
    const txt = elevenLabsScript(ep);
    expect(txt).toMatch(/KADE\s+Kade deep — profonda/);
    expect(txt).toMatch(/TELLER\s+"Woman in her fifties"/);
    expect(txt).toContain('KADE: [calm] Long night.');
    expect(txt).toContain('>>> RAMO MOVE');
    expect(txt).toContain('--- TELLER ---');
    expect(txt).not.toContain('nota di regia');
  });
});

describe('lista di generazione', () => {
  it('separa immagini e video da fare, escludendo grafica e scarti', () => {
    const shots = db.list('shot', { projectId });
    const eps = db.list('episode', { projectId });
    expect(generationQueue(shots, eps, 'image').map((s) => s.code)).toEqual(['EP01_S03']);
    expect(generationQueue(shots, eps, 'video').map((s) => s.code)).toEqual(['EP01_S03']);
  });
});

describe('pacchetto Remotion', () => {
  it('costruisce la timeline con video, taglio e look notturno', () => {
    const ep = db.list('episode', { projectId })[0];
    const t = remotionTimeline(ep);
    expect(t.shots.map((s) => s.id)).toEqual(['S01', 'S02_VID']);
    expect(t.shots[0]).toMatchObject({ src: 'img/S01.png', kind: 'image', grade: 'night', from: 0 });
    expect(t.shots[1]).toMatchObject({ src: 'vid/S02_VID.mp4', kind: 'video', trimBefore: 0.5 });
    expect(t.shots[1].from).toBe(t.shots[0].to);
    expect(t.skipped).toEqual(['EP01_S03', 'EP01_S04']);
  });

  it('copia i file e scrive timeline, copione e README senza sovrascrivere', () => {
    const ep = db.list('episode', { projectId })[0];
    const out = path.join(dir, 'pack');
    const r = remotionPack(ep, out);
    expect(r.copied).toBe(2);
    expect(fs.existsSync(path.join(out, 'public', 'img', 'S01.png'))).toBe(true);
    expect(fs.readFileSync(path.join(out, 'src', 'data', 'timeline.generated.ts'), 'utf8')).toContain('src: "vid/S02_VID.mp4"');
    expect(fs.existsSync(path.join(out, 'EP01_doppiaggio_ElevenLabs.txt'))).toBe(true);
    expect(remotionPack(ep, out)).toMatchObject({ copied: 0, kept: 2 });
  });
});
