import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useItems } from '../api.ts';
import { Select } from '../components/ui.tsx';
import { dayKey } from '../util.ts';
import type { Episode } from '../../shared/types.ts';

const WEEKDAYS = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];

/** Calendario editoriale di tutti gli account: trascina un contenuto su un giorno per pianificarlo. */
export function CalendarPage() {
  const episodes = useItems('episode');
  const accounts = useItems('account');
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [accountId, setAccountId] = useState('');
  const [over, setOver] = useState('');

  const accountOf = (e: Episode) => e.publishAccountId || e.accountId;
  const shown = (episodes ?? []).filter((e) => !accountId || accountOf(e) === accountId);
  const byDay = new Map<string, Episode[]>();
  for (const e of shown) {
    if (!e.publishDate) continue;
    const k = e.publishDate.slice(0, 10);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  const unscheduled = shown.filter((e) => !e.publishDate && e.status !== 'published');

  // Griglia da lunedì: 6 settimane.
  const start = new Date(month);
  start.setDate(1 - ((month.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const today = dayKey(new Date());

  const move = (id: string, day: string) => {
    const e = episodes?.find((x) => x.id === id);
    if (!e) return;
    const time = e.publishDate.includes('T') ? e.publishDate.slice(10) : 'T18:00';
    api.update('episode', id, { publishDate: day + time });
  };

  const chip = (e: Episode) => {
    const acc = accounts?.find((a) => a.id === accountOf(e));
    return (
      <Link
        key={e.id}
        to={`/episodio/${e.id}`}
        className={`cal-item ep-${e.status}`}
        style={{ borderLeftColor: acc?.color }}
        draggable
        onDragStart={(ev) => ev.dataTransfer.setData('text/episode', e.id)}
        title={`${acc?.handle || acc?.name || ''} — ${e.title}`}
      >
        {e.publishDate.includes('T') && <span className="cal-time">{e.publishDate.slice(11, 16)}</span>}
        <span className="code">{e.code}</span> {e.title}
      </Link>
    );
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1 className="grow">{month.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}</h1>
        <Select value={accountId} onChange={setAccountId} options={[['', 'Tutti gli account'], ...(accounts ?? []).map((a): [string, string] => [a.id, a.handle || a.name])]} />
        <div className="segmented">
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Mese precedente">
            ←
          </button>
          <button onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Oggi</button>
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Mese successivo">
            →
          </button>
        </div>
      </header>
      <div className="calendar-wrap">
        <div className="calendar">
          {WEEKDAYS.map((w) => (
            <div key={w} className="cal-head">
              {w}
            </div>
          ))}
          {days.map((d) => {
            const k = dayKey(d);
            return (
              <div
                key={k}
                className={`cal-day${d.getMonth() !== month.getMonth() ? ' other' : ''}${k === today ? ' today' : ''}${over === k ? ' drop' : ''}`}
                onDragOver={(ev) => {
                  ev.preventDefault();
                  setOver(k);
                }}
                onDragLeave={() => setOver('')}
                onDrop={(ev) => {
                  setOver('');
                  const id = ev.dataTransfer.getData('text/episode');
                  if (id) move(id, k);
                }}
              >
                <span className="cal-num">{d.getDate()}</span>
                {(byDay.get(k) ?? []).sort((a, b) => a.publishDate.localeCompare(b.publishDate)).map(chip)}
              </div>
            );
          })}
        </div>
        <aside
          className="panel cal-unscheduled"
          onDragOver={(ev) => ev.preventDefault()}
          onDrop={(ev) => {
            const id = ev.dataTransfer.getData('text/episode');
            if (id) api.update('episode', id, { publishDate: '' });
          }}
        >
          <h2>Da pianificare</h2>
          <p className="muted small">Trascina un contenuto su un giorno. Riportalo qui per togliere la data.</p>
          {unscheduled.length === 0 && <p className="muted">Tutto pianificato.</p>}
          {unscheduled.map(chip)}
        </aside>
      </div>
    </div>
  );
}
