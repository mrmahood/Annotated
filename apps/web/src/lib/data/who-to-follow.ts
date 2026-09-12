import { getHttpUrl, getOptionalText, isUuid } from "../public-content.ts";

const WHO_TO_FOLLOW_HANDLE_PATTERN = /^[a-z0-9_-]{3,30}$/;
const WHO_TO_FOLLOW_RESERVED_HANDLES = new Set([
  "api",
  "auth",
  "_next",
  "ops",
  "me",
  "trending",
  "who-to-follow",
]);

export const WHO_TO_FOLLOW_MAX = 5;
export const WHO_TO_FOLLOW_MIN_VISIBLE = 1;
export const WHO_TO_FOLLOW_PATH = "/who-to-follow";

export const WHO_TO_FOLLOW_SEED_HANDLES = [
  "jason",
  "davidscornik",
  "chamath",
  "friedberg",
  "matt",
] as const;

export const WHO_TO_FOLLOW_SEED_PROFILE_IDS = [
  "3e3882b6-7c94-46aa-9a6d-583b734536e2",
] as const;

export type WhoToFollowProfile = {
  profileId: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

export function normalizeWhoToFollowHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const handle = value.trim().replace(/^@+/u, "").toLowerCase();
  return WHO_TO_FOLLOW_HANDLE_PATTERN.test(handle)
      && !WHO_TO_FOLLOW_RESERVED_HANDLES.has(handle)
    ? handle
    : null;
}

export function uniqueWhoToFollowHandles(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const handles: string[] = [];
  for (const value of values) {
    const handle = normalizeWhoToFollowHandle(value);
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    handles.push(handle);
  }
  return handles;
}

export function parseWhoToFollowProfile(value: unknown): WhoToFollowProfile | null {
  if (!isRecord(value)) return null;
  const profileId = getOptionalText(value.id);
  const handle = normalizeWhoToFollowHandle(value.username);
  const displayName = getOptionalText(value.display_name) ?? "Annotated reader";
  if (!profileId || !isUuid(profileId) || !handle) return null;
  return {
    profileId,
    displayName,
    handle,
    avatarUrl: getHttpUrl(value.avatar_url)?.href ?? null,
  };
}

export function collectWhoToFollowProfiles(input: {
  handleRows: unknown[];
  idRows: unknown[];
  seedHandles: readonly string[];
  seedIds: readonly string[];
}): WhoToFollowProfile[] {
  const byHandle = new Map<string, WhoToFollowProfile>();
  const byId = new Map<string, WhoToFollowProfile>();
  for (const row of [...input.handleRows, ...input.idRows]) {
    const profile = parseWhoToFollowProfile(row);
    if (!profile) continue;
    byHandle.set(profile.handle, profile);
    byId.set(profile.profileId, profile);
  }

  const ordered: WhoToFollowProfile[] = [];
  const seen = new Set<string>();
  for (const seed of input.seedHandles) {
    const handle = normalizeWhoToFollowHandle(seed);
    const profile = handle ? byHandle.get(handle) : undefined;
    if (!profile || seen.has(profile.profileId)) continue;
    seen.add(profile.profileId);
    ordered.push(profile);
  }
  for (const seedId of input.seedIds) {
    const profile = isUuid(seedId) ? byId.get(seedId) : undefined;
    if (!profile || seen.has(profile.profileId)) continue;
    seen.add(profile.profileId);
    ordered.push(profile);
  }
  return ordered;
}

export function selectWhoToFollowSuggestions(
  resolved: readonly WhoToFollowProfile[],
  options: { viewerId: string | null; followedIds: ReadonlySet<string> },
): WhoToFollowProfile[] {
  const selected: WhoToFollowProfile[] = [];
  const seen = new Set<string>();
  for (const profile of resolved) {
    if (seen.has(profile.profileId)) continue;
    if (options.viewerId && profile.profileId === options.viewerId) continue;
    if (options.followedIds.has(profile.profileId)) continue;
    seen.add(profile.profileId);
    selected.push(profile);
    if (selected.length >= WHO_TO_FOLLOW_MAX) break;
  }
  return selected;
}

export function shouldShowWhoToFollowRail(count: number): boolean {
  return Number.isSafeInteger(count) && count >= WHO_TO_FOLLOW_MIN_VISIBLE;
}

export function getWhoToFollowProfilePath(profileId: string): string {
  if (!isUuid(profileId)) {
    throw new Error("Invalid Who to Follow profile identity.");
  }
  return `/p/${profileId}`;
}
