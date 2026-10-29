import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, bump, request, useAutosave, useItem, useItems } from '../api.ts';
import { Area, Browser, DeleteButton, Empty, Field, Media, Modal, SaveBadge, Select, Tabs, Text } from '../components/ui.tsx';
import { CharacterForm, EpisodeForm } from '../components/forms.tsx';
import { PromptList } from '../components/PromptList.tsx';
import { Composer } from '../components/Composer.tsx';
import { IdeasBoard } from '../components/IdeasBoard.tsx';
import { StoryTab } from '../components/StoryTab.tsx';
import { GenerationQueue } from '../components/GenerationQueue.tsx';
import { Progress } from './Home.tsx';
import { ProgressBar } from '../components/EpisodeProgress.tsx';
import { formatDate, plural } from '../util.ts';
import {
  EPISODE_FORMAT_LABEL, EPISODE_STATUS_LABEL, PROJECT_STATUS_LABEL, PROJECT_TYPE_LABEL,
  type Brand, type Project, type ProjectStatus, type ProjectType, type StylePreset,
} from '../../shared/types.ts';

type Tab = 'panoramica' | 'personaggi' | 'episodi' | 'generare' | 'voti' | 'prompt' | 'stili' | 'bibbia' | 'brand' | 'idee';

const TABS: Record<ProjectType, [Tab, string][]> = {
  base: [['panoramica', 'Panoramica'], ['episodi', 'Post'], ['generare', 'Da generare'], ['prompt', 'Prompt'], ['stili', 'Stili'], ['idee', 'Idee']],
  characters: [
    ['panoramica', 'Panoramica'], ['personaggi', 'Personaggi'], ['episodi', 'Episodi'], ['generare', 'Da generare'],
    ['voti', 'Voti e rami'], ['prompt', 'Prompt'], ['stili', 'Stili'], ['bibbia', 'Bibbia'], ['idee', 'Idee'],
  ],
  ai_influencer: [
    ['panoramica', 'Panoramica'], ['personaggi', 'Persona'], ['episodi', 'Post'], ['generare', 'Da generare'], ['prompt', 'Prompt'],
    ['stili', 'Stili'], ['brand', 'Linee guida'], ['idee', 'Idee'],
  ],
};

export function ProjectPage() {
  const { id, tab } = useParams();
  const item = useItem('project', id);
  const { draft: p, set, state } = useAutosave('project', item);
  const account = useItem('account', item?.accountId);
  const navigate = useNavigate();

  if (item === null) return <Empty title="Progetto non trovato" />;
  if (!p) return null;
  const tabs = TABS[p.type];
  const current = (tabs.some(([k]) => k === tab) ? tab : 'panoramica') as Tab;

  return (
    <div className="page">
      <header className="page-head">
        <span className={`type-glyph type-${p.type}`} aria-hidden />
        <div className="grow">
          <p className="crumbs">
            {account && <Link to={`/account/${account.id}`}>{account.name || account.handle}</Link>} — {PROJECT_TYPE_LABEL[p.type]}
          </p>
          <h1>{p.title}</h1>
        </div>
        <SaveBadge state={state} />
      </header>
      <Tabs tabs={tabs} value={current} onChange={(t) => navigate(`/progetto/${p.id}/${t}`)} />

      {current === 'panoramica' && <Overview p={p} set={set} />}
      {current === 'personaggi' && <Characters project={p} />}
      {current === 'episodi' && <Episodes project={p} />}
      {current === 'generare' && <GenerationQueue project={p} />}
      {current === 'voti' && <StoryTab project={p} set={set} />}
      {current === 'prompt' && <Prompts project={p} />}
      {current === 'stili' && <Styles project={p} />}
      {current === 'bibbia' && (
        <section className="panel">
          <p className="muted">
            Verità della storia, regole, numeri fissi e punti aperti. Il testo resta in markdown, così lo puoi incollare
            dove serve (anche nei prompt per Claude o Remotion).
          </p>
          <Area value={p.bible} onChange={(bible) => set({ bible })} rows={20} mono />
        </section>
      )}
      {current === 'brand' && <BrandTab brand={p.brand} onChange={(brand) => set({ brand })} />}
      {current === 'idee' && <IdeasBoard filter={{ projectId: p.id }} defaults={{ projectId: p.id, accountId: p.accountId }} />}
    </div>
  );
}

function Overview({ p, set }: { p: Project; set: (patch: Partial<Project>) => void }) {
  const episodes = useItems('episode', { projectId: p.id });
  const shots = useItems('shot', { projectId: p.id });
  const characters = useItems('character', { projectId: p.id });
  const [browse, setBrowse] = useState(false);
  const [scan, setScan] = useState('');
  const navigate = useNavigate();
  const persona = p.type === 'ai_influencer' ? characters?.find((c) => !c.voiceOnly) : undefined;

  return (
    <div className="split">
      <section className="stack">
        {persona && (
          <Link to={`/personaggio/${persona.id}`} className="persona-hero">
            <div className="persona-hero-img">{persona.images[0] && <Media path={persona.images[0].path} />}</div>
            <div>
              <strong>{persona.name}</strong>
              <p className="muted">{[persona.age, persona.role].filter(Boolean).join(', ')}</p>
              <p className="clamp-3">{p.brand.persona || persona.personality || 'Completa la persona nella scheda Linee guida.'}</p>
            </div>
          </Link>
        )}
        <div className="panel">
          <h2>Stato della produzione</h2>
          {shots && shots.length > 0 ? <Progress shots={shots.filter((s) => s.status !== 'discarded')} /> : <p className="muted">Nessuna inquadratura ancora.</p>}
          <ul className="list">
            {(episodes ?? [])
              .filter((e) => e.status !== 'published')
              .slice(0, 6)
              .map((e) => (
                <li key={e.id}>
                  <Link to={`/episodio/${e.id}`} className="list-link">
                    <span className="code">{e.code}</span>
                    <span className="grow">{e.title}</span>
                    <span className="muted small">{EPISODE_STATUS_LABEL[e.status]}</span>
                  </Link>
                </li>
              ))}
          </ul>
        </div>
        <div className="panel form">
          <Field label="In una frase">
            <Area value={p.logline} onChange={(logline) => set({ logline })} rows={2} />
          </Field>
          <Field label="Note">
            <Area value={p.notes} onChange={(notes) => set({ notes })} rows={4} />
          </Field>
        </div>
      </section>
      <aside className="panel form">
        <Field label="Titolo">
          <Text value={p.title} onChange={(title) => set({ title })} />
        </Field>
        <Field label="Stato">
          <Select value={p.status} onChange={(status) => set({ status })} options={Object.entries(PROJECT_STATUS_LABEL) as [ProjectStatus, string][]} />
        </Field>
        <Field label="Tipo" hint="Cambia le schede disponibili; i dati restano.">
          <Select value={p.type} onChange={(type) => set({ type })} options={Object.entries(PROJECT_TYPE_LABEL) as [ProjectType, string][]} />
        </Field>
        <Field label="Cartella sul disco" hint="Dove salvi immagini e video del progetto. Lo scanner la legge per collegare i file alle inquadrature.">
          <div className="row">
            <input value={p.folder} onChange={(e) => set({ folder: e.target.value })} placeholder="C:\…\Contenuti\…" />
            <button className="btn btn-small" type="button" onClick={() => setBrowse(true)}>
              Sfoglia
            </button>
          </div>
        </Field>
        {p.folder && (
          <div className="row">
            <button
              className="btn btn-small"
              type="button"
              onClick={async () => {
                setScan('Scansione…');
                try {
                  const r = await request<{ updated: number }>(`/projects/${p.id}/scan`, { method: 'POST' });
                  setScan(r.updated ? `${plural(r.updated, 'inquadratura aggiornata', 'inquadrature aggiornate')}.` : 'Nessun file nuovo.');
                  bump();
                } catch (e) {
                  setScan((e as Error).message);
                }
              }}
            >
              Risincronizza i file
            </button>
            <span className="muted small">{scan}</span>
          </div>
        )}
        <hr />
        <DeleteButton
          label="Elimina progetto"
          text={`Eliminare "${p.title}" con personaggi, episodi, inquadrature e prompt? I file sul disco non vengono toccati.`}
          onDelete={async () => {
            await api.remove('project', p.id);
            navigate(`/account/${p.accountId}`);
          }}
        />
      </aside>
      {browse && (
        <Browser
          mode="folder"
          start={p.folder}
          onClose={() => setBrowse(false)}
          onPick={(folder) => {
            set({ folder });
            setBrowse(false);
          }}
        />
      )}
    </div>
  );
}

function Characters({ project }: { project: Project }) {
  const characters = useItems('character', { projectId: project.id });
  const [create, setCreate] = useState(false);
  const navigate = useNavigate();
  const cast = (characters ?? []).filter((c) => !c.voiceOnly);
  const voices = (characters ?? []).filter((c) => c.voiceOnly);
  const single = project.type === 'ai_influencer';
  return (
    <section>
      <div className="section-head">
        <p className="muted">
          {single
            ? 'La persona dell’influencer: aspetto fisso, immagini di riferimento e voce.'
            : 'Ogni carta personaggio tiene la descrizione fissa da incollare nei prompt e le immagini di riferimento da allegare.'}
        </p>
        <button className="btn btn-primary" onClick={() => setCreate(true)}>
          {single ? 'Nuova persona' : 'Nuovo personaggio'}
        </button>
      </div>
      {characters?.length === 0 && <Empty title="Nessun personaggio">Crea il primo e aggiungi la sua scheda immagine.</Empty>}
      <div className="cast-grid">
        {cast.map((c) => (
          <Link key={c.id} to={`/personaggio/${c.id}`} className="cast-card">
            <div className="cast-img">{c.images[0] ? <Media path={c.images[0].path} /> : <span className="cast-initial">{c.name.slice(0, 1)}</span>}</div>
            <strong>{c.name}</strong>
            <span className="muted small">{[c.age, c.role].filter(Boolean).join(', ')}</span>
            {c.images.length > 1 && <span className="small">{plural(c.images.length - 1, 'variante', 'varianti')}</span>}
          </Link>
        ))}
      </div>
      {voices.length > 0 && (
        <>
          <h3 className="section-title">Solo voce</h3>
          <ul className="list voice-list">
            {voices.map((c) => (
              <li key={c.id}>
                <Link to={`/personaggio/${c.id}`} className="list-link">
                  <strong>{c.name}</strong>
                  <span className="grow muted">{c.voice.description || c.voice.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {create && (
        <Modal title={single ? 'Nuova persona' : 'Nuovo personaggio'} onClose={() => setCreate(false)}>
          <CharacterForm
            onSave={async (d) => {
              const c = await api.create('character', { ...d, projectId: project.id });
              navigate(`/personaggio/${c.id}`);
            }}
          />
        </Modal>
      )}
    </section>
  );
}

function Episodes({ project }: { project: Project }) {
  const episodes = useItems('episode', { projectId: project.id });
  const shots = useItems('shot', { projectId: project.id });
  const accounts = useItems('account');
  const [create, setCreate] = useState(false);
  const navigate = useNavigate();
  const series = project.type === 'characters';
  const sorted = [...(episodes ?? [])].sort(
    (a, b) => Number(!!a.publishAccountId) - Number(!!b.publishAccountId) || a.number - b.number || a.code.localeCompare(b.code),
  );
  const nextNumber = Math.max(0, ...(episodes ?? []).filter((e) => !e.publishAccountId).map((e) => e.number)) + 1;

  return (
    <section>
      <div className="section-head">
        <p className="muted">{series ? 'Episodi della serie e post dei profili collegati.' : 'I contenuti del progetto, dal concept alla pubblicazione.'}</p>
        <button className="btn btn-primary" onClick={() => setCreate(true)}>
          {series ? 'Nuovo episodio' : 'Nuovo post'}
        </button>
      </div>
      {episodes?.length === 0 && <Empty title={series ? 'Nessun episodio' : 'Nessun post'} />}
      <table className="table">
        <thead>
          <tr>
            <th>Codice</th>
            <th>Titolo</th>
            <th>Formato</th>
            <th>Stato</th>
            <th>Avanzamento</th>
            <th>Uscita</th>
            <th>Voto</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((e) => {
            const es = (shots ?? []).filter((s) => s.episodeId === e.id);
            const sat = accounts?.find((a) => a.id === e.publishAccountId);
            return (
              <tr key={e.id} onClick={() => navigate(`/episodio/${e.id}`)} className="row-link">
                <td className="code">{e.code}</td>
                <td>
                  <Link to={`/episodio/${e.id}`}>{e.title || 'Senza titolo'}</Link>
                  {sat && <span className="account-chip" style={{ borderColor: sat.color }}>{sat.handle}</span>}
                </td>
                <td>{EPISODE_FORMAT_LABEL[e.format]}</td>
                <td>
                  <span className={`ep-status ep-${e.status}`}>{EPISODE_STATUS_LABEL[e.status]}</span>
                </td>
                <td>
                  <ProgressBar episode={e} shots={es} />
                </td>
                <td>{e.publishDate ? formatDate(e.publishDate) : '—'}</td>
                <td className="small">
                  {e.vote.options.join(' / ')}
                  {e.vote.winner && <strong> → {e.vote.winner} {e.vote.percent && `${e.vote.percent}%`}</strong>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {create && (
        <Modal title={series ? 'Nuovo episodio' : 'Nuovo post'} onClose={() => setCreate(false)}>
          <EpisodeForm
            nextNumber={nextNumber}
            isSeries={series}
            onSave={async (d) => {
              const e = await api.create('episode', { ...d, projectId: project.id });
              navigate(`/episodio/${e.id}`);
            }}
          />
        </Modal>
      )}
    </section>
  );
}

function Prompts({ project }: { project: Project }) {
  const [compose, setCompose] = useState(false);
  return (
    <section className="stack">
      <div className="section-head">
        <p className="muted">Tutti i prompt del progetto con strumento, esito e versioni precedenti.</p>
        <button className="btn btn-primary" onClick={() => setCompose(!compose)}>
          {compose ? 'Chiudi il composer' : 'Componi un prompt'}
        </button>
      </div>
      {compose && (
        <div className="panel">
          <Composer projectId={project.id} />
        </div>
      )}
      <PromptList filter={{ projectId: project.id }} projectId={project.id} />
    </section>
  );
}

function Styles({ project }: { project: Project }) {
  const own = useItems('style', { projectId: project.id });
  const global = useItems('style', { projectId: '' });
  return (
    <section className="stack">
      <div className="section-head">
        <p className="muted">
          Il prefisso di stile apre ogni prompt immagine; per i video servono parametri e la riga Avoid. Gli stili generali
          valgono per tutti i progetti.
        </p>
        <div className="row">
          <button className="btn" onClick={() => api.create('style', { projectId: project.id, name: 'Nuovo stile video', target: 'video' })}>
            Nuovo stile video
          </button>
          <button className="btn btn-primary" onClick={() => api.create('style', { projectId: project.id, name: 'Nuovo stile immagine', target: 'image' })}>
            Nuovo stile immagine
          </button>
        </div>
      </div>
      <h3 className="section-title">Di questo progetto</h3>
      {own?.length === 0 && <p className="muted">Nessuno stile specifico.</p>}
      {own?.map((s) => <StyleEditor key={s.id} style={s} />)}
      <h3 className="section-title">Generali</h3>
      {global?.map((s) => <StyleEditor key={s.id} style={s} />)}
    </section>
  );
}

function StyleEditor({ style }: { style: StylePreset }) {
  const { draft: s, set, state } = useAutosave('style', style);
  if (!s) return null;
  return (
    <div className="panel style-editor">
      <div className="row">
        <input className="input-title" value={s.name} onChange={(e) => set({ name: e.target.value })} />
        <Select value={s.target} onChange={(target) => set({ target })} options={[['image', 'Immagine'], ['video', 'Video']]} />
        <SaveBadge state={state} />
        <DeleteButton text={`Eliminare lo stile "${s.name}"?`} onDelete={() => api.remove('style', s.id)} />
      </div>
      <Field label={s.target === 'image' ? 'Prefisso del prompt' : 'Indicazioni di movimento comuni'}>
        <Area value={s.prefix} onChange={(prefix) => set({ prefix })} mono />
      </Field>
      <div className="grid-2">
        <Field label="Parametri">
          <Text value={s.params} onChange={(params) => set({ params })} placeholder="Es. 9:16, 5 s, seed 1234" />
        </Field>
        <Field label="Da evitare (Avoid / negative)">
          <Text value={s.avoid} onChange={(avoid) => set({ avoid })} />
        </Field>
      </div>
    </div>
  );
}

const BRAND_FIELDS: [keyof Brand, string, string][] = [
  ['persona', 'Chi è', 'Storia, età, città, lavoro, cosa la/lo rende riconoscibile.'],
  ['toneOfVoice', 'Tono di voce', 'Come scrive le caption e come parla nei video.'],
  ['values', 'Valori', ''],
  ['pillars', 'Pilastri dei contenuti', 'I 3-5 temi ricorrenti del profilo.'],
  ['donts', 'Cose da non fare', 'Argomenti, pose o stili da evitare.'],
  ['palette', 'Palette e look', 'Colori, luce, ambientazioni ricorrenti.'],
  ['outfits', 'Outfit ricorrenti', ''],
  ['hashtags', 'Hashtag base', ''],
];

function BrandTab({ brand, onChange }: { brand: Brand; onChange: (b: Brand) => void }) {
  return (
    <section className="panel form brand-form">
      {BRAND_FIELDS.map(([k, label, hint]) => (
        <Field key={k} label={label} hint={hint || undefined}>
          <Area value={brand[k]} onChange={(v) => onChange({ ...brand, [k]: v })} />
        </Field>
      ))}
    </section>
  );
}
