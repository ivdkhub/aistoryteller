// Composizione dei prompt: usata dal composer dell'interfaccia e dal server MCP.
import type { Character, StylePreset } from './types.ts';

type Style = Pick<StylePreset, 'prefix' | 'avoid'> | undefined;
type Cast = Pick<Character, 'name' | 'fixedDescription' | 'images' | 'continuityRules'>[];

/** Prefisso di stile + descrizioni fisse dei personaggi (con le immagini di riferimento numerate) + scena. */
export function buildImagePrompt(style: Style, cast: Cast, extraRefs: string[], scene: string) {
  const parts: string[] = [];
  if (style?.prefix) parts.push(style.prefix.trim());
  let n = 0;
  for (const c of cast) {
    if (c.images.length) {
      n++;
      parts.push(`Use the character from reference image ${n} exactly (same face, hair and clothes): ${c.fixedDescription || c.name}.`);
    } else if (c.fixedDescription) {
      parts.push(`${c.name}: ${c.fixedDescription}.`);
    }
  }
  for (const r of extraRefs) {
    n++;
    parts.push(`Match reference image ${n} (${r}).`);
  }
  if (scene.trim()) parts.push(scene.trim());
  return parts.join(' ').replace(/\.\./g, '.');
}

/** Movimento + regole di continuità dei personaggi + riga Avoid. */
export function buildVideoPrompt(style: Style, cast: Cast, motion: string) {
  const parts: string[] = [];
  if (style?.prefix) parts.push(style.prefix.trim());
  if (motion.trim()) parts.push(motion.trim());
  const rules = cast.flatMap((c) => c.continuityRules);
  if (rules.length) parts.push(`Continuity: ${rules.join('; ')}.`);
  if (style?.avoid) parts.push(`Avoid: ${style.avoid.trim()}`);
  return parts.join(' ');
}

/** Elenco delle immagini da allegare, nell'ordine dei riferimenti del prompt. */
export function attachmentsFor(cast: Cast, extraRefs: string[]) {
  const base = (p: string) => p.split(/[\\/]/).pop() ?? p;
  return [...cast.filter((c) => c.images.length).map((c) => `${base(c.images[0].path)} (${c.name})`), ...extraRefs];
}
