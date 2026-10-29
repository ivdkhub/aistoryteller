import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, useFetch, useItems, watchChanges } from '../api.ts';
import { Area, Avatar, Field, Modal, Select, Text } from './ui.tsx';
import { AccountForm } from './forms.tsx';
import { Icon, type IconName } from './Icon.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import type { Account } from '../../shared/types.ts';

const SECTIONS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Panoramica', icon: 'home', end: true },
  { to: '/calendario', label: 'Calendario', icon: 'calendar' },
  { to: '/idee', label: 'Idee', icon: 'idea' },
  { to: '/cerca', label: 'Cerca', icon: 'search' },
  { to: '/import', label: 'Import e backup', icon: 'import' },
];

/** Scrivania in stile macOS: barra dei menu, una finestra con barra laterale, il Dock. */
export function Layout() {
  const accounts = useItems('account');
  const projects = useItems('project');
  const [newAccount, setNewAccount] = useState(false);
  const [quickIdea, setQuickIdea] = useState(false);
  const [about, setAbout] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [menu, setMenu] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => setMenu(false), [location.pathname]);
  useEffect(() => watchChanges(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'k') {
        e.preventDefault();
        setQuickIdea(true);
      } else if (k === 'f') {
        e.preventDefault();
        document.getElementById('toolbar-search')?.focus();
      } else if (e.altKey && k === 's') {
        e.preventDefault();
        setSidebar((s) => !s);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  };

  // I profili satellite compaiono sotto l'account principale.
  const roots = (accounts ?? []).filter((a) => !a.parentAccountId || !accounts?.some((x) => x.id === a.parentAccountId));
  const children = (a: Account) => (accounts ?? []).filter((x) => x.parentAccountId === a.id);

  const accountNode = (a: Account, satellite = false) => (
    <li key={a.id} className={satellite ? 'nav-satellite' : undefined}>
      <NavLink to={`/account/${a.id}`} className="nav-item nav-account">
        <Avatar account={a} />
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
              <NavLink to={`/progetto/${p.id}`} className="nav-item">
                <Icon name={p.type === 'characters' ? 'film' : p.type === 'ai_influencer' ? 'sparkle' : 'folder'} size={15} />
                <span>{p.title || 'Progetto senza titolo'}</span>
              </NavLink>
            </li>
          ))}
      </ul>
      {children(a).length > 0 && <ul className="nav-accounts">{children(a).map((c) => accountNode(c, true))}</ul>}
    </li>
  );

  const menus: MenuDef[] = [
    {
      label: 'AI Story Teller',
      strong: true,
      items: [
        { label: 'Informazioni su AI Story Teller', run: () => setAbout(true) },
        'sep',
        { label: 'Scorciatoie da tastiera', run: () => setShortcuts(true) },
      ],
    },
    {
      label: 'File',
      items: [
        { label: 'Nuovo account…', run: () => setNewAccount(true) },
        { label: 'Nuova idea…', key: 'Ctrl K', run: () => setQuickIdea(true) },
        'sep',
        { label: 'Importa una serie…', run: () => navigate('/import') },
        { label: 'Scarica il backup', run: () => (window.location.href = '/api/export') },
      ],
    },
    {
      label: 'Vista',
      items: [
        ...SECTIONS.map((s) => ({ label: s.label, run: () => navigate(s.to) })),
        'sep',
        { label: sidebar ? 'Nascondi barra laterale' : 'Mostra barra laterale', key: 'Ctrl Alt S', run: () => setSidebar(!sidebar) },
      ],
    },
    {
      label: 'Vai',
      items: [
        { label: 'Indietro', run: () => navigate(-1) },
        { label: 'Avanti', run: () => navigate(1) },
        'sep',
        { label: 'Cerca…', key: 'Ctrl F', run: () => document.getElementById('toolbar-search')?.focus() },
      ],
    },
    { label: 'Finestra', items: [{ label: 'Schermo intero', run: fullscreen }] },
    { label: 'Aiuto', items: [{ label: 'Scorciatoie da tastiera', run: () => setShortcuts(true) }] },
  ];

  return (
    <div className="desktop">
      <MenuBar menus={menus} />
      <div className={`window${sidebar ? '' : ' no-sidebar'}${menu ? ' menu-open' : ''}`}>
        <aside className="sidebar">
          <div className="titlebar-space">
            <TrafficLights onMinimize={() => setSidebar(false)} onZoom={fullscreen} />
          </div>
          <nav className="nav-group">
            {SECTIONS.map((s) => (
              <NavLink key={s.to} to={s.to} end={s.end} className="nav-item">
                <Icon name={s.icon} size={15} />
                <span>{s.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="nav-section">
            <span>Account Instagram</span>
            <button className="icon-button" onClick={() => setNewAccount(true)} aria-label="Nuovo account" title="Nuovo account">
              <Icon name="plus" size={14} />
            </button>
          </div>
          <ul className="nav-accounts">{roots.map((a) => accountNode(a))}</ul>
          {accounts?.length === 0 && <p className="nav-empty">Crea il primo account per iniziare.</p>}
        </aside>

        <div className="content">
          <header className="window-toolbar">
            {!sidebar && <TrafficLights onMinimize={() => setSidebar(true)} onZoom={fullscreen} />}
            <button className="icon-button" onClick={() => setSidebar(!sidebar)} aria-label="Barra laterale" title="Mostra/nascondi barra laterale">
              <Icon name="sidebar" size={17} />
            </button>
            <button className="icon-button mobile-only" onClick={() => setMenu(!menu)} aria-label="Menu">
              <Icon name="sidebar" size={17} />
            </button>
            <div className="nav-arrows">
              <button className="icon-button" onClick={() => navigate(-1)} aria-label="Indietro" title="Indietro">
                <Icon name="back" size={16} />
              </button>
              <button className="icon-button" onClick={() => navigate(1)} aria-label="Avanti" title="Avanti">
                <Icon name="forward" size={16} />
              </button>
            </div>
            <span className="toolbar-title">{titleFor(location.pathname)}</span>
            <button className="icon-button" onClick={() => setQuickIdea(true)} aria-label="Nuova idea" title="Nuova idea (Ctrl K)">
              <Icon name="idea" size={17} />
            </button>
            <form
              className="toolbar-search"
              onSubmit={(e) => {
                e.preventDefault();
                if (query.trim()) navigate(`/cerca?q=${encodeURIComponent(query.trim())}`);
              }}
            >
              <Icon name="search" size={13} />
              <input id="toolbar-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cerca" aria-label="Cerca" />
            </form>
          </header>
          <main className="main">
            <ErrorBoundary key={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </main>
        </div>
      </div>
      <Dock accounts={accounts ?? []} />

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
      {about && (
        <Modal title="AI Story Teller" onClose={() => setAbout(false)}>
          <div className="about">
            <span className="app-icon app-icon-lg" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <p>
              Lo studio locale per i tuoi contenuti Instagram: account, progetti, personaggi, prompt e produzione degli episodi.
              I dati restano su questo computer.
            </p>
            <AboutDetails />
          </div>
        </Modal>
      )}
      {shortcuts && (
        <Modal title="Scorciatoie da tastiera" onClose={() => setShortcuts(false)}>
          <dl className="shortcuts">
            <dt><kbd>Ctrl</kbd> <kbd>K</kbd></dt><dd>Nuova idea</dd>
            <dt><kbd>Ctrl</kbd> <kbd>F</kbd></dt><dd>Cerca</dd>
            <dt><kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>S</kbd></dt><dd>Mostra o nascondi la barra laterale</dd>
            <dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Inquadratura precedente o successiva</dd>
            <dt><kbd>Esc</kbd></dt><dd>Chiude un pannello o una finestra</dd>
          </dl>
        </Modal>
      )}
    </div>
  );
}

function AboutDetails() {
  const { data } = useFetch<{ version: string; dataDir: string }>('/config');
  if (!data) return null;
  return (
    <p className="muted small">
      Versione {data.version}
      <br />
      Archivio: {data.dataDir}
    </p>
  );
}

function titleFor(path: string) {
  if (path === '/') return 'Panoramica';
  const first = path.split('/')[1];
  return (
    { calendario: 'Calendario', idee: 'Idee', cerca: 'Cerca', import: 'Import e backup', account: 'Account', progetto: 'Progetto', personaggio: 'Carta personaggio', episodio: 'Episodio' } as Record<string, string>
  )[first] ?? 'AI Story Teller';
}

function TrafficLights({ onMinimize, onZoom }: { onMinimize: () => void; onZoom: () => void }) {
  return (
    <div className="traffic-lights">
      <span className="tl tl-close" aria-hidden title="Questa finestra non si chiude: è l'app" />
      <button className="tl tl-min" onClick={onMinimize} aria-label="Mostra o nascondi la barra laterale" title="Barra laterale" />
      <button className="tl tl-zoom" onClick={onZoom} aria-label="Schermo intero" title="Schermo intero" />
    </div>
  );
}

type MenuItem = { label: string; key?: string; run: () => void } | 'sep';
interface MenuDef {
  label: string;
  strong?: boolean;
  items: MenuItem[];
}

function MenuBar({ menus }: { menus: MenuDef[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [now, setNow] = useState(() => new Date());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (open === null) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(null);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const clock = `${now.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })}  ${now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;

  return (
    <div className="menubar" ref={ref}>
      <span className="menubar-logo" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      {menus.map((m, i) => (
        <div key={m.label} className="menubar-menu">
          <button
            className={`menubar-item${m.strong ? ' strong' : ''}${open === i ? ' open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={open === i}
            onClick={() => setOpen(open === i ? null : i)}
            onMouseEnter={() => open !== null && setOpen(i)}
          >
            {m.label}
          </button>
          {open === i && (
            <div className="menu-dropdown" role="menu">
              {m.items.map((it, j) =>
                it === 'sep' ? (
                  <hr key={j} />
                ) : (
                  <button
                    key={it.label}
                    role="menuitem"
                    className="menu-entry"
                    onClick={() => {
                      setOpen(null);
                      it.run();
                    }}
                  >
                    <span>{it.label}</span>
                    {it.key && <span className="menu-key">{it.key}</span>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
      <span className="grow" />
      <span className="menubar-clock">{clock}</span>
    </div>
  );
}

/**
 * Apre una pagina come un'app di macOS: la nuova pagina si ingrandisce partendo dall'icona del Dock,
 * la vecchia svanisce. Usa le View Transitions del browser; senza supporto naviga e basta.
 */
function useDockNavigate() {
  const navigate = useNavigate();
  const location = useLocation();
  return (to: string, icon: HTMLElement) => {
    const main = document.querySelector<HTMLElement>('.main');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (to === location.pathname) return;
    if (!document.startViewTransition || !main || reduced) return navigate(to);
    const m = main.getBoundingClientRect();
    const i = icon.getBoundingClientRect();
    document.documentElement.style.setProperty('--dock-origin', `${i.left + i.width / 2 - m.left}px ${i.top + i.height / 2 - m.top}px`);
    document.startViewTransition(async () => {
      flushSync(() => navigate(to));
      // Aspetta (poco) che la pagina abbia contenuto, così non si ingrandisce una finestra vuota.
      const until = performance.now() + 350;
      while (main.childElementCount === 0 && performance.now() < until) await new Promise(requestAnimationFrame);
    });
  };
}

function Dock({ accounts }: { accounts: Account[] }) {
  const go = useDockNavigate();
  const open = (to: string) => (e: ReactMouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go(to, e.currentTarget.querySelector<HTMLElement>('.dock-icon') ?? e.currentTarget);
  };
  return (
    <nav className="dock" aria-label="Dock">
      {SECTIONS.map((s) => (
        <NavLink key={s.to} to={s.to} end={s.end} className="dock-item" title={s.label} aria-label={s.label} onClick={open(s.to)}>
          <span className={`dock-icon dock-${s.icon}`}>
            <Icon name={s.icon} size={24} />
          </span>
        </NavLink>
      ))}
      {accounts.length > 0 && <span className="dock-separator" aria-hidden />}
      {accounts.map((a) => {
        const label = a.name || a.handle || 'Account senza nome';
        return (
          <NavLink key={a.id} to={`/account/${a.id}`} className="dock-item" title={a.handle ? `${label} (${a.handle})` : label} aria-label={label} onClick={open(`/account/${a.id}`)}>
            <Avatar account={a} className="dock-icon dock-account" />
          </NavLink>
        );
      })}
    </nav>
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
          <button className="btn" type="button" onClick={onClose}>
            Annulla
          </button>
          <button className="btn btn-primary" type="submit" disabled={!title.trim()}>
            Salva idea
          </button>
        </div>
      </form>
    </Modal>
  );
}
