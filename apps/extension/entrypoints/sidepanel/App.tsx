import { useCallback, useEffect, useState } from 'react';

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
  | { status: 'ready'; source: PageSource }
  | { status: 'unsupported'; url?: string }
  | { status: 'error'; message: string };

const chrome = (globalThis as typeof globalThis & {
  chrome: typeof browser;
}).chrome;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to read the current page.';
}

function App() {
  const [sourceState, setSourceState] = useState<SourceState>({ status: 'loading' });

  const loadSource = useCallback(async () => {
    setSourceState({ status: 'loading' });

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabUrl = tab?.url?.trim();

      if (!tabUrl) {
        setSourceState({ status: 'unsupported' });
        return;
      }

      const url = new URL(tabUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        setSourceState({ status: 'unsupported', url: tabUrl });
        return;
      }

      setSourceState({
        status: 'ready',
        source: {
          title: tab?.title?.trim() || 'Untitled page',
          hostname: url.hostname,
          url: tabUrl,
          classification: YOUTUBE_HOSTS.has(url.hostname) ? 'YouTube' : 'Web page',
        },
      });
    } catch (error) {
      setSourceState({ status: 'error', message: getErrorMessage(error) });
    }
  }, []);

  useEffect(() => {
    void loadSource();
  }, [loadSource]);

  return (
    <main className="panel">
      <header className="brand">
        <p className="eyebrow">ANNOTATED</p>
        <h1>Current source</h1>
        <p className="intro">Review the page connected to this annotation.</p>
      </header>

      <section className="source-card" aria-live="polite">
        {sourceState.status === 'loading' && (
          <div className="status">
            <span className="spinner" aria-hidden="true" />
            <p>Reading the current page…</p>
          </div>
        )}

        {sourceState.status === 'error' && (
          <div className="status status-error">
            <p className="status-title">Couldn’t load this page</p>
            <p>{sourceState.message}</p>
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

        {sourceState.status === 'ready' && (
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
        <button className="button button-primary" type="button" onClick={loadSource}>
          Refresh source
        </button>
        <button className="button button-secondary" type="button" disabled>
          Capture selection — coming next
        </button>
      </div>
    </main>
  );
}

export default App;
