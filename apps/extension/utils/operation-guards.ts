import type { CreateMode, CreatePageGeneration, MediaCreateMode } from './create-mode.ts';
import type { CaptureSnapshot, HostedMediaOperation } from './media-capture.ts';
import type { HostedMediaSession } from './hosted-media.ts';

export type OperationGuardPhase =
  | 'idle'
  | 'article-publishing'
  | 'hosted-begin'
  | 'preparing'
  | 'capturing'
  | 'stopping'
  | 'uploading'
  | 'waiting-to-upload'
  | 'verifying-upload'
  | 'processing'
  | 'restart-recovery'
  | 'cancelling';

export type OperationGuardState = {
  phase: OperationGuardPhase;
  hostedMode: MediaCreateMode | null;
  startMs: number | null;
  endMs: number | null;
};

export type ModeSwitchGuard =
  | { action: 'allow' }
  | { action: 'lock'; message: string }
  | {
      action: 'confirm-cancel';
      hostedMode: MediaCreateMode;
      startMs: number;
      endMs: number;
    };

export type ModeSwitchIntent = {
  fromMode: CreateMode;
  toMode: CreateMode;
  pageGeneration: number;
  hostedMode: MediaCreateMode;
  startMs: number;
  endMs: number;
};

export type PlayerActionToken = {
  page: CreatePageGeneration;
  mode: MediaCreateMode;
  draftRevision: number;
  playerIdentity: string;
};

export type HostedAttemptToken = {
  annotationId: string;
  mediaId: string;
  captureId: string | null;
};

type OperationGuardInput = {
  articlePublishing: boolean;
  hostedBeginMode: MediaCreateMode | null;
  hostedSession: HostedMediaSession | null;
  capture: CaptureSnapshot;
  cancelling: boolean;
};

function hostedDetails(session: HostedMediaSession | null) {
  return {
    hostedMode: session?.mediaType ?? null,
    startMs: session?.startMs ?? null,
    endMs: session?.endMs ?? null,
  };
}

export function deriveOperationGuardState(input: OperationGuardInput): OperationGuardState {
  if (input.cancelling) return { phase: 'cancelling', ...hostedDetails(input.hostedSession) };
  if (input.articlePublishing) {
    return { phase: 'article-publishing', hostedMode: null, startMs: null, endMs: null };
  }
  if (input.hostedBeginMode) {
    return {
      phase: 'hosted-begin',
      hostedMode: input.hostedBeginMode,
      startMs: input.hostedSession?.startMs ?? null,
      endMs: input.hostedSession?.endMs ?? null,
    };
  }
  const details = hostedDetails(input.hostedSession);
  if (input.capture.status === 'preparing') return { phase: 'preparing', ...details };
  if (input.capture.status === 'capturing') return { phase: 'capturing', ...details };
  if (input.capture.status === 'stopping') return { phase: 'stopping', ...details };
  if (input.capture.status === 'uploading') return { phase: 'uploading', ...details };
  if (input.capture.status === 'waiting-to-upload') return { phase: 'waiting-to-upload', ...details };
  if (input.capture.status === 'verifying-upload') return { phase: 'verifying-upload', ...details };
  if (input.capture.status === 'processing') return { phase: 'processing', ...details };
  if (input.capture.status === 'error' && input.capture.code === 'upload-failed' && input.capture.captureId) {
    return { phase: 'waiting-to-upload', ...details };
  }
  if (!input.hostedSession) {
    return { phase: 'idle', hostedMode: null, startMs: null, endMs: null };
  }
  return { phase: 'restart-recovery', ...details };
}

export function getModeSwitchGuard(
  state: OperationGuardState,
  currentMode: CreateMode | null,
  requestedMode: CreateMode,
): ModeSwitchGuard {
  if (currentMode === requestedMode) return { action: 'allow' };
  if (state.phase === 'article-publishing') {
    return { action: 'lock', message: 'Finish publishing this text annotation before switching modes.' };
  }
  if (state.phase === 'hosted-begin') {
    return { action: 'lock', message: 'Wait while the hosted-media draft is created before switching modes.' };
  }
  if (state.phase === 'preparing') {
    return { action: 'lock', message: 'Wait while capture preparation finishes before switching modes.' };
  }
  if (state.phase === 'cancelling') {
    return { action: 'lock', message: 'Wait for authoritative cancellation to finish before switching modes.' };
  }
  if (
    state.phase === 'capturing' || state.phase === 'stopping' ||
    state.phase === 'uploading' || state.phase === 'waiting-to-upload' ||
    state.phase === 'verifying-upload'
  ) {
    if (!state.hostedMode || state.startMs === null || state.endMs === null) {
      return { action: 'lock', message: 'The active hosted-media operation must be reconciled before switching modes.' };
    }
    return {
      action: 'confirm-cancel',
      hostedMode: state.hostedMode,
      startMs: state.startMs,
      endMs: state.endMs,
    };
  }
  return { action: 'allow' };
}

export function createModeSwitchIntent(
  guard: Extract<ModeSwitchGuard, { action: 'confirm-cancel' }>,
  fromMode: CreateMode,
  toMode: CreateMode,
  pageGeneration: number,
): ModeSwitchIntent {
  return {
    fromMode,
    toMode,
    pageGeneration,
    hostedMode: guard.hostedMode,
    startMs: guard.startMs,
    endMs: guard.endMs,
  };
}

export function modeSwitchIntentIsCurrent(
  intent: ModeSwitchIntent,
  page: CreatePageGeneration | null,
  selectedMode: CreateMode | null,
): boolean {
  return Boolean(page && page.generation === intent.pageGeneration && selectedMode === intent.fromMode);
}

export function operationLocksMediaEditor(state: OperationGuardState): boolean {
  return !['idle', 'processing', 'restart-recovery'].includes(state.phase);
}

export function createPlayerActionToken(
  page: CreatePageGeneration,
  mode: MediaCreateMode,
  draftRevision: number,
  playerIdentity: string,
): PlayerActionToken {
  return {
    page: { generation: page.generation, identity: { ...page.identity } },
    mode,
    draftRevision,
    playerIdentity,
  };
}

export function playerActionTokenIsCurrent(
  token: PlayerActionToken,
  page: CreatePageGeneration | null,
  draft: { revision: number; playerIdentity: string | null },
): boolean {
  return Boolean(
    page && page.generation === token.page.generation &&
    page.identity.tabId === token.page.identity.tabId &&
    page.identity.windowId === token.page.identity.windowId &&
    page.identity.sourceKey === token.page.identity.sourceKey &&
    draft.revision === token.draftRevision &&
    draft.playerIdentity === token.playerIdentity,
  );
}

export function createHostedAttemptToken(
  operation: HostedMediaOperation,
  captureId: string | null,
): HostedAttemptToken {
  return { annotationId: operation.annotationId, mediaId: operation.mediaId, captureId };
}

export function hostedAttemptTokenIsCurrent(
  token: HostedAttemptToken,
  session: HostedMediaSession | null,
  captureId: string | null,
): boolean {
  return Boolean(
    session && session.operation.annotationId === token.annotationId &&
    session.operation.mediaId === token.mediaId && captureId === token.captureId,
  );
}
