import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOGO_MARK_ASTERISK,
  LOGO_MARK_RULE,
  LOGO_MARK_VIEWBOX,
  LOGO_SHORTCODE,
  asteriskRays,
  splitLogoShortcode,
} from './logo-mark.ts';

test('logo C geometry is a left margin rule plus an 8-spoke asterisk', () => {
  assert.equal(LOGO_MARK_VIEWBOX, '0 0 64 64');
  assert.equal(LOGO_SHORTCODE, '|*');
  assert.ok(LOGO_MARK_RULE.x < LOGO_MARK_ASTERISK.cx);
  assert.ok(LOGO_MARK_RULE.y1 < LOGO_MARK_ASTERISK.cy);
  assert.ok(LOGO_MARK_RULE.y2 > LOGO_MARK_ASTERISK.cy);
  assert.equal(asteriskRays().length, 4);
});

test('splitLogoShortcode expands only the literal |* shortcode', () => {
  assert.deepEqual(splitLogoShortcode(''), [{ type: 'text', value: '' }]);
  assert.deepEqual(splitLogoShortcode('plain note'), [{ type: 'text', value: 'plain note' }]);
  assert.deepEqual(splitLogoShortcode('|*'), [{ type: 'mark' }]);
  assert.deepEqual(splitLogoShortcode('See |* here'), [
    { type: 'text', value: 'See ' },
    { type: 'mark' },
    { type: 'text', value: ' here' },
  ]);
  assert.deepEqual(splitLogoShortcode('|* start'), [
    { type: 'mark' },
    { type: 'text', value: ' start' },
  ]);
  assert.deepEqual(splitLogoShortcode('end |*'), [
    { type: 'text', value: 'end ' },
    { type: 'mark' },
  ]);
  assert.deepEqual(splitLogoShortcode('a|*b|*c'), [
    { type: 'text', value: 'a' },
    { type: 'mark' },
    { type: 'text', value: 'b' },
    { type: 'mark' },
    { type: 'text', value: 'c' },
  ]);
  assert.deepEqual(splitLogoShortcode('| *'), [{ type: 'text', value: '| *' }]);
  assert.deepEqual(splitLogoShortcode('*|'), [{ type: 'text', value: '*|' }]);
});
