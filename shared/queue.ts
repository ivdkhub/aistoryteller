// Lista di generazione: le inquadrature che aspettano un'immagine o un video, nell'ordine di produzione.
import type { Episode, Shot } from './types.ts';

export type QueueKind = 'image' | 'video';

const PRIORITY = { alta: 0, media: 1, bassa: 2, '': 3 } as const;

export function needsImage(s: Shot) {
  return !s.noImage && !s.imageFile && s.status === 'todo';
}

export function needsVideo(s: Shot) {
  return !!s.animPriority && !s.videoFile && s.status !== 'discarded' && s.status !== 'edited';
}

/** Episodi principali prima dei post satellite, poi per numero; dentro l'episodio per ordine (video: prima la priorità alta). */
export function generationQueue(shots: Shot[], episodes: Pick<Episode, 'id' | 'number' | 'publishAccountId' | 'code'>[], kind: QueueKind): Shot[] {
  const ep = new Map(episodes.map((e) => [e.id, e]));
  const rank = (s: Shot) => {
    const e = ep.get(s.episodeId);
    return [e?.publishAccountId ? 1 : 0, e?.number ?? 0];
  };
  return shots
    .filter(kind === 'image' ? needsImage : needsVideo)
    .sort((a, b) => {
      const [sa, na] = rank(a);
      const [sb, nb] = rank(b);
      return sa - sb || na - nb || (kind === 'video' ? PRIORITY[a.animPriority] - PRIORITY[b.animPriority] : 0) || a.order - b.order || a.code.localeCompare(b.code);
    });
}
