import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCurrentScreen,
  getPostPublishNavigation,
  INITIAL_NAVIGATION,
  reduceNavigation,
} from './navigation.ts';

test('navigation stack supports deterministic push and back', () => {
  let state = reduceNavigation(INITIAL_NAVIGATION, {
    type: 'select-root',
    view: 'feed',
  });
  state = reduceNavigation(state, {
    type: 'push',
    screen: { kind: 'annotation', annotationId: 'annotation' },
  });
  state = reduceNavigation(state, {
    type: 'push',
    screen: { kind: 'profile', profileId: 'profile' },
  });
  assert.equal(getCurrentScreen(state).kind, 'profile');
  state = reduceNavigation(state, { type: 'back' });
  assert.equal(getCurrentScreen(state).kind, 'annotation');
  state = reduceNavigation(state, { type: 'back' });
  assert.deepEqual(getCurrentScreen(state), { kind: 'root', view: 'feed' });
});

test('post-publish navigation opens extension-native annotation detail', () => {
  const state = getPostPublishNavigation('new-annotation');
  assert.deepEqual(getCurrentScreen(state), {
    kind: 'annotation',
    annotationId: 'new-annotation',
  });
  assert.deepEqual(state.stack[0], { kind: 'root', view: 'context' });
});
