import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAudioDuration,
  parsePublicAnnotationAudio,
} from "./audio-commentary.ts";

const PATH = "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webm";

test("parses only bounded owned WebM metadata", () => {
  assert.deepEqual(parsePublicAnnotationAudio({
    storage_path: PATH,
    duration_ms: 62_000,
    mime_type: "audio/webm",
    byte_size: 4_096,
  }), { storagePath: PATH, durationMs: 62_000, byteSize: 4_096 });
  assert.equal(parsePublicAnnotationAudio({ storage_path: "https://example.test/audio.webm" }), null);
  assert.equal(parsePublicAnnotationAudio({
    storage_path: PATH,
    duration_ms: 62_000,
    mime_type: "audio/mpeg",
    byte_size: 4_096,
  }), null);
});

test("formats published audio duration", () => {
  assert.equal(formatAudioDuration(101_001), "1:42");
});
