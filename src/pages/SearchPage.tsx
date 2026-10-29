import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { request } from '../api.ts';
import { Empty } from '../components/ui.tsx';
import type { Item, Kind } from '../../shared/types.ts';

const KIND_LABEL: Record<Kind, string> = {
  account: 'Account', project: 'Progetti', character: 'Personaggi', style: 'Stili',
  episode: 'Episodi e post', shot: 'Inquadrature', prompt: 'Prompt', idea: 'Idee',
};

function link(it: Item): string {
  switch (it.kind) {
    case 'account': return `/account/${it.id}`;
    case 'project': return `/progetto/${it.id}`;
    case 'character': return `/personaggio/${it.id}`;
    case 'episode': return `/episodio/${it.id}`;
    case 'shot': return `/episodio/${it.episodeId}?shot=${it.id}`;
    case 'prompt': return it.shotId ? `/episodio/${(it as unknown as { episodeId: string }).episodeId}?shot=${it.shotId}` : `/progetto/${it.projectId}/prompt`;
    case 'style': return it.projectId ? `/progetto/${it.projectId}/stili` : '/';
    case 'idea': return '/idee';
  }
}

function label(it: Item): string {
  switch (it.kind) {
    case 'account': return it.name || it.handle;
    case 'project': return it.title;
    case 'character': return it.name;
    case 'episode': return `${it.code} ${it.title}`;
    case 'shot': return `${it.code} ${it.title}`;
    case 'prompt': return it.title;
    case 'style': return it.name;
    case 'idea': return it.title;
  }
}

/** Frammento di testo attorno alla parola cercata. */
function snippet(it: Item, q: string) {
  const text = Object.values(it).filter((v) => typeof v === 'string').join(' · ');
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return '';
  const from = Math.max(0, i - 60);
  return (from ? '…' : '') + text.slice(from, i + q.length + 80) + '…';
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [input, setInput] = useState(q);
  const [results, setResults] = useState<Item[] | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults(null);
      return;
    }
    request<Item[]>(`/search?q=${encodeURIComponent(q)}`).then(setResults);
  }, [q]);

  const groups = new Map<Kind, Item[]>();
  for (const r of results ?? []) groups.set(r.kind, [...(groups.get(r.kind) ?? []), r]);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Cerca</h1>
      </header>
      <form
        className="row search-box"
        onSubmit={(e) => {
          e.preventDefault();
          setParams({ q: input });
        }}
      >
        <input autoFocus value={input} onChange={(e) => setInput(e.target.value)} placeholder="Personaggi, prompt, inquadrature, idee…" />
        <button className="btn btn-primary" type="submit">
          Cerca
        </button>
      </form>
      {results?.length === 0 && <Empty title={`Nessun risultato per “${q}”`}>Prova con una parola sola o con un codice come EP02_S07.</Empty>}
      {[...groups.entries()].map(([kind, items]) => (
        <section key={kind}>
          <h2 className="section-title">
            {KIND_LABEL[kind]} <span className="muted">{items.length}</span>
          </h2>
          <ul className="list results">
            {items.map((it) => (
              <li key={it.id}>
                <Link to={link(it)} className="result">
                  <strong>{label(it) || 'Senza titolo'}</strong>
                  <span className="muted small">{snippet(it, q)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
