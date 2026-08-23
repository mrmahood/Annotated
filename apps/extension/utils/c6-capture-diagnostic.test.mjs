import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticMimeType, resolveC6CaptureDiagnostic } from './c6-capture-diagnostic.ts';

test('C6 capture diagnostics are disabled with exact production recorder defaults', () => {
  assert.deepEqual(resolveC6CaptureDiagnostic({}), {
    enabled: false,
    collectorUrl: null,
    variant: null,
    loopbackEnabled: true,
    timesliceMs: 1_000,
    preferredVideoCodec: 'auto',
    audioBitsPerSecond: null,
    videoBitsPerSecond: null,
  });
});

test('C6 capture diagnostics require a completely Local HTTP boundary', () => {
  const base = {
    webAppUrl: 'http://localhost:3000',
    collectorUrl: 'http://127.0.0.1:4173/capture/token',
    variant: 'loopback-off', loopback: 'false', timeslice: '1000', videoCodec: 'vp9',
  };
  assert.equal(resolveC6CaptureDiagnostic(base).loopbackEnabled, false);
  assert.throws(() => resolveC6CaptureDiagnostic({ ...base, collectorUrl: 'https://example.com/capture' }), /localhost/);
  assert.throws(() => resolveC6CaptureDiagnostic({ ...base, webAppUrl: 'https://staging.example.com' }), /localhost/);
  assert.throws(() => resolveC6CaptureDiagnostic({ ...base, timeslice: '250' }), /1000 or none/);
});

test('C6 diagnostic codec preference fails closed when unsupported', () => {
  assert.equal(diagnosticMimeType(true, 'vp8', 'video/webm', (value) => value.includes('vp8')), 'video/webm;codecs=vp8,opus');
  assert.equal(diagnosticMimeType(true, 'vp9', 'video/webm', () => false), null);
  assert.equal(diagnosticMimeType(false, 'vp8', 'audio/webm', () => true), 'audio/webm');
});
