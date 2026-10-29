// Parser del documento di stagione in stile "Bank Error" (copioni + prompt in un unico .txt).
// Funzione pura: dal testo ricava stili, personaggi, voci, bibbia, episodi e inquadrature.

export interface ParsedVariant {
  label: string;
  file: string;
  description: string;
}

export interface ParsedCharacter {
  name: string;
  age: string;
  role: string;
  imageFile: string;
  imageNote: string;
  fixedDescription: string;
  variants: ParsedVariant[];
  voice: string;
  arc: string;
  voiceOnly: boolean;
}

export interface ParsedStyle {
  name: string;
  prefix: string;
}

export interface ParsedShot {
  code: string;
  title: string;
  refs: string;
  file: string;
  imagePrompt: string;
  animPriority: '' | 'alta' | 'media' | 'bassa';
  animation: string;
  graphics: string;
  note: string;
  editing: string;
  caption: string;
  noImage: boolean;
}

export interface ParsedEpisode {
  code: string;
  number: number;
  title: string;
  produced: boolean;
  info: string;
  voices: string;
  vote: { options: string[]; winner: string; percent: string; notes: string };
  branches: string[];
  stateVars: Record<string, string>;
  script: string;
  shots: ParsedShot[];
  format: 'reel' | 'post';
  caption: string;
  /** Numero dell'episodio principale a cui è legato (post satellite). */
  linkedEpisode: number;
  satellite: boolean;
  notes: string;
}

export interface ParsedSeason {
  title: string;
  version: string;
  styles: ParsedStyle[];
  characters: ParsedCharacter[];
  bible: string;
  continuityRules: string[];
  episodes: ParsedEpisode[];
  satellite: { handle: string; altHandle: string; intro: string } | null;
  /** Variabili di stato (es. TRACE) con gli effetti dei voti per episodio. */
  stateDefs: { name: string; start: number; startEpisode: number; min: number | null; max: number | null; unit: string }[];
  voteEffects: { episode: number; variable: string; effects: Record<string, number> }[];
}

/**
 * "TRACE (TRACCIA %) — ... Parte dal 12% (ep. 2), min 5%, max 95%:
 *    voto 2 MOVE +29 / FREEZE 0 · voto 3 DEAL +25 / RUN +5 ..."
 */
function parseStateRules(lines: string[]): Pick<ParsedSeason, 'stateDefs' | 'voteEffects'> {
  const paragraphs = lines.join('\n').split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim());
  const stateDefs: ParsedSeason['stateDefs'] = [];
  const voteEffects: ParsedSeason['voteEffects'] = [];
  for (const p of paragraphs) {
    const def = p.match(/^([A-Z][A-Z ]*?)\s*(?:\([^)]*\))?\s*—.*?Parte da(?:l)?\s*(-?\d+)\s*(%?)\s*\(ep\.\s*(\d+)\)(?:,\s*min\s*(-?\d+)\s*%?)?(?:,\s*max\s*(-?\d+)\s*%?)?/);
    if (!def) continue;
    const name = def[1].trim();
    stateDefs.push({
      name, start: Number(def[2]), unit: def[3], startEpisode: Number(def[4]),
      min: def[5] !== undefined ? Number(def[5]) : null, max: def[6] !== undefined ? Number(def[6]) : null,
    });
    const num = (s: string) => Number(s.replace('−', '-').replace('+', ''));
    for (const m of p.matchAll(/voto\s+(\d+)\s+([A-Z][A-Z ]*?)\s+([+−-]?\d+)\s*\/\s*([A-Z][A-Z ]*?)\s+([+−-]?\d+)/g)) {
      voteEffects.push({ episode: Number(m[1]), variable: name, effects: { [m[2].trim()]: num(m[3]), [m[4].trim()]: num(m[5]) } });
    }
  }
  return { stateDefs, voteEffects };
}

const BANNER = /^(={10,}|#{10,})\s*$/;
const DASHES = /^-{10,}\s*$/;
const SHOT_HEAD = /^((?:EP\d{2}_S[\w-]+|J\d+_S[\w-]+|JEN_P\d+))(?:\s*·\s*(.*))?\s*$/;
const FIELD = /^(PROMPT|ANIMAZIONE|GRAFICA|NOTA|MONTAGGIO|DIDASCALIA|File)(?:\s*\(([^)]*)\))?:\s*(.*)$/;

interface Section {
  title: string;
  lines: string[];
}

/** Divide il testo nelle sezioni delimitate da righe ===== o #####. */
function splitSections(lines: string[]): { preamble: string[]; sections: Section[] } {
  const sections: Section[] = [];
  const preamble: string[] = [];
  let current: Section | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // Titolo di sezione: banner / titolo / banner.
    if (BANNER.test(l) && lines[i + 1]?.trim() && !BANNER.test(lines[i + 1]) && BANNER.test(lines[i + 2] ?? '')) {
      current = { title: lines[i + 1].trim(), lines: [] };
      sections.push(current);
      i += 2;
      continue;
    }
    if (BANNER.test(l)) continue;
    (current ? current.lines : preamble).push(l);
  }
  return { preamble, sections };
}

function trimBlock(lines: string[]): string {
  return lines.join('\n').replace(/^\s*\n/, '').trimEnd();
}

/** Estrae il testo tra virgolette a partire da una riga, anche su più righe. */
function readQuoted(lines: string[], start: number): { text: string; end: number } | null {
  let buf = '';
  for (let i = start; i < lines.length; i++) {
    buf += (buf ? ' ' : '') + lines[i].trim();
    const first = buf.indexOf('"');
    if (first === -1) {
      if (i > start) return null;
      continue;
    }
    const second = buf.indexOf('"', first + 1);
    if (second !== -1) return { text: buf.slice(first + 1, second).replace(/\s+/g, ' ').trim(), end: i };
  }
  return null;
}

/** Paragrafi "Etichetta: "prefisso..."", oppure "Notte: stessa frase, con "X" al posto di "Y"". */
function parseStyles(lines: string[]): ParsedStyle[] {
  const styles: ParsedStyle[] = [];
  const paragraphs: string[] = [];
  let buf: string[] = [];
  for (const l of [...lines, '']) {
    if (l.trim()) buf.push(l.trim());
    else if (buf.length) {
      paragraphs.push(buf.join(' '));
      buf = [];
    }
  }
  for (const p of paragraphs) {
    // L'etichetta finisce ai primi ":" fuori dalle parentesi.
    let depth = 0;
    let cut = -1;
    for (let i = 0; i < p.length; i++) {
      if (p[i] === '(') depth++;
      else if (p[i] === ')') depth--;
      else if (p[i] === ':' && depth === 0) {
        cut = i;
        break;
      }
    }
    if (cut === -1) continue;
    const label = p.slice(0, cut).trim();
    const rest = p.slice(cut + 1);
    const derived = rest.match(/con "(.+?)" al posto di "(.+?)"/);
    if (derived && styles.length) {
      styles.push({ name: label, prefix: styles[0].prefix.replace(derived[2], derived[1]) });
      continue;
    }
    const q = rest.match(/"([^"]+)"/);
    if (q) styles.push({ name: label, prefix: q[1].replace(/\s+/g, ' ').trim() });
  }
  return styles;
}

function parseCharacters(lines: string[]): ParsedCharacter[] {
  const out: ParsedCharacter[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    const head = l.match(/^(.+?)\s*\((.+)\)\s*—\s*scheda:\s*(.+)$/);
    const variant = l.match(/^([^"—]+?)\s*—\s*scheda:\s*(.+)$/);
    if (head) {
      const [age, role] = splitAgeRole(head[2]);
      const { file, note } = splitFile(head[3]);
      const q = readQuoted(lines, i + 1);
      out.push({
        name: head[1].trim(), age, role, imageFile: file, imageNote: note,
        fixedDescription: q?.text ?? '', variants: [], voice: '', arc: '', voiceOnly: false,
      });
      if (q) i = q.end;
    } else if (variant && out.length) {
      const { file } = splitFile(variant[2]);
      const q = readQuoted(lines, i + 1);
      out[out.length - 1].variants.push({ label: variant[1].trim(), file, description: q?.text ?? '' });
      if (q) i = q.end;
    }
  }
  return out;
}

function splitAgeRole(inner: string): [string, string] {
  const parts = inner.split(',').map((p) => p.trim());
  const idx = parts.findIndex((p) => /^\d{1,3}$/.test(p) || /^età/i.test(p));
  if (idx === -1) return ['', inner.trim()];
  const age = parts[idx];
  return [age, parts.filter((_, j) => j !== idx).join(', ')];
}

function splitFile(s: string): { file: string; note: string } {
  const m = s.trim().match(/^(.+?\.(?:png|jpe?g|webp))(.*)$/i);
  if (!m) return { file: s.trim(), note: '' };
  return { file: m[1].trim(), note: m[2].replace(/^[\s(]+|[\s)]+$/g, '') };
}

function parseVoices(lines: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const l of lines) {
    const m = l.match(/^([A-Z][A-Z .']*?[A-Z])\s{2,}(.+)$/);
    if (m) map.set(m[1].trim(), m[2].trim());
  }
  return map;
}

/** "- TU: vuoi tenerti i soldi..." → arco narrativo per nome. */
function parseArcs(lines: string[]): Map<string, string> {
  const map = new Map<string, string>();
  let start = lines.findIndex((l) => /^I PERSONAGGI NELLA/i.test(l.trim()));
  if (start === -1) return map;
  let key = '';
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) break;
    const m = l.match(/^-\s*([^:]+):\s*(.*)$/);
    if (m) {
      key = m[1].trim();
      map.set(key, m[2].trim());
    } else if (key && /^\s+/.test(l)) {
      map.set(key, map.get(key) + ' ' + l.trim());
    }
  }
  return map;
}

function matchCharacter(chars: ParsedCharacter[], key: string): ParsedCharacter | undefined {
  const k = key.toUpperCase();
  return (
    chars.find((c) => c.name.toUpperCase() === k) ??
    chars.find((c) => c.name.toUpperCase().split(/[\s.]+/).includes(k)) ??
    chars.find((c) => c.imageFile.toUpperCase().includes(k))
  );
}

/** "MOVE (...) / FREEZE (...)", anche doppio: "TU CONTACT / HIDE · JEN (sul suo profilo) TRUST / REPORT". */
function parseVote(raw: string): ParsedEpisode['vote'] {
  const vote = { options: [] as string[], winner: '', percent: '', notes: raw.trim() };
  const won = raw.match(/vinto\s+([A-Z][A-Z ]*?),\s*(\d+)\s*%/);
  if (won) {
    vote.winner = won[1].trim();
    vote.percent = won[2];
  }
  for (const part of raw.replace(/\([^)]*\)/g, '').split('·')) {
    if (!part.includes('/')) continue;
    const segs = part.trim().replace(/^(TU|JEN)\s+/, '').split('/');
    for (const seg of segs) {
      const opt = seg.trim().match(/^[A-Z][A-Z ]*[A-Z]\b|^[A-Z]\b/)?.[0];
      if (opt) vote.options.push(opt.trim());
    }
  }
  return vote;
}

function emptyShot(code: string, rest: string): ParsedShot {
  const shot: ParsedShot = {
    code, title: '', refs: '', file: '', imagePrompt: '', animPriority: '', animation: '',
    graphics: '', note: '', editing: '', caption: '', noImage: /NESSUNA IMMAGINE/i.test(rest),
  };
  const titles: string[] = [];
  for (const part of rest.split(/\s+·\s+/)) {
    const p = part.trim();
    if (!p) continue;
    if (/^Rif\.:/.test(p)) shot.refs = p.replace(/^Rif\.:\s*/, '');
    else if (/^File:/.test(p)) shot.file = p.replace(/^File:\s*/, '');
    else titles.push(p);
  }
  shot.title = titles.join(' · ').replace(/^"(.*)"$/, '$1');
  return shot;
}

/** Legge le inquadrature (blocchi che iniziano con un codice tipo EP02_S07). */
function parseShots(lines: string[]): { shots: ParsedShot[]; rest: string[] } {
  const shots: ParsedShot[] = [];
  const rest: string[] = [];
  let shot: ParsedShot | null = null;
  let field: keyof ParsedShot | null = null;
  const append = (key: keyof ParsedShot, text: string) => {
    if (!shot) return;
    const prev = shot[key];
    if (typeof prev === 'string') (shot as unknown as Record<string, string>)[key] = prev ? `${prev}\n${text}` : text;
  };
  for (const raw of lines) {
    const l = raw.trimEnd();
    const head = l.match(SHOT_HEAD);
    if (head) {
      shot = emptyShot(head[1], head[2] ?? '');
      shots.push(shot);
      field = null;
      continue;
    }
    const f = l.match(FIELD);
    if (f && shot) {
      const [, name, paren, text] = f;
      switch (name) {
        case 'PROMPT': field = 'imagePrompt'; break;
        case 'ANIMAZIONE': {
          field = 'animation';
          const prio = (paren ?? '').split(',')[0].trim().toLowerCase();
          if (prio === 'alta' || prio === 'media' || prio === 'bassa') shot.animPriority = prio;
          if (paren && /chiave/i.test(paren)) append('note', 'Animazione chiave.');
          break;
        }
        case 'GRAFICA': field = 'graphics'; break;
        case 'NOTA': field = 'note'; break;
        case 'MONTAGGIO': field = 'editing'; break;
        case 'DIDASCALIA': field = 'caption'; break;
        case 'File': field = 'file'; break;
      }
      if (field) append(field, text.trim());
      continue;
    }
    if (!l.trim()) {
      field = null;
      continue;
    }
    if (shot && field) append(field, l.trim());
    else if (shot && /^\s/.test(raw)) append('note', l.trim());
    else {
      shot = null;
      rest.push(l);
    }
  }
  return { shots, rest };
}

function parseEpisode(sec: Section): ParsedEpisode {
  const m = sec.title.match(/^EP\.\s*(\d+)\s*—\s*"?([^"]+)"?(.*)$/);
  const number = m ? Number(m[1]) : 0;
  const ep: ParsedEpisode = {
    code: `EP${String(number).padStart(2, '0')}`, number, title: m ? m[2].trim() : sec.title,
    produced: m ? /GIÀ PRODOTTO/i.test(m[3]) : false, info: '', voices: '',
    vote: { options: [], winner: '', percent: '', notes: '' }, branches: [], stateVars: {}, script: '', shots: [],
    format: 'reel', caption: '', linkedEpisode: 0, satellite: false, notes: '',
  };
  const voiceIdx = sec.lines.findIndex((l) => /^-{5,}\s*VOCE COMPLETA/.test(l));
  const shotIdx = sec.lines.findIndex((l) => /^-{5,}\s*INQUADRATURE/.test(l));
  const headEnd = voiceIdx !== -1 ? voiceIdx : shotIdx !== -1 ? shotIdx : sec.lines.length;
  const info: string[] = [];
  let voteRaw = '';
  let inVote = false;
  for (const l of sec.lines.slice(0, headEnd)) {
    const t = l.trim();
    if (!t) continue;
    const voteHead = t.match(/^(?:Voto[^:]*|ULTIMO VOTO[^:]*):\s*(.+)$/i);
    if (/^Voci:/.test(t)) ep.voices = t.replace(/^Voci:\s*/, '');
    else if (voteHead) {
      voteRaw = voteHead[1];
      inVote = true;
      continue;
    } else if (inVote && t.startsWith('·')) {
      voteRaw += ' ' + t;
      continue;
    } else info.push(t);
    inVote = false;
    const inline = t.match(/·\s*Voto:\s*(.+)$/);
    if (inline) voteRaw = inline[1];
    const trace = t.match(/^TRACE[^:]*:\s*(.+)$/) ?? t.match(/TRACE debutta:\s*([\d%]+)/);
    if (trace) ep.stateVars.TRACE = trace[1].trim();
  }
  if (voteRaw) ep.vote = parseVote(voteRaw);
  ep.info = info.join('\n');
  if (voiceIdx !== -1) {
    const end = shotIdx > voiceIdx ? shotIdx : sec.lines.length;
    ep.script = trimBlock(sec.lines.slice(voiceIdx + 1, end));
  }
  ep.branches = [...new Set([...sec.lines.join('\n').matchAll(/^>>>\s*RAMO\s+(.+?)\s*$/gm)].map((x) => x[1].trim()))];
  if (shotIdx !== -1) {
    const { shots, rest } = parseShots(sec.lines.slice(shotIdx + 1));
    ep.shots = shots;
    ep.notes = rest.filter((l) => l.trim()).join('\n');
  }
  return ep;
}

/** Sezione del profilo satellite: post statici + J1..Jn, separati da righe di trattini. */
function parseSatellite(sec: Section): { meta: NonNullable<ParsedSeason['satellite']>; episodes: ParsedEpisode[]; style: ParsedStyle | null } {
  const handles = [...sec.title.matchAll(/@[\w.]+/g)].map((x) => x[0]);
  const blocks: { head: string[]; body: string[] }[] = [];
  const intro: string[] = [];
  let i = 0;
  for (; i < sec.lines.length && !DASHES.test(sec.lines[i]); i++) intro.push(sec.lines[i]);
  while (i < sec.lines.length) {
    // Intestazione tra due righe di trattini, poi il corpo fino alla prossima intestazione.
    i++;
    const head: string[] = [];
    for (; i < sec.lines.length && !DASHES.test(sec.lines[i]); i++) head.push(sec.lines[i].trim());
    i++;
    const body: string[] = [];
    for (; i < sec.lines.length && !DASHES.test(sec.lines[i]); i++) body.push(sec.lines[i]);
    blocks.push({ head: head.filter(Boolean), body });
  }
  const introText = intro.join('\n');
  const alt = introText.match(/alternativa\s+(@[\w.]*\w)/i)?.[1] ?? '';
  const styleQ = introText.match(/Stile comune dei prompt:\s*"([^"]+)"/);
  const episodes: ParsedEpisode[] = [];
  for (const b of blocks) {
    const title = b.head[0] ?? '';
    const voteLine = b.head.find((h) => /^Voto/.test(h)) ?? '';
    const jm = title.match(/^(J\d+)\s*—\s*"([^"]+)"\s*(?:\((.+)\))?/);
    if (jm) {
      const voiceStart = b.body.findIndex((l) => /^VOCE/.test(l.trim()));
      const shotStart = b.body.findIndex((l) => /^INQUADRATURE/.test(l.trim()));
      const { shots, rest } = parseShots(shotStart === -1 ? [] : b.body.slice(shotStart + 1));
      const linked = jm[3]?.match(/ep\.\s*(\d+)/)?.[1];
      episodes.push({
        code: jm[1], number: Number(jm[1].slice(1)), title: jm[2], produced: false, info: jm[3] ?? '',
        voices: 'JEN', vote: parseVote(voteLine.replace(/^Voto[^:]*:\s*/, '')), branches: [], stateVars: {},
        script: voiceStart === -1 ? '' : trimBlock(b.body.slice(voiceStart + 1, shotStart === -1 ? undefined : shotStart)),
        shots, format: 'reel', caption: '', linkedEpisode: linked ? Number(linked) : 0, satellite: true,
        notes: rest.filter((l) => l.trim()).join('\n'),
      });
    } else {
      // Post statici: ogni inquadratura è un post a sé.
      const linked = title.match(/ep\.\s*(\d+)/)?.[1];
      for (const s of parseShots(b.body).shots) {
        episodes.push({
          code: s.code, number: Number(s.code.match(/\d+$/)?.[0] ?? 0), title: s.title, produced: false, info: title,
          voices: '', vote: { options: [], winner: '', percent: '', notes: '' }, branches: [], stateVars: {}, script: '',
          shots: [s], format: 'post', caption: s.caption, linkedEpisode: linked ? Number(linked) : 0, satellite: true, notes: '',
        });
      }
    }
  }
  return {
    meta: { handle: handles[0] ?? '', altHandle: alt, intro: introText.trim() },
    episodes,
    style: styleQ ? { name: 'Selfie (profilo satellite)', prefix: styleQ[1] } : null,
  };
}

/** Elenchi puntati con continuazioni indentate; tiene solo le regole di continuità. */
function bulletRules(lines: string[]): string[] {
  const bullets: string[] = [];
  for (const l of lines) {
    if (/^-\s+/.test(l.trim()) && !/^\s{4,}/.test(l)) bullets.push(l.trim().replace(/^-\s+/, ''));
    else if (bullets.length && /^\s+\S/.test(l)) bullets[bullets.length - 1] += ' ' + l.trim();
  }
  return bullets.filter((b) => /\bMAI\b|^Niente\b|\bsempre\b/.test(b));
}

export function parseSeason(text: string): ParsedSeason {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const { preamble, sections } = splitSections(lines);
  const head = preamble.filter((l) => l.trim());
  const season: ParsedSeason = {
    title: head[0]?.trim() ?? 'Serie importata',
    version: head.find((l) => /^Versione/i.test(l.trim()))?.trim() ?? '',
    styles: [], characters: [], bible: '', continuityRules: [], episodes: [], satellite: null, stateDefs: [], voteEffects: [],
  };
  const bible: string[] = [];
  let voices = new Map<string, string>();
  const arcs = new Map<string, string>();
  for (const sec of sections) {
    const t = sec.title.toUpperCase();
    if (/^EP\.\s*\d+/.test(t)) season.episodes.push(parseEpisode(sec));
    else if (t.startsWith('STILE')) season.styles.push(...parseStyles(sec.lines));
    else if (t.startsWith('PERSONAGGI')) season.characters.push(...parseCharacters(sec.lines));
    else if (t.startsWith('VOCI')) voices = parseVoices(sec.lines);
    else if (t.startsWith('PROFILO')) {
      const sat = parseSatellite(sec);
      season.satellite = sat.meta;
      season.episodes.push(...sat.episodes);
      if (sat.style) season.styles.push(sat.style);
    } else {
      for (const [k, v] of parseArcs(sec.lines)) arcs.set(k, v);
      if (t.startsWith('COME LEGGERE')) season.continuityRules = bulletRules(sec.lines);
      if (t.startsWith('NUMERI')) Object.assign(season, parseStateRules(sec.lines));
      bible.push(`## ${sec.title}\n\n${trimBlock(sec.lines)}`);
    }
  }
  season.bible = bible.join('\n\n');
  for (const [key, desc] of voices) {
    const c = matchCharacter(season.characters, key);
    if (c) c.voice = desc;
    else {
      season.characters.push({
        name: key, age: '', role: 'solo voce', imageFile: '', imageNote: '', fixedDescription: '',
        variants: [], voice: desc, arc: '', voiceOnly: true,
      });
    }
  }
  for (const [key, arc] of arcs) {
    const c = matchCharacter(season.characters, key);
    if (c) c.arc = arc;
  }
  return season;
}

/** Codici dei personaggi citati nei riferimenti di un'inquadratura ("scheda NICO", "BANK TELLER.png"). */
export function referencedCharacters(refs: string, chars: { name: string; imageFile: string }[]): number[] {
  const out = new Set<number>();
  const up = refs.toUpperCase();
  for (const m of up.matchAll(/SCHEDA\s+([A-ZÀ-Ü.]+(?:\s+[A-ZÀ-Ü]+)?)/g)) {
    const key = m[1].replace(/\.$/, '');
    const idx = chars.findIndex(
      (c) => c.name.toUpperCase() === key || c.name.toUpperCase().split(/[\s.]+/).includes(key.split(/\s+/)[0]),
    );
    if (idx !== -1) out.add(idx);
  }
  chars.forEach((c, idx) => {
    if (c.imageFile && up.includes(c.imageFile.toUpperCase())) out.add(idx);
  });
  return [...out];
}
