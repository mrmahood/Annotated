import {
  ACTIVE_TAB_CONTEXT_KEY,
  isActiveTabContext,
} from '../utils/active-tab-context';
import { applyPendingArticleHoverOnTab } from '../utils/article-hover-pending';
import { applyPendingAudioHoverOnTab } from '../utils/audio-hover-pending';
import { applyPendingPageVideoHoverOnTab } from '../utils/page-video-hover-pending';
import { applyPendingSpotifyHoverOnTab } from '../utils/spotify-hover-pending';
import { installMediaCapture } from '../utils/media-capture-background';
import {
  followBrowsingTab,
  installSurfFollow,
} from '../utils/surf-follow';

export default defineBackground(() => {
  const chrome = (globalThis as typeof globalThis & {
    chrome: typeof browser;
  }).chrome;

  let actionContextRevision = 0;

  installMediaCapture(chrome);
  installSurfFollow(chrome, {
    applyPending: async (tab) => {
      await applyPendingArticleHoverOnTab(tab);
      await applyPendingAudioHoverOnTab(tab);
      await applyPendingPageVideoHoverOnTab(tab);
      await applyPendingSpotifyHoverOnTab(tab);
    },
  });

  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch((error: unknown) => {
      console.error('Unable to disable automatic Annotated side-panel opening:', error);
    });

  chrome.action.onClicked.addListener((tab) => {
    if (tab.id == null || tab.windowId == null) {
      console.warn('Unable to capture the Annotated action tab because it has no ID:', tab);
      return;
    }

    const openPromise = chrome.sidePanel.open({ tabId: tab.id });

    actionContextRevision += 1;

    void followBrowsingTab(chrome, tab)
      .then(async () => {
        if (tab.url) {
          const pendingTab = {
            tabId: tab.id as number,
            tabUrl: tab.url,
          };
          await applyPendingArticleHoverOnTab(pendingTab);
          await applyPendingAudioHoverOnTab(pendingTab);
          await applyPendingPageVideoHoverOnTab(pendingTab);
          await applyPendingSpotifyHoverOnTab(pendingTab);
        }
      })
      .catch((error: unknown) => {
        console.error('Unable to store the Annotated action tab:', error);
      });

    void openPromise.catch((error: unknown) => {
      console.error('Unable to open the Annotated side panel:', error);
    });
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    const revisionAtRemoval = actionContextRevision;

    void chrome.storage.session
      .get(ACTIVE_TAB_CONTEXT_KEY)
      .then((stored) => {
        const context = stored[ACTIVE_TAB_CONTEXT_KEY];

        if (
          revisionAtRemoval === actionContextRevision &&
          isActiveTabContext(context) &&
          context.tabId === tabId
        ) {
          return chrome.storage.session.remove(ACTIVE_TAB_CONTEXT_KEY);
        }

        return undefined;
      })
      .catch((error: unknown) => {
        console.error('Unable to clear the closed Annotated action tab:', error);
      });
  });
});
