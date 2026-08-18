import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

export async function hashFileSha256(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
}

export async function fileByteSize(filePath) {
  const facts = await stat(filePath);
  if (!facts.isFile()) throw new TypeError('Media path is not a file.');
  return facts.size;
}
