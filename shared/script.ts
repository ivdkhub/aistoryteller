// Lettura dei copioni: "NOME: [tag] testo" sono battute dei personaggi, il resto è NARRATOR.

export interface ScriptLine {
  speaker: string;
  text: string;
  /** Riga di servizio (">>> RAMO MOVE", ">>> FINE RAMI"). */
  marker?: boolean;
}

export const NARRATOR = 'NARRATOR';
/** Ritmo reale della voce misurato sull'EP01 di Bank Error. */
export const WORDS_PER_MINUTE = 141;

export function parseScript(script: string): ScriptLine[] {
  const out: ScriptLine[] = [];
  for (const raw of script.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    if (t.startsWith('>>>')) {
      out.push({ speaker: '', text: t, marker: true });
      continue;
    }
    // Indicazioni di regia tra parentesi tonde su una riga a sé: non si doppiano.
    if (/^\(.*\)$/.test(t)) continue;
    const m = t.match(/^([A-Z][A-Z .']{1,30}):\s*(.*)$/);
    out.push(m ? { speaker: m[1].trim(), text: m[2] } : { speaker: NARRATOR, text: t });
  }
  return out;
}

/** Parole effettivamente pronunciate (senza tag [..] e senza "NOME:"). */
export function spokenWords(text: string) {
  return text.replace(/\[[^\]]*\]/g, ' ').replace(/^[A-Z .']+:/gm, ' ').split(/\s+/).filter((w) => /\w/.test(w)).length;
}

export function estimateSeconds(script: string) {
  return Math.round((spokenWords(script) / WORDS_PER_MINUTE) * 60);
}

/** Battute per personaggio, dal più presente. */
export function speakers(script: string): [string, number][] {
  const counts = new Map<string, number>();
  for (const l of parseScript(script)) if (!l.marker) counts.set(l.speaker, (counts.get(l.speaker) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
