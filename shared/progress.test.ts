import { describe, expect, it } from 'vitest';
import { episodeProgress } from './progress.ts';
import { defaults, type Shot } from './types.ts';

const episode = (patch: Partial<ReturnType<typeof defaults<'episode'>>> = {}) => ({ ...defaults('episode'), ...patch });
const shot = (patch: Partial<Shot>): Shot => ({ ...defaults('shot'), id: '', kind: 'shot', createdAt: '', updatedAt: '', ...patch });

describe('episodeProgress', () => {
  it('episodio vuoto: tutto da fare, le tappe senza dati diventano a spunta', () => {
    const p = episodeProgress(episode(), []);
    expect(p.percent).toBe(0);
    expect(p.next?.key).toBe('script');
    expect(p.steps.find((s) => s.key === 'images')?.manual).toBe(true);
  });

  it('calcola prompt, immagini e animazioni dalle inquadrature', () => {
    const shots = [
      shot({ imagePrompt: 'a', imageFile: 'x.png', status: 'image', animPriority: 'alta' }),
      shot({ imagePrompt: 'b', status: 'video', videoFile: 'x.mp4', animPriority: 'media' }),
      shot({ imagePrompt: '', status: 'todo' }),
      shot({ status: 'discarded' }),
      shot({ noImage: true }),
    ];
    const p = episodeProgress(episode({ script: 'Hello' }), shots);
    const by = Object.fromEntries(p.steps.map((s) => [s.key, s]));
    expect(by.script.done).toBe(true);
    expect(by.prompts.detail).toBe('2/3 prompt');
    expect(by.images.detail).toBe('2/3 immagini');
    expect(by.videos.detail).toBe('1/2 clip');
    expect(by.edit.detail).toBe('0/4 montate');
  });

  it('le spunte a mano completano una tappa', () => {
    const p = episodeProgress(episode({ checklist: { audio: true, images: true } }), [shot({})]);
    const by = Object.fromEntries(p.steps.map((s) => [s.key, s]));
    expect(by.audio.done).toBe(true);
    expect(by.images.done).toBe(true);
  });

  it('un episodio pubblicato è al 100%', () => {
    expect(episodeProgress(episode({ status: 'published' }), []).percent).toBe(100);
  });
});
