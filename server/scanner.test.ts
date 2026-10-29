import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { matchFiles, walk, type FileEntry } from './scanner.ts';
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
