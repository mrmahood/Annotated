import { spawn } from 'node:child_process';
import { MediaCoreError } from '../domain/media-core-error.mjs';

const MAX_CAPTURED_OUTPUT_BYTES = 1024 * 1024;

export function runExecutable(executable, args, options = {}) {
  const {
    timeoutMs = 120_000,
    stage = 'transcoding',
    failureCode = 'transcode_failed',
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;

    const collect = (chunks, kind) => (chunk) => {
      const current = kind === 'stdout' ? stdoutBytes : stderrBytes;
      if (current >= MAX_CAPTURED_OUTPUT_BYTES) {
        if (kind === 'stdout') stdoutTruncated = true;
        else stderrTruncated = true;
        return;
      }
      const remaining = MAX_CAPTURED_OUTPUT_BYTES - current;
      const bounded = chunk.subarray(0, remaining);
      chunks.push(bounded);
      if (kind === 'stdout') stdoutBytes += bounded.byteLength;
      else stderrBytes += bounded.byteLength;
    };
    child.stdout.on('data', collect(stdout, 'stdout'));
    child.stderr.on('data', collect(stderr, 'stderr'));

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(new MediaCoreError(stage, failureCode, `Unable to start media executable: ${error.message}`));
    });
    child.once('close', (exitCode, signal) => {
      clearTimeout(timeout);
      const result = {
        exitCode,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        stdoutTruncated,
        stderrTruncated,
      };
      if (timedOut) {
        reject(new MediaCoreError(stage, `${failureCode.replace(/_failed$/, '')}_timeout`, 'Media executable timed out.'));
      } else if (exitCode !== 0) {
        reject(new MediaCoreError(stage, failureCode, `Media executable exited with code ${exitCode}.`));
      } else {
        resolve(result);
      }
    });
  });
}
