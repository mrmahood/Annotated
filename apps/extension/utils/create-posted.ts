import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getPublicAnnotationPath,
  isUuid,
  parsePublicAnnotationRoute,
  type PublicAnnotationRoute,
} from './social-helpers.ts';

export const CREATE_POSTED_CONFIRMATION_STORAGE_KEY = 'annotated.createPosted.confirmation.v1';

const chrome = (globalThis as typeof globalThis & {
  chrome: typeof browser;
}).chrome;

export type CreatePostedKind = 'text' | 'video' | 'audio';

export type CreatePostedConfirmation = {
  annotationId: string;
  kind: CreatePostedKind;
  publicPath: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createPostedKindFromMediaType(mediaType: 'video' | 'audio'): CreatePostedKind {
  return mediaType === 'audio' ? 'audio' : 'video';
}

export function createPostedConfirmation(input: {
  annotationId: string;
  kind: CreatePostedKind;
  creatorHandle?: string | null;
  annotationSlug?: string | null;
}): CreatePostedConfirmation {
  const route = parsePublicAnnotationRoute(
    input.creatorHandle ?? null,
    input.annotationSlug ?? null,
  );
  return {
    annotationId: input.annotationId,
    kind: input.kind,
    publicPath: getPublicAnnotationPath(route ?? null, input.annotationId),
  };
}

export function isCreatePostedConfirmation(value: unknown): value is CreatePostedConfirmation {
  return isRecord(value) &&
    isUuid(value.annotationId) &&
    (value.kind === 'text' || value.kind === 'video' || value.kind === 'audio') &&
    typeof value.publicPath === 'string' &&
    value.publicPath.startsWith('/');
}

export async function persistCreatePostedConfirmation(
  confirmation: CreatePostedConfirmation | null,
) {
  if (!confirmation) {
    await chrome.storage.session.remove(CREATE_POSTED_CONFIRMATION_STORAGE_KEY);
    return;
  }
  await chrome.storage.session.set({
    [CREATE_POSTED_CONFIRMATION_STORAGE_KEY]: confirmation,
  });
}

export async function readCreatePostedConfirmation(): Promise<CreatePostedConfirmation | null> {
  const stored = await chrome.storage.session.get(CREATE_POSTED_CONFIRMATION_STORAGE_KEY);
  const value = stored[CREATE_POSTED_CONFIRMATION_STORAGE_KEY];
  return isCreatePostedConfirmation(value) ? value : null;
}

export async function queryPostedAnnotationRoute(
  supabase: SupabaseClient,
  annotationId: string,
): Promise<PublicAnnotationRoute | null> {
  if (!isUuid(annotationId)) return null;
  const { data, error } = await supabase
    .from('annotations')
    .select('slug, creator:profiles!annotations_user_id_fkey(username)')
    .eq('id', annotationId)
    .maybeSingle();
  if (error || !isRecord(data)) return null;
  const creator = Array.isArray(data.creator) ? data.creator[0] : data.creator;
  const username = isRecord(creator) ? creator.username : null;
  const route = parsePublicAnnotationRoute(username ?? null, data.slug ?? null);
  return route ?? null;
}
