// Galleria delle generazioni di un'inquadratura: principale, varianti, scarti e risultati dei prompt, affiancati.
import { useState } from 'react';
import { baseName, isVideo, useItems } from '../api.ts';
import { Media, Modal } from './ui.tsx';
import type { Shot } from '../../shared/types.ts';

interface Candidate {
  path: string;
  video: boolean;
  primary: boolean;
  discarded: boolean;
  fromPrompt: boolean;
}

const DISCARDED = /[\\/](scartate|scartati|bloopers|_backup)[\\/]/i;

export function useCandidates(shot: Shot): Candidate[] {
  const prompts = useItems('prompt', { shotId: shot.id });
  const results = (prompts ?? []).map((p) => p.resultFile).filter(Boolean);
  const all = [shot.imageFile, shot.videoFile, ...shot.alternates, ...results].filter(Boolean);
  return [...new Set(all)].map((path) => ({
    path,
    video: isVideo(path),
    primary: path === shot.imageFile || path === shot.videoFile,
    discarded: DISCARDED.test(path),
    fromPrompt: results.includes(path) && !shot.alternates.includes(path),
  }));
}

interface Props {
  shot: Shot;
  onUse: (patch: Partial<Shot>) => void;
}

/** Striscia compatta nell'inspector: tocca una miniatura per renderla principale, o apri il confronto. */
export function GalleryStrip({ shot, onUse }: Props) {
  const candidates = useCandidates(shot);
  const [open, setOpen] = useState(false);
  if (candidates.length < 2) return null;
  return (
    <div className="gallery-strip">
      <div className="row">
        <span className="field-label grow">Generazioni ({candidates.length})</span>
        <button className="btn btn-small" onClick={() => setOpen(true)}>
          Confronta
        </button>
      </div>
      <ul>
        {candidates.slice(0, 8).map((c) => (
          <li key={c.path} className={`${c.primary ? 'primary' : ''}${c.discarded ? ' discarded' : ''}`}>
            <button className="gallery-thumb" title={baseName(c.path)} onClick={() => onUse(c.video ? { videoFile: c.path } : { imageFile: c.path })}>
              <Media path={c.path} />
              {c.video && <span className="frame-vid">▶</span>}
            </button>
          </li>
        ))}
      </ul>
      {open && <GalleryCompare shot={shot} candidates={candidates} onUse={onUse} onClose={() => setOpen(false)} />}
    </div>
  );
}

function GalleryCompare({ shot, candidates, onUse, onClose }: Props & { candidates: Candidate[]; onClose: () => void }) {
  const [kind, setKind] = useState<'image' | 'video'>(candidates.some((c) => !c.video) ? 'image' : 'video');
  const [hideDiscarded, setHideDiscarded] = useState(false);
  const shown = candidates.filter((c) => (kind === 'video') === c.video && (!hideDiscarded || !c.discarded));
  return (
    <Modal title={`Generazioni di ${shot.code}`} onClose={onClose} wide>
      <div className="row toolbar">
        <div className="segmented">
          <button className={kind === 'image' ? 'on' : undefined} onClick={() => setKind('image')}>
            Immagini <span className="tab-count">{candidates.filter((c) => !c.video).length}</span>
          </button>
          <button className={kind === 'video' ? 'on' : undefined} onClick={() => setKind('video')}>
            Video <span className="tab-count">{candidates.filter((c) => c.video).length}</span>
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={hideDiscarded} onChange={(e) => setHideDiscarded(e.target.checked)} /> Nascondi gli scarti
        </label>
      </div>
      <div className="gallery-grid">
        {shown.map((c) => (
          <figure key={c.path} className={`gallery-card${c.primary ? ' primary' : ''}`}>
            <div className="gallery-media">
              <Media path={c.path} controls />
            </div>
            <figcaption>
              <span className="small clamp-1" title={c.path}>{baseName(c.path)}</span>
              <span className="row">
                {c.primary && <span className="tag tag-accent">Principale</span>}
                {c.discarded && <span className="tag">Scartata</span>}
                {c.fromPrompt && <span className="tag">Dallo storico prompt</span>}
              </span>
              <span className="row">
                {!c.primary && (
                  <button className="btn btn-small btn-primary" onClick={() => onUse(c.video ? { videoFile: c.path } : { imageFile: c.path })}>
                    Usa come principale
                  </button>
                )}
                {shot.alternates.includes(c.path) && (
                  <button className="btn btn-small btn-ghost" onClick={() => onUse({ alternates: shot.alternates.filter((a) => a !== c.path) })}>
                    Togli dall'elenco
                  </button>
                )}
              </span>
            </figcaption>
          </figure>
        ))}
        {shown.length === 0 && <p className="muted">Nessun file di questo tipo.</p>}
      </div>
    </Modal>
  );
}
