// Scheda "Voti e rami": variabili di stato del progetto e linea della storia con i voti del pubblico.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useItems } from '../api.ts';
import { Empty } from './ui.tsx';
import { formatValue, storyStates, type EpisodeState } from '../../shared/story.ts';
import type { Episode, Project, StateDef } from '../../shared/types.ts';

export function StoryTab({ project, set }: { project: Project; set: (p: Partial<Project>) => void }) {
  const episodes = useItems('episode', { projectId: project.id });
  const defs = project.stateDefs ?? [];
  const main = (episodes ?? []).filter((e) => !e.publishAccountId);
  const satellites = (episodes ?? []).filter((e) => e.publishAccountId);
  const states = storyStates(defs, main);
  const firstOpen = states.find((s) => !s.decided && s.options.length);

  return (
    <div className="stack">
      <StateDefsEditor defs={defs} onChange={(stateDefs) => set({ stateDefs })} />
      {firstOpen && (
        <p className="note">
          Prossimo voto da chiudere: <strong>{firstOpen.code}</strong> ({firstOpen.options.map((o) => o.option).join(' / ')}). Segna il
          vincitore per far avanzare i valori negli episodi successivi.
        </p>
      )}
      {main.length === 0 && <Empty title="Nessun episodio">I voti compaiono qui quando gli episodi hanno delle opzioni di voto.</Empty>}
      <ol className="story-line">
        {states.map((s) => (
          <StoryNode
            key={s.episodeId}
            state={s}
            defs={defs}
            episode={main.find((e) => e.id === s.episodeId)!}
            linked={satellites.filter((x) => x.linkedEpisodeId === s.episodeId)}
          />
        ))}
      </ol>
    </div>
  );
}

function StateDefsEditor({ defs, onChange }: { defs: StateDef[]; onChange: (d: StateDef[]) => void }) {
  const patch = (i: number, p: Partial<StateDef>) => onChange(defs.map((d, j) => (j === i ? { ...d, ...p } : d)));
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  return (
    <section className="panel">
      <div className="row">
        <h2 className="grow">Variabili della storia</h2>
        <button className="btn btn-small" onClick={() => onChange([...defs, { name: `VAR${defs.length + 1}`, start: 0, startEpisode: 1, min: null, max: null, unit: '' }])}>
          Aggiungi variabile
        </button>
      </div>
      <p className="muted small">Valori che i voti del pubblico spostano, come TRACE o HOURS TO FREEZE. Gli effetti di ogni opzione si impostano qui sotto, episodio per episodio.</p>
      {defs.length > 0 && (
        <table className="table state-defs">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Valore iniziale</th>
              <th>Dall'episodio</th>
              <th>Minimo</th>
              <th>Massimo</th>
              <th>Unità</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {defs.map((d, i) => (
              <tr key={i}>
                <td><input className="mono" value={d.name} onChange={(e) => patch(i, { name: e.target.value.toUpperCase() })} aria-label="Nome" /></td>
                <td><input type="number" value={d.start} onChange={(e) => patch(i, { start: Number(e.target.value) })} aria-label="Valore iniziale" /></td>
                <td><input type="number" min={1} value={d.startEpisode} onChange={(e) => patch(i, { startEpisode: Number(e.target.value) })} aria-label="Dall'episodio" /></td>
                <td><input type="number" value={d.min ?? ''} onChange={(e) => patch(i, { min: num(e.target.value) })} aria-label="Minimo" /></td>
                <td><input type="number" value={d.max ?? ''} onChange={(e) => patch(i, { max: num(e.target.value) })} aria-label="Massimo" /></td>
                <td><input value={d.unit} onChange={(e) => patch(i, { unit: e.target.value })} aria-label="Unità" placeholder="%" /></td>
                <td>
                  <button className="btn btn-ghost btn-small" aria-label={`Rimuovi ${d.name}`} onClick={() => onChange(defs.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function StoryNode({ state, defs, episode, linked }: { state: EpisodeState; defs: StateDef[]; episode: Episode; linked: Episode[] }) {
  const [edit, setEdit] = useState(false);
  const vote = episode.vote;
  const effects = vote.effects ?? {};
  const setVote = (p: Partial<Episode['vote']>) => api.update('episode', episode.id, { vote: { ...vote, effects, ...p } });
  const setEffect = (option: string, variable: string, value: string) => {
    const next = structuredClone(effects);
    next[option] = { ...(next[option] ?? {}) };
    if (value.trim() === '' || Number(value) === 0) delete next[option][variable];
    else next[option][variable] = Number(value);
    void setVote({ effects: next });
  };
  const fmtDelta = (n: number) => (n > 0 ? `+${n}` : `${n}`);

  return (
    <li className={`story-node${state.decided ? ' decided' : ''}${state.options.length ? '' : ' no-vote'}`}>
      <div className="story-marker" aria-hidden />
      <div className="story-card">
        <div className="row">
          <Link to={`/episodio/${episode.id}/dettagli`} className="story-title">
            <span className="code">{episode.code}</span> {episode.title}
          </Link>
          <span className="grow" />
          {defs.filter((d) => state.number >= d.startEpisode).map((d) => (
            <span key={d.name} className="state-chip" title={state.known ? 'Valore all\'inizio dell\'episodio' : 'Dipende da un voto precedente non ancora deciso'}>
              {d.name} {formatValue(state.before[d.name], d.unit)}
            </span>
          ))}
        </div>
        {state.options.length > 0 ? (
          <div className="vote-options">
            {state.options.map((o) => (
              <button
                key={o.option}
                className={`vote-option${o.winner ? ' winner' : ''}`}
                title={o.winner ? 'Clic per annullare il vincitore' : 'Clic per segnarla come vincitrice'}
                onClick={() => setVote({ winner: o.winner ? '' : o.option })}
              >
                <strong>{o.option}</strong>
                {o.winner && vote.percent && <span className="vote-pct">{vote.percent}%</span>}
                {defs.map((d) =>
                  o.delta[d.name] ? (
                    <span key={d.name} className="vote-effect">
                      {d.name} {fmtDelta(o.delta[d.name])} → {formatValue(o.after[d.name], d.unit)}
                    </span>
                  ) : null,
                )}
              </button>
            ))}
            {state.decided && (
              <label className="vote-percent">
                <input value={vote.percent} onChange={(e) => setVote({ percent: e.target.value })} placeholder="%" aria-label="Percentuale del vincitore" />%
              </label>
            )}
            {defs.length > 0 && (
              <button className="btn btn-small btn-ghost" onClick={() => setEdit(!edit)} aria-expanded={edit}>
                {edit ? 'Chiudi effetti' : 'Effetti sul voto'}
              </button>
            )}
          </div>
        ) : (
          <p className="muted small">Nessun voto in questo episodio.</p>
        )}
        {edit && (
          <table className="table effects">
            <thead>
              <tr>
                <th>Opzione</th>
                {defs.map((d) => (
                  <th key={d.name}>{d.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vote.options.map((o) => (
                <tr key={o}>
                  <td><strong>{o}</strong></td>
                  {defs.map((d) => (
                    <td key={d.name}>
                      <input
                        type="number"
                        defaultValue={effects[o]?.[d.name] ?? ''}
                        placeholder="0"
                        onBlur={(e) => setEffect(o, d.name, e.target.value)}
                        aria-label={`Effetto di ${o} su ${d.name}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {episode.branches.length > 0 && (
          <p className="small muted">Rami preparati: {episode.branches.join(' · ')}</p>
        )}
        {linked.map((l) => (
          <Link key={l.id} to={`/episodio/${l.id}`} className="story-linked">
            ↳ <span className="code">{l.code}</span> {l.title}
            {l.vote.options.length > 0 && <span className="muted"> — voto {l.vote.options.join(' / ')}{l.vote.winner && ` → ${l.vote.winner}`}</span>}
          </Link>
        ))}
      </div>
    </li>
  );
}
