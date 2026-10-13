import { pathToFileURL } from 'node:url';

const DEMO_PATH = '/demo/passage-highlight';
const DEMO_QUOTE =
  'The harbor commission recorded that the amber lighthouse kept its beam on the north channel through the night watch.';
const DEMO_PREFIX_SENTENCE =
  'A later note said the amber lighthouse kept its beam on the south shoal until dawn.';
const DEMO_SUFFIX_SENTENCE =
  'The record is the passage this demo annotation marks.';
const DEMO_TEXT_PREFIX = `${DEMO_PREFIX_SENTENCE} `;
const DEMO_TEXT_SUFFIX = ` ${DEMO_SUFFIX_SENTENCE}`;
const DEMO_COMMENTARY =
  'The night watch kept the north channel lit. This demo annotation marks the harbor log.';
const DEMO_TITLE = 'North channel log';
const DEMO_PAGE_HEADING = 'Harbor night watch';

const PRODUCTION_PROJECT_REF = 'vnxjktpdzmykmqrqwvks';
const STAGING_PROJECT_REF = 'nkkunkwirvfwhmpwonqz';
const PRODUCTION_HOSTS = new Set([
  'annotated.cbandcoop.com',
  'www.annotated.cbandcoop.com',
]);
const DEMO_USER_ID = 'b1000000-0000-4000-8000-0000000000b1';
const DEMO_EMAIL = 'passage-highlight-demo@example.com';

const TRACKING_PARAMETERS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
]);

export function normalizeDemoPageUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The demo page URL must use HTTP or HTTPS.');
  }
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';
  for (const parameter of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMETERS.has(parameter.toLowerCase())) url.searchParams.delete(parameter);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}

export function assertSeedTargetAllowed(supabaseUrl, pageUrl) {
  const supabase = new URL(supabaseUrl);
  const page = normalizeDemoPageUrl(pageUrl);
  if (supabase.protocol !== 'http:' && supabase.protocol !== 'https:') {
    throw new Error('The Supabase URL must use HTTP or HTTPS.');
  }
  const project = `${supabase.href} ${supabase.hostname}`;
  if (project.includes(PRODUCTION_PROJECT_REF) || PRODUCTION_HOSTS.has(page.hostname)) {
    throw new Error('Refusing to seed Production. Use Local or Staging.');
  }
  if (page.pathname !== DEMO_PATH) {
    throw new Error(`The demo annotation can only be seeded on ${DEMO_PATH}.`);
  }
  return { supabase, page };
}

function redact(text, secret) {
  const value = String(text);
  return secret ? value.split(secret).join('[redacted]') : value;
}

function readPageUrl(argv) {
  const index = argv.indexOf('--url');
  const value = index >= 0 ? argv[index + 1] : 'http://127.0.0.1:3000/demo/passage-highlight';
  if (!value || value.startsWith('--')) throw new Error('Pass --url with the demo page URL.');
  return value;
}

async function api(supabaseUrl, key, path, options = {}) {
  const response = await fetch(new URL(path, supabaseUrl), {
    ...options,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!response.ok) {
    const message = typeof body === 'string' ? body : JSON.stringify(body);
    throw new Error(`${response.status} ${redact(message, key)}`);
  }
  return body;
}

async function resolveUser(supabaseUrl, key) {
  try {
    const created = await api(supabaseUrl, key, '/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        id: DEMO_USER_ID,
        email: DEMO_EMAIL,
        email_confirm: true,
        user_metadata: { full_name: 'Passage Highlight Demo' },
      }),
    });
    return created.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith('422') && !message.startsWith('409') && !message.includes('already')) {
      throw error;
    }
  }
  const listed = await api(
    supabaseUrl,
    key,
    `/auth/v1/admin/users?page=1&per_page=200&filter=${encodeURIComponent(DEMO_EMAIL)}`,
  );
  const users = Array.isArray(listed?.users) ? listed.users : [];
  const match = users.find((user) => user?.email?.toLowerCase() === DEMO_EMAIL);
  if (!match?.id) throw new Error('The demo user could not be created or found.');
  return match.id;
}

async function resolveSource(supabaseUrl, key, pageUrl) {
  const created = await api(supabaseUrl, key, '/rest/v1/sources?on_conflict=normalized_url,source_type', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      normalized_url: pageUrl,
      canonical_url: pageUrl,
      source_type: 'article',
      title: DEMO_PAGE_HEADING,
    }),
  });
  const source = Array.isArray(created) ? created[0] : created;
  if (!source?.id) throw new Error('The demo source could not be saved.');
  return source.id;
}

async function insertPublishedAnnotation(supabaseUrl, key, body) {
  try {
    return await api(supabaseUrl, key, '/rest/v1/annotations', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!body.verdict || !/verdict/i.test(message) || !/(42703|PGRST204|does not exist|schema cache)/i.test(message)) {
      throw error;
    }
    const withoutVerdict = { ...body };
    delete withoutVerdict.verdict;
    return api(supabaseUrl, key, '/rest/v1/annotations', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify(withoutVerdict),
    });
  }
}

async function seedPassage(supabaseUrl, key, pageUrl) {
  const userId = await resolveUser(supabaseUrl, key);
  const sourceId = await resolveSource(supabaseUrl, key, pageUrl);
  const existing = await api(
    supabaseUrl,
    key,
    `/rest/v1/annotations?select=id,target:annotation_targets(selected_text)&source_id=eq.${sourceId}&user_id=eq.${userId}&annotation_type=eq.article_text&status=eq.published`,
  );
  const current = (Array.isArray(existing) ? existing : []).find((annotation) => {
    const target = annotation.target;
    const selected = Array.isArray(target) ? target[0]?.selected_text : target?.selected_text;
    return selected === DEMO_QUOTE;
  });
  let annotationId = current?.id;
  if (!annotationId) {
    const inserted = await insertPublishedAnnotation(supabaseUrl, key, {
      source_id: sourceId,
      user_id: userId,
      annotation_type: 'article_text',
      commentary_text: DEMO_COMMENTARY,
      title: DEMO_TITLE,
      status: 'published',
      published_at: new Date().toISOString(),
      verdict: 'true',
    });
    annotationId = (Array.isArray(inserted) ? inserted[0] : inserted)?.id;
  }
  if (!annotationId) throw new Error('The demo annotation could not be saved.');
  if (!current) {
    await api(supabaseUrl, key, '/rest/v1/annotation_targets', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({
        annotation_id: annotationId,
        target_type: 'text',
        selected_text: DEMO_QUOTE,
        text_prefix: DEMO_TEXT_PREFIX,
        text_suffix: DEMO_TEXT_SUFFIX,
      }),
    });
  }
  return { annotationId, pageUrl };
}

function projectRefFromServiceRole(token) {
  if (typeof token !== 'string' || token.length === 0) return '';
  const part = token.split('.')[1];
  if (!part) return '';
  try {
    const json = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return typeof json.ref === 'string' ? json.ref : '';
  } catch {
    return '';
  }
}

export function readSeedCredentials(env, supabaseUrl) {
  if (!supabaseUrl) throw new Error('Set SUPABASE_URL for Local or Staging.');
  const host = new URL(supabaseUrl).hostname;
  const staging = host === `${STAGING_PROJECT_REF}.supabase.co`;
  const stagingKey = env.SUPABASE_STAGING_SERVICE_ROLE_KEY || '';
  const genericKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  const key = staging && stagingKey ? stagingKey : genericKey;
  if (!key) {
    throw new Error('Set SUPABASE_STAGING_SERVICE_ROLE_KEY for Staging, or SUPABASE_SERVICE_ROLE_KEY for Local.');
  }
  const ref = projectRefFromServiceRole(key);
  if (ref === PRODUCTION_PROJECT_REF || supabaseUrl.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error('Refusing to seed Production. Use Local or Staging.');
  }
  if (staging && ref && ref !== STAGING_PROJECT_REF) {
    throw new Error('The service role is not the Staging project.');
  }
  return { supabaseUrl, key };
}

async function main() {
  const pageUrl = readPageUrl(process.argv.slice(2));
  const { supabaseUrl, key } = readSeedCredentials(process.env, process.env.SUPABASE_URL);
  const page = assertSeedTargetAllowed(supabaseUrl, pageUrl);
  const seeded = await seedPassage(supabaseUrl, key, page.page.href);
  console.log(`Seeded published passage ${seeded.annotationId} on ${seeded.pageUrl}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
