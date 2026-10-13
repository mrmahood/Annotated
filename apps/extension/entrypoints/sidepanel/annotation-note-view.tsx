import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ANNOTATION_NOTE_TYPE_LABELS,
  ANNOTATION_VERDICT_LABELS,
  helpfulSourceCount,
  parseAnnotationConsensus,
  parseHelpfulRatingResult,
  type AnnotationConsensus,
  type AnnotationNoteType,
  type AnnotationSourceLink,
  type AnnotationVerdict,
} from '@annotated/shared/annotation-note';

function sourceLinkLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    const label = `${parsed.hostname}${path}`;
    return label.length > 72 ? `${label.slice(0, 69)}…` : label;
  } catch {
    return url;
  }
}

export function AnnotationNoteSummary({
  noteType,
  verdict,
  sourceLinks,
}: {
  noteType: AnnotationNoteType | null;
  verdict: AnnotationVerdict | null;
  sourceLinks: AnnotationSourceLink[];
}) {
  if (!noteType && !verdict && sourceLinks.length === 0) return null;
  return (
    <div className="note-summary">
      {(noteType || verdict) && (
        <p className="note-pills">
          {noteType && <span className="note-type">{ANNOTATION_NOTE_TYPE_LABELS[noteType]}</span>}
          {verdict && <span className={`note-verdict note-verdict-${verdict}`}>{ANNOTATION_VERDICT_LABELS[verdict]}</span>}
        </p>
      )}
      {sourceLinks.length > 0 && (
        <ul className="note-source-links">
          {sourceLinks.map((source) => (
            <li key={source.id}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {sourceLinkLabel(source.url)} <span aria-hidden="true">↗</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AnnotationConsensusPanel({
  supabase,
  annotationId,
  creatorId,
  currentUserId,
  onSignIn,
}: {
  supabase: SupabaseClient;
  annotationId: string;
  creatorId: string;
  currentUserId: string | null;
  onSignIn: (provider: 'google' | 'x') => void;
}) {
  const [consensus, setConsensus] = useState<AnnotationConsensus | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [pending, setPending] = useState<'agree' | 'disagree' | string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setStatus('loading');
    void supabase.rpc('get_annotation_consensus', { p_annotation_id: annotationId })
      .then(({ data, error }) => {
        if (!current) return;
        const parsed = error ? null : parseAnnotationConsensus(data);
        setConsensus(parsed);
        setStatus(parsed ? 'ready' : 'unavailable');
      }, () => {
        if (current) setStatus('unavailable');
      });
    return () => { current = false; };
  }, [annotationId, supabase]);

  const canRespond = Boolean(currentUserId) && currentUserId !== creatorId;
  const agree = async (value: -1 | 1) => {
    if (!canRespond || pending) return;
    setPending(value === 1 ? 'agree' : 'disagree');
    setMessage(null);
    const next = consensus?.viewerAgreement === value ? null : value;
    try {
      const { data, error } = await supabase.rpc('cast_annotation_agreement', {
        p_annotation_id: annotationId,
        p_value: next,
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row || typeof row !== 'object') {
        setMessage('Your vote was not saved.');
      } else {
        const record = row as { result_code?: string; upvote_count?: number; downvote_count?: number; current_vote?: number | null };
        if (record.result_code === 'SELF_VOTE_FORBIDDEN') setMessage('Creators cannot vote on their own annotations.');
        else if (record.result_code === 'RATE_LIMITED') setMessage('Too many vote changes. Try again later.');
        else if (typeof record.upvote_count === 'number' && typeof record.downvote_count === 'number') {
          setConsensus((current) => current ? {
            ...current,
            agreeCount: record.upvote_count as number,
            disagreeCount: record.downvote_count as number,
            viewerAgreement: record.current_vote === 1 || record.current_vote === -1 ? record.current_vote : null,
          } : current);
          setMessage(next === null ? 'Vote cleared.' : next === 1 ? 'Agree saved.' : 'Disagree saved.');
        } else setMessage('Your vote was not saved.');
      }
    } catch {
      setMessage('Your vote was not saved.');
    } finally {
      setPending(null);
    }
  };

  const toggleHelpful = async (sourceId: string) => {
    if (!canRespond || pending) return;
    setPending(sourceId);
    setMessage(null);
    try {
      const { data, error } = await supabase.rpc('rate_annotation_source_helpful', { p_source_id: sourceId });
      const result = error ? null : parseHelpfulRatingResult(data);
      if (!result || result.resultCode === 'SOURCE_UNAVAILABLE' || result.resultCode === 'AUTH_REQUIRED') {
        setMessage('That helpful rating was not saved.');
      } else if (result.resultCode === 'RATE_LIMITED') {
        setMessage('Too many ratings. Try again later.');
      } else if (result.resultCode === 'SELF_RATE_FORBIDDEN') {
        setMessage('Creators cannot rate their own sources.');
      } else {
        setConsensus((current) => current ? {
          ...current,
          sources: current.sources.map((source) => source.id === sourceId
            ? { ...source, helpfulCount: result.helpfulCount, viewerMarkedHelpful: result.viewerMarkedHelpful }
            : source),
        } : current);
        setMessage(result.viewerMarkedHelpful ? 'Marked helpful.' : 'Helpful rating removed.');
      }
    } catch {
      setMessage('That helpful rating was not saved.');
    } finally {
      setPending(null);
    }
  };

  if (status === 'loading') return <p className="note-consensus-status" role="status">Loading consensus…</p>;
  if (status === 'unavailable' || !consensus) return null;

  const total = consensus.agreeCount + consensus.disagreeCount;
  const agreeShare = total > 0 ? (consensus.agreeCount / total) * 100 : 0;

  return (
    <section className="note-consensus" aria-labelledby="consensus-heading">
      <h2 id="consensus-heading">Consensus</h2>
      <p className="note-consensus-counts">
        <span>{consensus.agreeCount.toLocaleString()} agree</span>
        <span>{consensus.disagreeCount.toLocaleString()} disagree</span>
        <span>{helpfulSourceCount(consensus.sources).toLocaleString()} helpful source ratings</span>
      </p>
      <div className="note-consensus-bar" role="img" aria-label={`${consensus.agreeCount} agree and ${consensus.disagreeCount} disagree`}>
        <span className="note-consensus-agree" style={{ width: `${agreeShare}%` }} />
      </div>
      {canRespond ? (
        <div className="note-consensus-actions">
          <button className="button button-secondary" type="button" aria-pressed={consensus.viewerAgreement === 1} disabled={pending !== null} onClick={() => void agree(1)}>Agree</button>
          <button className="button button-secondary" type="button" aria-pressed={consensus.viewerAgreement === -1} disabled={pending !== null} onClick={() => void agree(-1)}>Disagree</button>
        </div>
      ) : (
        <p className="field-hint">
          {currentUserId ? 'Creators cannot vote on their own annotations.' : 'Sign in to agree, disagree, or mark a source helpful.'}
          {!currentUserId && (
            <>
              {' '}
              <button className="text-button" type="button" onClick={() => onSignIn('google')}>Sign in with Google</button>
            </>
          )}
        </p>
      )}
      {consensus.sources.length > 0 && (
        <ul className="note-source-links">
          {consensus.sources.map((source) => (
            <li key={source.id}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">{sourceLinkLabel(source.url)} <span aria-hidden="true">↗</span></a>
              <span>{source.helpfulCount.toLocaleString()} helpful</span>
              {canRespond && (
                <button className="text-button" type="button" aria-pressed={source.viewerMarkedHelpful} disabled={pending !== null} onClick={() => void toggleHelpful(source.id)}>
                  {source.viewerMarkedHelpful ? 'Helpful' : 'Mark helpful'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {message && <p className="field-hint" role="status">{message}</p>}
    </section>
  );
}
