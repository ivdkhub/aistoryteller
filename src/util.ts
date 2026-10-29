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

/** Battute per personaggio in un copione ("NOME: ..."); il resto è narratore. */
export function speakers(script: string) {
  const counts = new Map<string, number>();
  for (const line of script.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('>>>')) continue;
    const m = t.match(/^([A-Z][A-Z .']{1,30}):/);
    const who = m ? m[1].trim() : 'NARRATOR';
    counts.set(who, (counts.get(who) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/** Stima della durata parlata: ~141 parole al minuto (ritmo reale dell'EP01). */
export function estimateSeconds(script: string) {
  const words = script.replace(/\[[^\]]*\]/g, ' ').replace(/^[A-Z .']+:/gm, ' ').split(/\s+/).filter((w) => /\w/.test(w)).length;
  return Math.round((words / 141) * 60);
}
