import { useState } from 'react';
import { api, useAutosave, useItems, type Filter } from '../api.ts';
import { Area, CopyButton, DeleteButton, Empty, Field, FilePicker, Media, SaveBadge, Select, Text } from './ui.tsx';
import { PROMPT_OUTCOME_LABEL, TOOLS, type Prompt, type PromptOutcome, type PromptType } from '../../shared/types.ts';

const TYPE_LABEL: Record<PromptType, string> = { image: 'Immagine', video: 'Video', voice: 'Voce', other: 'Altro' };

/** Storico dei prompt con filtri per tipo ed esito. */
export function PromptList({ filter, projectId, newDefaults = {} }: { filter: Filter; projectId: string; newDefaults?: Partial<Prompt> }) {
  const prompts = useItems('prompt', filter);
  const [type, setType] = useState<'' | PromptType>('');
  const [outcome, setOutcome] = useState<'' | PromptOutcome | 'current'>('current');
  const list = [...(prompts ?? [])]
    .reverse()
    .filter((p) => !type || p.type === type)
    .filter((p) => !outcome || (outcome === 'current' ? p.outcome !== 'previous' : p.outcome === outcome));
  const previous = (prompts ?? []).filter((p) => p.outcome === 'previous').length;

  return (
    <div className="stack">
      <div className="row toolbar">
        <Select value={type} onChange={setType} options={[['', 'Tutti i tipi'], ...(Object.entries(TYPE_LABEL) as [PromptType, string][])]} />
        <Select
          value={outcome}
          onChange={setOutcome}
          options={[['current', 'Senza versioni precedenti'], ['', 'Tutti'], ...(Object.entries(PROMPT_OUTCOME_LABEL) as [PromptOutcome, string][])]}
        />
        {previous > 0 && outcome === 'current' && <span className="muted small">{previous} versioni precedenti nascoste</span>}
        <span className="grow" />
        <button
          className="btn"
          onClick={() => api.create('prompt', { projectId, title: 'Nuovo prompt', ...newDefaults })}
        >
          Nuovo prompt a mano
        </button>
      </div>
      {list.length === 0 && <Empty title="Nessun prompt">Usa il composer o aggiungine uno a mano.</Empty>}
      {list.map((p) => (
        <PromptCard key={p.id} prompt={p} projectId={projectId} />
      ))}
    </div>
  );
}

function PromptCard({ prompt, projectId }: { prompt: Prompt; projectId: string }) {
  const { draft: p, set, state } = useAutosave('prompt', prompt);
  const [open, setOpen] = useState(false);
  if (!p) return null;
  return (
    <article className={`prompt-card outcome-${p.outcome}`}>
      <header className="row">
        <span className={`type-tag type-tag-${p.type}`}>{TYPE_LABEL[p.type]}</span>
        <button className="link-button grow" onClick={() => setOpen(!open)} aria-expanded={open}>
          {p.title || 'Senza titolo'}
        </button>
        <span className="muted small">{p.tool}</span>
        <Stars value={p.rating} onChange={(rating) => set({ rating })} />
        <Select value={p.outcome} onChange={(outcome) => set({ outcome })} options={Object.entries(PROMPT_OUTCOME_LABEL) as [PromptOutcome, string][]} />
        <CopyButton text={p.text} />
        <SaveBadge state={state} />
      </header>
      {!open && <p className="prompt-text clamp-2" onClick={() => setOpen(true)}>{p.text || <span className="muted">Vuoto</span>}</p>}
      {open && (
        <div className="form">
          <Field label="Titolo">
            <Text value={p.title} onChange={(title) => set({ title })} />
          </Field>
          <div className="grid-3">
            <Field label="Tipo">
              <Select value={p.type} onChange={(type) => set({ type })} options={Object.entries(TYPE_LABEL) as [PromptType, string][]} />
            </Field>
            <Field label="Strumento">
              <Select value={p.tool} onChange={(tool) => set({ tool })} options={TOOLS.map((t): [string, string] => [t, t])} />
            </Field>
            <Field label="Parametri">
              <Text value={p.params} onChange={(params) => set({ params })} placeholder="9:16, 5 s, seed…" />
            </Field>
          </div>
          <Field label="Prompt">
            <Area value={p.text} onChange={(text) => set({ text })} rows={4} mono />
          </Field>
          <Field label="Da evitare / negative">
            <Area value={p.negative} onChange={(negative) => set({ negative })} rows={1} />
          </Field>
          <Field label="Note">
            <Area value={p.notes} onChange={(notes) => set({ notes })} rows={1} />
          </Field>
          <Field label="Risultato">
            <div className="row">
              {p.resultFile && (
                <div className="thumb-sm">
                  <Media path={p.resultFile} />
                </div>
              )}
              <FilePicker projectId={projectId} onPick={(resultFile) => set({ resultFile })} label={p.resultFile ? 'Cambia file' : 'Aggiungi file'} />
            </div>
          </Field>
          <div className="row-end">
            <DeleteButton text="Eliminare questo prompt dallo storico?" onDelete={() => api.remove('prompt', p.id)} />
          </div>
        </div>
      )}
    </article>
  );
}

function Stars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <span className="stars" role="radiogroup" aria-label="Valutazione">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} role="radio" aria-checked={value === n} aria-label={`${n} su 5`} className={n <= value ? 'star on' : 'star'} onClick={() => onChange(value === n ? 0 : n)}>
          ★
        </button>
      ))}
    </span>
  );
}
