// Accesso alle API locali e hook di lettura con aggiornamento automatico dopo ogni modifica.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Draft, ItemByKind, Kind } from '../shared/types.ts';

// Ogni modifica incrementa la versione: gli hook di lettura ricaricano i dati.
let version = 0;
const listeners = new Set<() => void>();
export function bump() {
  version++;
  listeners.forEach((l) => l());
}
function useVersion() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
}

export async function request<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const headers = opts.body && !(opts.body instanceof FormData) ? { 'content-type': 'application/json' } : undefined;
  const res = await fetch(`/api${url}`, { ...opts, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error ?? `Errore ${res.status}`);
  return data as T;
}

export type Filter = Partial<Record<'accountId' | 'projectId' | 'episodeId' | 'shotId' | 'characterId', string>>;

function qs(filter: Filter) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) if (v !== undefined) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const api = {
  list: <K extends Kind>(kind: K, filter: Filter = {}) => request<ItemByKind[K][]>(`/items/${kind}${qs(filter)}`),
  get: <K extends Kind>(kind: K, id: string) => request<ItemByKind[K]>(`/items/${kind}/${id}`),
  async create<K extends Kind>(kind: K, data: Partial<Draft<K>>) {
    const item = await request<ItemByKind[K]>(`/items/${kind}`, { method: 'POST', body: JSON.stringify(data) });
    bump();
    return item;
  },
  async update<K extends Kind>(kind: K, id: string, patch: Partial<Draft<K>>, silent = false) {
    const item = await request<ItemByKind[K]>(`/items/${kind}/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    if (!silent) bump();
    return item;
  },
  async remove(kind: Kind, id: string) {
    await request(`/items/${kind}/${id}`, { method: 'DELETE' });
    bump();
  },
  async upload(file: File, projectId?: string) {
    const fd = new FormData();
    fd.append('file', file);
    return request<{ path: string }>(`/upload${projectId ? `?projectId=${projectId}` : ''}`, { method: 'POST', body: fd });
  },
};

export function fileUrl(p: string) {
  return `/api/file?path=${encodeURIComponent(p)}`;
}

export function isVideo(p: string) {
  return /\.(mp4|mov|webm)$/i.test(p);
}

export function baseName(p: string) {
  return p.split(/[\\/]/).pop() ?? p;
}

/** Legge una lista e la ricarica dopo ogni modifica. */
export function useItems<K extends Kind>(kind: K, filter: Filter = {}, enabled = true) {
  const v = useVersion();
  const key = JSON.stringify(filter);
  const [items, setItems] = useState<ItemByKind[K][] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    api.list(kind, JSON.parse(key)).then((r) => alive && setItems(r));
    return () => {
      alive = false;
    };
  }, [kind, key, v, enabled]);
  return items;
}

export function useItem<K extends Kind>(kind: K, id: string | undefined) {
  const v = useVersion();
  const [item, setItem] = useState<ItemByKind[K] | null | undefined>(undefined);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    api.get(kind, id).then((r) => alive && setItem(r), () => alive && setItem(null));
    return () => {
      alive = false;
    };
  }, [kind, id, v]);
  return item;
}

export function useFetch<T>(url: string | null) {
  const v = useVersion();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!url) return;
    let alive = true;
    request<T>(url).then(
      (r) => alive && (setData(r), setError('')),
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [url, v]);
  return { data, error };
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Bozza locale con salvataggio automatico (debounce).
 * Le modifiche si vedono subito; il server riceve una PATCH dopo una breve pausa.
 */
export function useAutosave<K extends Kind>(kind: K, item: ItemByKind[K] | null | undefined) {
  const [draft, setDraft] = useState(item);
  const [state, setState] = useState<SaveState>('idle');
  const pending = useRef<Partial<Draft<K>>>({});
  const timer = useRef<number | undefined>(undefined);
  const idRef = useRef(item?.id);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const patch = pending.current;
    const id = idRef.current;
    if (!id || !Object.keys(patch).length) return;
    pending.current = {};
    setState('saving');
    try {
      await api.update(kind, id, patch);
      setState('saved');
    } catch {
      setState('error');
    }
  }, [kind]);

  // Nuovo elemento (o ricarica da server senza modifiche in sospeso): riallinea la bozza.
  useEffect(() => {
    if (item?.id !== idRef.current) {
      void flush();
      idRef.current = item?.id;
      setDraft(item);
      setState('idle');
    } else if (!Object.keys(pending.current).length) {
      setDraft(item);
    }
  }, [item, flush]);

  useEffect(() => () => void flush(), [flush]);

  const set = useCallback(
    (patch: Partial<Draft<K>>) => {
      setDraft((d) => (d ? ({ ...d, ...patch } as ItemByKind[K]) : d));
      pending.current = { ...pending.current, ...patch };
      setState('saving');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), 700);
    },
    [flush],
  );

  return { draft, set, state, flush };
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}
