// Export di un episodio: markdown nel formato del documento di stagione e CSV della timeline.
import path from 'node:path';
import * as db from './db.ts';
import { SHOT_STATUS_LABEL, type Episode, type Shot } from '../shared/types.ts';

function shotsOf(episode: Episode): Shot[] {
  return db.list('shot', { episodeId: episode.id }).sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));
}

export function episodeMarkdown(episode: Episode): string {
  const out: string[] = [];
  out.push(`# ${episode.code} — "${episode.title}"`, '');
  if (episode.info) out.push(episode.info, '');
  if (episode.voices) out.push(`Voci: ${episode.voices}`);
  if (episode.vote.options.length) {
    const won = episode.vote.winner ? ` (vinto ${episode.vote.winner}${episode.vote.percent ? `, ${episode.vote.percent}%` : ''})` : '';
    out.push(`Voto finale: ${episode.vote.options.join(' / ')}${won}`);
  }
  for (const [k, v] of Object.entries(episode.stateVars)) out.push(`${k}: ${v}`);
  if (episode.caption) out.push(`Didascalia: ${episode.caption}`);
  if (episode.hashtags) out.push(`Hashtag: ${episode.hashtags}`);
  out.push('', '---------------- VOCE COMPLETA ----------------', '', episode.script.trim(), '');
  out.push('---------------- INQUADRATURE E PROMPT ----------------', '');
  for (const s of shotsOf(episode)) {
    const head = [s.code, s.title, s.refs ? `Rif.: ${s.refs}` : ''].filter(Boolean).join(' · ');
    out.push(head);
    if (s.imagePrompt) out.push(`PROMPT: ${s.imagePrompt}`);
    if (s.graphics) out.push(`GRAFICA: ${s.graphics}`);
    if (s.note) out.push(`NOTA: ${s.note}`);
    if (s.animation) out.push(`ANIMAZIONE${s.animPriority ? ` (${s.animPriority})` : ''}: ${s.animation}`);
    if (s.videoPrompt) out.push(`PROMPT VIDEO: ${s.videoPrompt}`);
    if (s.editing) out.push(`MONTAGGIO: ${s.editing}`);
    out.push(`STATO: ${SHOT_STATUS_LABEL[s.status]}`, '');
  }
  return out.join('\n');
}

function csvCell(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Stesse colonne di deliverables/timeline.csv; i tempi restano da compilare in montaggio. */
export function timelineCsv(episode: Episode): string {
  const header = ['tc_in', 'tc_out', 'in_s', 'out_s', 'shot', 'asset', 'clip', 'movimento', 'battuta', 'overlay', 'sfx', 'note'];
  const rows = shotsOf(episode)
    .filter((s) => s.status !== 'discarded')
    .map((s) => [
      '', '', '', '', s.code,
      s.imageFile ? path.basename(s.imageFile) : '',
      s.videoFile ? path.basename(s.videoFile) : '',
      s.animation, s.line, s.graphics, '', [s.cut, s.editing].filter(Boolean).join(' · '),
    ]);
  return [header, ...rows].map((r) => r.map((c) => csvCell(c ?? '')).join(',')).join('\r\n') + '\r\n';
}
