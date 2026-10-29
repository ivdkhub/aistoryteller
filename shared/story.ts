// Stato della storia: le variabili (es. TRACE) attraversano gli episodi seguendo i voti vinti.
import type { Episode, StateDef } from './types.ts';

export type Values = Record<string, number | null>;

export interface OptionOutcome {
  option: string;
  delta: Record<string, number>;
  /** Valori dopo il voto se vince questa opzione (null se lo stato non è ancora noto). */
  after: Values;
  winner: boolean;
}

export interface EpisodeState {
  episodeId: string;
  code: string;
  title: string;
  number: number;
  /** Valori all'inizio dell'episodio; null = la variabile non esiste ancora o dipende da voti non decisi. */
  before: Values;
  /** false quando un voto precedente non è ancora deciso. */
  known: boolean;
  decided: boolean;
  options: OptionOutcome[];
}

function clamp(v: number, def: StateDef) {
  let x = v;
  if (def.min !== null && def.min !== undefined) x = Math.max(def.min, x);
  if (def.max !== null && def.max !== undefined) x = Math.min(def.max, x);
  return x;
}

export function storyStates(defs: StateDef[], episodes: Pick<Episode, 'id' | 'code' | 'title' | 'number' | 'vote'>[]): EpisodeState[] {
  const ordered = [...episodes].sort((a, b) => a.number - b.number);
  const values: Record<string, number | undefined> = {};
  let known = true;
  const out: EpisodeState[] = [];

  for (const ep of ordered) {
    for (const d of defs) if (values[d.name] === undefined && ep.number >= d.startEpisode) values[d.name] = d.start;
    const snapshot = (): Values => Object.fromEntries(defs.map((d) => [d.name, known && values[d.name] !== undefined ? values[d.name]! : null]));
    const before = snapshot();
    const effects = ep.vote.effects ?? {};
    const winner = ep.vote.winner && ep.vote.options.includes(ep.vote.winner) ? ep.vote.winner : '';

    const options = ep.vote.options.map((option) => {
      const delta = effects[option] ?? {};
      const after: Values = Object.fromEntries(
        defs.map((d) => {
          const b = before[d.name];
          return [d.name, b === null ? null : clamp(b + (delta[d.name] ?? 0), d)];
        }),
      );
      return { option, delta, after, winner: option === winner };
    });

    out.push({ episodeId: ep.id, code: ep.code, title: ep.title, number: ep.number, before, known, decided: !!winner, options });

    if (winner) {
      const w = options.find((o) => o.winner)!;
      for (const d of defs) if (w.after[d.name] !== null && values[d.name] !== undefined) values[d.name] = w.after[d.name]!;
    } else if (ep.vote.options.some((o) => Object.keys(effects[o] ?? {}).length)) {
      // Un voto non deciso che sposta le variabili: da qui in poi lo stato dipende dal risultato.
      known = false;
    }
  }
  return out;
}

export function formatValue(v: number | null, unit: string) {
  return v === null ? '?' : `${v}${unit}`;
}
