import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useItems } from '../api.ts';
import { Select } from '../components/ui.tsx';
import { dayKey } from '../util.ts';
import type { Episode } from '../../shared/types.ts';

const WEEKDAYS = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
const HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 6:00 - 23:00

type View = 'month' | 'week';

/** Lunedì della settimana che contiene d. */
function monday(d: Date) {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

const hasTime = (iso: string) => /T\d{2}:\d{2}/.test(iso);

/** Calendario editoriale di tutti gli account: trascina un contenuto su un giorno (o un'ora) per pianificarlo. */
export function CalendarPage() {
  const episodes = useItems('episode');
  const accounts = useItems('account');
  const [view, setView] = useState<View>('month');
  const [anchor, setAnchor] = useState(() => new Date());
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
  const today = dayKey(new Date());

  /** Sposta un contenuto: sul giorno tiene l'ora che aveva (o le 18:00), sulla fascia oraria usa quella. */
  const move = (id: string, day: string, hour?: number) => {
    const e = episodes?.find((x) => x.id === id);
    if (!e) return;
    const time = hour !== undefined ? `T${String(hour).padStart(2, '0')}:00` : hasTime(e.publishDate) ? e.publishDate.slice(10, 16) : 'T18:00';
    void api.update('episode', id, { publishDate: day + time });
  };

  const dropProps = (key: string, day: string, hour?: number) => ({
    onDragOver: (ev: React.DragEvent) => {
      ev.preventDefault();
      setOver(key);
    },
    onDragLeave: () => setOver(''),
    onDrop: (ev: React.DragEvent) => {
      setOver('');
      const id = ev.dataTransfer.getData('text/episode');
      if (id) move(id, day, hour);
    },
  });

  const chip = (e: Episode) => {
    const acc = accounts?.find((a) => a.id === accountOf(e));
    const parent = e.linkedEpisodeId ? episodes?.find((x) => x.id === e.linkedEpisodeId) : undefined;
    const satellites = (episodes ?? []).filter((x) => x.linkedEpisodeId === e.id).length;
    return (
      <Link
        key={e.id}
        to={`/episodio/${e.id}`}
        className={`cal-item ep-${e.status}${parent ? ' cal-satellite' : ''}`}
        style={{ borderLeftColor: acc?.color }}
        draggable
        onDragStart={(ev) => ev.dataTransfer.setData('text/episode', e.id)}
        title={`${acc?.handle || acc?.name || ''} — ${e.title}${parent ? ` (legato a ${parent.code})` : ''}`}
      >
        {hasTime(e.publishDate) && <span className="cal-time">{e.publishDate.slice(11, 16)}</span>}
        <span className="code">{e.code}</span> {e.title}
        {parent && <span className="cal-link"> ↳ {parent.code}</span>}
        {satellites > 0 && <span className="cal-link"> +{satellites} satellite</span>}
      </Link>
    );
  };

  const step = (dir: number) => {
    const d = new Date(anchor);
    if (view === 'month') d.setMonth(d.getMonth() + dir, 1);
    else d.setDate(d.getDate() + dir * 7);
    setAnchor(d);
  };

  const weekStart = monday(anchor);
  const weekDays = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i));
  const title =
    view === 'month'
      ? anchor.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
      : `${weekDays[0].toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })} – ${weekDays[6].toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <div className="page">
      <header className="page-head">
        <h1 className="grow cal-title">{title}</h1>
        <Select value={accountId} onChange={setAccountId} options={[['', 'Tutti gli account'], ...(accounts ?? []).map((a): [string, string] => [a.id, a.handle || a.name])]} />
        <div className="segmented" role="group" aria-label="Vista">
          <button className={view === 'month' ? 'on' : undefined} onClick={() => setView('month')}>
            Mese
          </button>
          <button className={view === 'week' ? 'on' : undefined} onClick={() => setView('week')}>
            Settimana
          </button>
        </div>
        <div className="segmented">
          <button onClick={() => step(-1)} aria-label={view === 'month' ? 'Mese precedente' : 'Settimana precedente'}>
            ←
          </button>
          <button onClick={() => setAnchor(new Date())}>Oggi</button>
          <button onClick={() => step(1)} aria-label={view === 'month' ? 'Mese successivo' : 'Settimana successiva'}>
            →
          </button>
        </div>
      </header>
      <div className="calendar-wrap">
        {view === 'month' ? (
          <MonthGrid anchor={anchor} today={today} over={over} byDay={byDay} chip={chip} dropProps={dropProps} />
        ) : (
          <div className="week" role="grid" aria-label="Settimana">
            <div className="week-corner" />
            {weekDays.map((d) => (
              <div key={dayKey(d)} className={`week-head${dayKey(d) === today ? ' today' : ''}`}>
                {WEEKDAYS[(d.getDay() + 6) % 7]} <strong>{d.getDate()}</strong>
              </div>
            ))}
            <div className="week-hour">senza ora</div>
            {weekDays.map((d) => {
              const k = dayKey(d);
              const key = `${k}-x`;
              return (
                <div key={key} className={`week-cell week-allday${over === key ? ' drop' : ''}`} {...dropProps(key, k)}>
                  {(byDay.get(k) ?? []).filter((e) => !hasTime(e.publishDate)).map(chip)}
                </div>
              );
            })}
            {HOURS.map((h) => (
              <WeekRow key={h} hour={h} days={weekDays} today={today} over={over} byDay={byDay} chip={chip} dropProps={dropProps} />
            ))}
          </div>
        )}
        <aside
          className="panel cal-unscheduled"
          onDragOver={(ev) => ev.preventDefault()}
          onDrop={(ev) => {
            const id = ev.dataTransfer.getData('text/episode');
            if (id) void api.update('episode', id, { publishDate: '' });
          }}
        >
          <h2>Da pianificare</h2>
          <p className="muted small">
            Trascina un contenuto su un giorno{view === 'week' ? ' e un\'ora' : ''}. Riportalo qui per togliere la data.
          </p>
          {unscheduled.length === 0 && <p className="muted">Tutto pianificato.</p>}
          {unscheduled.map(chip)}
        </aside>
      </div>
    </div>
  );
}

type Chip = (e: Episode) => React.ReactNode;
type DropProps = (key: string, day: string, hour?: number) => React.HTMLAttributes<HTMLDivElement>;

function MonthGrid({ anchor, today, over, byDay, chip, dropProps }: { anchor: Date; today: string; over: string; byDay: Map<string, Episode[]>; chip: Chip; dropProps: DropProps }) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = monday(first);
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  return (
    <div className="calendar">
      {WEEKDAYS.map((w) => (
        <div key={w} className="cal-head">
          {w}
        </div>
      ))}
      {days.map((d) => {
        const k = dayKey(d);
        return (
          <div key={k} className={`cal-day${d.getMonth() !== first.getMonth() ? ' other' : ''}${k === today ? ' today' : ''}${over === k ? ' drop' : ''}`} {...dropProps(k, k)}>
            <span className="cal-num">{d.getDate()}</span>
            {(byDay.get(k) ?? []).sort((a, b) => a.publishDate.localeCompare(b.publishDate)).map(chip)}
          </div>
        );
      })}
    </div>
  );
}

function WeekRow({ hour, days, today, over, byDay, chip, dropProps }: { hour: number; days: Date[]; today: string; over: string; byDay: Map<string, Episode[]>; chip: Chip; dropProps: DropProps }) {
  return (
    <>
      <div className="week-hour">{String(hour).padStart(2, '0')}:00</div>
      {days.map((d) => {
        const k = dayKey(d);
        const key = `${k}-${hour}`;
        // Gli orari prima delle 6 finiscono nella prima fascia.
        const items = (byDay.get(k) ?? []).filter((e) => hasTime(e.publishDate) && Math.max(6, Number(e.publishDate.slice(11, 13))) === hour);
        return (
          <div key={key} className={`week-cell${k === today ? ' today' : ''}${over === key ? ' drop' : ''}`} {...dropProps(key, k, hour)}>
            {items.map(chip)}
          </div>
        );
      })}
    </>
  );
}
