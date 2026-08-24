import { createDispatchToken } from './dispatch-auth.mjs';
import { requireMediaId, requireSecret } from './validation.mjs';

const METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const CLOUD_RUN_API_ORIGIN = 'https://run.googleapis.com';
const IDENTIFIER = /^[a-z][a-z0-9-]{0,62}$/u;

function requireIdentifier(value, label) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw new TypeError(`${label} is invalid.`);
  return value;
}

async function metadataAccessToken(fetchImpl) {
  let response;
  try {
    response = await fetchImpl(METADATA_TOKEN_URL, { headers: { 'metadata-flavor': 'Google' } });
  } catch {
    throw new Error('Cloud identity token request failed.');
  }
  if (!response.ok) throw new Error('Cloud identity token request failed.');
  let value;
  try { value = await response.json(); }
  catch { throw new Error('Cloud identity token response was invalid.'); }
  if (!value || typeof value.access_token !== 'string' || value.access_token.length < 20 || value.access_token.length > 4096) {
    throw new Error('Cloud identity token response was invalid.');
  }
  return value.access_token;
}

export function createCloudRunDispatch({
  projectId,
  region,
  workerJob,
  dispatchSecret,
  fetchImpl = globalThis.fetch,
  clock = () => Date.now(),
}) {
  const project = requireIdentifier(projectId, 'Google Cloud project');
  const location = requireIdentifier(region, 'Google Cloud region');
  const job = requireIdentifier(workerJob, 'Cloud Run worker job');
  const secret = requireSecret(dispatchSecret, 'Dispatch secret');
  if (typeof fetchImpl !== 'function' || typeof clock !== 'function') throw new TypeError('Cloud Run dispatch dependencies are invalid.');
  const endpoint = `${CLOUD_RUN_API_ORIGIN}/v2/projects/${project}/locations/${location}/jobs/${job}:run`;

  return async (mediaId) => {
    const normalized = requireMediaId(mediaId);
    const dispatchToken = createDispatchToken({ mediaId: normalized, secret, now: clock() });
    const accessToken = await metadataAccessToken(fetchImpl);
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          overrides: {
            taskCount: 1,
            timeout: '600s',
            containerOverrides: [{
              env: [
                { name: 'ANNOTATED_MEDIA_ID', value: normalized },
                { name: 'ANNOTATED_DISPATCH_TOKEN', value: dispatchToken },
              ],
            }],
          },
        }),
      });
    } catch {
      throw new Error('Cloud Run worker invocation failed.');
    }
    if (!response.ok) throw new Error('Cloud Run worker invocation failed.');
    return Object.freeze({ outcome: 'accepted' });
  };
}

export const cloudRunDispatchContract = Object.freeze({
  metadataTokenUrl: METADATA_TOKEN_URL,
  apiOrigin: CLOUD_RUN_API_ORIGIN,
  taskCount: 1,
  timeoutSeconds: 600,
});
