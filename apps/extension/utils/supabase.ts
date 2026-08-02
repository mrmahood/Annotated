import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const AUTH_STORAGE_NAMESPACE = 'annotated:auth:';
const AUTH_STORAGE_KEY = 'supabase-session';

const chrome = (globalThis as typeof globalThis & {
  chrome: typeof browser;
}).chrome;

const chromeLocalStorage = {
  async getItem(key: string) {
    const namespacedKey = `${AUTH_STORAGE_NAMESPACE}${key}`;
    const result = await chrome.storage.local.get(namespacedKey);
    const value = result[namespacedKey];
    return typeof value === 'string' ? value : null;
  },
  async setItem(key: string, value: string) {
    await chrome.storage.local.set({
      [`${AUTH_STORAGE_NAMESPACE}${key}`]: value,
    });
  },
  async removeItem(key: string) {
    await chrome.storage.local.remove(`${AUTH_STORAGE_NAMESPACE}${key}`);
  },
};

let extensionClient: SupabaseClient | undefined;

function getSupabaseEnvironment() {
  const url = import.meta.env.WXT_SUPABASE_URL;
  const publishableKey = import.meta.env.WXT_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      'Supabase is not configured. Set WXT_SUPABASE_URL and WXT_SUPABASE_PUBLISHABLE_KEY in apps/extension/.env.local.',
    );
  }

  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== 'https:' && parsedUrl.hostname !== 'localhost') {
      throw new Error('invalid protocol');
    }
  } catch {
    throw new Error('WXT_SUPABASE_URL must be a valid HTTPS Supabase project URL.');
  }

  return { url, publishableKey };
}

export function getSupabaseClient() {
  if (!extensionClient) {
    const { url, publishableKey } = getSupabaseEnvironment();

    extensionClient = createClient(url, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: 'implicit',
        storage: chromeLocalStorage,
        storageKey: AUTH_STORAGE_KEY,
      },
    });
  }

  return extensionClient;
}
