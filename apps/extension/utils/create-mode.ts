import { ANNOTATION_TITLE_MAX_LENGTH } from '@annotated/shared/annotation-title';

export const CREATE_MODES = ['text', 'video', 'audio'] as const;
export type CreateMode = typeof CREATE_MODES[number];
export type MediaCreateMode = Exclude<CreateMode, 'text'>;

export const CREATE_MODE_SELECTION_STORAGE_KEY = 'annotated.createModeSelection.v1';
const CREATE_MODE_SELECTION_VERSION = 1 as const;

export type ModeCapability =
  | { status: 'checking' }
  | { status: 'available' }
  | { status: 'unavailable'; reason: string };

export type ModeCapabilities = Record<CreateMode, ModeCapability>;

export type CreatePageIdentity = {
  tabId: number;
  windowId: number;
  sourceKey: string;
};

export type CreatePageGeneration = {
  generation: number;
  identity: CreatePageIdentity;
};

export type ModeSelectionState = {
  page: CreatePageGeneration;
  capabilities: ModeCapabilities;
  recommendedMode: CreateMode | null;
  selectedMode: CreateMode | null;
  selectedBy: 'automatic' | 'explicit';
};

export type StoredCreateModeSelection = {
  version: typeof CREATE_MODE_SELECTION_VERSION;
  pageIdentity: CreatePageIdentity;
  selectedMode: CreateMode;
};

export type ModeRevisionState = Record<CreateMode, number>;

export type ModeAsyncToken = {
  pageGeneration: number;
  pageIdentity: CreatePageIdentity;
  mode: CreateMode;
  modeRevision: number;
};

export type PlayerReadState = 'idle' | 'reading' | 'error';

export type TextCreateDraftState = {
  title: string;
  commentary: string;
  revision: number;
};

export type MediaCreateDraftState = {
  sourceKey: string | null;
  playerIdentity: string | null;
  startMs: number | null;
  endMs: number | null;
  durationMs: number | null;
  playerTimeMs: number | null;
  title: string;
  commentary: string;
  playerReadState: PlayerReadState;
  revision: number;
};

export type CreateDraftState = {
  text: TextCreateDraftState;
  video: MediaCreateDraftState;
  audio: MediaCreateDraftState;
};

export type MediaDraftPatch = Partial<Omit<MediaCreateDraftState, 'revision'>>;

const MEDIA_CLOCK_SYNC_KEYS = new Set<keyof MediaDraftPatch>(['durationMs', 'playerTimeMs']);

/**
 * Player-token revision tracks user draft/player identity changes, not the
 * live content clock. Publish re-reads duration/playhead immediately before
 * hosted begin; bumping revision for that sync would cancel every clip.
 */
export function mediaDraftPatchRevisesDraft(patch: MediaDraftPatch): boolean {
  for (const key of Object.keys(patch) as Array<keyof MediaDraftPatch>) {
    if (patch[key] === undefined) continue;
    if (!MEDIA_CLOCK_SYNC_KEYS.has(key)) return true;
  }
  return false;
}

export type CreateDraftAction =
  | { type: 'set-text-commentary'; commentary: string }
  | { type: 'set-text-title'; title: string }
  | { type: 'patch-media'; mode: MediaCreateMode; patch: MediaDraftPatch }
  | { type: 'set-player-read-state'; mode: MediaCreateMode; state: PlayerReadState }
  | { type: 'restore-media'; mode: MediaCreateMode; sourceKey: string; startMs: number | null; endMs: number | null; commentary: string; title: string }
  | { type: 'reset-mode'; mode: CreateMode }
  | { type: 'advance-revision'; mode: CreateMode };

const COMMENTARY_LIMIT = 2_000;
const CAPABILITY_REASON_LIMIT = 160;

const EMPTY_MEDIA_DRAFT: Omit<MediaCreateDraftState, 'revision'> = {
  sourceKey: null,
  playerIdentity: null,
  startMs: null,
  endMs: null,
  durationMs: null,
  playerTimeMs: null,
  title: '',
  commentary: '',
  playerReadState: 'idle',
};

export function createInitialModeCapabilities(): ModeCapabilities {
  return {
    text: { status: 'checking' },
    video: { status: 'checking' },
    audio: { status: 'checking' },
  };
}

export function createInitialModeRevisions(): ModeRevisionState {
  return { text: 0, video: 0, audio: 0 };
}

export function createInitialDraftState(): CreateDraftState {
  return {
    text: { title: '', commentary: '', revision: 0 },
    video: { ...EMPTY_MEDIA_DRAFT, revision: 0 },
    audio: { ...EMPTY_MEDIA_DRAFT, revision: 0 },
  };
}

function isPageIdentity(value: CreatePageIdentity): boolean {
  return (
    Number.isInteger(value.tabId) && value.tabId >= 0 &&
    Number.isInteger(value.windowId) && value.windowId >= 0 &&
    typeof value.sourceKey === 'string' &&
    value.sourceKey.trim().length > 0 &&
    value.sourceKey.length <= 2_048
  );
}

function isCreateMode(value: unknown): value is CreateMode {
  return typeof value === 'string' && CREATE_MODES.includes(value as CreateMode);
}

export function serializeCreateModeSelection(
  pageIdentity: CreatePageIdentity,
  selectedMode: CreateMode,
): StoredCreateModeSelection {
  if (!isPageIdentity(pageIdentity) || !isCreateMode(selectedMode)) {
    throw new Error('The stored Create mode selection is invalid.');
  }
  return {
    version: CREATE_MODE_SELECTION_VERSION,
    pageIdentity: { ...pageIdentity },
    selectedMode,
  };
}

export function deserializeCreateModeSelection(value: unknown): StoredCreateModeSelection | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const identity = row.pageIdentity;
  if (
    row.version !== CREATE_MODE_SELECTION_VERSION ||
    typeof identity !== 'object' || identity === null || Array.isArray(identity)
  ) return null;
  const pageIdentity = identity as Record<string, unknown>;
  if (
    typeof pageIdentity.tabId !== 'number' ||
    typeof pageIdentity.windowId !== 'number' ||
    typeof pageIdentity.sourceKey !== 'string'
  ) return null;
  const parsedIdentity: CreatePageIdentity = {
    tabId: pageIdentity.tabId,
    windowId: pageIdentity.windowId,
    sourceKey: pageIdentity.sourceKey,
  };
  if (!isPageIdentity(parsedIdentity) || !isCreateMode(row.selectedMode)) return null;
  return {
    version: CREATE_MODE_SELECTION_VERSION,
    pageIdentity: parsedIdentity,
    selectedMode: row.selectedMode,
  };
}

export function storedCreateModeSelectionMatches(
  selection: StoredCreateModeSelection,
  pageIdentity: CreatePageIdentity,
): boolean {
  return pageIdentityMatches(selection.pageIdentity, pageIdentity);
}

export function pageIdentityMatches(
  first: CreatePageIdentity,
  second: CreatePageIdentity,
): boolean {
  return (
    first.tabId === second.tabId &&
    first.windowId === second.windowId &&
    first.sourceKey === second.sourceKey
  );
}

export function updatePageGeneration(
  current: CreatePageGeneration | null,
  identity: CreatePageIdentity,
): CreatePageGeneration {
  if (!isPageIdentity(identity)) throw new Error('The Create page identity is invalid.');
  if (current && pageIdentityMatches(current.identity, identity)) return current;
  return {
    generation: (current?.generation ?? 0) + 1,
    identity: { ...identity },
  };
}

function isAvailable(capability: ModeCapability): boolean {
  return capability.status === 'available';
}

function validateModeCapabilities(capabilities: ModeCapabilities): void {
  for (const mode of CREATE_MODES) {
    const capability = capabilities[mode] as ModeCapability | undefined;
    if (!capability || (
      capability.status !== 'checking' &&
      capability.status !== 'available' &&
      capability.status !== 'unavailable'
    )) {
      throw new Error('The Create mode capability is invalid.');
    }
    if (
      capability.status === 'unavailable' &&
      (!capability.reason.trim() || capability.reason.length > CAPABILITY_REASON_LIMIT)
    ) {
      throw new Error('The Create mode capability reason is invalid.');
    }
  }
}

export function getRecommendedMode(
  capabilities: ModeCapabilities,
  preferText = false,
): CreateMode | null {
  validateModeCapabilities(capabilities);
  if (preferText && isAvailable(capabilities.text)) return 'text';
  if (isAvailable(capabilities.video)) return 'video';
  if (isAvailable(capabilities.audio)) return 'audio';
  if (isAvailable(capabilities.text)) return 'text';
  return null;
}

export function createModeSelectionState(
  page: CreatePageGeneration,
  capabilities: ModeCapabilities,
  preferText = false,
): ModeSelectionState {
  validateModeCapabilities(capabilities);
  const recommendedMode = getRecommendedMode(capabilities, preferText);
  return {
    page,
    capabilities,
    recommendedMode,
    selectedMode: recommendedMode,
    selectedBy: 'automatic',
  };
}

export function updateModeCapabilities(
  state: ModeSelectionState,
  capabilities: ModeCapabilities,
  preferText = false,
): ModeSelectionState {
  validateModeCapabilities(capabilities);
  const recommendedMode = getRecommendedMode(capabilities, preferText);
  const currentCapability = state.selectedMode
    ? capabilities[state.selectedMode]
    : null;
  const preserveExplicit = (
    state.selectedBy === 'explicit' &&
    state.selectedMode !== null &&
    currentCapability?.status !== 'unavailable'
  );
  const preserveWhileChecking = (
    state.selectedMode !== null &&
    currentCapability?.status === 'checking'
  );
  const preserveSelection = preserveExplicit || preserveWhileChecking;
  return {
    ...state,
    capabilities,
    recommendedMode,
    selectedMode: preserveSelection ? state.selectedMode : recommendedMode,
    selectedBy: preserveSelection ? state.selectedBy : 'automatic',
  };
}

export function selectCreateMode(
  state: ModeSelectionState,
  mode: CreateMode,
): ModeSelectionState {
  if (!isAvailable(state.capabilities[mode])) return state;
  return { ...state, selectedMode: mode, selectedBy: 'explicit' };
}

export function moveSelectionToPage(
  state: ModeSelectionState,
  page: CreatePageGeneration,
  capabilities: ModeCapabilities,
  preferText = false,
): ModeSelectionState {
  if (
    state.page.generation === page.generation &&
    pageIdentityMatches(state.page.identity, page.identity)
  ) {
    return updateModeCapabilities(state, capabilities, preferText);
  }
  return createModeSelectionState(page, capabilities, preferText);
}

export function advanceModeRevision(
  revisions: ModeRevisionState,
  mode: CreateMode,
): ModeRevisionState {
  return { ...revisions, [mode]: revisions[mode] + 1 };
}

export function createModeAsyncToken(
  page: CreatePageGeneration,
  revisions: ModeRevisionState,
  mode: CreateMode,
): ModeAsyncToken {
  return {
    pageGeneration: page.generation,
    pageIdentity: { ...page.identity },
    mode,
    modeRevision: revisions[mode],
  };
}

export function isModeAsyncTokenCurrent(
  token: ModeAsyncToken,
  page: CreatePageGeneration,
  revisions: ModeRevisionState,
): boolean {
  return (
    token.pageGeneration === page.generation &&
    pageIdentityMatches(token.pageIdentity, page.identity) &&
    token.modeRevision === revisions[token.mode]
  );
}

function validCommentary(value: string): boolean {
  return value.length <= COMMENTARY_LIMIT;
}

function validTitle(value: string): boolean {
  return value.length <= ANNOTATION_TITLE_MAX_LENGTH;
}

function validTime(value: number | null): boolean {
  return value === null || (Number.isSafeInteger(value) && value >= 0);
}

function validateMediaPatch(patch: MediaDraftPatch): void {
  if (patch.commentary !== undefined && !validCommentary(patch.commentary)) {
    throw new Error('The Create commentary is invalid.');
  }
  if (patch.title !== undefined && !validTitle(patch.title)) {
    throw new Error('The Create title is invalid.');
  }
  for (const key of ['startMs', 'endMs', 'durationMs', 'playerTimeMs'] as const) {
    if (patch[key] !== undefined && !validTime(patch[key])) {
      throw new Error('The Create media time is invalid.');
    }
  }
  if (
    patch.playerReadState !== undefined &&
    patch.playerReadState !== 'idle' &&
    patch.playerReadState !== 'reading' &&
    patch.playerReadState !== 'error'
  ) {
    throw new Error('The Create player read state is invalid.');
  }
  if (
    (patch.sourceKey !== undefined && patch.sourceKey !== null && !patch.sourceKey.trim()) ||
    (patch.playerIdentity !== undefined && patch.playerIdentity !== null && !patch.playerIdentity.trim())
  ) {
    throw new Error('The Create media identity is invalid.');
  }
}

export function reduceCreateDraftState(
  state: CreateDraftState,
  action: CreateDraftAction,
): CreateDraftState {
  if (action.type === 'set-text-commentary') {
    if (!validCommentary(action.commentary)) throw new Error('The Create commentary is invalid.');
    return {
      ...state,
      text: {
        ...state.text,
        commentary: action.commentary,
        revision: state.text.revision + 1,
      },
    };
  }
  if (action.type === 'set-text-title') {
    if (!validTitle(action.title)) throw new Error('The Create title is invalid.');
    return {
      ...state,
      text: {
        ...state.text,
        title: action.title,
        revision: state.text.revision + 1,
      },
    };
  }
  if (action.type === 'patch-media') {
    validateMediaPatch(action.patch);
    const current = state[action.mode];
    return {
      ...state,
      [action.mode]: {
        ...current,
        ...action.patch,
        revision: mediaDraftPatchRevisesDraft(action.patch)
          ? current.revision + 1
          : current.revision,
      },
    };
  }
  if (action.type === 'set-player-read-state') {
    validateMediaPatch({ playerReadState: action.state });
    return {
      ...state,
      [action.mode]: {
        ...state[action.mode],
        playerReadState: action.state,
      },
    };
  }
  if (action.type === 'restore-media') {
    validateMediaPatch(action);
    const current = state[action.mode];
    return {
      ...state,
      [action.mode]: {
        ...EMPTY_MEDIA_DRAFT,
        sourceKey: action.sourceKey,
        startMs: action.startMs,
        endMs: action.endMs,
        title: action.title,
        commentary: action.commentary,
        revision: current.revision + 1,
      },
    };
  }
  if (action.type === 'reset-mode') {
    if (action.mode === 'text') {
      return {
        ...state,
        text: { title: '', commentary: '', revision: state.text.revision + 1 },
      };
    }
    return {
      ...state,
      [action.mode]: {
        ...EMPTY_MEDIA_DRAFT,
        revision: state[action.mode].revision + 1,
      },
    };
  }
  if (action.mode === 'text') {
    return {
      ...state,
      text: { ...state.text, revision: state.text.revision + 1 },
    };
  }
  return {
    ...state,
    [action.mode]: {
      ...state[action.mode],
      revision: state[action.mode].revision + 1,
    },
  };
}

export function hasCreateModeDraft(
  state: CreateDraftState,
  mode: CreateMode,
): boolean {
  if (mode === 'text') {
    return state.text.commentary.trim().length > 0 || state.text.title.trim().length > 0;
  }
  const draft = state[mode];
  return (
    draft.commentary.trim().length > 0 ||
    draft.title.trim().length > 0 ||
    draft.startMs !== null ||
    draft.endMs !== null
  );
}
