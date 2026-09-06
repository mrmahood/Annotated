import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyTypedClipFieldInput,
  fieldFromMilliseconds,
  getTypedClipFieldError,
  getTypedClipRangeError,
  syncTypedClipFieldFromMilliseconds,
  TYPED_MEDIA_TIME_FORMAT_ERROR,
  typedClipFieldsAllowPublish,
} from './clip-range-entry.ts';

test('typing a valid m:ss start commits milliseconds and stays in sync with Set start', () => {
  const typed = applyTypedClipFieldInput('1:00', false);
  assert.equal(typed.updateMilliseconds, true);
  assert.equal(typed.milliseconds, 60_000);
  assert.equal(typed.field.text, '1:00');
  assert.equal(typed.field.formatError, null);

  const committed = applyTypedClipFieldInput('1:00', true);
  assert.equal(committed.field.text, '01:00');
  assert.equal(committed.field.dirty, false);

  const fromSetStart = fieldFromMilliseconds(150_000);
  assert.equal(fromSetStart.text, '02:30');
  const stillEditing = applyTypedClipFieldInput('2:3', false);
  assert.equal(stillEditing.updateMilliseconds, false);
  assert.equal(stillEditing.field.formatError, null);
  const overwritten = syncTypedClipFieldFromMilliseconds(stillEditing.field, 150_000);
  assert.deepEqual(overwritten, fromSetStart);
});

test('typed fields keep user text while the parsed value matches committed milliseconds', () => {
  const typing = applyTypedClipFieldInput('2:30', false);
  assert.equal(typing.milliseconds, 150_000);
  const synced = syncTypedClipFieldFromMilliseconds(typing.field, 150_000);
  assert.equal(synced.text, '2:30');
  assert.equal(synced.dirty, true);
});

test('invalid or unfinished typed times do not replace the committed millisecond range', () => {
  const incomplete = applyTypedClipFieldInput('1:', false);
  assert.equal(incomplete.updateMilliseconds, false);
  assert.equal(incomplete.field.formatError, null);

  const invalid = applyTypedClipFieldInput('1:00x', false);
  assert.equal(invalid.updateMilliseconds, false);
  assert.equal(invalid.field.formatError, TYPED_MEDIA_TIME_FORMAT_ERROR);

  const blurred = applyTypedClipFieldInput('1:', true);
  assert.equal(blurred.updateMilliseconds, false);
  assert.equal(blurred.field.formatError, TYPED_MEDIA_TIME_FORMAT_ERROR);

  const cleared = applyTypedClipFieldInput('', true);
  assert.equal(cleared.updateMilliseconds, true);
  assert.equal(cleared.milliseconds, null);
});

test('publish stays blocked until both typed fields parse to the same ms range', () => {
  const start = applyTypedClipFieldInput('1:00', true).field;
  const end = applyTypedClipFieldInput('2:30', true).field;
  assert.equal(typedClipFieldsAllowPublish(start, end, 60_000, 150_000), true);

  const dirtyInvalid = applyTypedClipFieldInput('1:00x', false).field;
  assert.equal(typedClipFieldsAllowPublish(dirtyInvalid, end, 60_000, 150_000), false);
});

test('typed ranges reuse the hosted 1–90 s and bounds validators', () => {
  assert.equal(getTypedClipRangeError(60_000, 150_000, 180_000), null);
  assert.match(getTypedClipRangeError(60_000, 60_000, 180_000), /after/);
  assert.match(getTypedClipRangeError(60_000, 60_500, 180_000), /at least/);
  assert.match(getTypedClipRangeError(60_000, 151_000, 180_000), /90 seconds/);
  assert.match(getTypedClipRangeError(170_000, 180_000, 160_000), /start cannot exceed/);
  assert.match(getTypedClipFieldError(
    fieldFromMilliseconds(170_000),
    170_000,
    160_000,
    'start',
  ), /start cannot exceed/);
  assert.equal(getTypedClipFieldError(
    applyTypedClipFieldInput('nope', false).field,
    60_000,
    180_000,
    'start',
  ), TYPED_MEDIA_TIME_FORMAT_ERROR);
});
