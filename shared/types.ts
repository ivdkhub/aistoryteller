// Tipi condivisi tra server e interfaccia.

export type Kind = 'account' | 'project' | 'character' | 'style' | 'episode' | 'shot' | 'prompt' | 'idea';

export const KINDS: Kind[] = ['account', 'project', 'character', 'style', 'episode', 'shot', 'prompt', 'idea'];

export interface Base {
  id: string;
  kind: Kind;
  createdAt: string;
  updatedAt: string;
}

export interface Account extends Base {
  kind: 'account';
  name: string;
  handle: string;
  niche: string;
  bio: string;
  color: string;
  avatar: string;
  notes: string;
  /** Profilo satellite di un altro account (es. il profilo di un personaggio). */
  parentAccountId: string;
  /** Personaggio che "gestisce" il profilo. */
  linkedCharacterId: string;
}

export type ProjectType = 'base' | 'characters' | 'ai_influencer';
export type ProjectStatus = 'idea' | 'production' | 'published' | 'archived';

export interface Brand {
  persona: string;
  toneOfVoice: string;
  values: string;
  pillars: string;
  donts: string;
  palette: string;
  outfits: string;
  hashtags: string;
}

export interface Project extends Base {
  kind: 'project';
  accountId: string;
  title: string;
  type: ProjectType;
  status: ProjectStatus;
  logline: string;
  /** Bibbia della serie (markdown): verità, regole, numeri fissi, punti aperti. */
  bible: string;
  /** Cartella del progetto sul disco, usata dallo scanner dei file. */
  folder: string;
  brand: Brand;
  notes: string;
}

export interface RefImage {
  path: string;
  label: string;
}

export interface Voice {
  tool: string;
  name: string;
  description: string;
  design: string;
}

export interface Character extends Base {
  kind: 'character';
  accountId: string;
  projectId: string;
  name: string;
  age: string;
  role: string;
  /** Descrizione fissa (EN) da incollare in ogni prompt. */
  fixedDescription: string;
  personality: string;
  arc: string;
  continuityRules: string[];
  voice: Voice;
  images: RefImage[];
  /** Personaggio solo voce (narratore, chiamante...). */
  voiceOnly: boolean;
  notes: string;
}

export type StyleTarget = 'image' | 'video';

export interface StylePreset extends Base {
  kind: 'style';
  accountId: string;
  projectId: string;
  name: string;
  target: StyleTarget;
  prefix: string;
  avoid: string;
  params: string;
}

export type EpisodeFormat = 'reel' | 'carousel' | 'post' | 'story';
export type EpisodeStatus = 'idea' | 'writing' | 'production' | 'editing' | 'ready' | 'published';

export interface Revision {
  id: string;
  text: string;
  done: boolean;
  date: string;
}

export interface Metrics {
  views: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
}

export interface Vote {
  options: string[];
  winner: string;
  percent: string;
  notes: string;
}

export interface Episode extends Base {
  kind: 'episode';
  accountId: string;
  projectId: string;
  /** Account su cui esce (vuoto = account del progetto). */
  publishAccountId: string;
  code: string;
  number: number;
  title: string;
  format: EpisodeFormat;
  status: EpisodeStatus;
  duration: string;
  publishDate: string;
  info: string;
  voices: string;
  caption: string;
  hashtags: string;
  cta: string;
  vote: Vote;
  branches: string[];
  stateVars: Record<string, string>;
  script: string;
  revisions: Revision[];
  metrics: Metrics;
  /** Episodio a cui è legato (per i post del profilo satellite). */
  linkedEpisodeId: string;
  /** Tappe di produzione spuntate a mano (chiave della tappa → fatto). */
  checklist: Record<string, boolean>;
  notes: string;
}

export type ShotStatus = 'todo' | 'image' | 'video' | 'edited' | 'discarded';
export type AnimPriority = '' | 'alta' | 'media' | 'bassa';

export interface Shot extends Base {
  kind: 'shot';
  accountId: string;
  projectId: string;
  episodeId: string;
  code: string;
  title: string;
  order: number;
  characterIds: string[];
  refs: string;
  imagePrompt: string;
  videoPrompt: string;
  animPriority: AnimPriority;
  animation: string;
  graphics: string;
  line: string;
  note: string;
  editing: string;
  cut: string;
  imageFile: string;
  videoFile: string;
  alternates: string[];
  status: ShotStatus;
  noImage: boolean;
}

export type PromptType = 'image' | 'video' | 'voice' | 'other';
export type PromptOutcome = 'draft' | 'used' | 'discarded' | 'previous';

export interface Prompt extends Base {
  kind: 'prompt';
  accountId: string;
  projectId: string;
  shotId: string;
  characterId: string;
  title: string;
  type: PromptType;
  tool: string;
  params: string;
  text: string;
  negative: string;
  rating: number;
  outcome: PromptOutcome;
  resultFile: string;
  notes: string;
}

export type IdeaStatus = 'inbox' | 'develop' | 'used' | 'discarded';

export interface Idea extends Base {
  kind: 'idea';
  accountId: string;
  projectId: string;
  title: string;
  description: string;
  tags: string[];
  status: IdeaStatus;
}

export type Item = Account | Project | Character | StylePreset | Episode | Shot | Prompt | Idea;

export interface ItemByKind {
  account: Account;
  project: Project;
  character: Character;
  style: StylePreset;
  episode: Episode;
  shot: Shot;
  prompt: Prompt;
  idea: Idea;
}

export type Draft<K extends Kind> = Omit<ItemByKind[K], keyof Base>;

export const TOOLS = ['Nano Banana Pro', 'Kling', 'Flow', 'ElevenLabs', 'Midjourney', 'Flux', 'Runway', 'Sora', 'ChatGPT', 'Altro'];

const DEFAULTS: { [K in Kind]: Draft<K> } = {
  account: {
    name: '', handle: '', niche: '', bio: '', color: '#d4a53c', avatar: '', notes: '',
    parentAccountId: '', linkedCharacterId: '',
  },
  project: {
    accountId: '', title: '', type: 'base', status: 'idea', logline: '', bible: '', folder: '', notes: '',
    brand: { persona: '', toneOfVoice: '', values: '', pillars: '', donts: '', palette: '', outfits: '', hashtags: '' },
  },
  character: {
    accountId: '', projectId: '', name: '', age: '', role: '', fixedDescription: '', personality: '', arc: '',
    continuityRules: [], voice: { tool: 'ElevenLabs', name: '', description: '', design: '' }, images: [],
    voiceOnly: false, notes: '',
  },
  style: { accountId: '', projectId: '', name: '', target: 'image', prefix: '', avoid: '', params: '' },
  episode: {
    accountId: '', projectId: '', publishAccountId: '', code: '', number: 0, title: '', format: 'reel', status: 'idea',
    duration: '', publishDate: '', info: '', voices: '', caption: '', hashtags: '', cta: '',
    vote: { options: [], winner: '', percent: '', notes: '' }, branches: [], stateVars: {}, script: '',
    revisions: [], metrics: { views: 0, likes: 0, comments: 0, saves: 0, shares: 0 }, linkedEpisodeId: '', checklist: {}, notes: '',
  },
  shot: {
    accountId: '', projectId: '', episodeId: '', code: '', title: '', order: 0, characterIds: [], refs: '',
    imagePrompt: '', videoPrompt: '', animPriority: '', animation: '', graphics: '', line: '', note: '', editing: '',
    cut: '', imageFile: '', videoFile: '', alternates: [], status: 'todo', noImage: false,
  },
  prompt: {
    accountId: '', projectId: '', shotId: '', characterId: '', title: '', type: 'image', tool: 'Nano Banana Pro',
    params: '', text: '', negative: '', rating: 0, outcome: 'draft', resultFile: '', notes: '',
  },
  idea: { accountId: '', projectId: '', title: '', description: '', tags: [], status: 'inbox' },
};

/** Valori di default di un tipo: il server li fonde con i dati in arrivo. */
export function defaults<K extends Kind>(kind: K): Draft<K> {
  return structuredClone(DEFAULTS[kind]);
}

export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  base: 'Progetto base',
  characters: 'Progetto con personaggi',
  ai_influencer: 'AI Influencer',
};

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  idea: 'Idea',
  production: 'In produzione',
  published: 'Pubblicato',
  archived: 'Archiviato',
};

export const SHOT_STATUS_LABEL: Record<ShotStatus, string> = {
  todo: 'Da generare',
  image: 'Immagine ok',
  video: 'Video ok',
  edited: 'Montato',
  discarded: 'Scartato',
};

export const EPISODE_STATUS_LABEL: Record<EpisodeStatus, string> = {
  idea: 'Idea',
  writing: 'Scrittura',
  production: 'In produzione',
  editing: 'Montaggio',
  ready: 'Pronto',
  published: 'Pubblicato',
};

export const EPISODE_FORMAT_LABEL: Record<EpisodeFormat, string> = {
  reel: 'Reel',
  carousel: 'Carosello',
  post: 'Post',
  story: 'Story',
};

export const IDEA_STATUS_LABEL: Record<IdeaStatus, string> = {
  inbox: 'Inbox',
  develop: 'Da sviluppare',
  used: 'Usata',
  discarded: 'Scartata',
};

export const PROMPT_OUTCOME_LABEL: Record<PromptOutcome, string> = {
  draft: 'Bozza',
  used: 'Usato',
  discarded: 'Scartato',
  previous: 'Versione precedente',
};
