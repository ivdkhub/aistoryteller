import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { bump, request, useItems } from '../api.ts';
import { Browser, Field, Select } from '../components/ui.tsx';

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
      <SeasonImport />
      <Backup />
    </div>
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
                      {c.voiceOnly ? 'solo voce' : c.image ? `scheda trovata${c.variants ? ` + ${c.variants} varianti` : ''}` : 'scheda non trovata'}
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
