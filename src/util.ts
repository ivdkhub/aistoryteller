/** "1 variante" / "3 varianti". */
export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function formatDate(iso: string, withTime = true) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
  const hasTime = iso.includes('T') && !iso.endsWith('T00:00');
  return withTime && hasTime ? `${date}, ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}` : date;
}

/** "2026-10-29" per una data locale. */
export function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export { estimateSeconds, speakers } from '../shared/script.ts';
