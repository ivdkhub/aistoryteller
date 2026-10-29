import { describe, expect, it } from 'vitest';
import { checkShot, descriptionCoverage, ruleViolations } from './consistency.ts';

const TU = { id: 'tu', name: 'TU', fixedDescription: 'a person in a grey zip-up hoodie with the hood up, face always completely hidden in shadow', continuityRules: ['Il protagonista non mostra MAI il volto'], images: [], voiceOnly: false };
const NICO = { id: 'nico', name: 'NICO DALE', fixedDescription: 'curly dark-brown hair, oversized washed-black hoodie, thin gold chain', continuityRules: [], images: [{ path: 'C:\\x\\NICO DALE_30.png', label: 'Scheda' }], voiceOnly: false };
const shot = (p: Partial<Parameters<typeof checkShot>[0]>) => ({ characterIds: [], refs: '', imagePrompt: '', videoPrompt: '', noImage: false, status: 'todo' as const, imageFile: '', ...p });

describe('controllo di coerenza', () => {
  it('misura quanto della descrizione fissa è nel prompt', () => {
    expect(descriptionCoverage('a man with curly dark-brown hair, oversized washed-black hoodie and a thin gold chain', NICO.fixedDescription)).toBe(1);
    expect(descriptionCoverage('a man in a suit', NICO.fixedDescription)).toBeLessThan(0.2);
  });

  it('trova le violazioni delle regole e ignora i falsi allarmi', () => {
    const rule = 'non mostra MAI il volto';
    expect(ruleViolations('The protagonist turns and looks at the camera, his face lit by the screen.', rule)).toHaveLength(1);
    expect(ruleViolations('The face is hidden in shadow under the hood.', rule)).toHaveLength(0);
    expect(ruleViolations('A phone lies face down on the counter.', rule)).toHaveLength(0);
    expect(ruleViolations('Use the woman from reference image 1 exactly (same face, hair).', rule)).toHaveLength(0);
    expect(ruleViolations('Bright smiling face.', 'ha sempre il cappuccio')).toHaveLength(0);
    // La frase descrive un altro personaggio (Kade), non il protagonista.
    const kade = 'a lean ageless man with a sharp weathered face and swept-back salt-and-pepper hair, long charcoal wool overcoat';
    expect(ruleViolations('Inside, a lean ageless man with a sharp weathered face and swept-back hair stands still.', rule, [kade])).toHaveLength(0);
  });

  it('segnala regole violate, personaggi non segnati e nominati', () => {
    const issues = checkShot(
      shot({ characterIds: ['tu'], refs: 'scheda TU, scheda NICO', imagePrompt: 'A grey hoodie, hood up. We see his face clearly. Nico waits outside.' }),
      [TU, NICO],
    );
    expect(issues.some((i) => i.level === 'warn' && i.text.includes('MAI il volto'))).toBe(true);
    expect(issues.some((i) => i.level === 'warn' && i.character === 'NICO DALE')).toBe(true);
    const named = checkShot(shot({ characterIds: ['tu'], imagePrompt: 'Nico waits outside, face hidden.' }), [TU, NICO]);
    expect(named.find((i) => i.character === 'NICO DALE')?.level).toBe('info');
  });

  it('nessun avviso per un\'inquadratura coerente', () => {
    const ok = checkShot(shot({ characterIds: ['tu'], refs: 'scheda TU', imagePrompt: `${TU.fixedDescription}. Walking in the rain, seen from behind.` }), [TU, NICO]);
    expect(ok).toEqual([]);
  });
});
