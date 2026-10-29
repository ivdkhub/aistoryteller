import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, useAutosave, useItem, useItems } from '../api.ts';
import { Area, CopyButton, DeleteButton, Empty, Field, Media, SaveBadge, Select, Tabs, Text } from '../components/ui.tsx';
import { ShotEditor } from '../components/ShotEditor.tsx';
import { PromptList } from '../components/PromptList.tsx';
import { estimateSeconds, speakers } from '../util.ts';
import {
  EPISODE_FORMAT_LABEL, EPISODE_STATUS_LABEL, SHOT_STATUS_LABEL,
  type Episode, type EpisodeFormat, type EpisodeStatus, type Metrics, type Shot, type ShotStatus,
} from '../../shared/types.ts';

type Tab = 'inquadrature' | 'copione' | 'dettagli' | 'revisioni' | 'prompt';

export function EpisodePage() {
  const { id, tab } = useParams();
  const item = useItem('episode', id);
  const { draft: e, set, state } = useAutosave('episode', item);
  const project = useItem('project', item?.projectId);
  const shots = useItems('shot', { episodeId: id });
  const accounts = useItems('account');
  const navigate = useNavigate();

  if (item === null) return <Empty title="Episodio non trovato" />;
  if (!e) return null;
  const current = (['inquadrature', 'copione', 'dettagli', 'revisioni', 'prompt'].includes(tab ?? '') ? tab : 'inquadrature') as Tab;
  const sorted = [...(shots ?? [])].sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));
  const openRevisions = e.revisions.filter((r) => !r.done).length;

  return (
    <div className="page">
      <header className="page-head">
        <div className="grow">
          <p className="crumbs">
            {project && <Link to={`/progetto/${project.id}/episodi`}>{project.title}</Link>}
          </p>
          <h1>
            <input className="code code-input" value={e.code} onChange={(ev) => set({ code: ev.target.value })} aria-label="Codice" />
            <input className="title-input" value={e.title} onChange={(ev) => set({ title: ev.target.value })} aria-label="Titolo" />
          </h1>
        </div>
        <SaveBadge state={state} />
      </header>
      <div className="episode-bar">
        <Field label="Stato">
          <Select value={e.status} onChange={(status) => set({ status })} options={Object.entries(EPISODE_STATUS_LABEL) as [EpisodeStatus, string][]} />
        </Field>
        <Field label="Formato">
          <Select value={e.format} onChange={(format) => set({ format })} options={Object.entries(EPISODE_FORMAT_LABEL) as [EpisodeFormat, string][]} />
        </Field>
        <Field label="Uscita">
          <input type="datetime-local" value={e.publishDate} onChange={(ev) => set({ publishDate: ev.target.value })} />
        </Field>
        <Field label="Esce su">
          <Select
            value={e.publishAccountId}
            onChange={(publishAccountId) => set({ publishAccountId })}
            options={[['', 'Account del progetto'], ...(accounts ?? []).filter((a) => a.id !== e.accountId).map((a): [string, string] => [a.id, a.handle || a.name])]}
          />
        </Field>
      </div>
      <Tabs
        tabs={[
          ['inquadrature', 'Inquadrature', sorted.length],
          ['copione', 'Copione e montaggio'],
          ['dettagli', 'Caption e voto'],
          ['revisioni', 'Revisioni e metriche', openRevisions || undefined],
          ['prompt', 'Storico prompt'],
        ]}
        value={current}
        onChange={(t) => navigate(`/episodio/${e.id}/${t}`)}
      />
      {current === 'inquadrature' && <ShotBoard episode={e} shots={sorted} />}
      {current === 'copione' && <ScriptTab episode={e} shots={sorted} set={set} />}
      {current === 'dettagli' && <DetailsTab episode={e} set={set} />}
      {current === 'revisioni' && <RevisionsTab episode={e} set={set} />}
      {current === 'prompt' && <PromptList filter={{ episodeId: e.id }} projectId={e.projectId} />}
      <div className="row-end page-foot">
        <DeleteButton
          label="Elimina episodio"
          text={`Eliminare ${e.code} "${e.title}" con le sue inquadrature e i prompt collegati? I file sul disco non vengono toccati.`}
          onDelete={async () => {
            await api.remove('episode', e.id);
            navigate(`/progetto/${e.projectId}/episodi`);
          }}
        />
      </div>
    </div>
  );
}

const FILTERS: ('' | ShotStatus)[] = ['', 'todo', 'image', 'video', 'edited', 'discarded'];

function ShotBoard({ episode, shots }: { episode: Episode; shots: Shot[] }) {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<'' | ShotStatus>('');
  const [view, setView] = useState<'frames' | 'table'>('frames');
  const openId = params.get('shot');
  const open = shots.find((s) => s.id === openId);
  const visible = shots.filter((s) => (filter ? s.status === filter : s.status !== 'discarded'));
  const setOpen = (id: string | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set('shot', id);
    else p.delete('shot');
    setParams(p, { replace: true });
  };

  const addShot = async () => {
    const n = shots.length + 1;
    const s = await api.create('shot', {
      episodeId: episode.id,
      code: `${episode.code}_S${String(n).padStart(2, '0')}`,
      order: Math.max(0, ...shots.map((x) => x.order)) + 1,
    });
    setOpen(s.id);
  };

  return (
    <section className={`board${open ? ' with-drawer' : ''}`}>
      <div className="board-main">
        <div className="row toolbar">
          <div className="segmented" role="group" aria-label="Filtra per stato">
            {FILTERS.map((f) => (
              <button key={f || 'all'} className={filter === f ? 'on' : undefined} onClick={() => setFilter(f)}>
                {f ? SHOT_STATUS_LABEL[f] : 'Tutte'}
                <span className="tab-count">{f ? shots.filter((s) => s.status === f).length : shots.filter((s) => s.status !== 'discarded').length}</span>
              </button>
            ))}
          </div>
          <span className="grow" />
          <div className="segmented">
            <button className={view === 'frames' ? 'on' : undefined} onClick={() => setView('frames')}>
              Fotogrammi
            </button>
            <button className={view === 'table' ? 'on' : undefined} onClick={() => setView('table')}>
              Riepilogo animazioni
            </button>
          </div>
          <button className="btn btn-primary" onClick={addShot}>
            Nuova inquadratura
          </button>
        </div>
        {shots.length === 0 && (
          <Empty title="Nessuna inquadratura">
            <p>Aggiungine una oppure collega la cartella del progetto e usa “Risincronizza i file”.</p>
          </Empty>
        )}
        {view === 'frames' ? (
          <div className="frames">
            {visible.map((s) => (
              <button key={s.id} className={`frame frame-${s.status}${s.id === openId ? ' selected' : ''}`} onClick={() => setOpen(s.id)}>
                <span className="frame-img">
                  {s.imageFile ? <Media path={s.imageFile} /> : s.videoFile ? <Media path={s.videoFile} /> : <span className="frame-empty">{s.noImage ? 'Solo grafica' : 'Da generare'}</span>}
                  {s.videoFile && <span className="frame-vid" title="Video pronto">▶</span>}
                  {s.animPriority && <span className={`frame-prio prio-${s.animPriority}`}>{s.animPriority}</span>}
                </span>
                <span className="frame-code">{s.code}</span>
                <span className="frame-title">{s.title || <span className="muted">Senza titolo</span>}</span>
              </button>
            ))}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Inquadratura</th>
                <th>Immagine</th>
                <th>Video</th>
                <th>Priorità</th>
                <th>Animazione</th>
                <th>Uso in montaggio</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <tr key={s.id} className="row-link" onClick={() => setOpen(s.id)}>
                  <td className="code">{s.code}</td>
                  <td>{s.imageFile ? 'pronta' : s.noImage ? '—' : 'da fare'}</td>
                  <td>{s.videoFile ? 'fatto' : s.animPriority ? 'da fare' : '—'}</td>
                  <td>{s.animPriority || '—'}</td>
                  <td className="small">{s.animation}</td>
                  <td className="small">{[s.cut, s.editing].filter(Boolean).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open && (
        <ShotEditor
          key={open.id}
          shot={open}
          onClose={() => setOpen(null)}
          onPrev={() => {
            const i = visible.findIndex((s) => s.id === open.id);
            if (i > 0) setOpen(visible[i - 1].id);
          }}
          onNext={() => {
            const i = visible.findIndex((s) => s.id === open.id);
            if (i !== -1 && i < visible.length - 1) setOpen(visible[i + 1].id);
          }}
        />
      )}
    </section>
  );
}

function ScriptTab({ episode: e, shots, set }: { episode: Episode; shots: Shot[]; set: (p: Partial<Episode>) => void }) {
  const who = speakers(e.script);
  const secs = estimateSeconds(e.script);
  return (
    <div className="split split-wide">
      <section className="panel">
        <div className="row">
          <h2 className="grow">Copione voce</h2>
          <span className="muted small">
            circa {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')} di parlato
          </span>
          <CopyButton text={e.script} label="Copia copione" />
        </div>
        <p className="muted small">Tag ElevenLabs tra [parentesi quadre]; le battute iniziano con il nome in maiuscolo (es. KADE:).</p>
        <Area value={e.script} onChange={(script) => set({ script })} rows={18} mono />
        {who.length > 0 && (
          <p className="speakers">
            {who.map(([name, n]) => (
              <span key={name} className="tag">
                {name} {n}
              </span>
            ))}
          </p>
        )}
      </section>
      <section className="panel">
        <div className="row">
          <h2 className="grow">Mappa per il montaggio</h2>
          <a className="btn btn-small" href={`/api/episodes/${e.id}/export.csv`}>
            Scarica timeline CSV
          </a>
          <a className="btn btn-small" href={`/api/episodes/${e.id}/export.md`}>
            Scarica episodio .md
          </a>
        </div>
        <table className="table map">
          <thead>
            <tr>
              <th>#</th>
              <th>Inquadratura</th>
              <th>Battuta</th>
              <th>Grafica</th>
            </tr>
          </thead>
          <tbody>
            {shots
              .filter((s) => s.status !== 'discarded')
              .map((s, i) => (
                <MapRow key={s.id} shot={s} n={i + 1} />
              ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function MapRow({ shot, n }: { shot: Shot; n: number }) {
  const { draft: s, set } = useAutosave('shot', shot);
  if (!s) return null;
  return (
    <tr>
      <td>{n}</td>
      <td>
        <span className="code">{s.code}</span>
        <div className="small muted">{s.title}</div>
      </td>
      <td>
        <textarea rows={2} value={s.line} onChange={(e) => set({ line: e.target.value })} aria-label={`Battuta ${s.code}`} />
      </td>
      <td>
        <textarea rows={2} value={s.graphics} onChange={(e) => set({ graphics: e.target.value })} aria-label={`Grafica ${s.code}`} />
      </td>
    </tr>
  );
}

function DetailsTab({ episode: e, set }: { episode: Episode; set: (p: Partial<Episode>) => void }) {
  const episodes = useItems('episode', { projectId: e.projectId });
  const [key, setKey] = useState('');
  return (
    <div className="split">
      <section className="panel form">
        <Field label="Caption">
          <Area value={e.caption} onChange={(caption) => set({ caption })} rows={5} />
        </Field>
        <div className="row">
          <span className="muted small grow">{e.caption.length}/2200 caratteri</span>
          <CopyButton text={[e.caption, e.hashtags].filter(Boolean).join('\n\n')} label="Copia caption e hashtag" />
        </div>
        <Field label="Hashtag">
          <Area value={e.hashtags} onChange={(hashtags) => set({ hashtags })} rows={2} />
        </Field>
        <Field label="Call to action">
          <Text value={e.cta} onChange={(cta) => set({ cta })} placeholder="Comment MOVE or FREEZE" />
        </Field>
        <Field label="Scheda dell'episodio" hint="Giorno, durata, ricevute, dipendenze dai voti…">
          <Area value={e.info} onChange={(info) => set({ info })} rows={4} />
        </Field>
        <Field label="Voci">
          <Text value={e.voices} onChange={(voices) => set({ voices })} />
        </Field>
        <Field label="Note">
          <Area value={e.notes} onChange={(notes) => set({ notes })} rows={3} />
        </Field>
      </section>
      <aside className="panel form">
        <h2>Voto del pubblico</h2>
        <Field label="Opzioni" hint="Separate da /">
          <Text value={e.vote.options.join(' / ')} onChange={(v) => set({ vote: { ...e.vote, options: v.split('/').map((x) => x.trim()).filter(Boolean) } })} />
        </Field>
        <div className="grid-2">
          <Field label="Ha vinto">
            <Select
              value={e.vote.winner}
              onChange={(winner) => set({ vote: { ...e.vote, winner } })}
              options={[['', 'Non ancora'], ...e.vote.options.map((o): [string, string] => [o, o])]}
            />
          </Field>
          <Field label="Percentuale">
            <Text value={e.vote.percent} onChange={(percent) => set({ vote: { ...e.vote, percent } })} />
          </Field>
        </div>
        <Field label="Note sul voto">
          <Area value={e.vote.notes} onChange={(notes) => set({ vote: { ...e.vote, notes } })} rows={2} />
        </Field>
        <Field label="Rami preparati" hint="Separati da virgola.">
          <Text value={e.branches.join(', ')} onChange={(v) => set({ branches: v.split(',').map((x) => x.trim()).filter(Boolean) })} />
        </Field>
        <h2>Stato della storia</h2>
        <p className="muted small">Valori che cambiano episodio per episodio (es. TRACE, HOURS TO FREEZE).</p>
        {Object.entries(e.stateVars).map(([k, v]) => (
          <div key={k} className="list-row">
            <span className="code">{k}</span>
            <input value={v} onChange={(ev) => set({ stateVars: { ...e.stateVars, [k]: ev.target.value } })} />
            <button
              className="btn btn-ghost btn-small"
              aria-label={`Rimuovi ${k}`}
              onClick={() => {
                const next = { ...e.stateVars };
                delete next[k];
                set({ stateVars: next });
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <form
          className="list-row"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (key.trim()) set({ stateVars: { ...e.stateVars, [key.trim().toUpperCase()]: '' } });
            setKey('');
          }}
        >
          <input value={key} onChange={(ev) => setKey(ev.target.value)} placeholder="Nuovo valore, es. TRACE" />
          <button className="btn btn-small" type="submit">
            Aggiungi
          </button>
        </form>
        <Field label="Legato all'episodio" hint="Per i post del profilo satellite.">
          <Select
            value={e.linkedEpisodeId}
            onChange={(linkedEpisodeId) => set({ linkedEpisodeId })}
            options={[['', 'Nessuno'], ...(episodes ?? []).filter((x) => x.id !== e.id && !x.publishAccountId).map((x): [string, string] => [x.id, `${x.code} ${x.title}`])]}
          />
        </Field>
      </aside>
    </div>
  );
}

const METRICS: [keyof Metrics, string][] = [
  ['views', 'Visualizzazioni'],
  ['likes', 'Mi piace'],
  ['comments', 'Commenti'],
  ['saves', 'Salvataggi'],
  ['shares', 'Condivisioni'],
];

function RevisionsTab({ episode: e, set }: { episode: Episode; set: (p: Partial<Episode>) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="split">
      <section className="panel">
        <h2>Revisioni</h2>
        <p className="muted small">Il feedback sulle bozze, punto per punto.</p>
        <ol className="revisions">
          {e.revisions.map((r) => (
            <li key={r.id} className={r.done ? 'done' : undefined}>
              <label className="check">
                <input type="checkbox" checked={r.done} onChange={() => set({ revisions: e.revisions.map((x) => (x.id === r.id ? { ...x, done: !x.done } : x)) })} />
                <span>{r.text}</span>
              </label>
              <button className="btn btn-ghost btn-small" aria-label="Rimuovi" onClick={() => set({ revisions: e.revisions.filter((x) => x.id !== r.id) })}>
                ✕
              </button>
            </li>
          ))}
        </ol>
        <form
          className="list-row"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (!text.trim()) return;
            set({ revisions: [...e.revisions, { id: crypto.randomUUID(), text: text.trim(), done: false, date: new Date().toISOString() }] });
            setText('');
          }}
        >
          <input value={text} onChange={(ev) => setText(ev.target.value)} placeholder="Es. alzare la musica sotto il voto finale" />
          <button className="btn btn-small" type="submit">
            Aggiungi
          </button>
        </form>
      </section>
      <aside className="panel form">
        <h2>Metriche</h2>
        <p className="muted small">Da inserire a mano dopo la pubblicazione.</p>
        {METRICS.map(([k, label]) => (
          <Field key={k} label={label}>
            <input type="number" min={0} value={e.metrics[k] || ''} onChange={(ev) => set({ metrics: { ...e.metrics, [k]: Number(ev.target.value) || 0 } })} />
          </Field>
        ))}
        {e.metrics.views > 0 && (
          <p className="small">
            Interazioni: {(((e.metrics.likes + e.metrics.comments + e.metrics.saves + e.metrics.shares) / e.metrics.views) * 100).toFixed(1)}% delle
            visualizzazioni
          </p>
        )}
      </aside>
    </div>
  );
}
