import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, useAutosave, useItem, useItems } from '../api.ts';
import { Area, DeleteButton, Empty, Field, Modal, SaveBadge, Select, Text } from '../components/ui.tsx';
import { ProjectForm } from '../components/forms.tsx';
import { PROJECT_STATUS_LABEL, PROJECT_TYPE_LABEL } from '../../shared/types.ts';

export function AccountPage() {
  const { id } = useParams();
  const item = useItem('account', id);
  const { draft: a, set, state } = useAutosave('account', item);
  const accounts = useItems('account');
  const projects = useItems('project', { accountId: id });
  const characters = useItems('character');
  const [newProject, setNewProject] = useState(false);
  const navigate = useNavigate();

  if (item === null) return <Empty title="Account non trovato" />;
  if (!a) return null;
  const linked = characters?.find((c) => c.id === a.linkedCharacterId);

  return (
    <div className="page">
      <header className="page-head">
        <span className="avatar avatar-lg" style={{ background: a.color }}>
          {(a.name || a.handle || '?').replace('@', '').slice(0, 1).toUpperCase()}
        </span>
        <div className="grow">
          <h1>{a.name || a.handle || 'Account senza nome'}</h1>
          <p className="muted">{[a.handle, a.niche].filter(Boolean).join(' — ')}</p>
        </div>
        <SaveBadge state={state} />
        <DeleteButton
          label="Elimina account"
          text={`Eliminare "${a.name || a.handle}" con tutti i suoi progetti, personaggi, episodi e prompt? I file sul disco non vengono toccati.`}
          onDelete={async () => {
            await api.remove('account', a.id);
            navigate('/');
          }}
        />
      </header>

      <div className="split">
        <section>
          <div className="section-head">
            <h2>Progetti</h2>
            <button className="btn btn-primary" onClick={() => setNewProject(true)}>
              Nuovo progetto
            </button>
          </div>
          {projects?.length === 0 && (
            <Empty title="Ancora nessun progetto">
              <p>Un progetto può essere una serie con personaggi, un AI influencer o una raccolta di post.</p>
            </Empty>
          )}
          <div className="project-grid">
            {projects?.map((p) => (
              <Link key={p.id} to={`/progetto/${p.id}`} className="project-card">
                <span className={`type-glyph type-${p.type}`} aria-hidden />
                <strong>{p.title}</strong>
                <span className="muted small">
                  {PROJECT_TYPE_LABEL[p.type]} — {PROJECT_STATUS_LABEL[p.status].toLowerCase()}
                </span>
                {p.logline && <span className="small clamp-2">{p.logline}</span>}
              </Link>
            ))}
          </div>
        </section>

        <aside className="panel form">
          <h2>Profilo</h2>
          <Field label="Nome">
            <Text value={a.name} onChange={(name) => set({ name })} />
          </Field>
          <Field label="Handle">
            <Text value={a.handle} onChange={(handle) => set({ handle })} placeholder="@nomeprofilo" />
          </Field>
          <Field label="Nicchia o tema">
            <Text value={a.niche} onChange={(niche) => set({ niche })} />
          </Field>
          <Field label="Bio">
            <Area value={a.bio} onChange={(bio) => set({ bio })} />
          </Field>
          <Field label="Colore">
            <input type="color" value={a.color} onChange={(e) => set({ color: e.target.value })} />
          </Field>
          <Field label="Profilo satellite di" hint="Per i profili gestiti da un personaggio di un'altra serie.">
            <Select
              value={a.parentAccountId}
              onChange={(parentAccountId) => set({ parentAccountId })}
              options={[['', 'Nessuno: profilo principale'], ...(accounts ?? []).filter((x) => x.id !== a.id).map((x): [string, string] => [x.id, x.name || x.handle])]}
            />
          </Field>
          <Field label="Personaggio che gestisce il profilo">
            <Select
              value={a.linkedCharacterId}
              onChange={(linkedCharacterId) => set({ linkedCharacterId })}
              options={[['', 'Nessuno'], ...(characters ?? []).filter((c) => !c.voiceOnly).map((c): [string, string] => [c.id, c.name])]}
            />
          </Field>
          {linked && (
            <Link to={`/personaggio/${linked.id}`} className="small">
              Apri la carta di {linked.name}
            </Link>
          )}
          <Field label="Note">
            <Area value={a.notes} onChange={(notes) => set({ notes })} />
          </Field>
        </aside>
      </div>

      {newProject && (
        <Modal title="Nuovo progetto" onClose={() => setNewProject(false)} wide>
          <ProjectForm
            onSave={async (data) => {
              const p = await api.create('project', { ...data, accountId: a.id });
              navigate(`/progetto/${p.id}`);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
