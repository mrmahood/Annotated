import {
  ACTIVE_TAB_CONTEXT_KEY,
  ACTIVE_TAB_CONTEXT_MESSAGE,
  isActiveTabContext,
  type ActiveTabContext,
} from '../utils/active-tab-context';
import { installMediaCaptureSpike } from '../utils/media-capture-background';

export default defineBackground(() => {
  const chrome = (globalThis as typeof globalThis & {
    chrome: typeof browser;
  }).chrome;

  let actionContextRevision = 0;

  installMediaCaptureSpike(chrome);

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

    const context: ActiveTabContext = {
      tabId: tab.id,
      windowId: tab.windowId,
      title: tab.title ?? '',
      url: tab.url ?? '',
      ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}),
      capturedAt: Date.now(),
    };

    void chrome.storage.session
      .set({ [ACTIVE_TAB_CONTEXT_KEY]: context })
      .then(() => {
        void chrome.runtime
          .sendMessage({
            type: ACTIVE_TAB_CONTEXT_MESSAGE,
            context,
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);

            if (!message.includes('Receiving end does not exist')) {
              console.warn('Unable to notify the Annotated side panel:', error);
            }
          });
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
