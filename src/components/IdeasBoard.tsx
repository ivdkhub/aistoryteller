import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAutosave, useItems, type Filter } from '../api.ts';
import { Area, DeleteButton, Field, Modal, SaveBadge, Select, Text } from './ui.tsx';
import { IDEA_STATUS_LABEL, type Idea, type IdeaStatus } from '../../shared/types.ts';

const COLUMNS: IdeaStatus[] = ['inbox', 'develop', 'used', 'discarded'];

/** Bacheca a colonne: le idee si spostano trascinandole. */
export function IdeasBoard({ filter, defaults = {} }: { filter: Filter; defaults?: Partial<Idea> }) {
  const ideas = useItems('idea', filter);
  const accounts = useItems('account');
  const [title, setTitle] = useState('');
  const [open, setOpen] = useState<Idea | null>(null);
  const [over, setOver] = useState<IdeaStatus | null>(null);

  return (
    <div className="stack">
      <form
        className="row idea-capture"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return;
          await api.create('idea', { ...defaults, title: title.trim() });
          setTitle('');
        }}
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Scrivi un'idea e premi Invio" />
        <button className="btn btn-primary" type="submit" disabled={!title.trim()}>
          Aggiungi
        </button>
      </form>
      <div className="kanban">
        {COLUMNS.map((col) => {
          const items = (ideas ?? []).filter((i) => i.status === col);
          return (
            <section
              key={col}
              className={`kanban-col${over === col ? ' drop' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                setOver(null);
                const id = e.dataTransfer.getData('text/idea');
                if (id) api.update('idea', id, { status: col });
              }}
            >
              <h3>
                {IDEA_STATUS_LABEL[col]} <span className="muted">{items.length}</span>
              </h3>
              {items.map((i) => {
                const acc = accounts?.find((a) => a.id === i.accountId);
                return (
                  <button
                    key={i.id}
                    className="idea-card"
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/idea', i.id)}
                    onClick={() => setOpen(i)}
                  >
                    <span>{i.title}</span>
                    {i.description && <small className="clamp-2 muted">{i.description}</small>}
                    <span className="idea-meta">
                      {acc && <span className="account-chip" style={{ borderColor: acc.color }}>{acc.handle || acc.name}</span>}
                      {i.tags.map((t) => (
                        <span key={t} className="tag">#{t}</span>
                      ))}
                    </span>
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>
      {open && <IdeaEditor idea={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function IdeaEditor({ idea, onClose }: { idea: Idea; onClose: () => void }) {
  const { draft: i, set, state, flush } = useAutosave('idea', idea);
  const accounts = useItems('account');
  const projects = useItems('project');
  const navigate = useNavigate();
  if (!i) return null;
  const close = () => {
    void flush();
    onClose();
  };
  const project = projects?.find((p) => p.id === i.projectId);
  return (
    <Modal title="Idea" onClose={close}>
      <div className="form">
        <Field label="Idea">
          <Text value={i.title} onChange={(title) => set({ title })} />
        </Field>
        <Field label="Dettagli">
          <Area value={i.description} onChange={(description) => set({ description })} rows={4} />
        </Field>
        <div className="grid-2">
          <Field label="Account">
            <Select
              value={i.accountId}
              onChange={(accountId) => set({ accountId, projectId: '' })}
              options={[['', 'Nessuno'], ...(accounts ?? []).map((a): [string, string] => [a.id, a.name || a.handle])]}
            />
          </Field>
          <Field label="Progetto">
            <Select
              value={i.projectId}
              onChange={(projectId) => set({ projectId })}
              options={[['', 'Nessuno'], ...(projects ?? []).filter((p) => !i.accountId || p.accountId === i.accountId).map((p): [string, string] => [p.id, p.title])]}
            />
          </Field>
        </div>
        <Field label="Tag" hint="Separati da virgola.">
          <Text value={i.tags.join(', ')} onChange={(v) => set({ tags: v.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean) })} />
        </Field>
        <Field label="Stato">
          <Select value={i.status} onChange={(status) => set({ status })} options={Object.entries(IDEA_STATUS_LABEL) as [IdeaStatus, string][]} />
        </Field>
        <div className="row">
          <SaveBadge state={state} />
          <span className="grow" />
          <DeleteButton
            text="Eliminare questa idea?"
            onDelete={async () => {
              await api.remove('idea', i.id);
              onClose();
            }}
          />
          {project && (
            <button
              className="btn btn-primary"
              onClick={async () => {
                await flush();
                const e = await api.create('episode', {
                  projectId: project.id, title: i.title, notes: i.description, status: 'idea',
                  format: project.type === 'characters' ? 'reel' : 'post',
                });
                await api.update('idea', i.id, { status: 'used' });
                navigate(`/episodio/${e.id}`);
              }}
            >
              Trasforma in {project.type === 'characters' ? 'episodio' : 'post'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
