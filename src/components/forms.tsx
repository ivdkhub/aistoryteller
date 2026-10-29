import { useState } from 'react';
import { Area, Field, Select, Text } from './ui.tsx';
import { EPISODE_FORMAT_LABEL, type Draft, type EpisodeFormat, type ProjectType } from '../../shared/types.ts';

export function AccountForm({ onSave }: { onSave: (data: Partial<Draft<'account'>>) => void }) {
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [niche, setNiche] = useState('');
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() && !handle.trim()) return;
        const h = handle.trim();
        onSave({ name: name.trim(), handle: h && !h.startsWith('@') ? `@${h}` : h, niche: niche.trim() });
      }}
    >
      <Field label="Nome del profilo">
        <Text value={name} onChange={setName} placeholder="Es. Bank Error" />
      </Field>
      <Field label="Handle">
        <Text value={handle} onChange={setHandle} placeholder="@nomeprofilo" />
      </Field>
      <Field label="Nicchia o tema">
        <Text value={niche} onChange={setNiche} placeholder="Es. serie thriller interattiva" />
      </Field>
      <div className="row-end">
        <button className="btn btn-primary" type="submit" disabled={!name.trim() && !handle.trim()}>
          Crea account
        </button>
      </div>
    </form>
  );
}

const TYPE_CHOICES: { type: ProjectType; title: string; text: string; tabs: string }[] = [
  {
    type: 'base',
    title: 'Progetto base',
    text: 'Post, caroselli e reel senza personaggi ricorrenti.',
    tabs: 'Post · prompt · calendario · idee',
  },
  {
    type: 'characters',
    title: 'Progetto con personaggi',
    text: 'Una serie con cast fisso: carte personaggio, episodi, inquadrature, copioni e bibbia.',
    tabs: 'Personaggi · episodi · inquadrature · copioni · bibbia',
  },
  {
    type: 'ai_influencer',
    title: 'AI Influencer',
    text: 'Un unico personaggio virtuale che è il volto del profilo, con persona e linee guida.',
    tabs: 'Persona · post · prompt · linee guida',
  },
];

export function ProjectForm({ onSave }: { onSave: (data: Partial<Draft<'project'>>) => void }) {
  const [type, setType] = useState<ProjectType>('characters');
  const [title, setTitle] = useState('');
  const [logline, setLogline] = useState('');
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) onSave({ type, title: title.trim(), logline, status: 'idea' });
      }}
    >
      <fieldset className="type-choice">
        <legend className="field-label">Tipo di progetto</legend>
        {TYPE_CHOICES.map((c) => (
          <label key={c.type} className={`type-card${type === c.type ? ' selected' : ''}`}>
            <input type="radio" name="type" value={c.type} checked={type === c.type} onChange={() => setType(c.type)} />
            <span className={`type-glyph type-${c.type}`} aria-hidden />
            <strong>{c.title}</strong>
            <span>{c.text}</span>
            <small>{c.tabs}</small>
          </label>
        ))}
      </fieldset>
      <Field label={type === 'ai_influencer' ? 'Nome dell’influencer' : 'Titolo'}>
        <Text value={title} onChange={setTitle} placeholder={type === 'ai_influencer' ? 'Es. Margot Kessler' : 'Es. Bank Error — Stagione 1'} />
      </Field>
      <Field label="In una frase">
        <Area value={logline} onChange={setLogline} rows={2} placeholder="Di cosa parla, per chi è" />
      </Field>
      <div className="row-end">
        <button className="btn btn-primary" type="submit" disabled={!title.trim()}>
          Crea progetto
        </button>
      </div>
    </form>
  );
}

export function CharacterForm({ onSave }: { onSave: (data: Partial<Draft<'character'>>) => void }) {
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [role, setRole] = useState('');
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSave({ name: name.trim(), age, role });
      }}
    >
      <Field label="Nome">
        <Text value={name} onChange={setName} placeholder="Es. NICO DALE" />
      </Field>
      <div className="grid-2">
        <Field label="Età">
          <Text value={age} onChange={setAge} />
        </Field>
        <Field label="Ruolo">
          <Text value={role} onChange={setRole} placeholder="Es. migliore amico" />
        </Field>
      </div>
      <div className="row-end">
        <button className="btn btn-primary" type="submit" disabled={!name.trim()}>
          Crea personaggio
        </button>
      </div>
    </form>
  );
}

export function EpisodeForm({ nextNumber, isSeries, onSave }: { nextNumber: number; isSeries: boolean; onSave: (data: Partial<Draft<'episode'>>) => void }) {
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState<EpisodeFormat>('reel');
  const [publishDate, setPublishDate] = useState('');
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        onSave({
          title: title.trim(), format, publishDate, number: nextNumber,
          code: isSeries ? `EP${String(nextNumber).padStart(2, '0')}` : `P${String(nextNumber).padStart(2, '0')}`,
          status: 'idea',
        });
      }}
    >
      <Field label="Titolo">
        <Text value={title} onChange={setTitle} />
      </Field>
      <div className="grid-2">
        <Field label="Formato">
          <Select value={format} onChange={setFormat} options={Object.entries(EPISODE_FORMAT_LABEL) as [EpisodeFormat, string][]} />
        </Field>
        <Field label="Data di uscita">
          <input type="datetime-local" value={publishDate} onChange={(e) => setPublishDate(e.target.value)} />
        </Field>
      </div>
      <div className="row-end">
        <button className="btn btn-primary" type="submit" disabled={!title.trim()}>
          {isSeries ? 'Crea episodio' : 'Crea post'}
        </button>
      </div>
    </form>
  );
}
