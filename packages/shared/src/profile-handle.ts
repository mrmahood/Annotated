export const PROFILE_HANDLE_MIN_LENGTH = 3;
export const PROFILE_HANDLE_MAX_LENGTH = 30;
export const PROFILE_HANDLE_PATTERN = /^[a-z0-9_-]{3,30}$/;

export const RESERVED_PROFILE_HANDLES = [
  'api',
  'auth',
  '_next',
  'ops',
  'me',
  'trending',
  'who-to-follow',
  'privacy',
  'terms',
  'legal',
] as const;

const RESERVED_PROFILE_HANDLE_SET: ReadonlySet<string> = new Set(RESERVED_PROFILE_HANDLES);

export const PROFILE_HANDLE_FORMAT_ERROR =
  'A handle must be 3-30 lowercase letters, numbers, underscores, or hyphens.';
export const PROFILE_HANDLE_RESERVED_ERROR =
  'That handle is reserved. Try a different one.';
export const PROFILE_HANDLE_UNAVAILABLE_ERROR =
  'That handle is taken. Try a different one.';
export const PROFILE_HANDLE_AUTH_ERROR = 'Sign in to choose a public handle.';
export const PROFILE_HANDLE_PROFILE_UNAVAILABLE_ERROR =
  'Your Annotated profile is unavailable.';
export const PROFILE_HANDLE_SAVE_ERROR = 'Your handle could not be saved. Try again.';

export type ProfileHandleValidation =
  | { ok: true; handle: string }
  | { ok: false; error: string };

export type ProfileHandleRpcError = {
  message?: string;
  code?: string;
} | null | undefined;

export type ProfileHandleRpcClient = {
  rpc(
    fn: 'set_profile_handle',
    args: { p_handle: string },
  ): PromiseLike<{ data: unknown; error: ProfileHandleRpcError }>;
};

export function isReservedProfileHandle(value: string): boolean {
  return RESERVED_PROFILE_HANDLE_SET.has(value);
}

export function normalizeProfileHandle(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^@+/u, '').toLowerCase();
}

export function validateProfileHandle(value: unknown): ProfileHandleValidation {
  const handle = normalizeProfileHandle(value);
  if (isReservedProfileHandle(handle)) {
    return { ok: false, error: PROFILE_HANDLE_RESERVED_ERROR };
  }
  if (
    !handle ||
    handle.length < PROFILE_HANDLE_MIN_LENGTH ||
    handle.length > PROFILE_HANDLE_MAX_LENGTH ||
    !/^[a-z0-9_-]+$/.test(handle)
  ) {
    return { ok: false, error: PROFILE_HANDLE_FORMAT_ERROR };
  }
  return { ok: true, handle };
}

export function mapSetProfileHandleError(error: ProfileHandleRpcError): string {
  const message = typeof error?.message === 'string' ? error.message : '';
  const code = typeof error?.code === 'string' ? error.code : '';
  if (
    code === '42501' ||
    /authentication is required/i.test(message) ||
    /not authenticated/i.test(message)
  ) {
    return PROFILE_HANDLE_AUTH_ERROR;
  }
  if (/profile is unavailable/i.test(message)) {
    return PROFILE_HANDLE_PROFILE_UNAVAILABLE_ERROR;
  }
  if (code === '23505' || /unavailable/i.test(message)) {
    return PROFILE_HANDLE_UNAVAILABLE_ERROR;
  }
  if (/reserved/i.test(message)) {
    return PROFILE_HANDLE_RESERVED_ERROR;
  }
  if (
    code === '22023' ||
    /3-30 lowercase/i.test(message) ||
    /underscores, or hyphens/i.test(message)
  ) {
    return PROFILE_HANDLE_FORMAT_ERROR;
  }
  return PROFILE_HANDLE_SAVE_ERROR;
}

export async function setProfileHandle(
  client: ProfileHandleRpcClient,
  value: unknown,
): Promise<ProfileHandleValidation> {
  const validated = validateProfileHandle(value);
  if (!validated.ok) return validated;

  try {
    const { data, error } = await client.rpc('set_profile_handle', {
      p_handle: validated.handle,
    });
    if (error) return { ok: false, error: mapSetProfileHandleError(error) };
    if (typeof data === 'string') {
      const confirmed = validateProfileHandle(data);
      if (confirmed.ok) return confirmed;
    }
    return validated;
  } catch (caught) {
    return {
      ok: false,
      error: mapSetProfileHandleError(
        caught instanceof Error ? { message: caught.message } : null,
      ),
    };
  }
}
