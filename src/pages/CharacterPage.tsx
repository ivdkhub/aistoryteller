import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, baseName, useAutosave, useItem, useItems } from '../api.ts';
import { Area, CopyButton, DeleteButton, Empty, Field, FilePicker, ListEditor, Media, SaveBadge, Text } from '../components/ui.tsx';
import { PromptList } from '../components/PromptList.tsx';

export function CharacterPage() {
  const { id } = useParams();
  const item = useItem('character', id);
  const { draft: c, set, state } = useAutosave('character', item);
  const project = useItem('project', item?.projectId);
  const shots = useItems('shot', { projectId: item?.projectId }, !!item);
  const [active, setActive] = useState(0);
  const navigate = useNavigate();

  if (item === null) return <Empty title="Personaggio non trovato" />;
  if (!c) return null;
  const image = c.images[Math.min(active, c.images.length - 1)];
  const appears = (shots ?? []).filter((s) => s.characterIds.includes(c.id));

  return (
    <div className="page">
      <header className="page-head no-print">
        <div className="grow">
          <p className="crumbs">
            {project && <Link to={`/progetto/${project.id}/personaggi`}>{project.title}</Link>} — carta personaggio
          </p>
        </div>
        <SaveBadge state={state} />
        <button className="btn" onClick={() => window.print()}>
          Stampa la carta
        </button>
        <DeleteButton
          text={`Eliminare ${c.name}? Le immagini sul disco non vengono toccate.`}
          onDelete={async () => {
            await api.remove('character', c.id);
            navigate(`/progetto/${c.projectId}/personaggi`);
          }}
        />
      </header>

      <article className="char-card">
        <div className="char-visual">
          <div className="char-main">
            {image ? <Media path={image.path} controls /> : <span className="cast-initial">{c.name.slice(0, 1)}</span>}
          </div>
          {c.images.length > 0 && (
            <ul className="char-variants">
              {c.images.map((img, i) => (
                <li key={img.path} className={i === active ? 'active' : undefined}>
                  <button className="thumb" onClick={() => setActive(i)} aria-label={img.label}>
                    <Media path={img.path} />
                  </button>
                  <input
                    className="variant-label"
                    value={img.label}
                    aria-label="Etichetta"
                    onChange={(e) => set({ images: c.images.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                  />
                  <div className="variant-actions no-print">
                    {i > 0 && (
                      <button className="btn btn-ghost btn-small" title="Usa come scheda principale" onClick={() => {
                        const imgs = [...c.images];
                        const [x] = imgs.splice(i, 1);
                        set({ images: [x, ...imgs] });
                        setActive(0);
                      }}>
                        Principale
                      </button>
                    )}
                    <button className="btn btn-ghost btn-small" onClick={() => set({ images: c.images.filter((_, j) => j !== i) })}>
                      Rimuovi
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="no-print">
            <FilePicker
              projectId={c.projectId}
              accept="image/*"
              label="Carica immagine"
              onPick={(path) => set({ images: [...c.images, { path, label: c.images.length ? 'Variante' : 'Scheda' }] })}
            />
          </div>
          {image && <p className="muted small file-path">{baseName(image.path)}</p>}
        </div>

        <div className="char-body form">
          <input className="char-name" value={c.name} onChange={(e) => set({ name: e.target.value })} aria-label="Nome" />
          <div className="grid-2">
            <Field label="Età">
              <Text value={c.age} onChange={(age) => set({ age })} />
            </Field>
            <Field label="Ruolo">
              <Text value={c.role} onChange={(role) => set({ role })} />
            </Field>
          </div>
          <div className="fixed-desc">
            <div className="row">
              <span className="field-label grow">Descrizione fissa per i prompt</span>
              <CopyButton text={c.fixedDescription} label="Copia descrizione" />
            </div>
            <Area value={c.fixedDescription} onChange={(fixedDescription) => set({ fixedDescription })} rows={3} placeholder="a 30-year-old man with curly dark-brown hair…" />
            <span className="field-hint">In inglese, identica in ogni prompt: è quello che tiene il personaggio coerente insieme alla scheda immagine.</span>
          </div>
          <Field label="Personalità">
            <Area value={c.personality} onChange={(personality) => set({ personality })} rows={2} />
          </Field>
          <Field label="Arco narrativo">
            <Area value={c.arc} onChange={(arc) => set({ arc })} rows={2} />
          </Field>
          <Field label="Regole di continuità" hint="Finiscono nei prompt video creati con il composer.">
            <ListEditor value={c.continuityRules} onChange={(continuityRules) => set({ continuityRules })} placeholder="Es. non mostra mai il volto" />
          </Field>
          <fieldset className="voice">
            <legend>Voce</legend>
            <div className="grid-2">
              <Field label="Strumento">
                <Text value={c.voice.tool} onChange={(tool) => set({ voice: { ...c.voice, tool } })} />
              </Field>
              <Field label="Voce scelta">
                <Text value={c.voice.name} onChange={(name) => set({ voice: { ...c.voice, name } })} placeholder="Es. Louis - Informal, Authentic and Kind" />
              </Field>
            </div>
            <Field label="Come parla">
              <Area value={c.voice.description} onChange={(description) => set({ voice: { ...c.voice, description } })} rows={2} />
            </Field>
            <Field label="Prompt Voice Design">
              <Area value={c.voice.design} onChange={(design) => set({ voice: { ...c.voice, design } })} rows={2} />
            </Field>
          </fieldset>
          <label className="check">
            <input type="checkbox" checked={c.voiceOnly} onChange={(e) => set({ voiceOnly: e.target.checked })} /> Solo voce (non compare in scena)
          </label>
          <Field label="Note">
            <Area value={c.notes} onChange={(notes) => set({ notes })} rows={2} />
          </Field>
        </div>
      </article>

      <div className="split no-print">
        <section>
          <h2 className="section-title">Prompt del personaggio</h2>
          <PromptList filter={{ characterId: c.id }} projectId={c.projectId} newDefaults={{ characterId: c.id, title: `${c.name} · prompt` }} />
        </section>
        <aside className="panel">
          <h2>Compare in</h2>
          {appears.length === 0 && <p className="muted">Nessuna inquadratura collegata.</p>}
          <ul className="list">
            {appears.map((s) => (
              <li key={s.id}>
                <Link className="list-link" to={`/episodio/${s.episodeId}?shot=${s.id}`}>
                  <span className="code">{s.code}</span>
                  <span className="grow clamp-1">{s.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
