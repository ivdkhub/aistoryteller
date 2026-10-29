// Avanzamento della produzione di un episodio: tappe calcolate dai dati, più quelle spuntate a mano.
import type { Episode, Shot } from './types.ts';

export interface Step {
  key: string;
  label: string;
  /** Avanzamento della tappa da 0 a 1. */
  value: number;
  done: boolean;
  /** Es. "12/25 inquadrature"; vuoto per le tappe a spunta. */
  detail: string;
  /** La tappa si spunta a mano (non c'è modo di ricavarla dai dati). */
  manual: boolean;
}

export interface Progress {
  steps: Step[];
  /** Media delle tappe, 0-100. */
  percent: number;
  /** Prima tappa non completata. */
  next: Step | undefined;
}

const RANK: Record<Shot['status'], number> = { todo: 0, image: 1, video: 2, edited: 3, discarded: -1 };

function ratio(done: number, total: number, unit: string) {
  return { value: total ? done / total : 0, detail: `${done}/${total} ${unit}` };
}

export function episodeProgress(episode: Pick<Episode, 'script' | 'caption' | 'status' | 'revisions' | 'checklist'>, allShots: Shot[]): Progress {
  const shots = allShots.filter((s) => s.status !== 'discarded');
  const visual = shots.filter((s) => !s.noImage);
  const animated = shots.filter((s) => s.animPriority);
  const checklist = episode.checklist ?? {};
  const steps: Step[] = [];

  // Una tappa calcolata diventa "a spunta" quando non ci sono dati da cui ricavarla.
  const add = (key: string, label: string, auto: { value: number; detail: string } | null) => {
    const forced = checklist[key] === true;
    const value = forced ? 1 : auto ? auto.value : 0;
    steps.push({ key, label, value, done: value >= 1, detail: auto?.detail ?? '', manual: !auto });
  };

  add('script', 'Copione', episode.script.trim() ? { value: 1, detail: 'scritto' } : null);
  add('prompts', 'Prompt', visual.length ? ratio(visual.filter((s) => s.imagePrompt.trim()).length, visual.length, 'prompt') : null);
  add('images', 'Immagini', visual.length ? ratio(visual.filter((s) => s.imageFile || RANK[s.status] >= 1).length, visual.length, 'immagini') : null);
  if (animated.length || !shots.length) {
    add('videos', 'Animazioni', animated.length ? ratio(animated.filter((s) => s.videoFile || RANK[s.status] >= 2).length, animated.length, 'clip') : null);
  }
  add('audio', 'Voce e audio', null);
  const edit = shots.length ? ratio(shots.filter((s) => s.status === 'edited').length, shots.length, 'montate') : null;
  // "Pronto" vuol dire montaggio chiuso anche se le singole inquadrature non sono segnate.
  add('edit', 'Montaggio', episode.status === 'ready' ? { value: 1, detail: 'chiuso' } : edit);
  if (episode.revisions.length) {
    add('revisions', 'Revisioni', ratio(episode.revisions.filter((r) => r.done).length, episode.revisions.length, 'risolte'));
  }
  add('caption', 'Caption', episode.caption.trim() ? { value: 1, detail: 'pronta' } : null);
  add('published', 'Pubblicato', episode.status === 'published' ? { value: 1, detail: '' } : { value: 0, detail: '' });

  // Un episodio pubblicato è finito: tutte le tappe contano come fatte.
  if (episode.status === 'published') for (const s of steps) Object.assign(s, { value: 1, done: true, detail: '' });

  const percent = Math.round((steps.reduce((sum, s) => sum + s.value, 0) / steps.length) * 100);
  return { steps, percent, next: steps.find((s) => !s.done) };
}
