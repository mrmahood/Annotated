import {
  MICROPHONE_PERMISSION_PAGE,
  isMicrophonePermissionMessage,
  type MicrophonePermissionResult,
} from './audio-commentary.ts';

export const MICROPHONE_PERMISSION_POPUP_WIDTH = 420;
export const MICROPHONE_PERMISSION_POPUP_HEIGHT = 320;

export type MicrophonePermissionHelperChrome = {
  runtime: {
    getURL: (path: string) => string;
    onMessage: {
      addListener: (listener: (message: unknown) => void) => void;
      removeListener: (listener: (message: unknown) => void) => void;
    };
  };
  windows: {
    create: (createData: {
      url: string;
      type: 'popup';
      width: number;
      height: number;
      focused: boolean;
    }) => Promise<{ id?: number; tabs?: Array<{ id?: number }> }>;
    remove: (windowId: number) => Promise<void> | void;
  };
  tabs: {
    query?: (queryInfo: { windowId: number }) => Promise<Array<{ id?: number }>>;
    onRemoved: {
      addListener: (listener: (tabId: number) => void) => void;
      removeListener: (listener: (tabId: number) => void) => void;
    };
  };
};

export function openMicrophonePermissionHelper(
  chromeApi: MicrophonePermissionHelperChrome,
  pagePath = MICROPHONE_PERMISSION_PAGE,
): Promise<MicrophonePermissionResult> {
  return new Promise((resolve) => {
    let settled = false;
    let helperTabId: number | null = null;
    let helperWindowId: number | null = null;
    const removed = new Set<number>();
    const finish = (result: MicrophonePermissionResult) => {
      if (settled) return;
      settled = true;
      chromeApi.runtime.onMessage.removeListener(onMessage);
      chromeApi.tabs.onRemoved.removeListener(onRemoved);
      if (helperWindowId != null) {
        void Promise.resolve(chromeApi.windows.remove(helperWindowId)).catch(() => undefined);
      }
      resolve(result);
    };
    const onMessage = (message: unknown) => {
      if (!isMicrophonePermissionMessage(message)) return;
      finish(message.result);
    };
    const onRemoved = (tabId: number) => {
      if (helperTabId === null) {
        removed.add(tabId);
        return;
      }
      if (tabId === helperTabId) finish('dismissed');
    };
    chromeApi.runtime.onMessage.addListener(onMessage);
    chromeApi.tabs.onRemoved.addListener(onRemoved);
    void chromeApi.windows.create({
      url: chromeApi.runtime.getURL(pagePath),
      type: 'popup',
      width: MICROPHONE_PERMISSION_POPUP_WIDTH,
      height: MICROPHONE_PERMISSION_POPUP_HEIGHT,
      focused: true,
    }).then(async (created) => {
      helperWindowId = created.id ?? null;
      if (settled) {
        if (helperWindowId != null) {
          void Promise.resolve(chromeApi.windows.remove(helperWindowId)).catch(() => undefined);
        }
        return;
      }
      let tabId = created.tabs?.[0]?.id ?? null;
      if (tabId == null && created.id != null && chromeApi.tabs.query) {
        const tabs = await chromeApi.tabs.query({ windowId: created.id });
        tabId = tabs[0]?.id ?? null;
      }
      if (tabId == null) {
        finish('dismissed');
        return;
      }
      helperTabId = tabId;
      if (removed.has(tabId)) finish('dismissed');
    }).catch(() => finish('dismissed'));
  });
}
