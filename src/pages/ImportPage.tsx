import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { bump, request, useFetch, useItems, type PeerInfo } from '../api.ts';
import { Browser, Field, Select } from '../components/ui.tsx';
import { formatDate, plural } from '../util.ts';

interface Preview {
  title: string;
  version: string;
  folder: string;
  styles: string[];
  characters: { name: string; image: boolean; variants: number; voiceOnly: boolean; exists: boolean }[];
  episodes: { code: string; title: string; shots: number; satellite: boolean; exists: boolean }[];
  satellite: { handle: string; altHandle: string } | null;
  existingProjectId: string;
}

export function ImportPage() {
  return (
    <div className="page">
      <header className="page-head">
        <h1>Import e backup</h1>
      </header>
      <DriveSync />
      <SeasonImport />
      <Roots />
      <Backup />
    </div>
  );
}

interface SyncApiStatus {
  enabled: boolean;
  folder: string;
  folderExists: boolean;
  nodeId: string;
  nodeName: string;
  state: 'disabled' | 'idle' | 'syncing' | 'error';
  lastPushAt: string;
  lastPullAt: string;
  lastChangeAt: string;
  error: string;
  peers: PeerInfo[];
  stats: { pushed: number; pulled: number; mediaCopied: number };
  detectedDriveFolders?: string[];
}

/** Collaborazione in tempo reale tramite una cartella condivisa su Google Drive per Desktop. */
function DriveSync() {
  const { data } = useFetch<SyncApiStatus>('/sync');
  const [status, setStatus] = useState<SyncApiStatus | null>(null);
  const [folder, setFolder] = useState('');
  const [nodeName, setNodeName] = useState('');
  const [browse, setBrowse] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const cur = status ?? data;
  useEffect(() => {
    if (data && !status) {
      setFolder(data.folder);
      setNodeName(data.nodeName);
    }
  }, [data, status]);

  const applyConfig = async (nextFolder: string, nextName: string) => {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const r = await request<SyncApiStatus>('/sync', {
        method: 'PUT',
        body: JSON.stringify({ folder: nextFolder.trim(), nodeName: nextName.trim() }),
      });
      setStatus({ ...r, detectedDriveFolders: cur?.detectedDriveFolders });
      setFolder(r.folder);
      setNodeName(r.nodeName);
      setMsg(r.enabled ? 'Sincronizzazione continua attivata.' : 'Sincronizzazione disattivata.');
      bump();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const r = await request<SyncApiStatus>('/sync/now', { method: 'POST' });
      setStatus({ ...r, detectedDriveFolders: cur?.detectedDriveFolders });
      setMsg('Sincronizzato ora con la cartella condivisa.');
      bump();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const detected = cur?.detectedDriveFolders ?? [];

  return (
    <section className="panel stack sync-panel">
      <div className="row">
        <h2 className="grow">Collaborazione in tempo reale (Google Drive)</h2>
        {cur && (
          <span className={`ep-status sync-badge-${cur.state}`}>
            {cur.state === 'disabled'
              ? 'Non attiva'
              : cur.state === 'error'
                ? 'Errore cartella'
                : cur.state === 'syncing'
                  ? 'Sincronizzazione…'
                  : 'Attiva in tempo reale'}
          </span>
        )}
      </div>
      <p className="muted">
        Lavora contemporaneamente con il tuo socio: scegliete una cartella condivisa su <strong>Google Drive per Desktop</strong>.
        Ogni vostro PC mantiene il database SQLite locale ultra-rapido e scrive il proprio stato in file separati senza conflitti
        dentro <code>.storyteller-sync</code> (con fusione automatica campo per campo, propagazione delle eliminazioni, copia dei
        media caricati e traduzione automatica dei percorsi tra i due PC).
      </p>

      <div className="grid-2">
        <Field label="Cartella condivisa Google Drive" hint="Es. G:\Il mio Drive\AI Story Teller Condivisa">
          <div className="row">
            <input
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="Percorso della cartella condivisa su Google Drive"
              aria-label="Cartella condivisa Google Drive"
            />
            <button className="btn" type="button" onClick={() => setBrowse(true)}>
              Sfoglia
            </button>
          </div>
        </Field>
        <Field label="Il tuo nome (visibile al socio)" hint="Identifica la tua postazione nella barra in alto.">
          <input
            value={nodeName}
            onChange={(e) => setNodeName(e.target.value)}
            placeholder="Es. Marco, Studio, Portatile…"
            aria-label="Il tuo nome"
          />
        </Field>
      </div>

      {detected.length > 0 && (
        <div className="row small">
          <span className="muted">Google Drive rilevati su questo PC:</span>
          {detected.map((d) => (
            <button
              key={d}
              type="button"
              className="chip"
              onClick={() => setFolder(`${d}\\AI Story Teller Sync`)}
              title={`Imposta ${d}\\AI Story Teller Sync`}
            >
              Usa {d}
            </button>
          ))}
        </div>
      )}

      <div className="row">
        <button
          className="btn btn-primary"
          disabled={busy || !folder.trim()}
          onClick={() => void applyConfig(folder, nodeName)}
        >
          {cur?.enabled && cur.folder === folder.trim() ? 'Aggiorna impostazioni' : 'Attiva sincronizzazione continua'}
        </button>
        {cur?.enabled && (
          <>
            <button className="btn" disabled={busy} onClick={() => void syncNow()}>
              Sincronizza ora
            </button>
            <button
              className="btn btn-ghost btn-danger-text"
              disabled={busy}
              onClick={() => void applyConfig('', nodeName)}
            >
              Scollega
            </button>
          </>
        )}
        {msg && <span className="small muted">{msg}</span>}
      </div>

      {(error || cur?.error) && <p className="error">{error || cur?.error}</p>}

      {cur?.enabled && (
        <div className="sync-details">
          <div className="row small muted">
            <span>ID nodo: <code>{cur.nodeId}</code></span>
            {cur.lastPushAt && <span>· Ultimo invio: {formatDate(cur.lastPushAt)}</span>}
            {cur.lastPullAt && <span>· Ultimo controllo: {formatDate(cur.lastPullAt)}</span>}
            {cur.stats.mediaCopied > 0 && <span>· File media allineati: {cur.stats.mediaCopied}</span>}
          </div>
          {cur.peers.length > 0 ? (
            <div className="sync-peers">
              <h4>Soci collegati alla cartella</h4>
              <ul className="list">
                {cur.peers.map((p) => (
                  <li key={p.nodeId} className="list-link">
                    <span className="sync-peer-dot" aria-hidden />
                    <strong>{p.nodeName}</strong>
                    <span className="muted small">({p.itemsCount} elementi)</span>
                    <span className="grow" />
                    <span className="muted small">Ultimo aggiornamento: {formatDate(p.updatedAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="muted small">
              Nessun altro socio rilevato per ora. Quando il tuo socio avvierà AI Story Teller puntando alla stessa cartella Drive,
              comparirà qui e le modifiche si uniranno in automatico in meno di 2 secondi.
            </p>
          )}
        </div>
      )}

      {browse && (
        <Browser
          mode="folder"
          start={folder}
          onClose={() => setBrowse(false)}
          onPick={(p) => {
            setFolder(p);
            setBrowse(false);
          }}
        />
      )}
    </section>
  );
}

interface Root {
  path: string;
  exists: boolean;
}

/** Cartelle da cui l'app può mostrare immagini e video e cercare i file delle inquadrature. */
function Roots() {
  const { data } = useFetch<{ allowedRoots: Root[] }>('/config');
  const [roots, setRoots] = useState<Root[] | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const list = roots ?? data?.allowedRoots ?? [];

  const save = async (paths: string[]) => {
    setError('');
    try {
      const r = await request<{ allowedRoots: Root[] }>('/config/roots', { method: 'PUT', body: JSON.stringify({ allowedRoots: paths }) });
      setRoots(r.allowedRoots);
      bump();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="panel stack">
      <h2>Cartelle dei contenuti</h2>
      <p className="muted">
        L'app legge immagini, video e documenti solo da queste cartelle (e da quelle che contengono). Aggiungi quella in cui
        tieni i tuoi progetti, ad esempio <code>C:\Utenti\nome\Documenti\Contenuti</code>.
      </p>
      <ul className="list">
        {list.map((r) => (
          <li key={r.path} className="list-link">
            <span className="grow mono">{r.path}</span>
            {!r.exists && <span className="error small">cartella non trovata</span>}
            <button className="btn btn-small btn-ghost btn-danger-text" disabled={list.length === 1} onClick={() => save(list.filter((x) => x.path !== r.path).map((x) => x.path))}>
              Rimuovi
            </button>
          </li>
        ))}
      </ul>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          void save([...list.map((x) => x.path), draft.trim()]);
          setDraft('');
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Percorso della cartella da aggiungere" aria-label="Cartella da aggiungere" />
        <button className="btn" type="submit" disabled={!draft.trim()}>
          Aggiungi cartella
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function SeasonImport() {
  const accounts = useItems('account');
  const [filePath, setFilePath] = useState('');
  const [browse, setBrowse] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [satellite, setSatellite] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const body = () => JSON.stringify({ filePath, accountId: accountId || undefined, satellite });

  return (
    <section className="panel stack">
      <h2>Importa una serie da documento</h2>
      <p className="muted">
        Legge un documento di stagione come <code>Bank_error_S1_copioni_e_prompt.txt</code>: personaggi, stili, voci, bibbia,
        episodi, copioni e inquadrature con i loro prompt. Poi collega le immagini e i video che trova nella stessa cartella.
        Il file non viene modificato; reimportarlo aggiorna il progetto senza creare doppioni.
      </p>
      <Field label="Documento di stagione">
        <div className="row">
          <input value={filePath} onChange={(e) => { setFilePath(e.target.value); setPreview(null); }} placeholder="C:\…\Insta-series\Bank_error_S1_copioni_e_prompt.txt" />
          <button className="btn" onClick={() => setBrowse(true)}>
            Sfoglia
          </button>
        </div>
      </Field>
      <div className="grid-2">
        <Field label="Account">
          <Select
            value={accountId}
            onChange={(v) => { setAccountId(v); setPreview(null); }}
            options={[['', 'Crea un nuovo account'], ...(accounts ?? []).filter((a) => !a.parentAccountId).map((a): [string, string] => [a.id, a.name || a.handle])]}
          />
        </Field>
        <label className="check check-inline">
          <input type="checkbox" checked={satellite} onChange={(e) => setSatellite(e.target.checked)} /> Crea anche il profilo satellite del personaggio
        </label>
      </div>
      <div className="row">
        <button
          className="btn"
          disabled={!filePath || busy}
          onClick={async () => {
            setError('');
            try {
              setPreview(await request<Preview>('/import/season/preview', { method: 'POST', body: body() }));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Anteprima
        </button>
        {preview && (
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const r = await request<{ projectId: string }>('/import/season/apply', { method: 'POST', body: body() });
                bump();
                navigate(`/progetto/${r.projectId}/episodi`);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Import in corso…' : preview.existingProjectId ? 'Aggiorna il progetto' : 'Importa'}
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {preview && (
        <div className="preview">
          <h3>{preview.title}</h3>
          <p className="muted small">{preview.version}</p>
          {preview.existingProjectId && <p className="note">Il progetto esiste già: verrà aggiornato. Stato delle inquadrature e file collegati restano.</p>}
          <div className="grid-3">
            <div>
              <h4>Personaggi</h4>
              <ul className="plain">
                {preview.characters.map((c) => (
                  <li key={c.name}>
                    {c.name}{' '}
                    <span className="muted small">
                      {c.voiceOnly ? 'solo voce' : c.image ? `scheda trovata${c.variants ? ` + ${plural(c.variants, 'variante', 'varianti')}` : ''}` : 'scheda non trovata'}
                      {c.exists && ', aggiorna'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Episodi e post</h4>
              <ul className="plain">
                {preview.episodes.map((e) => (
                  <li key={e.code}>
                    <span className="code">{e.code}</span> {e.title} <span className="muted small">{e.shots} inq.{e.exists && ', aggiorna'}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Stili</h4>
              <ul className="plain">
                {preview.styles.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              {preview.satellite && (
                <>
                  <h4>Profilo satellite</h4>
                  <p>
                    {preview.satellite.handle}
                    {preview.satellite.altHandle && <span className="muted small"> (alternativa {preview.satellite.altHandle})</span>}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {browse && (
        <Browser
          mode="file"
          onClose={() => setBrowse(false)}
          onPick={(p) => {
            setFilePath(p);
            setPreview(null);
            setBrowse(false);
          }}
        />
      )}
    </section>
  );
}

function Backup() {
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [msg, setMsg] = useState('');
  return (
    <section className="panel stack">
      <h2>Backup</h2>
      <p className="muted">
        Ogni giorno, all'avvio, l'app copia l'archivio in <code>data\backups</code> (tiene gli ultimi 14). Per spostare i dati su un
        altro computer, scarica il backup completo e ripristinalo lì.
      </p>
      <div className="row">
        <a className="btn btn-primary" href="/api/export" download>
          Scarica il backup completo (.json)
        </a>
      </div>
      <div className="row">
        <Select value={mode} onChange={setMode} options={[['merge', 'Unisci ai dati attuali'], ['replace', 'Sostituisci tutti i dati']]} />
        <label className="btn">
          Ripristina da file…
          <input
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const data = JSON.parse(await f.text());
                const r = await request<{ imported: number }>('/import/json', { method: 'POST', body: JSON.stringify({ items: data.items, mode }) });
                bump();
                setMsg(`Ripristinati ${r.imported} elementi.`);
              } catch (err) {
                setMsg(`Ripristino non riuscito: ${(err as Error).message}`);
              }
              e.target.value = '';
            }}
          />
        </label>
        {msg && <span className="small">{msg}</span>}
      </div>
    </section>
  );
}
