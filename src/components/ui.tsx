import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api, baseName, copyText, fileUrl, isVideo, useFetch, type SaveState } from '../api.ts';
import { SHOT_STATUS_LABEL, type Account, type ShotStatus } from '../../shared/types.ts';

export function initial(a: Pick<Account, 'name' | 'handle'>) {
  return (a.name || a.handle || '?').replace('@', '').slice(0, 1).toUpperCase();
}

/** Foto profilo dell'account; senza foto (o se il file manca) mostra l'iniziale sul colore dell'account. */
export function Avatar({ account, className = 'avatar' }: { account: Pick<Account, 'name' | 'handle' | 'color' | 'avatar'>; className?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [account.avatar]);
  return (
    <span className={className} style={{ background: account.color }}>
      {account.avatar && !broken ? <img src={fileUrl(account.avatar)} alt="" draggable={false} onError={() => setBroken(true)} /> : initial(account)}
    </span>
  );
}

export function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field${wide ? ' field-wide' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Text({ value, onChange, placeholder, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return <input className={mono ? 'mono' : undefined} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

/** Area di testo che cresce con il contenuto. */
export function Area({
  value, onChange, placeholder, rows = 3, mono,
}: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; mono?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 640)}px`;
  }, [value]);
  return (
    <textarea ref={ref} className={mono ? 'mono' : undefined} rows={rows} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  );
}

/** Menu a tendina in stile macOS: il menu si apre sopra il pulsante con la voce scelta allineata al pulsante. */
export function Select<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const current = options.findIndex(([v]) => v === value);
  const label = current >= 0 ? options[current][1] : value;

  const show = () => {
    setActive(Math.max(current, 0));
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  const pick = (i: number) => {
    const opt = options[i];
    if (opt && opt[0] !== value) onChange(opt[0]);
    close();
  };

  // Posizione: la voce scelta copre il pulsante, e il testo delle voci è allineato al testo del pulsante.
  useLayoutEffect(() => {
    const b = button.current, m = menu.current;
    if (!open || !b || !m) return;
    const r = b.getBoundingClientRect();
    const margin = 6;
    m.style.minWidth = `${r.width + 22}px`;
    m.style.maxHeight = `${window.innerHeight - margin * 2}px`;
    const item = m.querySelectorAll<HTMLElement>('.popup-item')[Math.max(current, 0)];
    const offset = item ? item.offsetTop - (r.height - item.offsetHeight) / 2 : 0;
    const h = m.offsetHeight, w = m.offsetWidth;
    let top = r.top - offset;
    if (top < margin) {
      m.scrollTop = margin - top;
      top = margin;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - h - margin));
    const left = Math.max(margin, Math.min(r.left - 22, window.innerWidth - w - margin));
    m.style.top = `${top}px`;
    m.style.left = `${left}px`;
    m.focus({ preventScroll: true });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Chiusura con clic fuori, scorrimento o ridimensionamento della finestra.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) close(false);
    };
    const onScroll = (e: Event) => !menu.current?.contains(e.target as Node) && close(false);
    const onResize = () => close(false);
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) menu.current?.querySelectorAll<HTMLElement>('.popup-item')[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onMenuKey = (e: ReactKeyboardEvent) => {
    const last = options.length - 1;
    const keys: Record<string, () => void> = {
      ArrowDown: () => setActive((a) => Math.min(a + 1, last)),
      ArrowUp: () => setActive((a) => Math.max(a - 1, 0)),
      Home: () => setActive(0),
      End: () => setActive(last),
      Enter: () => pick(active),
      ' ': () => pick(active),
      Escape: () => close(),
      Tab: () => close(),
    };
    const action = keys[e.key];
    if (action) {
      e.preventDefault();
      e.stopPropagation();
      action();
      return;
    }
    // Ricerca per lettera iniziale, come nei menu di macOS.
    if (e.key.length === 1 && /\S/.test(e.key)) {
      const k = e.key.toLowerCase();
      const n = options.length;
      for (let s = 1; s <= n; s++) {
        const i = (active + s) % n;
        if (options[i][1].toLowerCase().startsWith(k)) {
          setActive(i);
          break;
        }
      }
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`popup${open ? ' open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
            e.preventDefault();
            show();
          }
        }}
      >
        {label}
      </button>
      {open &&
        createPortal(
          <div ref={menu} className="popup-menu" role="listbox" tabIndex={-1} onKeyDown={onMenuKey}>
            {options.map(([v, l], i) => (
              <div
                key={v}
                role="option"
                aria-selected={v === value}
                className={`popup-item${i === active ? ' active' : ''}`}
                // Solo movimenti veri: il menu che compare sotto un mouse fermo non cambia la voce attiva.
                onMouseMove={(e) => (e.movementX || e.movementY) && i !== active && setActive(i)}
                onMouseUp={() => pick(i)}
              >
                <span className="popup-check">{v === value ? '✓' : ''}</span>
                {l}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

export function SaveBadge({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  const label = { saving: 'Salvataggio…', saved: 'Salvato', error: 'Non salvato: riprova' }[state];
  return <span className={`save-badge save-${state}`}>{label}</span>;
}

export function CopyButton({ text, label = 'Copia', className = '' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`btn btn-small ${className}`}
      disabled={!text}
      onClick={async () => {
        await copyText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
    >
      {done ? 'Copiato' : label}
    </button>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string, number?][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([k, l, n]) => (
        <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'tab active' : 'tab'} onClick={() => onChange(k)}>
          {l}
          {n !== undefined && <span className="tab-count">{n}</span>}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Chiudi">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children}
    </div>
  );
}

export function StatusDot({ status }: { status: ShotStatus }) {
  return <span className={`status status-${status}`}>{SHOT_STATUS_LABEL[status]}</span>;
}

/** Anteprima di un'immagine o di un video locale. */
export function Media({ path, alt, controls }: { path: string; alt?: string; controls?: boolean }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [path]);
  if (!path) return null;
  if (broken) return <div className="media-missing" title={path}>File non trovato<br /><small>{baseName(path)}</small></div>;
  return isVideo(path) ? (
    <video src={fileUrl(path)} controls={controls} muted playsInline preload="metadata" onError={() => setBroken(true)} />
  ) : (
    <img src={fileUrl(path)} alt={alt ?? baseName(path)} loading="lazy" onError={() => setBroken(true)} />
  );
}

/** Scelta di un file: caricamento (copiato in data/media) o collegamento a un percorso sul disco. */
export function FilePicker({
  projectId, onPick, accept = 'image/*,video/*', label = 'Aggiungi file',
}: { projectId?: string; onPick: (path: string) => void; accept?: string; label?: string }) {
  const [browse, setBrowse] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="file-picker">
      <button type="button" className="btn btn-small" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Caricamento…' : label}
      </button>
      <button type="button" className="btn btn-small btn-ghost" onClick={() => setBrowse(true)}>
        Collega dal disco
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple
        hidden
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          setBusy(true);
          for (const f of files) onPick((await api.upload(f, projectId)).path);
          setBusy(false);
          e.target.value = '';
        }}
      />
      {browse && (
        <Browser
          mode="file"
          onClose={() => setBrowse(false)}
          onPick={(p) => {
            onPick(p);
            setBrowse(false);
          }}
        />
      )}
    </div>
  );
}

interface FsListing {
  path: string;
  parent: string;
  dirs: string[];
  files: string[];
}

/** Navigatore delle cartelle consentite (sola lettura). */
export function Browser({ mode, onPick, onClose, start = '' }: { mode: 'file' | 'folder'; onPick: (p: string) => void; onClose: () => void; start?: string }) {
  const [dir, setDir] = useState(start);
  const { data, error } = useFetch<FsListing>(`/fs?path=${encodeURIComponent(dir)}`);
  const files = mode === 'file' ? (data?.files ?? []).filter((f) => /\.(png|jpe?g|webp|gif|mp4|mov|webm|txt|md)$/i.test(f)) : [];
  return (
    <Modal title={mode === 'file' ? 'Collega un file dal disco' : 'Scegli una cartella'} onClose={onClose} wide>
      <div className="browser">
        <div className="browser-path">
          {data?.path || 'Cartelle consentite'}
          {mode === 'folder' && data?.path && (
            <button className="btn btn-small btn-primary" onClick={() => onPick(data.path)}>
              Usa questa cartella
            </button>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        <ul className="browser-list">
          {data?.path && (
            <li>
              <button className="browser-item" onClick={() => setDir(data.parent)}>
                ↰ Cartella superiore
              </button>
            </li>
          )}
          {data?.dirs.map((d) => (
            <li key={d}>
              <button className="browser-item browser-dir" onClick={() => setDir(d)}>
                {baseName(d) || d}
              </button>
            </li>
          ))}
          {files.map((f) => (
            <li key={f}>
              <button className="browser-item browser-file" onClick={() => onPick(f)}>
                {baseName(f)}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

export function Confirm({ text, onYes, onClose, yes = 'Elimina' }: { text: string; onYes: () => void; onClose: () => void; yes?: string }) {
  return (
    <Modal title="Conferma" onClose={onClose}>
      <p>{text}</p>
      <div className="row-end">
        <button className="btn btn-ghost" onClick={onClose}>
          Annulla
        </button>
        <button
          className="btn btn-danger"
          onClick={() => {
            onYes();
            onClose();
          }}
        >
          {yes}
        </button>
      </div>
    </Modal>
  );
}

/** Pulsante di eliminazione con conferma. */
export function DeleteButton({ label, text, onDelete }: { label?: string; text: string; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-small btn-ghost btn-danger-text" onClick={() => setOpen(true)}>
        {label ?? 'Elimina'}
      </button>
      {open && <Confirm text={text} onYes={onDelete} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Elenco di righe modificabile (es. regole di continuità). */
export function ListEditor({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  return (
    <div className="list-editor">
      {value.map((v, i) => (
        <div key={i} className="list-row">
          <input value={v} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} />
          <button className="btn btn-ghost btn-small" aria-label="Rimuovi" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <form
        className="list-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          onChange([...value, draft.trim()]);
          setDraft('');
        }}
      >
        <input value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} />
        <button className="btn btn-small" type="submit">
          Aggiungi
        </button>
      </form>
    </div>
  );
}
