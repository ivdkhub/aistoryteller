// Controllo di coerenza dei personaggi nei prompt di un'inquadratura.
// Euristico: segnala cosa ricontrollare, non decide al posto tuo.
import type { Character, Shot } from './types.ts';

export interface Issue {
  level: 'warn' | 'info';
  /** Personaggio coinvolto (se c'è). */
  character?: string;
  text: string;
}

const STOP = new Set([
  'with', 'and', 'the', 'over', 'under', 'into', 'from', 'that', 'this', 'very', 'slightly', 'about', 'around',
  'year', 'old', 'years', 'wearing', 'their', 'his', 'her', 'has', 'have', 'always', 'some', 'blank',
]);

function words(s: string) {
  return s.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? [];
}

/** Quanta parte della descrizione fissa compare nel prompt (0-1), contando le parole significative. */
export function descriptionCoverage(prompt: string, description: string) {
  const key = [...new Set(words(description).filter((w) => !STOP.has(w)))];
  if (!key.length) return 1;
  const have = new Set(words(prompt));
  return key.filter((w) => have.has(w)).length / key.length;
}

// Regole di continuità (in italiano) → parole inglesi da cercare nei prompt.
const RULE_TOPICS: { it: RegExp; en: string[] }[] = [
  { it: /volto|viso|faccia/i, en: ['face', 'facial'] },
  { it: /bocca|labbra|lip-?sync|parla/i, en: ['mouth', 'lips', 'talking', 'speaking'] },
  { it: /occhi|sguardo/i, en: ['eyes', 'gaze'] },
  { it: /mani\b|dita/i, en: ['hands', 'fingers'] },
];
const NEGATION_IT = /\b(mai|non|niente|nessun[oa]?|no)\b/i;
// Parole che, nella stessa frase del prompt, indicano che l'elemento è nascosto o negato.
const HIDDEN_EN = /\b(hidden|hide|hides|shadow|shadowed|no|not|never|without|closed|covered|obscured|behind|away|back of|from behind|turned away|out of frame|cannot be seen)\b/i;

function sentences(text: string) {
  return text.split(/(?<=[.!?;])\s+/);
}

/** Parole distintive di una descrizione presenti nella frase. */
function sharedWords(sentence: string, description: string) {
  const have = new Set(words(sentence));
  return words(description).filter((w) => !STOP.has(w) && have.has(w)).length;
}

/**
 * Regole del tipo "non mostra MAI il volto": cerca frasi del prompt che nominano il volto senza nasconderlo.
 * Le frasi che descrivono un altro personaggio (ne riprendono la descrizione fissa) non contano.
 */
export function ruleViolations(prompt: string, rule: string, otherDescriptions: string[] = []): string[] {
  if (!NEGATION_IT.test(rule)) return [];
  const hits: string[] = [];
  for (const topic of RULE_TOPICS) {
    if (!topic.it.test(rule)) continue;
    for (const s of sentences(prompt)) {
      // Le istruzioni di identità ("same face as reference image 1") e i modi di dire ("face down") non contano.
      if (/reference image|character sheet/i.test(s)) continue;
      if (otherDescriptions.some((d) => sharedWords(s, d) >= 3)) continue;
      const lower = s.toLowerCase().replace(/\bface[- ](down|up)\b|\bsurface\b|\btypeface\b/g, '');
      if (topic.en.some((w) => new RegExp(`\\b${w}\\b`).test(lower)) && !HIDDEN_EN.test(lower)) hits.push(s.trim());
    }
  }
  return hits;
}

function nameKeys(c: Pick<Character, 'name'>) {
  // "MR. KADE" → ["MR. KADE", "KADE"]; i nomi brevi (es. "TU") non si cercano nel testo.
  const parts = c.name.split(/[\s.]+/).filter((p) => p.length >= 3 && !/^(MR|MRS|MS|DR|LA|IL|LO)$/i.test(p));
  return parts;
}

type ShotLike = Pick<Shot, 'characterIds' | 'refs' | 'imagePrompt' | 'videoPrompt' | 'noImage' | 'status' | 'imageFile'>;
type CharLike = Pick<Character, 'id' | 'name' | 'fixedDescription' | 'continuityRules' | 'images' | 'voiceOnly'>;

export function checkShot(shot: ShotLike, characters: CharLike[]): Issue[] {
  const issues: Issue[] = [];
  const cast = shot.characterIds.map((id) => characters.find((c) => c.id === id)).filter((c): c is CharLike => !!c);
  const prompt = shot.imagePrompt.trim();

  for (const c of cast) {
    if (prompt && c.fixedDescription) {
      const cov = descriptionCoverage(prompt, c.fixedDescription);
      // Informazione, non avviso: nelle inquadrature parziali (una mano, una sagoma) è normale.
      if (cov < 0.4) {
        issues.push({ level: 'info', character: c.name, text: `Il prompt immagine riprende solo il ${Math.round(cov * 100)}% della descrizione fissa di ${c.name}: va bene se si vede solo in parte.` });
      }
    }
    const others = characters.filter((o) => o.id !== c.id && o.fixedDescription).map((o) => o.fixedDescription);
    for (const rule of c.continuityRules) {
      for (const [label, text] of [['immagine', prompt], ['video', shot.videoPrompt]] as const) {
        const hits = text ? ruleViolations(text, rule, others) : [];
        if (hits.length) {
          issues.push({ level: 'warn', character: c.name, text: `Regola "${rule}" — da verificare nel prompt ${label}: "${hits[0].slice(0, 120)}"` });
        }
      }
    }
  }

  // Personaggi nei riferimenti ("scheda NICO", "BANK TELLER.png") o nominati nel prompt ma non segnati.
  const refsUp = shot.refs.toUpperCase();
  for (const c of characters) {
    if (c.voiceOnly || shot.characterIds.includes(c.id)) continue;
    const keys = nameKeys(c);
    const inRefs =
      keys.some((k) => new RegExp(`SCHEDA\\s+${k.toUpperCase()}\\b`).test(refsUp)) ||
      c.images.some((i) => refsUp.includes((i.path.split(/[\\/]/).pop() ?? '').toUpperCase()));
    if (inRefs) {
      issues.push({ level: 'warn', character: c.name, text: `${c.name} è tra i riferimenti ma non è segnato tra i personaggi in scena.` });
      continue;
    }
    if (keys.some((k) => new RegExp(`\\b${k}\\b`, 'i').test(prompt))) {
      issues.push({ level: 'info', character: c.name, text: `Il prompt nomina ${c.name}, che non è segnato tra i personaggi in scena.` });
    }
  }

  if (!shot.noImage && shot.status !== 'todo' && shot.status !== 'discarded' && !prompt) {
    issues.push({ level: 'info', text: 'Immagine pronta ma senza prompt registrato: salvalo per poterla rigenerare.' });
  }
  return issues;
}
