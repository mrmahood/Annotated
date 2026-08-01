import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ACTIVE_TAB_CONTEXT_KEY,
  isActiveTabContext,
  isActiveTabContextMessage,
  type ActiveTabContext,
} from '../../utils/active-tab-context';
import {
  extractSelectionFromPage,
  type CaptureState,
  type SelectionExtractionResult,
} from '../../utils/selection-capture';

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
]);

const RECONNECT_MESSAGE =
  'Click the Annotated toolbar icon on this page to reconnect, then try again.';
const RESTRICTED_PAGE_MESSAGE = 'Annotated cannot capture text from this page.';
const UNEXPECTED_CAPTURE_MESSAGE =
  'Something went wrong while capturing the passage. Try again.';

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

const chrome = (globalThis as typeof globalThis & {
  chrome: typeof browser;
}).chrome;

function isClosedTabError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    /no tab with id/i.test(message) ||
    /invalid tab id/i.test(message) ||
    /tab (?:was|is) closed/i.test(message)
  );
}

function isSameOrigin(firstUrl: string, secondUrl: string) {
  try {
    return new URL(firstUrl).origin === new URL(secondUrl).origin;
  } catch {
    return false;
  }
}

function isRestrictedPageError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return /cannot access|cannot be scripted|missing host permission|extensions gallery|no frame with id|frame with id.*(?:removed|not found)|chrome:\/\/|edge:\/\/|about:/i.test(
    message,
  );
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

function getCapturedHostname(canonicalUrl: string, sourceHostname: string) {
  try {
    const canonical = new URL(canonicalUrl);

    if (canonical.protocol === 'http:' || canonical.protocol === 'https:') {
      return canonical.hostname || sourceHostname;
    }
  } catch {
    // The extractor already validates canonical URLs; retain a safe fallback.
  }

  return sourceHostname;
}

function getExtractionErrorMessage(
  reason: Exclude<SelectionExtractionResult, { ok: true }>['reason'],
) {
  switch (reason) {
    case 'NO_SELECTION':
      return 'Highlight a passage on the page, then try again.';
    case 'SELECTION_TOO_LONG':
      return 'Selections can contain up to 2,000 characters. Choose a shorter passage and try again.';
    case 'INVALID_PAGE':
      return RESTRICTED_PAGE_MESSAGE;
  }
}

function App() {
  const [sourceState, setSourceState] = useState<SourceState>({ status: 'loading' });
  const [captureState, setCaptureState] = useState<CaptureState>({ status: 'idle' });
  const [commentary, setCommentary] = useState('');
  const [refreshFeedback, setRefreshFeedback] =
    useState<RefreshFeedback>('idle');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const connectedContextRef = useRef<ActiveTabContext | null>(null);
  const captureRevisionRef = useRef(0);

  const clearCapture = useCallback(() => {
    captureRevisionRef.current += 1;
    setCaptureState({ status: 'idle' });
    setCommentary('');
  }, []);

  const enterReconnectRequired = useCallback(() => {
    captureRevisionRef.current += 1;
    setCommentary('');
    setCaptureState({
      status: 'reconnect-required',
      message: RECONNECT_MESSAGE,
    });
    setSourceState({ status: 'reconnect-required' });
    setRefreshFeedback('idle');
    setLastRefreshedAt(null);
  }, []);

  const showStoredContext = useCallback(
    (context: ActiveTabContext | null) => {
      const previousContext = connectedContextRef.current;
      const sourceChanged =
        previousContext !== null &&
        (context === null ||
          previousContext.tabId !== context.tabId ||
          previousContext.url !== context.url);

      if (sourceChanged) {
        clearCapture();
      }

      connectedContextRef.current = context;
      setSourceState(
        context
          ? getSourceState(context.title, context.url)
          : { status: 'not-connected' },
      );
      setRefreshFeedback('idle');
      setLastRefreshedAt(null);
    },
    [clearCapture],
  );

  const loadSource = useCallback(async () => {
    setRefreshFeedback('idle');
    setLastRefreshedAt(null);
    setSourceState({ status: 'refreshing' });

    try {
      const stored = await chrome.storage.session.get(ACTIVE_TAB_CONTEXT_KEY);
      const context = stored[ACTIVE_TAB_CONTEXT_KEY];

      if (!isActiveTabContext(context)) {
        clearCapture();
        connectedContextRef.current = null;
        setSourceState({ status: 'not-connected' });
        return;
      }

      const [activeTab] = await chrome.tabs.query({
        active: true,
        windowId: context.windowId,
      });

      if (!activeTab) {
        clearCapture();
        setSourceState({ status: 'not-connected' });
        return;
      }

      if (activeTab.id !== context.tabId) {
        clearCapture();
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

        clearCapture();
        connectedContextRef.current = null;
        await chrome.storage.session.remove(ACTIVE_TAB_CONTEXT_KEY);
        setSourceState({ status: 'not-connected' });
        return;
      }

      if (typeof freshTab.url !== 'string' || typeof freshTab.title !== 'string') {
        enterReconnectRequired();
        return;
      }

      if (freshTab.url !== context.url && !isSameOrigin(context.url, freshTab.url)) {
        enterReconnectRequired();
        return;
      }

      if (freshTab.url !== context.url) {
        clearCapture();

        const refreshedContext: ActiveTabContext = {
          ...context,
          title: freshTab.title,
          url: freshTab.url,
        };

        connectedContextRef.current = refreshedContext;
        await chrome.storage.session.set({
          [ACTIVE_TAB_CONTEXT_KEY]: refreshedContext,
        });
      }

      const nextSourceState = getSourceState(freshTab.title, freshTab.url);

      if (nextSourceState.status === 'unsupported') {
        clearCapture();
      }

      setSourceState(nextSourceState);

      if (nextSourceState.status === 'connected') {
        setLastRefreshedAt(Date.now());
        setRefreshFeedback('success');
      }
    } catch (error) {
      console.error('Failed to refresh source:', error);
      setSourceState({
        status: 'unexpected-error',
        message: 'Unable to refresh the connected source. Try again.',
      });
    }
  }, [clearCapture, enterReconnectRequired]);

  const captureSelection = useCallback(async () => {
    const captureRevision = captureRevisionRef.current + 1;
    captureRevisionRef.current = captureRevision;
    setCaptureState({ status: 'capturing' });

    try {
      const stored = await chrome.storage.session.get(ACTIVE_TAB_CONTEXT_KEY);
      const storedContext = stored[ACTIVE_TAB_CONTEXT_KEY];

      if (!isActiveTabContext(storedContext)) {
        if (captureRevisionRef.current === captureRevision) {
          connectedContextRef.current = null;
          setCommentary('');
          setCaptureState({ status: 'idle' });
          setSourceState({ status: 'not-connected' });
        }
        return;
      }

      const connectedTabId = storedContext.tabId;
      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (captureRevisionRef.current !== captureRevision) {
        return;
      }

      if (activeTab?.id !== connectedTabId) {
        enterReconnectRequired();
        return;
      }

      const executionResults = await chrome.scripting.executeScript({
        target: {
          tabId: connectedTabId,
          frameIds: [0],
        },
        func: extractSelectionFromPage,
      });

      if (captureRevisionRef.current !== captureRevision) {
        return;
      }

      const extractionResult = executionResults[0]?.result as
        | SelectionExtractionResult
        | undefined;

      if (!extractionResult) {
        throw new Error('The selection extractor returned no result.');
      }

      if (!extractionResult.ok) {
        setCaptureState({
          status: 'recoverable-error',
          message: getExtractionErrorMessage(extractionResult.reason),
        });
        return;
      }

      setCaptureState({ status: 'captured', data: extractionResult.data });
    } catch (error) {
      if (captureRevisionRef.current !== captureRevision) {
        return;
      }

      if (isClosedTabError(error)) {
        captureRevisionRef.current += 1;
        connectedContextRef.current = null;
        setCommentary('');
        setCaptureState({ status: 'idle' });
        setSourceState({ status: 'not-connected' });
        try {
          await chrome.storage.session.remove(ACTIVE_TAB_CONTEXT_KEY);
        } catch (storageError) {
          console.error('Failed to clear the closed connected tab:', storageError);
          setCaptureState({
            status: 'unexpected-error',
            message: UNEXPECTED_CAPTURE_MESSAGE,
          });
        }
        return;
      }

      if (isRestrictedPageError(error)) {
        setCaptureState({
          status: 'recoverable-error',
          message: RESTRICTED_PAGE_MESSAGE,
        });
        return;
      }

      console.error('Failed to capture the selected passage:', error);
      setCaptureState({
        status: 'unexpected-error',
        message: UNEXPECTED_CAPTURE_MESSAGE,
      });
    }
  }, [enterReconnectRequired]);

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

        console.error('Failed to read the Annotated action tab:', error);
        setSourceState({
          status: 'unexpected-error',
          message: 'Unable to load the connected source. Try again.',
        });
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
  const isCapturing = captureState.status === 'capturing';
  const capturedSelection =
    captureState.status === 'captured' ? captureState.data : null;
  const canCapture = sourceState.status === 'connected' && !isCapturing;

  return (
    <main className="panel">
      <header className="brand">
        <p className="eyebrow">ANNOTATED</p>
        <h1>Current source</h1>
        <p className="intro">Review the page connected to this annotation.</p>
      </header>

      {capturedSelection ? (
        <section className="capture-card">
          <h2>Captured passage</h2>
          <blockquote>{capturedSelection.selectedText}</blockquote>
          <p className="character-count">
            {capturedSelection.selectedText.length.toLocaleString()} characters
          </p>

          <dl className="capture-metadata">
            {capturedSelection.author && (
              <div>
                <dt>Author</dt>
                <dd>{capturedSelection.author}</dd>
              </div>
            )}
            {capturedSelection.publisher && (
              <div>
                <dt>Publisher</dt>
                <dd>{capturedSelection.publisher}</dd>
              </div>
            )}
            <div>
              <dt>Source</dt>
              <dd>
                {getCapturedHostname(
                  capturedSelection.canonicalUrl,
                  capturedSelection.hostname,
                )}
              </dd>
            </div>
          </dl>

          <div className="annotation-field">
            <label htmlFor="annotation-commentary">Your annotation</label>
            <textarea
              id="annotation-commentary"
              value={commentary}
              maxLength={2_000}
              rows={6}
              onChange={(event) => setCommentary(event.target.value)}
            />
            <p className="character-count" aria-live="polite" aria-atomic="true">
              {commentary.length.toLocaleString()} / 2,000 characters
            </p>
          </div>

          <div className="actions capture-actions">
            <button
              className="button button-secondary"
              type="button"
              onClick={clearCapture}
            >
              Clear capture
            </button>
            <button className="button button-primary" type="button" disabled>
              Publish — coming next
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="source-card" aria-busy={isRefreshing}>
            {(sourceState.status === 'loading' ||
              sourceState.status === 'refreshing') && (
              <div className="status">
                <span className="spinner" aria-hidden="true" />
                <p>
                  {sourceState.status === 'refreshing'
                    ? 'Refreshing source...'
                    : 'Reading the current page...'}
                </p>
              </div>
            )}

            {sourceState.status === 'unexpected-error' && (
              <div className="status status-error">
                <p className="status-title">Couldn't load this page</p>
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
                <p className="status-title">Connected tab isn't active</p>
                <p>
                  Return to the connected tab, or click the Annotated toolbar icon
                  to connect this one.
                </p>
              </div>
            )}

            {sourceState.status === 'reconnect-required' && (
              <div className="status status-reconnect">
                <p className="status-title">Reconnect to this page</p>
                <p>{RECONNECT_MESSAGE}</p>
                <p className="status-note">
                  You only need to reconnect when changing websites.
                </p>
              </div>
            )}

            {sourceState.status === 'unsupported' && (
              <div className="status status-unsupported">
                <p className="status-title">Unsupported page</p>
                <p>{RESTRICTED_PAGE_MESSAGE}</p>
                {sourceState.url && (
                  <p className="unsupported-url">{sourceState.url}</p>
                )}
              </div>
            )}

            {sourceState.status === 'connected' && (
              <div className="source-details">
                <span className="source-type">
                  {sourceState.source.classification}
                </span>
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
              disabled={isRefreshing || isCapturing}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh source'}
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={captureSelection}
              disabled={!canCapture}
            >
              {isCapturing ? 'Capturing...' : 'Capture selected text'}
            </button>
          </div>

          <div
            className={`panel-status panel-status-${sourceState.status}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {isCapturing && <p>Capturing selected text...</p>}
            {captureState.status === 'recoverable-error' && (
              <p>{captureState.message}</p>
            )}
            {captureState.status === 'reconnect-required' && (
              <p>{captureState.message}</p>
            )}
            {captureState.status === 'unexpected-error' && (
              <p>{captureState.message}</p>
            )}
            {isRefreshing && <p>Refreshing source...</p>}
            {refreshFeedback === 'success' && <p>Source updated</p>}
            {sourceState.status === 'reconnect-required' &&
              captureState.status !== 'reconnect-required' && (
                <p>{RECONNECT_MESSAGE}</p>
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
        </>
      )}
    </main>
  );
}

export default App;
