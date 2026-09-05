import {
  ACTIVE_TAB_CONTEXT_KEY,
  ACTIVE_TAB_CONTEXT_MESSAGE,
  activeTabContextFromTab,
  contextsDescribeSameTab,
  isActiveTabContext,
  type ActiveTabContext,
} from './active-tab-context.ts';
import { applyPendingArticleHoverOnTab } from './article-hover-pending.ts';
import { applyPendingAudioHoverOnTab } from './audio-hover-pending.ts';
import { applyPendingPageVideoHoverOnTab } from './page-video-hover-pending.ts';
import { ACTIVE_CAPTURE_KEY } from './media-capture-background.ts';

export type SurfFollowTab = {
  id?: number;
  windowId?: number;
  title?: string;
  url?: string;
  favIconUrl?: string;
  active?: boolean;
  status?: string;
};

export type SurfFollowChangeInfo = {
  status?: string;
  url?: string;
};

export type SurfFollowChrome = {
  storage: {
    session: {
      get: (key: string | string[]) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
    };
  };
  runtime: {
    sendMessage: (message: unknown) => Promise<unknown>;
  };
  tabs: {
    get: (tabId: number) => Promise<SurfFollowTab>;
    query: (queryInfo: { active?: boolean; windowId?: number }) => Promise<SurfFollowTab[]>;
    onActivated: {
      addListener: (listener: (activeInfo: { tabId: number; windowId: number }) => void) => void;
    };
    onUpdated: {
      addListener: (
        listener: (tabId: number, changeInfo: SurfFollowChangeInfo, tab: SurfFollowTab) => void,
      ) => void;
    };
  };
  windows?: {
    WINDOW_ID_NONE?: number;
    onFocusChanged?: {
      addListener: (listener: (windowId: number) => void) => void;
    };
  };
};

export function shouldFollowTabChange(changeInfo: SurfFollowChangeInfo): boolean {
  return changeInfo.status === 'complete' || typeof changeInfo.url === 'string';
}

export function tabIsActiveInFollowedWindow(
  tab: Pick<SurfFollowTab, 'active' | 'windowId'>,
  followWindowId: number | null,
): boolean {
  if (tab.active !== true) return false;
  if (followWindowId == null) return true;
  return tab.windowId === followWindowId;
}

export function tabIsReadyForPendingApply<T extends Pick<SurfFollowTab, 'url' | 'status' | 'id'>>(
  changeInfo: SurfFollowChangeInfo,
  tab: T,
): tab is T & { url: string; id: number } {
  if (tab.id == null || !Number.isInteger(tab.id) || tab.id < 0) return false;
  if (typeof tab.url !== 'string' || !tab.url) return false;
  return changeInfo.status === 'complete' || tab.status === 'complete';
}

export function activeCaptureHoldsContext(storedCapture: unknown, nextTabId: number): boolean {
  if (typeof storedCapture !== 'object' || storedCapture === null) return false;
  const request = (storedCapture as { request?: { tabId?: unknown } }).request;
  return typeof request?.tabId === 'number' && Number.isInteger(request.tabId) && request.tabId !== nextTabId;
}

export async function persistAndNotifyActiveTabContext(
  chromeApi: SurfFollowChrome,
  context: ActiveTabContext,
): Promise<void> {
  await chromeApi.storage.session.set({ [ACTIVE_TAB_CONTEXT_KEY]: context });
  try {
    await chromeApi.runtime.sendMessage({
      type: ACTIVE_TAB_CONTEXT_MESSAGE,
      context,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('Receiving end does not exist')) {
      console.warn('Unable to notify the Annotated side panel:', error);
    }
  }
}

export async function followBrowsingTab(
  chromeApi: SurfFollowChrome,
  tab: SurfFollowTab,
  now = Date.now(),
): Promise<'updated' | 'held' | 'unchanged' | 'skipped'> {
  const context = activeTabContextFromTab(tab, now);
  if (!context) return 'skipped';

  try {
    const stored = await chromeApi.storage.session.get([ACTIVE_CAPTURE_KEY, ACTIVE_TAB_CONTEXT_KEY]);
    if (activeCaptureHoldsContext(stored[ACTIVE_CAPTURE_KEY], context.tabId)) {
      return 'held';
    }
    const current = stored[ACTIVE_TAB_CONTEXT_KEY];
    if (isActiveTabContext(current) && contextsDescribeSameTab(current, context)) {
      return 'unchanged';
    }
  } catch {
    // Continue to persist when session read fails; capture hold is best-effort.
  }

  await persistAndNotifyActiveTabContext(chromeApi, context);
  return 'updated';
}

export function installSurfFollow(
  chromeApi: SurfFollowChrome,
  options: {
    applyPending?: (tab: { tabId: number; tabUrl: string }) => Promise<unknown>;
  } = {},
) {
  let followWindowId: number | null = null;
  const applyPending = options.applyPending ?? (async (tab) => {
    await applyPendingArticleHoverOnTab(tab);
    await applyPendingAudioHoverOnTab(tab);
    await applyPendingPageVideoHoverOnTab(tab);
  });

  const applyPendingIfReady = (changeInfo: SurfFollowChangeInfo, tab: SurfFollowTab) => {
    if (!tabIsReadyForPendingApply(changeInfo, tab) || tab.id == null) return;
    void applyPending({
      tabId: tab.id,
      tabUrl: tab.url,
    }).catch((error: unknown) => {
      console.error('Unable to apply a pending Annotated article highlight:', error);
    });
  };

  const follow = (tab: SurfFollowTab) => {
    void followBrowsingTab(chromeApi, tab).catch((error: unknown) => {
      console.error('Unable to follow the Annotated browsing tab:', error);
    });
  };

  chromeApi.tabs.onActivated.addListener((activeInfo) => {
    followWindowId = activeInfo.windowId;
    void chromeApi.tabs
      .get(activeInfo.tabId)
      .then((tab) => {
        follow(tab);
        applyPendingIfReady({ status: tab.status }, tab);
      })
      .catch((error: unknown) => {
        console.error('Unable to read the activated Annotated tab:', error);
      });
  });

  chromeApi.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (shouldFollowTabChange(changeInfo) && tabIsActiveInFollowedWindow(tab, followWindowId)) {
      follow({ ...tab, id: tab.id ?? tabId });
    }
    applyPendingIfReady(changeInfo, { ...tab, id: tab.id ?? tabId });
  });

  chromeApi.windows?.onFocusChanged?.addListener((windowId) => {
    const none = chromeApi.windows?.WINDOW_ID_NONE ?? -1;
    if (windowId === none) return;
    followWindowId = windowId;
    void chromeApi.tabs
      .query({ active: true, windowId })
      .then((tabs) => {
        const tab = tabs[0];
        if (tab) {
          follow(tab);
          applyPendingIfReady({ status: tab.status }, tab);
        }
      })
      .catch((error: unknown) => {
        console.error('Unable to follow the focused Annotated window:', error);
      });
  });
}
