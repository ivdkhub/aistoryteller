import { describe, expect, it } from 'vitest';
import { storyStates } from './story.ts';

const TRACE = { name: 'TRACE', start: 12, startEpisode: 2, min: 5, max: 95, unit: '%' };
const ep = (number: number, options: string[], winner = '', effects: Record<string, Record<string, number>> = {}) => ({
  id: `e${number}`, code: `EP0${number}`, title: '', number, vote: { options, winner, percent: '', notes: '', effects },
});

describe('storyStates', () => {
  it('propaga i valori seguendo i vincitori, con minimo e massimo', () => {
    const s = storyStates([TRACE], [
      ep(1, ['CALL', 'WAIT'], 'WAIT'),
      ep(2, ['MOVE', 'FREEZE'], 'MOVE', { MOVE: { TRACE: 29 }, FREEZE: { TRACE: 0 } }),
      ep(3, ['DEAL', 'RUN'], 'DEAL', { DEAL: { TRACE: 25 }, RUN: { TRACE: 5 } }),
      ep(4, ['PLAY', 'GHOST'], 'PLAY', { PLAY: { TRACE: -100 } }),
      ep(5, []),
    ]);
    expect(s.map((x) => x.before.TRACE)).toEqual([null, 12, 41, 66, 5]);
  });

  it('dopo un voto non deciso mostra le proiezioni e poi "non noto"', () => {
    const s = storyStates([TRACE], [
      ep(2, ['MOVE', 'FREEZE'], '', { MOVE: { TRACE: 29 } }),
      ep(3, ['DEAL', 'RUN'], '', { DEAL: { TRACE: 25 } }),
    ]);
    expect(s[0].options.map((o) => o.after.TRACE)).toEqual([41, 12]);
    expect(s[1].known).toBe(false);
    expect(s[1].before.TRACE).toBeNull();
  });
});
