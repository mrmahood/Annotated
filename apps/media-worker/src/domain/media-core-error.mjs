const REASON_PATTERN = /^[a-z0-9_]{1,100}$/u;

export class MediaCoreError extends Error {
  constructor(stage, code, message, reason) {
    super(message);
    this.name = 'MediaCoreError';
    this.stage = stage;
    this.code = code;
    if (typeof reason === 'string' && REASON_PATTERN.test(reason)) this.reason = reason;
  }
}

export function mediaCoreFailure(stage, code, message, reason) {
  throw new MediaCoreError(stage, code, message, reason);
}
