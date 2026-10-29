// Composer: prefisso di stile + descrizioni fisse dei personaggi + scena → prompt immagine;
// movimento + regole di continuità + Avoid → prompt video.
import { useState } from 'react';
import { api, useItems } from '../api.ts';
import { Area, CopyButton, Field, Select, Text } from './ui.tsx';
import { TOOLS, type Character, type Shot } from '../../shared/types.ts';
import { attachmentsFor, buildImagePrompt, buildVideoPrompt } from '../../shared/compose.ts';

interface Props {
  projectId: string;
  shot?: Shot;
  onApplied?: () => void;
}

export function Composer({ projectId, shot, onApplied }: Props) {
  const characters = useItems('character', { projectId });
  const own = useItems('style', { projectId });
  const global = useItems('style', { projectId: '' });
  const styles = [...(own ?? []), ...(global ?? [])];
  const imageStyles = styles.filter((s) => s.target === 'image');
  const videoStyles = styles.filter((s) => s.target === 'video');

  const [imageStyleId, setImageStyleId] = useState('');
  const [videoStyleId, setVideoStyleId] = useState('');
  const [castIds, setCastIds] = useState<string[]>(shot?.characterIds ?? []);
  const [refs, setRefs] = useState('');
  const [scene, setScene] = useState('');
  const [motion, setMotion] = useState(shot?.animation ?? '');
  const [tool, setTool] = useState('Nano Banana Pro');
  const [videoTool, setVideoTool] = useState('Kling');
  const [saved, setSaved] = useState('');

  const imageStyle = imageStyles.find((s) => s.id === imageStyleId) ?? imageStyles[0];
  const videoStyle = videoStyles.find((s) => s.id === videoStyleId) ?? videoStyles[0];
  const cast = castIds.map((id) => characters?.find((c) => c.id === id)).filter((c): c is Character => !!c);
  const extraRefs = refs.split('\n').map((r) => r.trim()).filter(Boolean);

  const imagePrompt = buildImagePrompt(imageStyle, cast, extraRefs, scene);
  const videoPrompt = buildVideoPrompt(videoStyle, cast, motion);
  const attachments = attachmentsFor(cast, extraRefs);

  const toggle = (id: string) => setCastIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const save = async (type: 'image' | 'video') => {
    await api.create('prompt', {
      projectId,
      shotId: shot?.id ?? '',
      characterId: cast.length === 1 ? cast[0].id : '',
      title: shot ? `${shot.code} · ${type === 'image' ? 'immagine' : 'video'}` : scene.slice(0, 60) || 'Prompt composto',
      type,
      tool: type === 'image' ? tool : videoTool,
      params: type === 'video' ? videoStyle?.params ?? '' : imageStyle?.params ?? '',
      text: type === 'image' ? imagePrompt : videoPrompt,
      negative: type === 'video' ? videoStyle?.avoid ?? '' : imageStyle?.avoid ?? '',
      notes: attachments.length ? `Riferimenti: ${attachments.map((a, i) => `${i + 1}) ${a}`).join(' ')}` : '',
    });
    setSaved(type === 'image' ? 'Prompt immagine salvato nello storico.' : 'Prompt video salvato nello storico.');
  };

  return (
    <div className="composer">
      <div className="composer-inputs form">
        <div className="grid-2">
          <Field label="Stile immagine">
            <Select value={imageStyle?.id ?? ''} onChange={setImageStyleId} options={imageStyles.map((s): [string, string] => [s.id, s.name])} />
          </Field>
          <Field label="Strumento">
            <Select value={tool} onChange={setTool} options={TOOLS.map((t): [string, string] => [t, t])} />
          </Field>
        </div>
        <Field label="Personaggi in scena" hint="L'ordine di selezione è l'ordine delle immagini di riferimento.">
          <div className="chips">
            {(characters ?? [])
              .filter((c) => !c.voiceOnly)
              .map((c) => (
                <button key={c.id} type="button" className={`chip${castIds.includes(c.id) ? ' chip-on' : ''}`} onClick={() => toggle(c.id)}>
                  {castIds.includes(c.id) && <b>{castIds.indexOf(c.id) + 1}</b>}
                  {c.name}
                </button>
              ))}
          </div>
        </Field>
        <Field label="Altri riferimenti" hint="Uno per riga, es. EP01_S09.png (ambiente).">
          <Area value={refs} onChange={setRefs} rows={2} />
        </Field>
        <Field label="Scena (in inglese)">
          <Area value={scene} onChange={setScene} rows={4} placeholder="Over-the-shoulder shot from behind the protagonist…" />
        </Field>
        <div className="grid-2">
          <Field label="Stile video">
            <Select value={videoStyle?.id ?? ''} onChange={setVideoStyleId} options={videoStyles.map((s): [string, string] => [s.id, s.name])} />
          </Field>
          <Field label="Strumento video">
            <Select value={videoTool} onChange={setVideoTool} options={TOOLS.map((t): [string, string] => [t, t])} />
          </Field>
        </div>
        <Field label="Movimento (prompt video)">
          <Text value={motion} onChange={setMotion} placeholder="the phone vibrates, the hand stops" />
        </Field>
      </div>

      <div className="composer-output">
        <div className="out-block">
          <div className="out-head">
            <strong>Prompt immagine</strong>
            <CopyButton text={imagePrompt} />
            <button className="btn btn-small" onClick={() => save('image')} disabled={!imagePrompt}>
              Salva nello storico
            </button>
          </div>
          <p className="prompt-text">{imagePrompt || <span className="muted">Scegli uno stile e scrivi la scena.</span>}</p>
          {attachments.length > 0 && (
            <ol className="attachments">
              {attachments.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ol>
          )}
        </div>
        <div className="out-block">
          <div className="out-head">
            <strong>Prompt video</strong>
            <CopyButton text={videoPrompt} />
            <button className="btn btn-small" onClick={() => save('video')} disabled={!videoPrompt}>
              Salva nello storico
            </button>
          </div>
          <p className="prompt-text">{videoPrompt || <span className="muted">Descrivi il movimento.</span>}</p>
        </div>
        {shot && (
          <button
            className="btn btn-primary"
            onClick={async () => {
              await api.update('shot', shot.id, {
                imagePrompt: scene.trim() ? imagePrompt : shot.imagePrompt,
                videoPrompt: motion.trim() ? videoPrompt : shot.videoPrompt,
                characterIds: castIds,
                refs: attachments.map((a, i) => `${i + 1}) ${a}`).join(' '),
              });
              onApplied?.();
            }}
          >
            Usa per {shot.code}
          </button>
        )}
        {saved && <p className="muted small">{saved}</p>}
      </div>
    </div>
  );
}
