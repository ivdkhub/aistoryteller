import { useEffect, useState } from 'react';
import { api, useAutosave, useItems } from '../api.ts';
import { Area, CopyButton, DeleteButton, Field, FilePicker, Media, Modal, SaveBadge, Select, Text } from './ui.tsx';
import { Composer } from './Composer.tsx';
import { GalleryStrip } from './Gallery.tsx';
import { PromptList } from './PromptList.tsx';
import { checkShot } from '../../shared/consistency.ts';
import { SHOT_STATUS_LABEL, type AnimPriority, type Shot, type ShotStatus } from '../../shared/types.ts';

interface Props {
  shot: Shot;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}

/** Pannello laterale di un'inquadratura: prompt, file, animazione e storico. */
export function ShotEditor({ shot, onClose, onPrev, onNext }: Props) {
  const { draft: s, set, state, flush } = useAutosave('shot', shot);
  const characters = useItems('character', { projectId: shot.projectId });
  const [compose, setCompose] = useState(false);
  const [history, setHistory] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onPrev();
      if (e.key === 'ArrowRight') onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  if (!s) return null;
  const cast = (characters ?? []).filter((c) => !c.voiceOnly);
  const issues = checkShot(s, characters ?? []);
  const toggle = (id: string) => set({ characterIds: s.characterIds.includes(id) ? s.characterIds.filter((x) => x !== id) : [...s.characterIds, id] });

  return (
    <aside className="drawer" aria-label={`Inquadratura ${s.code}`}>
      <header className="drawer-head">
        <button className="btn btn-ghost btn-small" onClick={onPrev} aria-label="Precedente">
          ←
        </button>
        <input className="code code-input" value={s.code} onChange={(e) => set({ code: e.target.value })} aria-label="Codice" />
        <button className="btn btn-ghost btn-small" onClick={onNext} aria-label="Successiva">
          →
        </button>
        <span className="grow" />
        <SaveBadge state={state} />
        <button className="btn btn-ghost" onClick={() => { void flush(); onClose(); }} aria-label="Chiudi">
          ✕
        </button>
      </header>
      <div className="drawer-body form">
        <input className="input-title" value={s.title} onChange={(e) => set({ title: e.target.value })} placeholder="Cosa succede in questa inquadratura" />

        <div className="status-steps" role="radiogroup" aria-label="Stato">
          {(Object.keys(SHOT_STATUS_LABEL) as ShotStatus[]).map((k) => (
            <button key={k} role="radio" aria-checked={s.status === k} className={`step step-${k}${s.status === k ? ' on' : ''}`} onClick={() => set({ status: k })}>
              {SHOT_STATUS_LABEL[k]}
            </button>
          ))}
        </div>

        {issues.length > 0 && (
          <ul className="issues">
            {issues.map((i, n) => (
              <li key={n} className={`issue issue-${i.level}`}>
                <span aria-hidden>{i.level === 'warn' ? '⚠' : 'ⓘ'}</span>
                <span>{i.text}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="media-pair">
          <div>
            <span className="field-label">Immagine</span>
            <div className="media-slot">{s.imageFile ? <Media path={s.imageFile} /> : <span className="muted small">Nessuna</span>}</div>
            <FilePicker
              projectId={s.projectId}
              accept="image/*"
              label={s.imageFile ? 'Sostituisci' : 'Carica'}
              onPick={(imageFile) => set({ imageFile, status: s.status === 'todo' ? 'image' : s.status })}
            />
          </div>
          <div>
            <span className="field-label">Video</span>
            <div className="media-slot">{s.videoFile ? <Media path={s.videoFile} controls /> : <span className="muted small">Nessuno</span>}</div>
            <FilePicker
              projectId={s.projectId}
              accept="video/*"
              label={s.videoFile ? 'Sostituisci' : 'Carica'}
              onPick={(videoFile) => set({ videoFile, status: s.status === 'todo' || s.status === 'image' ? 'video' : s.status })}
            />
          </div>
        </div>
        <GalleryStrip shot={s} onUse={set} />

        <Field label="Personaggi">
          <div className="chips">
            {cast.map((c) => (
              <button key={c.id} type="button" className={`chip${s.characterIds.includes(c.id) ? ' chip-on' : ''}`} onClick={() => toggle(c.id)}>
                {c.name}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Riferimenti da allegare">
          <Text value={s.refs} onChange={(refs) => set({ refs })} placeholder="1) scheda TU 2) EP01_S09.png" />
        </Field>

        <div className="prompt-field">
          <div className="row">
            <span className="field-label grow">Prompt immagine</span>
            <button className="btn btn-small" onClick={() => setCompose(true)}>
              Componi
            </button>
            <CopyButton text={s.imagePrompt} />
          </div>
          <Area value={s.imagePrompt} onChange={(imagePrompt) => set({ imagePrompt })} rows={5} mono />
        </div>

        <div className="grid-2">
          <Field label="Priorità animazione">
            <Select
              value={s.animPriority}
              onChange={(animPriority) => set({ animPriority })}
              options={[['', 'Nessuna (immagine fissa)'], ['alta', 'Alta'], ['media', 'Media'], ['bassa', 'Bassa']] as [AnimPriority, string][]}
            />
          </Field>
          <label className="check check-inline">
            <input type="checkbox" checked={s.noImage} onChange={(e) => set({ noImage: e.target.checked })} /> Solo grafica (nessuna immagine)
          </label>
        </div>
        <Field label="Animazione">
          <Area value={s.animation} onChange={(animation) => set({ animation })} rows={2} />
        </Field>
        <div className="prompt-field">
          <div className="row">
            <span className="field-label grow">Prompt video</span>
            <CopyButton text={s.videoPrompt} />
          </div>
          <Area value={s.videoPrompt} onChange={(videoPrompt) => set({ videoPrompt })} rows={3} mono placeholder="Image-to-video: … Avoid: …" />
        </div>
        <Field label="Taglio da usare" hint="Es. usare 0–2,2 s (a 2,3 s il semaforo diventa verde).">
          <Text value={s.cut} onChange={(cut) => set({ cut })} />
        </Field>
        <Field label="Battuta">
          <Area value={s.line} onChange={(line) => set({ line })} rows={2} />
        </Field>
        <Field label="Grafica (Remotion)">
          <Area value={s.graphics} onChange={(graphics) => set({ graphics })} rows={2} />
        </Field>
        <Field label="Montaggio">
          <Area value={s.editing} onChange={(editing) => set({ editing })} rows={2} />
        </Field>
        <Field label="Note">
          <Area value={s.note} onChange={(note) => set({ note })} rows={2} />
        </Field>

        <button className="link-button" onClick={() => setHistory(!history)} aria-expanded={history}>
          {history ? 'Nascondi lo storico dei prompt' : 'Mostra lo storico dei prompt'}
        </button>
        {history && (
          <PromptList
            filter={{ shotId: s.id }}
            projectId={s.projectId}
            newDefaults={{ shotId: s.id, title: `${s.code} · prompt` }}
          />
        )}
        <div className="row-end">
          <DeleteButton
            label="Elimina inquadratura"
            text={`Eliminare ${s.code}? I file sul disco non vengono toccati.`}
            onDelete={async () => {
              await api.remove('shot', s.id);
              onClose();
            }}
          />
        </div>
      </div>
      {compose && (
        <Modal title={`Componi i prompt di ${s.code}`} onClose={() => setCompose(false)} wide>
          <Composer projectId={s.projectId} shot={s} onApplied={() => setCompose(false)} />
        </Modal>
      )}
    </aside>
  );
}
