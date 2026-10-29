import type { CSSProperties } from 'react';
import { api } from '../api.ts';
import { episodeProgress, type Progress } from '../../shared/progress.ts';
import type { Episode, Shot } from '../../shared/types.ts';

/**
 * Linea di avanzamento della produzione: una tappa per fase, dal copione alla pubblicazione.
 * Un clic su una tappa la segna come fatta (o toglie la spunta).
 */
export function EpisodeProgress({ episode, shots, onToggle }: { episode: Episode; shots: Shot[]; onToggle?: (checklist: Record<string, boolean>) => void }) {
  const p = episodeProgress(episode, shots);
  const toggle = (key: string) => {
    const checklist = { ...episode.checklist, [key]: !episode.checklist?.[key] };
    if (!checklist[key]) delete checklist[key];
    if (onToggle) onToggle(checklist);
    else void api.update('episode', episode.id, { checklist });
  };
  const locked = episode.status === 'published';

  return (
    <section className="progress-line" aria-label={`Avanzamento della produzione: ${p.percent}%`}>
      <div className="progress-line-head">
        <strong>{p.percent}%</strong>
        <span className="muted small">{p.next ? `Prossima tappa: ${p.next.label.toLowerCase()}` : 'Produzione completata'}</span>
      </div>
      <ol className="pl-steps">
        {p.steps.map((s) => {
          const state = s.done ? 'done' : s.value > 0 ? 'partial' : 'todo';
          const forced = !!episode.checklist?.[s.key];
          return (
            <li key={s.key} className={`pl-step pl-${state}`} style={{ '--fill': `${Math.round(s.value * 100)}%` } as CSSProperties}>
              <button
                type="button"
                className="pl-node"
                disabled={locked || s.key === 'published'}
                aria-pressed={s.done}
                title={
                  s.key === 'published'
                    ? 'Si completa quando lo stato dell’episodio è “Pubblicato”.'
                    : forced
                      ? 'Segnata a mano: clic per togliere la spunta'
                      : s.done
                        ? 'Completata'
                        : 'Clic per segnarla come fatta'
                }
                onClick={() => toggle(s.key)}
              >
                {s.done ? '✓' : ''}
              </button>
              <span className="pl-label">{s.label}</span>
              <span className="pl-detail">{forced && !s.manual ? 'segnata a mano' : s.detail || (s.manual ? (s.done ? 'fatto' : 'da spuntare') : '')}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Versione compatta per elenchi e panoramica: una barra a segmenti e la percentuale. */
export function ProgressBar({ episode, shots }: { episode: Episode; shots: Shot[] }) {
  const p: Progress = episodeProgress(episode, shots);
  return (
    <span className="pl-bar" title={p.steps.map((s) => `${s.label}: ${Math.round(s.value * 100)}%`).join('\n')}>
      <span className="pl-bar-track">
        {p.steps.map((s) => (
          <i key={s.key} className={s.done ? 'done' : undefined} style={{ '--fill': `${Math.round(s.value * 100)}%` } as CSSProperties} />
        ))}
      </span>
      <span className="pl-bar-pct">{p.percent}%</span>
    </span>
  );
}
