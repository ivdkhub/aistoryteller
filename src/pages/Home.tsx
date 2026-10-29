import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, useItems } from '../api.ts';
import { Empty, Modal } from '../components/ui.tsx';
import { AccountForm } from '../components/forms.tsx';
import { EPISODE_STATUS_LABEL, PROJECT_TYPE_LABEL, type Episode, type Shot, type ShotStatus } from '../../shared/types.ts';
import { formatDate } from '../util.ts';
import { ProgressBar } from '../components/EpisodeProgress.tsx';

const ORDER: ShotStatus[] = ['edited', 'video', 'image', 'todo'];

export function Home() {
  const accounts = useItems('account');
  const projects = useItems('project');
  const episodes = useItems('episode');
  const shots = useItems('shot');
  const ideas = useItems('idea');
  const [create, setCreate] = useState(false);
  const navigate = useNavigate();

  if (!accounts) return null;
  if (!accounts.length) {
    return (
      <div className="page">
        <div className="welcome">
          <h1>Il tuo studio per i contenuti Instagram</h1>
          <p>
            Organizza account, progetti, personaggi e prompt in un unico posto. Tutto resta sul tuo computer: nessun
            collegamento ai social.
          </p>
          <div className="row">
            <button className="btn btn-primary" onClick={() => setCreate(true)}>
              Crea il primo account
            </button>
            <Link className="btn" to="/import">
              Importa una serie esistente
            </Link>
          </div>
        </div>
        {create && (
          <Modal title="Nuovo account Instagram" onClose={() => setCreate(false)}>
            <AccountForm
              onSave={async (d) => {
                const a = await api.create('account', d);
                navigate(`/account/${a.id}`);
              }}
            />
          </Modal>
        )}
      </div>
    );
  }

  const now = Date.now();
  const soon = (episodes ?? [])
    .filter((e) => e.publishDate && e.status !== 'published' && new Date(e.publishDate).getTime() >= now - 864e5)
    .sort((a, b) => a.publishDate.localeCompare(b.publishDate))
    .slice(0, 8);
  const unscheduled = (episodes ?? []).filter((e) => !e.publishDate && ['production', 'editing', 'ready'].includes(e.status));
  const active = (projects ?? []).filter((p) => p.status !== 'archived');
  const accountOf = (e: Episode) => accounts.find((a) => a.id === (e.publishAccountId || e.accountId));

  return (
    <div className="page">
      <header className="page-head">
        <h1>Panoramica</h1>
      </header>

      <div className="home-grid">
        <section className="panel">
          <h2>Prossime uscite</h2>
          {soon.length === 0 && <p className="muted">Nessuna data fissata. Aggiungi una data di uscita agli episodi o usa il calendario.</p>}
          <ul className="list">
            {soon.map((e) => (
              <li key={e.id}>
                <Link to={`/episodio/${e.id}`} className="list-link">
                  <span className="date-chip">{formatDate(e.publishDate)}</span>
                  <span className="grow">
                    <span className="code">{e.code}</span> {e.title}
                  </span>
                  <ProgressBar episode={e} shots={(shots ?? []).filter((s) => s.episodeId === e.id)} />
                  <span className="account-chip" style={{ borderColor: accountOf(e)?.color }}>
                    {accountOf(e)?.handle || accountOf(e)?.name}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {unscheduled.length > 0 && (
            <p className="muted small">
              {unscheduled.length === 1 ? '1 episodio in lavorazione non ha' : `${unscheduled.length} episodi in lavorazione non hanno`} ancora una data. <Link to="/calendario">Pianificali</Link>
            </p>
          )}
        </section>

        <section className="panel">
          <h2>Idee da sviluppare</h2>
          {(ideas ?? []).filter((i) => i.status === 'inbox' || i.status === 'develop').length === 0 && (
            <p className="muted">Nessuna idea in attesa. Premi Ctrl K in qualsiasi pagina per annotarne una.</p>
          )}
          <ul className="list">
            {(ideas ?? [])
              .filter((i) => i.status === 'inbox' || i.status === 'develop')
              .slice(-6)
              .reverse()
              .map((i) => (
                <li key={i.id}>
                  <Link to="/idee" className="list-link">
                    <span className="grow">{i.title}</span>
                    <span className="muted small">{i.status === 'inbox' ? 'Inbox' : 'Da sviluppare'}</span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      </div>

      <h2 className="section-title">Progetti attivi</h2>
      {active.length === 0 && <Empty title="Nessun progetto attivo">Apri un account e crea un progetto.</Empty>}
      <div className="project-grid">
        {active.map((p) => {
          const ps = (shots ?? []).filter((s) => s.projectId === p.id && s.status !== 'discarded');
          const eps = (episodes ?? []).filter((e) => e.projectId === p.id);
          const acc = accounts.find((a) => a.id === p.accountId);
          const current = eps.find((e) => e.status === 'production' || e.status === 'editing');
          return (
            <Link key={p.id} to={`/progetto/${p.id}`} className="project-card">
              <span className="project-card-account" style={{ color: acc?.color }}>
                {acc?.handle || acc?.name}
              </span>
              <strong>{p.title}</strong>
              <span className="muted small">{PROJECT_TYPE_LABEL[p.type]}</span>
              {ps.length > 0 && <Progress shots={ps} />}
              <span className="small">
                {eps.length} {p.type === 'characters' ? (eps.length === 1 ? 'episodio' : 'episodi') : 'post'}
                {current && (
                  <>
                    {' · in lavorazione: '}
                    <span className="code">{current.code}</span> ({EPISODE_STATUS_LABEL[current.status].toLowerCase()})
                  </>
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** Barra di avanzamento delle inquadrature per stato. */
export function Progress({ shots }: { shots: Shot[] }) {
  const total = shots.length;
  return (
    <span className="progress" title={ORDER.map((s) => `${s}: ${shots.filter((x) => x.status === s).length}`).join(', ')}>
      {ORDER.map((s) => {
        const n = shots.filter((x) => x.status === s).length;
        return n ? <i key={s} className={`bar-${s}`} style={{ flexGrow: n }} /> : null;
      })}
      <span className="progress-label">
        {shots.filter((s) => s.status !== 'todo').length}/{total} inquadrature pronte
      </span>
      <span hidden>{total}</span>
    </span>
  );
}
