// Operazioni di dominio sopra l'archivio: storico dei prompt delle inquadrature.
import * as db from './db.ts';
import type { Shot } from '../shared/types.ts';

/**
 * Aggiorna un'inquadratura. Se il prompt immagine o video cambia, la versione
 * precedente finisce nello storico dei prompt (sostituisce i file _backup manuali).
 */
export function updateShot(id: string, patch: Partial<Shot>): Shot | undefined {
  const old = db.get('shot', id);
  if (!old) return undefined;
  const fields = [
    ['imagePrompt', 'image'],
    ['videoPrompt', 'video'],
  ] as const;
  for (const [field, type] of fields) {
    const next = patch[field];
    if (next !== undefined && old[field].trim() && next.trim() !== old[field].trim()) {
      db.create('prompt', {
        shotId: id,
        projectId: old.projectId,
        accountId: old.accountId,
        title: `${old.code} · versione precedente`,
        type,
        tool: type === 'image' ? 'Nano Banana Pro' : 'Kling',
        text: old[field],
        outcome: 'previous',
      });
    }
  }
  return db.update('shot', id, patch);
}
