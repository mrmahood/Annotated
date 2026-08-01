import { useCallback, useEffect, useState } from 'react';
import {
  ACTIVE_TAB_CONTEXT_KEY,
  isActiveTabContext,
  isActiveTabContextMessage,
  type ActiveTabContext,
} from '../../utils/active-tab-context';

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
]);

type PageSource = {
  title: string;
  hostname: string;
  url: string;
  classification: 'YouTube' | 'Web page';
};

type SourceState =
  | { status: 'loading' }
  | { status: 'connected'; source: PageSource }
  | { status: 'refreshing' }
  | { status: 'not-connected' }
  | { status: 'different-tab' }
  | { status: 'reconnect-required' }
  | { status: 'unsupported'; url?: string }
  | { status: 'unexpected-error'; message: string };

type RefreshFeedback = 'idle' | 'success';

const RECONNECT_ANNOUNCEMENT =
  'New website detected. Reconnect Annotated from the toolbar.';

const chrome = (globalThis as typeof globalThis & {
  chrome: typeof browser;
}).chrome;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to read the current page.';
}

function isClosedTabError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return /no tab with id/i.test(message) || /invalid tab id/i.test(message);
}

function getSourceState(title: string, urlValue: string): SourceState {
  const tabUrl = urlValue.trim();

  try {
    const url = new URL(tabUrl);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { status: 'unsupported', url: tabUrl };
    }

    return {
      status: 'connected',
      source: {
        title: title.trim() || 'Untitled page',
        hostname: url.hostname,
        url: tabUrl,
        classification: YOUTUBE_HOSTS.has(url.hostname) ? 'YouTube' : 'Web page',
      },
    };
  } catch {
    return { status: 'unsupported', url: tabUrl || undefined };
  }
}

function App() {
  const [sourceState, setSourceState] = useState<SourceState>({ status: 'loading' });
  const [refreshFeedback, setRefreshFeedback] =
    useState<RefreshFeedback>('idle');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);

  const showStoredContext = useCallback((context: ActiveTabContext | null) => {
    setSourceState(
      context
        ? getSourceState(context.title, context.url)
        : { status: 'not-connected' },
    );
    setRefreshFeedback('idle');
    setLastRefreshedAt(null);
  }, []);

  const loadSource = useCallback(async () => {
    setRefreshFeedback('idle');
    setLastRefreshedAt(null);
    setSourceState({ status: 'refreshing' });

    try {
      const stored = await chrome.storage.session.get(ACTIVE_TAB_CONTEXT_KEY);
      const context = stored[ACTIVE_TAB_CONTEXT_KEY];

      if (!isActiveTabContext(context)) {
        setSourceState({ status: 'not-connected' });
        return;
      }

      const [activeTab] = await chrome.tabs.query({
        active: true,
        windowId: context.windowId,
      });

      if (!activeTab) {
        setSourceState({ status: 'not-connected' });
        return;
      }

      if (activeTab.id !== context.tabId) {
        setSourceState({ status: 'different-tab' });
        return;
      }

      let freshTab: Browser.tabs.Tab;

      try {
        freshTab = await chrome.tabs.get(context.tabId);
      } catch (error) {
        if (!isClosedTabError(error)) {
          throw error;
        }

        await chrome.storage.session.remove(ACTIVE_TAB_CONTEXT_KEY);
        setSourceState({ status: 'not-connected' });
        return;
      }

      if (typeof freshTab.url !== 'string' || typeof freshTab.title !== 'string') {
        setSourceState({ status: 'reconnect-required' });
        return;
      }

      const nextSourceState = getSourceState(freshTab.title, freshTab.url);
      setSourceState(nextSourceState);

      if (nextSourceState.status === 'connected') {
        setLastRefreshedAt(Date.now());
        setRefreshFeedback('success');
      }
    } catch (error) {
      const message = getErrorMessage(error);
      console.error('Failed to refresh source:', error);
      setSourceState({ status: 'unexpected-error', message });
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const applyContext = (value: unknown) => {
      if (isMounted) {
        showStoredContext(isActiveTabContext(value) ? value : null);
      }
    };

    const handleStorageChange = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: string,
    ) => {
      if (
        areaName === 'session' &&
        Object.prototype.hasOwnProperty.call(changes, ACTIVE_TAB_CONTEXT_KEY)
      ) {
        applyContext(changes[ACTIVE_TAB_CONTEXT_KEY]?.newValue);
      }
    };

    const handleRuntimeMessage = (message: unknown) => {
      if (isActiveTabContextMessage(message)) {
        applyContext(message.context);
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);

    void chrome.storage.session
      .get(ACTIVE_TAB_CONTEXT_KEY)
      .then((stored) => {
        applyContext(stored[ACTIVE_TAB_CONTEXT_KEY]);
      })
      .catch((error: unknown) => {
        if (!isMounted) {
          return;
        }

        const message = getErrorMessage(error);
        console.error('Failed to read the Annotated action tab:', error);
        setSourceState({ status: 'unexpected-error', message });
      });

    return () => {
      isMounted = false;
      chrome.storage.onChanged.removeListener(handleStorageChange);
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
    };
  }, [showStoredContext]);

  useEffect(() => {
    if (refreshFeedback !== 'success') {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setRefreshFeedback('idle');
    }, 3000);

    return () => window.clearTimeout(timeoutId);
  }, [refreshFeedback]);

  const isRefreshing = sourceState.status === 'refreshing';

  return (
    <main className="panel">
      <header className="brand">
        <p className="eyebrow">ANNOTATED</p>
        <h1>Current source</h1>
        <p className="intro">Review the page connected to this annotation.</p>
      </header>

      <section className="source-card" aria-busy={isRefreshing}>
        {(sourceState.status === 'loading' ||
          sourceState.status === 'refreshing') && (
          <div className="status">
            <span className="spinner" aria-hidden="true" />
            <p>
              {sourceState.status === 'refreshing'
                ? 'Refreshing source...'
                : 'Reading the current page…'}
            </p>
          </div>
        )}

        {sourceState.status === 'unexpected-error' && (
          <div className="status status-error">
            <p className="status-title">Couldn’t load this page</p>
            <p>{sourceState.message}</p>
          </div>
        )}

        {sourceState.status === 'not-connected' && (
          <div className="status status-empty">
            <p className="status-title">Connect a website</p>
            <p>Click the Annotated toolbar icon to connect the current page.</p>
          </div>
        )}

        {sourceState.status === 'different-tab' && (
          <div className="status status-empty">
            <p className="status-title">Connected tab isn’t active</p>
            <p>
              Return to the connected tab, or click the Annotated toolbar icon
              to connect this one.
            </p>
          </div>
        )}

        {sourceState.status === 'reconnect-required' && (
          <div className="status status-reconnect">
            <p className="status-title">New website detected</p>
            <p>
              Annotated access resets when you move to another website. Click
              the Annotated toolbar icon to connect this page.
            </p>
            <p className="status-note">
              You only need to reconnect when changing websites.
            </p>
          </div>
        )}

        {sourceState.status === 'unsupported' && (
          <div className="status status-unsupported">
            <p className="status-title">Unsupported page</p>
            <p>
              Annotated can use HTTP and HTTPS pages. Chrome settings, extension
              pages, blank tabs, and other internal pages aren’t supported.
            </p>
            {sourceState.url && <p className="unsupported-url">{sourceState.url}</p>}
          </div>
        )}

        {sourceState.status === 'connected' && (
          <div className="source-details">
            <span className="source-type">{sourceState.source.classification}</span>
            <div className="field">
              <span className="field-label">Title</span>
              <p className="page-title">{sourceState.source.title}</p>
            </div>
            <div className="field">
              <span className="field-label">Hostname</span>
              <p>{sourceState.source.hostname}</p>
            </div>
            <div className="field">
              <span className="field-label">URL</span>
              <p className="page-url">{sourceState.source.url}</p>
            </div>
          </div>
        )}
      </section>

      <div className="actions">
        <button
          className="button button-primary"
          type="button"
          onClick={loadSource}
          disabled={isRefreshing}
        >
          {isRefreshing ? 'Refreshing...' : 'Refresh source'}
        </button>
        <button className="button button-secondary" type="button" disabled>
          Capture selection — coming next
        </button>
      </div>

      <div
        className={`refresh-status refresh-status-${sourceState.status}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {isRefreshing && <p>Refreshing source...</p>}
        {refreshFeedback === 'success' && <p>Source updated</p>}
        {sourceState.status === 'reconnect-required' && (
          <p>{RECONNECT_ANNOUNCEMENT}</p>
        )}
        {sourceState.status === 'unexpected-error' && (
          <p>{sourceState.message}</p>
        )}
        {lastRefreshedAt !== null && (
          <p className="refresh-time">
            Last refreshed{' '}
            <time dateTime={new Date(lastRefreshedAt).toISOString()}>
              {new Date(lastRefreshedAt).toLocaleTimeString()}
            </time>
          </p>
        )}
      </div>
    </main>
  );
}

export default App;
