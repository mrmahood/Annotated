import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApprovedReceiptSource } from '@annotated/shared/receipt-source';
import {
  loadReceiptAssistAvailability,
  requestReceiptSuggestions,
  type ReceiptSuggestion,
} from '../../utils/receipt-sources';
import { getWebAppOrigin } from '../../utils/web-app-url';

export function ReceiptAssist({
  passage,
  pageUrl,
  signedIn,
  disabled,
  supabase,
  onApprovedChange,
}: {
  passage: string;
  pageUrl: string;
  signedIn: boolean;
  disabled: boolean;
  supabase: SupabaseClient | null;
  onApprovedChange: (sources: ApprovedReceiptSource[]) => void;
}) {
  const [availability, setAvailability] = useState<'unknown' | 'hidden' | 'ready'>('unknown');
  const [suggestion, setSuggestion] = useState<ReceiptSuggestion | null>(null);
  const [approvedUrls, setApprovedUrls] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => () => onApprovedChange([]), [onApprovedChange]);

  useEffect(() => {
    if (!signedIn) {
      setAvailability('hidden');
      return;
    }
    let origin: string;
    try {
      origin = getWebAppOrigin();
    } catch {
      setAvailability('hidden');
      return;
    }
    let current = true;
    setAvailability('unknown');
    void loadReceiptAssistAvailability(origin).then((enabled) => {
      if (current) setAvailability(enabled ? 'ready' : 'hidden');
    }).catch(() => {
      if (current) setAvailability('hidden');
    });
    return () => { current = false; };
  }, [signedIn]);

  if (availability !== 'ready') return null;

  const approve = (source: ApprovedReceiptSource) => {
    if (disabled || approvedUrls.includes(source.url)) return;
    const next = [...approvedUrls, source.url];
    setApprovedUrls(next);
    const approved = suggestion?.sources.filter((item) => next.includes(item.url)) ?? [];
    onApprovedChange(approved);
  };

  const suggest = async () => {
    if (!supabase || disabled || status === 'loading') return;
    setStatus('loading');
    setMessage(null);
    try {
      const { data, error } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (error || !token) throw new Error('AUTH_REQUIRED');
      const next = await requestReceiptSuggestions(getWebAppOrigin(), token, { passage, pageUrl });
      setSuggestion(next);
      setApprovedUrls([]);
      onApprovedChange([]);
      setStatus('idle');
    } catch {
      setStatus('error');
      setMessage('Source suggestions are unavailable right now.');
    }
  };

  return (
    <section className="receipt-assist" aria-labelledby="receipt-assist-heading">
      <div className="receipt-assist-heading">
        <h3 id="receipt-assist-heading">Sources</h3>
        <button className="button button-small" type="button" onClick={() => void suggest()} disabled={disabled || status === 'loading'}>
          {status === 'loading' ? 'Suggesting…' : 'Suggest sources'}
        </button>
      </div>
      {suggestion && (
        <>
          <p className="receipt-summary">
            <span className="ai-suggested-label">AI-suggested</span>
            {suggestion.claimSummary}
          </p>
          <ul className="receipt-source-list">
            {suggestion.sources.map((source) => {
              const added = approvedUrls.includes(source.url);
              return (
                <li key={source.url} className="receipt-source">
                  <span className="ai-suggested-label">AI-suggested</span>
                  <strong>{source.title}</strong>
                  {source.publisher && <span>{source.publisher}</span>}
                  <a href={source.url} target="_blank" rel="noopener noreferrer">{source.url}</a>
                  <button className="button button-small" type="button" onClick={() => approve(source)} disabled={disabled || added}>
                    {added ? 'Added' : 'Add source'}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {message && <p className="inline-error" role="alert">{message}</p>}
    </section>
  );
}
