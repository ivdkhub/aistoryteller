import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api, useItems } from '../api.ts';
import { Field, Modal, Select, Text, Area } from './ui.tsx';
import { AccountForm } from './forms.tsx';
import type { Account } from '../../shared/types.ts';

export function Layout() {
  const accounts = useItems('account');
  const projects = useItems('project');
  const [newAccount, setNewAccount] = useState(false);
  const [quickIdea, setQuickIdea] = useState(false);
  const [menu, setMenu] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQuickIdea(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // I profili satellite compaiono sotto l'account principale.
  const roots = (accounts ?? []).filter((a) => !a.parentAccountId || !accounts?.some((x) => x.id === a.parentAccountId));
  const children = (a: Account) => (accounts ?? []).filter((x) => x.parentAccountId === a.id);

  const accountNode = (a: Account, satellite = false) => (
    <li key={a.id} className={satellite ? 'nav-satellite' : undefined}>
      <NavLink to={`/account/${a.id}`} className="nav-account" onClick={() => setMenu(false)}>
        <span className="avatar" style={{ background: a.color }}>
          {(a.name || a.handle || '?').replace('@', '').slice(0, 1).toUpperCase()}
        </span>
        <span className="nav-account-text">
          <span>{a.name || a.handle || 'Senza nome'}</span>
          {a.handle && <small>{a.handle}</small>}
        </span>
      </NavLink>
      <ul className="nav-projects">
        {(projects ?? [])
          .filter((p) => p.accountId === a.id && p.status !== 'archived')
          .map((p) => (
            <li key={p.id}>
              <NavLink to={`/progetto/${p.id}`} onClick={() => setMenu(false)}>
                {p.title || 'Progetto senza titolo'}
              </NavLink>
            </li>
          ))}
      </ul>
      {children(a).length > 0 && <ul className="nav-accounts">{children(a).map((c) => accountNode(c, true))}</ul>}
    </li>
  );

  return (
    <div className={`shell${menu ? ' menu-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span>AI Story Teller</span>
        </div>
        <nav className="nav-main">
          <NavLink to="/" end onClick={() => setMenu(false)}>Panoramica</NavLink>
          <NavLink to="/calendario" onClick={() => setMenu(false)}>Calendario</NavLink>
          <NavLink to="/idee" onClick={() => setMenu(false)}>Idee</NavLink>
          <NavLink to="/cerca" onClick={() => setMenu(false)}>Cerca</NavLink>
          <NavLink to="/import" onClick={() => setMenu(false)}>Import e backup</NavLink>
        </nav>
        <div className="nav-section">
          <span>Account Instagram</span>
          <button className="btn btn-small btn-ghost" onClick={() => setNewAccount(true)}>
            + Nuovo
          </button>
        </div>
        <ul className="nav-accounts">{roots.map((a) => accountNode(a))}</ul>
        {accounts?.length === 0 && <p className="nav-empty">Crea il primo account per iniziare.</p>}
        <button className="btn quick-idea" onClick={() => setQuickIdea(true)}>
          Nuova idea <kbd>Ctrl K</kbd>
        </button>
      </aside>
      <button className="menu-toggle btn" onClick={() => setMenu(!menu)} aria-label="Menu">
        ☰
      </button>
      <main className="main">
        <Outlet />
      </main>
      {newAccount && (
        <Modal title="Nuovo account Instagram" onClose={() => setNewAccount(false)}>
          <AccountForm
            onSave={async (data) => {
              const a = await api.create('account', data);
              setNewAccount(false);
              navigate(`/account/${a.id}`);
            }}
          />
        </Modal>
      )}
      {quickIdea && <QuickIdea onClose={() => setQuickIdea(false)} />}
    </div>
  );
}

function QuickIdea({ onClose }: { onClose: () => void }) {
  const accounts = useItems('account');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [accountId, setAccountId] = useState('');
  return (
    <Modal title="Nuova idea" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return;
          await api.create('idea', { title: title.trim(), description, accountId });
          onClose();
        }}
      >
        <Field label="Idea">
          <Text value={title} onChange={setTitle} placeholder="Es. reel sul dietro le quinte del primo episodio" />
        </Field>
        <Field label="Dettagli">
          <Area value={description} onChange={setDescription} />
        </Field>
        <Field label="Account">
          <Select value={accountId} onChange={setAccountId} options={[['', 'Nessuno in particolare'], ...(accounts ?? []).map((a): [string, string] => [a.id, a.name || a.handle])]} />
        </Field>
        <div className="row-end">
          <button className="btn btn-primary" type="submit" disabled={!title.trim()}>
            Salva idea
          </button>
        </div>
      </form>
    </Modal>
  );
}
