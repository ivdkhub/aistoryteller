import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findEpisodeDir, listCuts, matchFiles, walk, type FileEntry } from './scanner.ts';
import type { ShotStatus } from '../shared/types.ts';

const shot = (code: string, status: ShotStatus = 'todo') => ({ id: code, code, imageFile: '', videoFile: '', status });
const file = (name: string, discarded = false): FileEntry => ({ path: `X/${name}`, name, discarded });

describe('matchFiles', () => {
  it('abbina immagine, video e varianti al codice più lungo', () => {
    const res = matchFiles(
      [shot('EP02_S10'), shot('EP02_S10_CCTV'), shot('EP02_S13'), shot('EP02_S13_JEN')],
      [
        file('EP02_S10.png'),
        file('EP02_S10_cctv_waterdrops.jpg'),
        file('EP02_S13.png'),
        file('EP02_S13_JEN_VID.mp4'),
        file('EP02_S13_old.png', true),
        file('EP02_S01toS2.mp4'),
      ],
    );
    const by = Object.fromEntries(res.map((m) => [m.code, m]));
    expect(by.EP02_S10).toMatchObject({ image: 'X/EP02_S10.png', status: 'image' });
    expect(by.EP02_S10_CCTV).toMatchObject({ image: 'X/EP02_S10_cctv_waterdrops.jpg' });
    expect(by.EP02_S13).toMatchObject({ discarded: ['X/EP02_S13_old.png'] });
    expect(by.EP02_S13_JEN).toMatchObject({ video: 'X/EP02_S13_JEN_VID.mp4', status: 'video' });
    expect(res.some((m) => m.code === 'EP02_S01')).toBe(false);
  });

  it('non abbassa lo stato di un\'inquadratura già montata', () => {
    const [m] = matchFiles([shot('EP01_S01', 'edited')], [file('EP01_S01.png')]);
    expect(m.status).toBe('edited');
  });
});

const EP02 = 'C:/Spazio di lavoro/ivdk/Contenuti/Insta-series/EP02';

describe.runIf(fs.existsSync(EP02))('scanner sulla cartella reale EP02', () => {
  it('abbina EP02_Syy.png e _VID.mp4 alle inquadrature giuste', () => {
    const codes = Array.from({ length: 25 }, (_, i) => `EP02_S${String(i + 1).padStart(2, '0')}`);
    const res = matchFiles(codes.map((c) => shot(c)), walk(EP02));
    const s05 = res.find((m) => m.code === 'EP02_S05')!;
    expect(s05.image).toMatch(/EP02_S05\.png$/);
    expect(s05.video).toMatch(/EP02_S05_VID\.mp4$/);
    expect(res.filter((m) => m.image).length).toBeGreaterThan(15);
  });
});

describe("montaggi dell'episodio", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuts-'));
  const deliv = path.join(root, 'Serie', 'EP01', 'deliverables');
  fs.mkdirSync(deliv, { recursive: true });
  fs.mkdirSync(path.join(root, 'Serie', 'scartate', 'EP01'), { recursive: true });
  for (const n of ['EP01_final.mp4', 'EP01_final.srt', 'EP01_final_bozza_v1.mp4', 'EP01_final_bozza_v3.mp4', 'EP01_final_bozza_v2.mp4', 'sorgente.zip', 'timeline.csv']) {
    fs.writeFileSync(path.join(deliv, n), 'x');
  }

  it("trova la cartella dell'episodio ignorando le scartate", () => {
    expect(findEpisodeDir(root, 'ep01')).toBe(path.join(root, 'Serie', 'EP01'));
    expect(findEpisodeDir(root, 'EP09')).toBe('');
  });

  it('elenca solo i video: finale per primo, poi le bozze dalla più recente', () => {
    const cuts = listCuts(deliv);
    expect(cuts.map((c) => c.label)).toEqual(['Finale', 'Bozza v3', 'Bozza v2', 'Bozza v1']);
    expect(cuts[0].subtitles).toBe(path.join(deliv, 'EP01_final.srt'));
    expect(cuts[1].subtitles).toBe('');
  });

  it('riconosce la bozza anche in mezzo al nome', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuts-'));
    fs.writeFileSync(path.join(dir, 'EP02_bozza_v1_1080x1920.mp4'), 'x');
    expect(listCuts(dir)[0]).toMatchObject({ label: 'Bozza v1', final: false });
  });
});
