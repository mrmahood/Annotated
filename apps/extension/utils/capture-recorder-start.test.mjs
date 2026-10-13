import assert from 'node:assert/strict';
import test from 'node:test';
import { startCaptureRecorder } from './capture-recorder-start.ts';

function track(name) {
  return {
    name,
    stopped: false,
    stop() { this.stopped = true; },
  };
}

function stream(name) {
  const tracks = [track(`${name}-audio`)];
  return {
    name,
    tracks,
    getTracks() { return this.tracks; },
  };
}

function installFakeRecorder({ failStart = false } = {}) {
  const created = [];
  class FakeMediaRecorder {
    constructor(target) {
      this.stream = target;
      this.state = 'inactive';
      this.startCalls = [];
      this.stopCalls = 0;
      created.push(this);
    }

    start(timeslice) {
      this.startCalls.push(timeslice === undefined ? null : timeslice);
      if (this.state !== 'inactive') {
        throw new DOMException('The MediaRecorder has already been started.', 'InvalidStateError');
      }
      if (failStart) throw new Error('MediaRecorder.start failed');
      this.state = 'recording';
    }

    stop() {
      this.stopCalls += 1;
      this.state = 'inactive';
    }
  }
  return { FakeMediaRecorder, created };
}

test('capture recorder starts once after state is assigned', () => {
  const { FakeMediaRecorder, created } = installFakeRecorder();
  const tab = stream('tab');
  const mixed = stream('mix');
  const mic = stream('mic');
  const order = [];
  let disconnected = false;
  let assigned = null;
  const recorder = startCaptureRecorder({
    tabStream: tab,
    recordedStream: mixed,
    microphoneStream: mic,
    disconnectMix: () => { disconnected = true; },
    timesliceMs: 1_000,
    createRecorder: (target) => new FakeMediaRecorder(target),
    assign: (next) => {
      order.push('assign');
      assigned = next;
    },
  });
  order.push('started');
  assert.equal(created.length, 1);
  assert.equal(recorder, assigned);
  assert.equal(recorder.state, 'recording');
  assert.deepEqual(recorder.startCalls, [1_000]);
  assert.equal(recorder.stream, mixed);
  assert.deepEqual(order, ['assign', 'started']);
  assert.equal(tab.tracks[0].stopped, false);
  assert.equal(mixed.tracks[0].stopped, false);
  assert.equal(mic.tracks[0].stopped, false);
  assert.equal(disconnected, false);
  assert.equal(recorder.stopCalls, 0);
});

test('a failed capture start stops the recorder and tab, mic, and mix tracks', () => {
  const { FakeMediaRecorder, created } = installFakeRecorder({ failStart: true });
  const tab = stream('tab');
  const mixed = stream('mix');
  const mic = stream('mic');
  let disconnected = false;
  let audioClosed = false;
  let assigned = null;
  assert.throws(() => startCaptureRecorder({
    tabStream: tab,
    recordedStream: mixed,
    microphoneStream: mic,
    disconnectMix: () => { disconnected = true; },
    closeAudio: () => { audioClosed = true; },
    timesliceMs: 1_000,
    createRecorder: (target) => new FakeMediaRecorder(target),
    assign: (next) => { assigned = next; },
  }), /MediaRecorder\.start failed/);
  assert.equal(created.length, 1);
  assert.equal(assigned, created[0]);
  assert.deepEqual(created[0].startCalls, [1_000]);
  assert.equal(created[0].stopCalls, 1);
  assert.equal(tab.tracks[0].stopped, true);
  assert.equal(mixed.tracks[0].stopped, true);
  assert.equal(mic.tracks[0].stopped, true);
  assert.equal(disconnected, true);
  assert.equal(audioClosed, true);
});

test('a second start on the same recorder is rejected by the fake and is not used', () => {
  const { FakeMediaRecorder } = installFakeRecorder();
  const tab = stream('tab');
  const recorder = new FakeMediaRecorder(tab);
  recorder.start();
  assert.throws(() => recorder.start(), /InvalidStateError/);
  assert.deepEqual(recorder.startCalls, [null, null]);
});
