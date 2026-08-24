export class MediaCoreError extends Error {
  constructor(stage, code, message) {
    super(message);
    this.name = 'MediaCoreError';
    this.stage = stage;
    this.code = code;
  }
}

export function mediaCoreFailure(stage, code, message) {
  throw new MediaCoreError(stage, code, message);
}
