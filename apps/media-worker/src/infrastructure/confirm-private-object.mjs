const CONFIRMATION_DELAYS_MS = Object.freeze([0, 250, 500, 1_000, 2_000]);

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function confirmPrivateObjectRemoved(storage, bucket, objectPath, {
  sleep = defaultSleep,
  delaysMs = CONFIRMATION_DELAYS_MS,
} = {}) {
  if (!objectPath) return true;
  if (!storage || typeof storage.objectVisible !== 'function') {
    throw new TypeError('Storage removal confirmation is unavailable.');
  }
  let removed = false;
  for (let index = 0; index < delaysMs.length; index += 1) {
    if (delaysMs[index] > 0) await sleep(delaysMs[index]);
    if (!(await storage.objectVisible(bucket, objectPath))) return true;
    if (!removed) {
      if (typeof storage.remove !== 'function') throw new TypeError('Storage removal confirmation is unavailable.');
      await storage.remove(bucket, [objectPath]);
      removed = true;
      if (!(await storage.objectVisible(bucket, objectPath))) return true;
    }
  }
  return false;
}
