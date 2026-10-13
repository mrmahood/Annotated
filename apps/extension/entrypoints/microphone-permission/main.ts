import {
  MICROPHONE_PERMISSION_MESSAGE,
  microphoneHelperResultFromStartError,
  type MicrophonePermissionResult,
} from '../../utils/audio-commentary';

const chromeApi = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;

async function report(result: MicrophonePermissionResult) {
  try {
    await chromeApi.runtime.sendMessage({
      type: MICROPHONE_PERMISSION_MESSAGE,
      result,
    });
  } catch {
    // The side panel may already have closed.
  }
  window.close();
}

async function main() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    await report('granted');
  } catch (error) {
    await report(microphoneHelperResultFromStartError(error));
  }
}

void main();
