// Scheda "Da generare": prompt e riferimenti pronti da copiare uno dopo l'altro.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, baseName, copyText, fileUrl, useItems } from '../api.ts';
import { CopyButton, Empty, FilePicker, Media, Select } from './ui.tsx';
import { checkShot } from '../../shared/consistency.ts';
import { generationQueue, type QueueKind } from '../../shared/queue.ts';
import type { Character, Episode, Project, Shot } from '../../shared/types.ts';

export function GenerationQueue({ project }: { project: Project }) {
  const shots = useItems('shot', { projectId: project.id });
  const episodes = useItems('episode', { projectId: project.id });
  const characters = useItems('character', { projectId: project.id });
  const [kind, setKind] = useState<QueueKind>('image');
  const [episodeId, setEpisodeId] = useState('');
  const [cursor, setCursor] = useState(0);
  const [copied, setCopied] = useState('');
  const refs = useRef<Record<string, HTMLElement | null>>({});

  const all = generationQueue(shots ?? [], episodes ?? [], kind);
  const queue = episodeId ? all.filter((s) => s.episodeId === episodeId) : all;
  const current = queue[Math.min(cursor, queue.length - 1)];
  const count = (k: QueueKind) => generationQueue(shots ?? [], episodes ?? [], k).length;
  // Per i video, se manca il prompt si copia la nota di animazione (spesso contiene già le frasi per Kling).
  const promptOf = (s: Shot) => (kind === 'image' ? s.imagePrompt : s.videoPrompt || s.animation);

  useEffect(() => setCursor(0), [kind, episodeId]);
  useEffect(() => {
    if (current) refs.current[current.id]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [current?.id]);

  const episodeOptions = (episodes ?? [])
    .filter((e) => all.some((s) => s.episodeId === e.id))
    .sort((a, b) => Number(!!a.publishAccountId) - Number(!!b.publishAccountId) || a.number - b.number)
    .map((e): [string, string] => [e.id, `${e.code} ${e.title}`]);

  return (
    <section className="stack">
      <div className="row toolbar">
        <div className="segmented">
          <button className={kind === 'image' ? 'on' : undefined} onClick={() => setKind('image')}>
            Immagini <span className="tab-count">{count('image')}</span>
          </button>
          <button className={kind === 'video' ? 'on' : undefined} onClick={() => setKind('video')}>
            Video da animare <span className="tab-count">{count('video')}</span>
          </button>
        </div>
        <Select value={episodeId} onChange={setEpisodeId} options={[['', 'Tutti gli episodi'], ...episodeOptions]} />
        <span className="grow" />
        {current && (
          <button
            className="btn btn-primary"
            disabled={!promptOf(current)}
            onClick={async () => {
              await copyText(promptOf(current));
              setCopied(current.code);
              setCursor((c) => Math.min(c + 1, queue.length - 1));
            }}
          >
            Copia il prompt di {current.code} e passa al successivo
          </button>
        )}
      </div>
      {copied && <p className="muted small">Prompt di {copied} copiato. Allega i riferimenti indicati e incollalo nello strumento.</p>}
      {queue.length === 0 && (
        <Empty title={kind === 'image' ? 'Nessuna immagine da generare' : 'Nessun video da animare'}>
          {kind === 'image' ? 'Tutte le inquadrature hanno un\'immagine, oppure sono solo grafica.' : 'Le inquadrature con priorità di animazione hanno già il loro video.'}
        </Empty>
      )}
      <ol className="queue">
        {queue.map((s, i) => (
          <QueueCard
            key={s.id}
            ref={(el) => {
              refs.current[s.id] = el;
            }}
            shot={s}
            kind={kind}
            active={s.id === current?.id}
            position={i + 1}
            episode={episodes?.find((e) => e.id === s.episodeId)}
            characters={characters ?? []}
            onSelect={() => setCursor(i)}
          />
        ))}
      </ol>
    </section>
  );
}

interface CardProps {
  shot: Shot;
  kind: QueueKind;
  active: boolean;
  position: number;
  episode?: Episode;
  characters: Character[];
  onSelect: () => void;
  ref: (el: HTMLElement | null) => void;
}

function QueueCard({ shot: s, kind, active, position, episode, characters, onSelect, ref }: CardProps) {
  const cast = s.characterIds.map((id) => characters.find((c) => c.id === id)).filter((c): c is Character => !!c);
  const issues = checkShot(s, characters).filter((i) => i.level === 'warn');
  const prompt = kind === 'image' ? s.imagePrompt : s.videoPrompt || s.animation;
  const fromNote = kind === 'video' && !s.videoPrompt && !!s.animation;
  return (
    <li ref={ref} className={`queue-card${active ? ' active' : ''}`} onClick={onSelect}>
      <div className="queue-head">
        <span className="queue-pos">{position}</span>
        <span className="code">{s.code}</span>
        <strong className="grow clamp-1">{s.title || 'Senza titolo'}</strong>
        {kind === 'video' && s.animPriority && <span className={`frame-prio prio-${s.animPriority} static`}>{s.animPriority}</span>}
        <Link className="small" to={`/episodio/${s.episodeId}?shot=${s.id}`} onClick={(e) => e.stopPropagation()}>
          Apri {episode ? `in ${episode.code}` : ''}
        </Link>
      </div>
      <div className="queue-body">
        <div className="queue-refs">
          <span className="field-label">Da allegare</span>
          {kind === 'video' && s.imageFile && (
            <a className="queue-ref" href={fileUrl(s.imageFile)} target="_blank" rel="noreferrer" title={s.imageFile}>
              <span className="thumb-sm"><Media path={s.imageFile} /></span>
              <span className="small">Immagine di partenza<br /><span className="muted">{baseName(s.imageFile)}</span></span>
            </a>
          )}
          {kind === 'image' &&
            cast.map((c, i) => (
              <a key={c.id} className="queue-ref" href={c.images[0] ? fileUrl(c.images[0].path) : undefined} target="_blank" rel="noreferrer" title={c.images[0]?.path}>
                <span className="thumb-sm">{c.images[0] ? <Media path={c.images[0].path} /> : null}</span>
                <span className="small">
                  {i + 1}) {c.name}
                  <br />
                  <span className="muted">{c.images[0] ? baseName(c.images[0].path) : 'nessuna scheda immagine'}</span>
                </span>
              </a>
            ))}
          {s.refs && <span className="small muted">{s.refs}</span>}
          {kind === 'video' && s.animation && !fromNote && <span className="small">Movimento: {s.animation}</span>}
          {s.cut && <span className="small">Taglio: {s.cut}</span>}
        </div>
        <div className="queue-prompt">
          <div className="row">
            <span className="field-label grow">
              {kind === 'image' ? 'Prompt immagine' : fromNote ? 'Nota di animazione (manca il prompt video)' : 'Prompt video'}
            </span>
            <CopyButton text={prompt} />
          </div>
          {prompt ? (
            <p className="prompt-text">{prompt}</p>
          ) : (
            <p className="muted small">Manca il prompt: aprilo e usa “Componi” nell'inquadratura.</p>
          )}
          {issues.map((i, n) => (
            <p key={n} className="issue issue-warn">⚠ {i.text}</p>
          ))}
          <div className="row" onClick={(e) => e.stopPropagation()}>
            <FilePicker
              projectId={s.projectId}
              accept={kind === 'image' ? 'image/*' : 'video/*'}
              label={kind === 'image' ? 'Carica l\'immagine generata' : 'Carica il video'}
              onPick={(path) => api.update('shot', s.id, kind === 'image' ? { imageFile: path, status: 'image' } : { videoFile: path, status: 'video' })}
            />
            <button className="btn btn-small btn-ghost" onClick={() => api.update('shot', s.id, kind === 'image' ? { status: 'image' } : { status: 'video' })}>
              Segna come fatta
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
