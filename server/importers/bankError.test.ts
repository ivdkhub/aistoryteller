import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSeason, referencedCharacters } from './bankError.ts';

const REAL = 'C:/Spazio di lavoro/ivdk/Contenuti/Insta-series/Bank_error_S1_copioni_e_prompt.txt';

const SAMPLE = `SERIE DI PROVA — STAGIONE 1
Versione 1 del 1 gennaio 2026

======================================================================
COME LEGGERE QUESTO FILE
======================================================================

- Il protagonista (TU) non mostra MAI il volto.
- Niente lip-sync: chi parla è di spalle.

======================================================================
STILE COMUNE (già incluso in ogni prompt)
======================================================================

Giorno:
"Photorealistic still, soft overcast light, no text."

Notte: stessa frase, con "night darkness" al posto di "soft overcast light".

======================================================================
PERSONAGGI — DESCRIZIONI FISSE
======================================================================

TU (protagonista, 30, barista) — scheda: TU_30_Barista.png
"a person in a grey hoodie,
face hidden"

ANNA ROSSI (età indefinita, vicina) — scheda: ANNA_40_Vicina.png (identica)
"a woman with red hair"
Esterni — scheda: ANNA_40_Vicina_ESTERNO.png
"a woman with red hair and a coat"

======================================================================
VOCI (ElevenLabs)
======================================================================

NARRATOR  calmo, intimo.
ANNA      femminile, ironica.

######################################################################
EP. 1 — "PILOT"   ·   GIÀ PRODOTTO
######################################################################
Giorno: lunedì · Durata reale: 90 s · Voto: LEFT / RIGHT (vinto RIGHT, 61%)
Voci: NARRATOR, ANNA

---------------- VOCE COMPLETA ----------------

[calm] Hello.
ANNA: [dry] Hi.

---------------- INQUADRATURE E PROMPT ----------------

EP01_S01 · La porta · Rif.: scheda TU, scheda ANNA
PROMPT: Photorealistic still, a door.
ANIMAZIONE (alta, chiave): la porta si apre.
NOTA: rigenerata.

EP01_S02_CCTV · Ripresa · File: EP01_S02_cctv.jpg (già generata)
PROMPT: Security camera look.
MONTAGGIO: taglio glitch.
`;

describe('parseSeason (esempio)', () => {
  const s = parseSeason(SAMPLE);

  it('legge titolo, stili e regole', () => {
    expect(s.title).toBe('SERIE DI PROVA — STAGIONE 1');
    expect(s.styles.map((x) => x.name)).toEqual(['Giorno', 'Notte']);
    expect(s.styles[1].prefix).toBe('Photorealistic still, night darkness, no text.');
    expect(s.continuityRules).toHaveLength(2);
  });

  it('legge le carte personaggio con varianti e voci', () => {
    const [tu, anna, narrator] = s.characters;
    expect(tu).toMatchObject({ name: 'TU', age: '30', role: 'protagonista, barista', imageFile: 'TU_30_Barista.png' });
    expect(tu.fixedDescription).toBe('a person in a grey hoodie, face hidden');
    expect(anna).toMatchObject({ age: 'età indefinita', imageNote: 'identica', voice: 'femminile, ironica.' });
    expect(anna.variants).toEqual([{ label: 'Esterni', file: 'ANNA_40_Vicina_ESTERNO.png', description: 'a woman with red hair and a coat' }]);
    expect(narrator).toMatchObject({ name: 'NARRATOR', voiceOnly: true });
  });

  it('legge episodio, voto, copione e inquadrature', () => {
    const [ep] = s.episodes;
    expect(ep).toMatchObject({ code: 'EP01', number: 1, title: 'PILOT', produced: true, voices: 'NARRATOR, ANNA' });
    expect(ep.vote).toMatchObject({ options: ['LEFT', 'RIGHT'], winner: 'RIGHT', percent: '61' });
    expect(ep.script).toContain('ANNA: [dry] Hi.');
    expect(ep.shots.map((x) => x.code)).toEqual(['EP01_S01', 'EP01_S02_CCTV']);
    expect(ep.shots[0]).toMatchObject({ title: 'La porta', refs: 'scheda TU, scheda ANNA', animPriority: 'alta', animation: 'la porta si apre.' });
    expect(ep.shots[1]).toMatchObject({ file: 'EP01_S02_cctv.jpg (già generata)', editing: 'taglio glitch.' });
  });

  it('riconosce i personaggi citati nei riferimenti', () => {
    expect(referencedCharacters('scheda TU, scheda ANNA', s.characters)).toEqual([0, 1]);
    expect(referencedCharacters('1) ANNA_40_Vicina.png', s.characters)).toEqual([1]);
  });
});

describe.runIf(fs.existsSync(REAL))('parseSeason (documento reale Bank Error)', () => {
  const s = parseSeason(fs.readFileSync(REAL, 'utf8'));

  it('trova le 8 carte personaggio e le voci senza scheda', () => {
    expect(s.characters.filter((c) => !c.voiceOnly)).toHaveLength(8);
    expect(s.characters.filter((c) => c.fixedDescription).every((c) => c.imageFile)).toBe(true);
  });

  it('trova gli episodi 1-10 e il profilo satellite', () => {
    const main = s.episodes.filter((e) => !e.satellite);
    expect(main.map((e) => e.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(s.satellite?.handle).toBe('@fatfinger.jen');
    expect(s.episodes.filter((e) => e.satellite).length).toBeGreaterThanOrEqual(6);
  });

  it('legge la variabile TRACE e gli effetti dei voti', () => {
    expect(s.stateDefs).toEqual([{ name: 'TRACE', start: 12, startEpisode: 2, min: 5, max: 95, unit: '%' }]);
    expect(s.voteEffects.find((v) => v.episode === 5)?.effects).toEqual({ COVER: 15, ESCAPE: 0 });
  });

  it('EP02 ha inquadrature con prompt non vuoti', () => {
    const ep2 = s.episodes.find((e) => e.code === 'EP02')!;
    expect(ep2.shots.length).toBeGreaterThan(20);
    const withImages = ep2.shots.filter((x) => !x.noImage);
    expect(withImages.every((x) => x.imagePrompt.length > 50)).toBe(true);
  });
});
