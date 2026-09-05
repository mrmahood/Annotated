import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

const chrome = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome;
import { formatMediaTime } from '@annotated/shared/media-time';
import {
  ANNOTATION_AUDIO_BUCKET,
  formatAudioDuration,
} from '../../utils/audio-commentary';
import {
  hostedExcerptExpandSessionKey,
  hostedExcerptStatusAfterLoad,
} from '../../utils/hosted-excerpt-expand';
import {
  getMediaPlaybackPath,
  hasHostedExcerptTranscript,
  isHostedExcerptReady,
  type HostedExcerpt,
  type HostedExcerptMedia,
  type HostedExcerptTranscript,
} from '../../utils/hosted-playback';
import { resolveHostedPlaybackSrc } from '../../utils/hosted-playback-src';
import {
  createComment,
  deleteComment,
  followProfile,
  queryAnnotation,
  queryAnnotations,
  queryComments,
  queryFollowState,
  queryProfile,
  queryPublicHostedExcerpt,
  unfollowProfile,
  type AnnotationPage,
  type CommentPage,
  type PublicAnnotation,
  type PublicComment,
  type PublicProfile,
} from '../../utils/social-data';
import {
  ANNOTATION_PAGE_SIZE,
  COMMENT_BODY_LIMIT,
  formatTimestamp,
  getPublicAnnotationPath,
  getInitial,
  RequestRevision,
  mergeCommentPages,
} from '../../utils/social-helpers';
import {
  annotationMatchesConnectedArticle,
  articleHoverNestedChipHandlers,
  articleHoverRegionHandlers,
  ARTICLE_PASSAGE_MISS_OPEN_HINT,
  ARTICLE_PASSAGE_MISS_STATUS,
  cancelArticleHoverLink,
  type ArticleHoverApplyResult,
  type ArticleHoverConnection,
  type ArticleHoverResultListener,
} from '../../utils/article-hover-link';
import {
  ARTICLE_HOVER_PENDING_KEY,
  ARTICLE_PENDING_CONNECT_HINT,
  articleHoverPendingMatchesTarget,
  openArticleSourceFromPanel,
  readArticleHoverPending,
} from '../../utils/article-hover-pending';
import { getSourceOpenUrl } from '../../utils/source-open-url';
import {
  cancelYouTubeHoverLink,
  enterYouTubeHoverLink,
  youtubeHoverNestedChipHandlers,
  youtubeHoverRegionHandlers,
  type YouTubeHoverConnection,
} from '../../utils/youtube-hover-link';

export type SessionSocialCache = Map<string, AnnotationPage>;

type NavigationCallbacks = {
  openAnnotation: (annotationId: string) => void;
  openComments: (annotationId: string) => void;
  openProfile: (profileId: string) => void;
};

type AuthProps = {
  currentUserId: string | null;
  onSignIn: () => void;
};

function getAudioPublicUrl(supabase: SupabaseClient, storagePath: string) {
  const publicUrl = supabase.storage
    .from(ANNOTATION_AUDIO_BUCKET)
    .getPublicUrl(storagePath).data.publicUrl;
  try {
    const url = new URL(publicUrl);
    return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost')
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function getDurationDateTime(durationMs: number): string {
  return `PT${durationMs / 1_000}S`;
}

function HostedExcerptPlayer({
  annotationId,
  media,
  getPublicUrl,
  compact = false,
}: {
  annotationId: string;
  media: HostedExcerptMedia;
  getPublicUrl: (path: string) => string | null;
  compact?: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  const [mediaSrc, setMediaSrc] = useState<string | null>(null);
  let playbackUrl: string | null = null;
  try {
    playbackUrl = getPublicUrl(getMediaPlaybackPath(annotationId, attempt));
  } catch {
    playbackUrl = null;
  }

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setMediaSrc(null);

    if (!playbackUrl) {
      setUnavailable(true);
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    const supabaseUrl = import.meta.env.WXT_SUPABASE_URL;
    void resolveHostedPlaybackSrc({
      playbackUrl,
      supabaseUrl: typeof supabaseUrl === 'string' ? supabaseUrl : '',
      signal: controller.signal,
    }).then((resolved) => {
      if (cancelled) return;
      if (resolved) {
        setMediaSrc(resolved);
        setUnavailable(false);
        return;
      }
      if (attempt === 0) setAttempt(1);
      else setUnavailable(true);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [playbackUrl, attempt]);

  const onError = () => {
    if (attempt === 0) setAttempt(1);
    else setUnavailable(true);
  };
  const player = mediaSrc && media.mimeType === 'video/mp4' ? (
    <video
      key={`${annotationId}:${attempt}`}
      controls
      controlsList="nodownload"
      preload="metadata"
      src={mediaSrc}
      onError={onError}
      onLoadedMetadata={() => setUnavailable(false)}
      aria-label="Archived source video excerpt"
    >
      Your browser cannot play this video excerpt.
    </video>
  ) : mediaSrc ? (
    <audio
      key={`${annotationId}:${attempt}`}
      controls
      controlsList="nodownload"
      preload="metadata"
      src={mediaSrc}
      onError={onError}
      onLoadedMetadata={() => setUnavailable(false)}
      aria-label="Archived source audio excerpt"
    >
      Your browser cannot play this audio excerpt.
    </audio>
  ) : unavailable ? (
    <p className="inline-error" role="status">
      The archived excerpt is temporarily unavailable. The original source remains linked above.
    </p>
  ) : null;

  if (compact) {
    return (
      <div className="card-hosted-media">
        {player}
        {mediaSrc && unavailable && (
          <p className="inline-error" role="status">
            The archived excerpt is temporarily unavailable. The original source remains linked above.
          </p>
        )}
      </div>
    );
  }

  return (
    <section className="detail-hosted-media" aria-labelledby="detail-hosted-media-heading">
      <div className="detail-hosted-heading">
        <span className="section-label" id="detail-hosted-media-heading">
          {media.mimeType === 'video/mp4' ? 'Video excerpt' : 'Audio excerpt'}
        </span>
        <span>{formatMediaTime(media.durationMs)}</span>
      </div>
      {player}
      {mediaSrc && unavailable && (
        <p className="inline-error" role="status">
          The archived excerpt is temporarily unavailable. The original source remains linked above.
        </p>
      )}
    </section>
  );
}

function youtubeClipHoverTarget(annotation: PublicAnnotation) {
  return annotation.kind === 'youtube'
    ? {
        videoId: annotation.source.videoId,
        startMs: annotation.startMs,
        endMs: annotation.endMs,
      }
    : null;
}

function articlePassageHoverTarget(annotation: PublicAnnotation) {
  return annotation.kind === 'article'
    ? {
        selectedText: annotation.selectedText,
        canonicalUrl: annotation.source.canonicalUrl,
        normalizedUrl: annotation.source.normalizedUrl,
      }
    : null;
}

function sourceOpenHref(annotation: PublicAnnotation): string {
  return getSourceOpenUrl({
    kind: annotation.kind,
    canonicalUrl: annotation.source.canonicalUrl,
    selectedText: annotation.kind === 'article' ? annotation.selectedText : null,
    startMs: annotation.startMs,
  });
}

function handleArticleSourceOpenClick(
  event: { preventDefault: () => void },
  annotation: PublicAnnotation,
  connection: ArticleHoverConnection | null,
  href: string,
  onResult?: ArticleHoverResultListener,
  onAwaitingConnection?: (awaiting: boolean) => void,
) {
  const target = articlePassageHoverTarget(annotation);
  if (!target) return;
  event.preventDefault();
  void openArticleSourceFromPanel({
    target,
    connection,
    href,
    openFallback: (openHref) => {
      window.open(openHref, '_blank', 'noopener,noreferrer');
    },
  }).then((outcome) => {
    if (outcome.applied) onResult?.(outcome.applied);
    onAwaitingConnection?.(outcome.awaitingConnection);
  });
}

function useArticlePassageMiss(
  annotationId: string,
  connection: ArticleHoverConnection | null,
) {
  const [passageMissed, setPassageMissed] = useState(false);
  const connectionKey = connection ? `${connection.tabId}:${connection.tabUrl}` : '';

  useEffect(() => {
    setPassageMissed(false);
  }, [annotationId, connectionKey]);

  const onArticleHoverResult = useCallback((result: ArticleHoverApplyResult) => {
    if (result.status === 'unmatched') setPassageMissed(true);
    if (result.status === 'matched') setPassageMissed(false);
  }, []);

  return { passageMissed, onArticleHoverResult };
}

function ArticlePassageMissStatus({
  show,
  annotation,
  connection,
}: {
  show: boolean;
  annotation: PublicAnnotation;
  connection: ArticleHoverConnection | null;
}) {
  if (
    !show ||
    !connection ||
    !annotationMatchesConnectedArticle(annotation, connection.tabUrl)
  ) {
    return null;
  }
  return (
    <p className="article-passage-miss" role="status">
      {ARTICLE_PASSAGE_MISS_STATUS}
      <span>{ARTICLE_PASSAGE_MISS_OPEN_HINT}</span>
    </p>
  );
}

function useArticlePendingConnectHint(annotation: PublicAnnotation | null) {
  const [awaiting, setAwaiting] = useState(false);
  const target = annotation ? articlePassageHoverTarget(annotation) : null;
  const targetKey = target
    ? `${target.normalizedUrl}\n${target.canonicalUrl}\n${target.selectedText}`
    : '';

  useEffect(() => {
    if (!awaiting || !target) return;
    let mounted = true;
    const matchedTarget = target;
    const sync = async () => {
      const pending = await readArticleHoverPending();
      if (!mounted) return;
      if (!pending || !articleHoverPendingMatchesTarget(pending, matchedTarget)) {
        setAwaiting(false);
      }
    };
    void sync();
    const onChange = (changes: Record<string, Browser.storage.StorageChange>, area: string) => {
      if (area === 'session' && Object.prototype.hasOwnProperty.call(changes, ARTICLE_HOVER_PENDING_KEY)) {
        void sync();
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => {
      mounted = false;
      chrome.storage.onChanged.removeListener(onChange);
    };
  }, [awaiting, targetKey]);

  return {
    showHint: awaiting,
    onAwaitingConnection: (value: boolean) => setAwaiting(value),
  };
}

function ArticlePendingConnectHint({ show }: { show: boolean }) {
  if (!show) return null;
  return <p className="article-pending-connect-hint">{ARTICLE_PENDING_CONNECT_HINT}</p>;
}

function ExcerptTranscript({
  transcript,
  youtubeHover = null,
  clipTarget = null,
}: {
  transcript: HostedExcerptTranscript;
  youtubeHover?: YouTubeHoverConnection | null;
  clipTarget?: { videoId: string; startMs: number; endMs: number } | null;
}) {
  return (
    <section className="detail-transcript" aria-labelledby="detail-transcript-heading">
      <span className="section-label" id="detail-transcript-heading">Excerpt transcript</span>
      <p className="transcript-text">{transcript.text}</p>
      {transcript.segments && transcript.segments.length > 0 && (
        <ol className="transcript-segments" aria-label="Timestamped excerpt transcript">
          {transcript.segments.map((segment) => (
            <li
              key={`${segment.startMs}:${segment.endMs}`}
              {...youtubeHoverRegionHandlers(youtubeHover, clipTarget ? {
                videoId: clipTarget.videoId,
                strength: 'strong',
                startMs: segment.startMs,
                endMs: segment.endMs,
                seekMs: segment.startMs,
              } : null)}
            >
              <span>
                <time dateTime={getDurationDateTime(segment.startMs)}>{formatMediaTime(segment.startMs)}</time>
                –
                <time dateTime={getDurationDateTime(segment.endMs)}>{formatMediaTime(segment.endMs)}</time>
              </span>
              <p>{segment.text}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Avatar({ name, url, size = 30 }: { name: string; url: string | null; size?: number }) {
  return url ? (
    <img
      className="social-avatar"
      src={url}
      alt=""
      width={size}
      height={size}
      referrerPolicy="no-referrer"
    />
  ) : (
    <span className="social-avatar social-avatar-fallback" style={{ width: size, height: size }} aria-hidden="true">
      {getInitial(name)}
    </span>
  );
}

function sourceChipLabel(annotation: PublicAnnotation): string {
  if (annotation.kind === 'youtube') return 'Video';
  if (annotation.kind === 'audio') return 'Audio';
  return 'Text';
}

function AnnotationCard({ annotation, navigation, supabase, getPublicUrl, youtubeHover = null, articleHover = null }: {
  annotation: PublicAnnotation;
  navigation: NavigationCallbacks;
  supabase: SupabaseClient;
  getPublicUrl: (path: string) => string | null;
  youtubeHover?: YouTubeHoverConnection | null;
  articleHover?: ArticleHoverConnection | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [hosted, setHosted] = useState<HostedExcerpt | null>(
    annotation.kind === 'article' ? null : annotation.hosted,
  );
  const [hostedStatus, setHostedStatus] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>(
    annotation.kind !== 'article' && isHostedExcerptReady(annotation.hosted) ? 'ready' : 'idle',
  );
  const { passageMissed, onArticleHoverResult } = useArticlePassageMiss(annotation.id, articleHover);
  const { showHint, onAwaitingConnection } = useArticlePendingConnectHint(annotation);
  const sourceUrl = sourceOpenHref(annotation);
  const sourceTitle = annotation.source.title ?? annotation.source.hostname;
  const hasPassage = annotation.kind === 'article';
  const hasArticleAudio = annotation.kind === 'article' && Boolean(annotation.audio);
  const hostedReady = isHostedExcerptReady(hosted) ? hosted : null;
  const hostedTranscript = hostedReady && hasHostedExcerptTranscript(hostedReady.transcript)
    ? hostedReady.transcript
    : null;
  const audioUrl = hasArticleAudio && annotation.audio
    ? getAudioPublicUrl(supabase, annotation.audio.storagePath)
    : null;
  const annotationRef = useRef(annotation);
  annotationRef.current = annotation;
  const hostedReadyRef = useRef(hostedReady);
  hostedReadyRef.current = hostedReady;
  const expandSessionKey = hostedExcerptExpandSessionKey({
    expanded,
    annotationId: annotation.id,
    kind: annotation.kind,
  });

  useEffect(() => {
    if (!expandSessionKey) return;
    if (hostedReadyRef.current) {
      setHostedStatus('ready');
      return;
    }

    const current = annotationRef.current;
    if (current.kind === 'article') return;

    let cancelled = false;
    setHostedStatus('loading');
    void queryPublicHostedExcerpt(supabase, current)
      .then((result) => {
        if (cancelled) return;
        setHosted(result);
        setHostedStatus(hostedExcerptStatusAfterLoad(result));
      })
      .catch(() => {
        if (cancelled) return;
        setHosted(null);
        setHostedStatus('unavailable');
      });
    return () => { cancelled = true; };
  }, [expandSessionKey, supabase]);

  const nestedPreview = hasPassage ? (
    <span className={`passage-excerpt${expanded ? ' expanded' : ''}`}>“{annotation.selectedText}”</span>
  ) : (
    <span className={`clip-range${expanded ? ' expanded' : ''}`}>
      {formatMediaTime(annotation.startMs)}–{formatMediaTime(annotation.endMs)}
      {expanded && <> · {formatMediaTime(annotation.endMs - annotation.startMs)}</>}
    </span>
  );
  const clipTarget = youtubeClipHoverTarget(annotation);
  const articleTarget = articlePassageHoverTarget(annotation);
  const cardHover = articleTarget
    ? articleHoverRegionHandlers(articleHover, { ...articleTarget, strength: 'soft' }, onArticleHoverResult)
    : youtubeHoverRegionHandlers(
      youtubeHover,
      clipTarget ? { ...clipTarget, strength: 'soft' } : null,
    );
  const chipHover = articleTarget
    ? articleHoverNestedChipHandlers(articleHover, articleTarget, onArticleHoverResult)
    : youtubeHoverNestedChipHandlers(youtubeHover, clipTarget);

  return (
    <article className="social-card">
      <header className="social-card-header">
        <button className="text-button creator-button" type="button" onClick={() => navigation.openProfile(annotation.creator.id)}>
          <Avatar name={annotation.creator.displayName} url={annotation.creator.avatarUrl} />
          <span>{annotation.creator.displayName}</span>
        </button>
        <time dateTime={annotation.publishedAt}>{formatTimestamp(annotation.publishedAt)}</time>
      </header>
      <div className="annotation-card-body" {...cardHover}>
        <p className="commentary-lead">{annotation.commentaryText}</p>
        <div className="nested-source">
          <button
            className="nested-source-body"
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
            {...chipHover}
          >
            <span className="source-chip-row">
              <span className="source-chip">{sourceChipLabel(annotation)}</span>
              <span className="nested-source-title">{sourceTitle}</span>
            </span>
            <span className="nested-source-host">{annotation.source.hostname}</span>
            {nestedPreview}
          </button>
          {expanded && hostedStatus === 'loading' && <span className="nested-source-host">Loading excerpt…</span>}
          {expanded && hostedStatus === 'unavailable' && <span className="nested-source-host">Excerpt unavailable</span>}
          {expanded && hostedReady && (
            <HostedExcerptPlayer
              annotationId={annotation.id}
              media={hostedReady.media}
              getPublicUrl={getPublicUrl}
              compact
            />
          )}
          {expanded && hostedTranscript && hostedTranscript.segments && hostedTranscript.segments.length > 0 ? (
            <ol className="transcript-peek-segments" aria-label="Excerpt transcript">
              {hostedTranscript.segments.map((segment) => (
                <li
                  key={`${segment.startMs}:${segment.endMs}`}
                  className="transcript-peek"
                  onPointerEnter={() => {
                    if (!youtubeHover || !clipTarget) return;
                    enterYouTubeHoverLink(youtubeHover, {
                      videoId: clipTarget.videoId,
                      strength: 'strong',
                      startMs: segment.startMs,
                      endMs: segment.endMs,
                      seekMs: segment.startMs,
                    });
                  }}
                  onPointerLeave={() => {
                    if (!youtubeHover || !clipTarget) return;
                    enterYouTubeHoverLink(youtubeHover, { ...clipTarget, strength: 'soft' });
                  }}
                >
                  {segment.text}
                </li>
              ))}
            </ol>
          ) : expanded && hostedTranscript ? (
            <p className="transcript-peek">{hostedTranscript.text}</p>
          ) : null}
          {expanded && hasArticleAudio && audioUrl && (
            <audio controls preload="metadata" src={audioUrl} aria-label="Published audio commentary" />
          )}
          <a className="open-source-link" href={sourceUrl} target="_blank" rel="noopener noreferrer" onClick={(event) => handleArticleSourceOpenClick(event, annotation, articleHover, sourceUrl, onArticleHoverResult, onAwaitingConnection)}>Open source ↗</a>
          <ArticlePendingConnectHint show={showHint} />
          <ArticlePassageMissStatus show={passageMissed} annotation={annotation} connection={articleHover} />
        </div>
      </div>
      <footer className="social-card-actions">
        <button className="text-button" type="button" onClick={() => navigation.openComments(annotation.id)}>
          {annotation.commentCount.toLocaleString()} {annotation.commentCount === 1 ? 'comment' : 'comments'}
        </button>
        <button className="text-button" type="button" onClick={() => navigation.openAnnotation(annotation.id)}>
          View annotation
        </button>
      </footer>
    </article>
  );
}

export function AnnotationCollection({
  supabase,
  cache,
  cacheKey,
  navigation,
  getPublicUrl,
  sourceUrl,
  profileId,
  emptyTitle,
  emptyMessage,
  compactHeading,
  youtubeHover = null,
  articleHover = null,
}: {
  supabase: SupabaseClient;
  cache: SessionSocialCache;
  cacheKey: string;
  navigation: NavigationCallbacks;
  getPublicUrl: (path: string) => string | null;
  sourceUrl?: string;
  profileId?: string;
  emptyTitle: string;
  emptyMessage: string;
  compactHeading?: string;
  youtubeHover?: YouTubeHoverConnection | null;
  articleHover?: ArticleHoverConnection | null;
}) {
  const [page, setPage] = useState<AnnotationPage | null>(() => cache.get(cacheKey) ?? null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(page ? 'ready' : 'loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revisions = useRef(new RequestRevision());

  useEffect(() => () => {
    cancelYouTubeHoverLink();
    cancelArticleHoverLink();
  }, []);

  const loadInitial = useCallback(async (force = false) => {
    const revision = revisions.current.begin();
    const cached = !force ? cache.get(cacheKey) : undefined;
    if (cached) {
      setPage(cached);
      setStatus('ready');
      return;
    }
    setStatus('loading');
    setError(null);
    try {
      const result = await queryAnnotations(supabase, { sourceUrl, profileId });
      if (!revisions.current.isCurrent(revision)) return;
      cache.set(cacheKey, result);
      setPage(result);
      setStatus('ready');
    } catch {
      if (!revisions.current.isCurrent(revision)) return;
      setStatus('error');
      setError('Annotations could not be loaded. Check your connection and try again.');
    }
  }, [cache, cacheKey, profileId, sourceUrl, supabase]);

  useEffect(() => {
    void loadInitial();
    return () => revisions.current.invalidate();
  }, [loadInitial]);

  const loadMore = async () => {
    if (!page || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const next = await queryAnnotations(supabase, {
        sourceUrl,
        profileId,
        offset: page.annotations.length,
      });
      const merged = {
        annotations: [...page.annotations, ...next.annotations],
        total: next.total,
        hasMore: next.hasMore,
      };
      cache.set(cacheKey, merged);
      setPage(merged);
    } catch {
      setError('More annotations could not be loaded. Try again.');
    } finally {
      setLoadingMore(false);
    }
  };

  if (status === 'loading') {
    return <div className="compact-state" role="status"><strong>Loading annotations</strong><span>Reading published activity…</span></div>;
  }
  if (status === 'error') {
    return <div className="compact-state compact-state-error" role="alert"><strong>Annotations unavailable</strong><span>{error}</span><button className="button button-secondary" type="button" onClick={() => void loadInitial(true)}>Try again</button></div>;
  }
  if (!page || page.annotations.length === 0) {
    return <div className="compact-state"><strong>{emptyTitle}</strong><span>{emptyMessage}</span></div>;
  }

  return (
    <section className="social-list-section" aria-label={compactHeading ?? 'Annotations'}>
      {compactHeading && <div className="section-heading"><h2>{compactHeading}</h2><span>{page.total ?? page.annotations.length}</span></div>}
      <div className="social-list">
        {page.annotations.map((annotation) => <AnnotationCard key={annotation.id} annotation={annotation} navigation={navigation} supabase={supabase} getPublicUrl={getPublicUrl} youtubeHover={youtubeHover} articleHover={articleHover} />)}
      </div>
      {page.hasMore && (
        <button className="button button-secondary load-more" type="button" onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : `Load ${ANNOTATION_PAGE_SIZE} more`}
        </button>
      )}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </section>
  );
}

function FollowControl({ supabase, profile, currentUserId, onSignIn, onCountChange }: {
  supabase: SupabaseClient;
  profile: Pick<PublicProfile, 'id' | 'followerCount'>;
  onCountChange?: (count: number) => void;
} & AuthProps) {
  const [following, setFollowing] = useState(false);
  const [count, setCount] = useState(profile.followerCount);
  const [status, setStatus] = useState<'loading' | 'idle' | 'working'>('loading');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const self = currentUserId === profile.id;

  useEffect(() => {
    let current = true;
    if (self || !currentUserId) {
      setStatus('idle');
      setFollowing(false);
      return;
    }
    setStatus('loading');
    void queryFollowState(supabase, profile.id, currentUserId)
      .then((value) => { if (current) { setFollowing(value); setStatus('idle'); } })
      .catch(() => { if (current) { setError('Follow state is unavailable.'); setStatus('idle'); } });
    return () => { current = false; };
  }, [currentUserId, profile.id, self, supabase]);

  if (self) return <span className="social-count">{count.toLocaleString()} followers</span>;

  const mutate = async (nextFollowing: boolean) => {
    if (!currentUserId) { onSignIn(); return; }
    if (status === 'working') return;
    setStatus('working');
    setError(null);
    try {
      if (nextFollowing) await followProfile(supabase, profile.id);
      else await unfollowProfile(supabase, profile.id);
      const nextCount = Math.max(0, count + (nextFollowing ? 1 : -1));
      setFollowing(nextFollowing);
      setCount(nextCount);
      onCountChange?.(nextCount);
      setConfirming(false);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'Follow state could not be changed.');
    } finally {
      setStatus('idle');
    }
  };

  return (
    <div className="follow-control">
      <span className="social-count">{count.toLocaleString()} followers</span>
      {!currentUserId ? (
        <button className="button button-secondary button-small" type="button" onClick={onSignIn}>Continue with Google</button>
      ) : confirming ? (
        <span className="inline-confirm" role="group" aria-label="Confirm unfollow">
          <span>Unfollow?</span>
          <button className="text-button danger-text" type="button" onClick={() => void mutate(false)} disabled={status === 'working'}>Confirm</button>
          <button className="text-button" type="button" onClick={() => setConfirming(false)} disabled={status === 'working'}>Cancel</button>
        </span>
      ) : (
        <button className="button button-secondary button-small" type="button" disabled={status !== 'idle'} onClick={() => following ? setConfirming(true) : void mutate(true)}>
          {status === 'loading' ? 'Checking…' : status === 'working' ? 'Saving…' : following ? 'Following' : 'Follow'}
        </button>
      )}
      {error && <span className="inline-error" role="alert">{error}</span>}
    </div>
  );
}

function Comments({ supabase, annotationId, currentUserId, onSignIn, onProfile, autoFocus, onCountChange, onMutation }: {
  supabase: SupabaseClient;
  annotationId: string;
  onProfile: (profileId: string) => void;
  autoFocus?: boolean;
  onCountChange?: (count: number) => void;
  onMutation?: () => void;
} & AuthProps) {
  const [page, setPage] = useState<CommentPage | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const refresh = useCallback(async () => {
    setStatus('loading');
    try {
      setPage(await queryComments(supabase, annotationId));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [annotationId, supabase]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (autoFocus && status === 'ready') headingRef.current?.focus(); }, [autoFocus, status]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentUserId) { onSignIn(); return; }
    if (posting || !body.trim() || body.length > COMMENT_BODY_LIMIT) return;
    const submittedBody = body;
    setPosting(true);
    setError(null);
    try {
      await createComment(supabase, annotationId, submittedBody);
      const next = await queryComments(supabase, annotationId);
      setPage(next);
      onCountChange?.(next.total);
      onMutation?.();
      setStatus('ready');
      setBody((current) => current === submittedBody ? '' : current);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'The comment could not be posted.');
    } finally {
      setPosting(false);
    }
  };

  const remove = async (comment: PublicComment) => {
    if (deletingId) return;
    setDeletingId(comment.id);
    setError(null);
    try {
      await deleteComment(supabase, comment.id);
      const nextTotal = Math.max(0, (page?.total ?? 1) - 1);
      setPage((current) => current ? {
        ...current,
        comments: current.comments.filter(({ id }) => id !== comment.id),
        total: nextTotal,
      } : current);
      onCountChange?.(nextTotal);
      onMutation?.();
      setConfirmDeleteId(null);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'The comment could not be deleted.');
    } finally {
      setDeletingId(null);
    }
  };

  const loadMore = async () => {
    if (!page || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await queryComments(supabase, annotationId, page.comments.length);
      setPage({
        comments: mergeCommentPages(page.comments, next.comments),
        total: next.total,
        hasMore: next.hasMore,
      });
    } catch {
      setError('More comments could not be loaded.');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <section className="comments-panel" aria-labelledby="comments-heading">
      <div className="section-heading">
        <h2 id="comments-heading" ref={headingRef} tabIndex={autoFocus ? -1 : undefined}>Comments</h2>
        <span>{page?.total ?? '—'}</span>
      </div>
      {status === 'loading' && <div className="compact-state" role="status">Loading comments…</div>}
      {status === 'error' && <div className="compact-state compact-state-error" role="alert"><strong>Comments unavailable</strong><button className="button button-secondary" type="button" onClick={() => void refresh()}>Try again</button></div>}
      {status === 'ready' && page?.comments.length === 0 && <div className="compact-state"><strong>No comments yet</strong><span>Start the conversation.</span></div>}
      {status === 'ready' && page && page.comments.length > 0 && (
        <ol className="comment-list">
          {page.comments.map((comment) => (
            <li key={comment.id} className="comment-item">
              <Avatar name={comment.author.displayName} url={comment.author.avatarUrl} size={26} />
              <div>
                <div className="comment-meta"><button className="text-button" type="button" onClick={() => onProfile(comment.userId)}>{comment.author.displayName}</button><time dateTime={comment.createdAt}>{formatTimestamp(comment.createdAt)}</time></div>
                <p>{comment.body}</p>
                {comment.userId === currentUserId && (confirmDeleteId === comment.id ? (
                  <div className="inline-confirm" role="group" aria-label="Confirm comment deletion"><span>Delete permanently?</span><button className="text-button danger-text" type="button" disabled={deletingId === comment.id} onClick={() => void remove(comment)}>{deletingId === comment.id ? 'Deleting…' : 'Delete'}</button><button className="text-button" type="button" disabled={Boolean(deletingId)} onClick={() => setConfirmDeleteId(null)}>Cancel</button></div>
                ) : <button className="text-button comment-delete" type="button" onClick={() => setConfirmDeleteId(comment.id)}>Delete</button>)}
              </div>
            </li>
          ))}
        </ol>
      )}
      {page?.hasMore && <button className="button button-secondary load-more" type="button" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Show more comments'}</button>}
      <div className="comment-composer">
        <h3>Add a comment</h3>
        {!currentUserId ? (
          <div className="signed-out-action"><span>Sign in to participate.</span><button className="button button-primary button-small" type="button" onClick={onSignIn}>Continue with Google</button></div>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            <label htmlFor={`comment-${annotationId}`}>Comment</label>
            <textarea id={`comment-${annotationId}`} value={body} rows={4} maxLength={COMMENT_BODY_LIMIT} onChange={(event) => setBody(event.target.value)} />
            <div className="composer-footer"><span aria-live="polite">{body.length.toLocaleString()} / 1,000</span><button className="button button-primary button-small" type="submit" disabled={posting || !body.trim()}>{posting ? 'Posting…' : 'Post comment'}</button></div>
          </form>
        )}
        {error && <p className="inline-error" role="alert">{error}</p>}
      </div>
    </section>
  );
}

export function AnnotationDetailView({
  supabase,
  annotationId,
  currentUserId,
  onSignIn,
  navigation,
  getPublicUrl,
  focusComments = false,
  onSocialMutation,
  connectedVideoId = null,
  onPlayConnectedClip,
  connectedAudioNormalizedUrl = null,
  onPlayConnectedAudioClip,
  youtubeHover = null,
  articleHover = null,
}: {
  supabase: SupabaseClient;
  annotationId: string;
  navigation: NavigationCallbacks;
  getPublicUrl: (path: string) => string | null;
  focusComments?: boolean;
  onSocialMutation?: () => void;
  connectedVideoId?: string | null;
  onPlayConnectedClip?: (annotation: Extract<PublicAnnotation, { kind: 'youtube' }>) => Promise<void>;
  connectedAudioNormalizedUrl?: string | null;
  onPlayConnectedAudioClip?: (annotation: Extract<PublicAnnotation, { kind: 'audio' }>) => Promise<void>;
  youtubeHover?: YouTubeHoverConnection | null;
  articleHover?: ArticleHoverConnection | null;
} & AuthProps) {
  const [annotation, setAnnotation] = useState<PublicAnnotation | null>(null);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [audioError, setAudioError] = useState<string | null>(null);
  const [playState, setPlayState] = useState<'idle' | 'playing' | 'error'>('idle');
  const { passageMissed, onArticleHoverResult } = useArticlePassageMiss(annotationId, articleHover);
  const { showHint, onAwaitingConnection } = useArticlePendingConnectHint(annotation);

  useEffect(() => {
    let current = true;
    setStatus('loading');
    void queryAnnotation(supabase, annotationId)
      .then(async (result) => {
        if (!current) return;
        if (!result) { setStatus('missing'); return; }
        setAnnotation(result);
        setStatus('ready');
        try {
          const creator = await queryProfile(supabase, result.creator.id);
          if (current) setProfile(creator);
        } catch { /* Detail remains readable if social counts fail. */ }
      })
      .catch(() => { if (current) setStatus('error'); });
    return () => { current = false; };
  }, [annotationId, supabase]);

  if (status === 'loading') return <div className="compact-state view-state" role="status"><strong>Loading annotation</strong><span>Retrieving published detail…</span></div>;
  if (status === 'missing') return <div className="compact-state view-state"><strong>Annotation unavailable</strong><span>It may have been removed or is not public.</span></div>;
  if (status === 'error' || !annotation) return <div className="compact-state compact-state-error view-state" role="alert"><strong>Annotation unavailable</strong><span>Check your connection and go back to try again.</span></div>;
  const publicUrl = getPublicUrl(getPublicAnnotationPath(annotation.route, annotation.id));
  const audioUrl = annotation.audio
    ? getAudioPublicUrl(supabase, annotation.audio.storagePath)
    : null;
  const sourceOpenUrl = sourceOpenHref(annotation);
  const hostedReady = annotation.kind !== 'article' && isHostedExcerptReady(annotation.hosted)
    ? annotation.hosted
    : null;
  const hostedTranscript = hostedReady && hasHostedExcerptTranscript(hostedReady.transcript)
    ? hostedReady.transcript
    : null;
  const hostedRemoved = annotation.kind !== 'article' && annotation.hosted?.status === 'removed';
  const canPlayConnectedClip = !hostedReady && annotation.kind === 'youtube' &&
    connectedVideoId === annotation.source.videoId;
  const canPlayConnectedAudioClip = !hostedReady && annotation.kind === 'audio' &&
    connectedAudioNormalizedUrl === annotation.source.normalizedUrl;
  const clipTarget = youtubeClipHoverTarget(annotation);
  const articleTarget = articlePassageHoverTarget(annotation);
  const commentaryHover = articleTarget
    ? articleHoverRegionHandlers(articleHover, { ...articleTarget, strength: 'soft' }, onArticleHoverResult)
    : youtubeHoverRegionHandlers(
      youtubeHover,
      clipTarget ? { ...clipTarget, strength: 'soft' } : null,
    );
  const sourceHover = articleTarget
    ? articleHoverNestedChipHandlers(articleHover, articleTarget, onArticleHoverResult)
    : youtubeHoverNestedChipHandlers(youtubeHover, clipTarget);
  const playConnected = async () => {
    if (annotation.kind === 'article' || hostedReady) return;
    if (annotation.kind === 'youtube' && !onPlayConnectedClip) return;
    if (annotation.kind === 'audio' && !onPlayConnectedAudioClip) return;
    setPlayState('playing');
    try {
      if (annotation.kind === 'youtube') await onPlayConnectedClip!(annotation);
      else await onPlayConnectedAudioClip!(annotation);
      setPlayState('idle');
    } catch {
      setPlayState('error');
    }
  };

  return (
    <article className="detail-view">
      <header className="detail-creator">
        <button className="text-button creator-button" type="button" onClick={() => navigation.openProfile(annotation.creator.id)}><Avatar name={annotation.creator.displayName} url={annotation.creator.avatarUrl} size={34} /><span><strong>{annotation.creator.displayName}</strong><time dateTime={annotation.publishedAt}>Published {formatTimestamp(annotation.publishedAt)}</time></span></button>
        {profile && <FollowControl supabase={supabase} profile={profile} currentUserId={currentUserId} onSignIn={onSignIn} />}
      </header>
      {annotation.kind === 'article' ? <>
        <section className="detail-source" {...sourceHover}><span className="section-label">Original article</span><h1>{annotation.source.title ?? annotation.source.hostname}</h1>{(annotation.source.author || annotation.source.publisher) && <p>{annotation.source.author && `By ${annotation.source.author}`}{annotation.source.author && annotation.source.publisher && ' · '}{annotation.source.publisher}</p>}<span className="source-kicker">{annotation.source.hostname}</span><a className="button button-primary" href={sourceOpenUrl} target="_blank" rel="noopener noreferrer" onClick={(event) => handleArticleSourceOpenClick(event, annotation, articleHover, sourceOpenUrl, onArticleHoverResult, onAwaitingConnection)}>View original source ↗</a><ArticlePendingConnectHint show={showHint} /></section>
        <section className="detail-passage" {...sourceHover}><span className="section-label">Captured passage</span><blockquote>{annotation.selectedText}</blockquote><ArticlePassageMissStatus show={passageMissed} annotation={annotation} connection={articleHover} /></section>
      </> : annotation.kind === 'youtube' ? <>
        <section className="detail-source" {...sourceHover}><span className="section-label">YouTube source</span><h1>{annotation.source.title ?? 'YouTube video'}</h1>{annotation.source.author && <p>{annotation.source.author}</p>}<span className="source-kicker">youtube.com</span><div className="clip-action-row">{canPlayConnectedClip && onPlayConnectedClip && <button className="button button-primary" type="button" onClick={() => void playConnected()} disabled={playState === 'playing'}>{playState === 'playing' ? 'Starting…' : 'Play clip'}</button>}<a className={canPlayConnectedClip || hostedReady ? 'button button-secondary' : 'button button-primary'} href={sourceOpenUrl} target="_blank" rel="noopener noreferrer">Open on YouTube ↗</a></div>{playState === 'error' && <p className="inline-error" role="alert">The connected YouTube player could not be started. Reconnect the video and try again.</p>}</section>
        <section className="detail-clip-range" {...sourceHover}><span className="section-label">Saved clip</span><strong>{formatMediaTime(annotation.startMs)}–{formatMediaTime(annotation.endMs)}</strong><span>{formatMediaTime(annotation.endMs - annotation.startMs)} long</span></section>
      </> : <>
        <section className="detail-source"><span className="section-label">Podcast / web audio</span><h1>{annotation.source.title ?? 'Audio episode'}</h1>{(annotation.source.showName || annotation.source.author || annotation.source.publisher) && <p>{[annotation.source.showName, annotation.source.author, annotation.source.publisher].filter(Boolean).join(' · ')}</p>}<span className="source-kicker">{annotation.source.hostname}</span><div className="clip-action-row">{canPlayConnectedAudioClip && onPlayConnectedAudioClip && <button className="button button-primary" type="button" onClick={() => void playConnected()} disabled={playState === 'playing'}>{playState === 'playing' ? 'Starting…' : 'Play clip'}</button>}<a className={canPlayConnectedAudioClip || hostedReady ? 'button button-secondary' : 'button button-primary'} href={sourceOpenUrl} target="_blank" rel="noopener noreferrer">Open original source ↗</a></div>{playState === 'error' && <p className="inline-error" role="alert">The connected page audio could not be controlled. Reconnect the episode and try again.</p>}</section>
        <section className="detail-clip-range"><span className="section-label">Saved clip</span><strong>{formatMediaTime(annotation.startMs)}–{formatMediaTime(annotation.endMs)}</strong><span>{formatMediaTime(annotation.endMs - annotation.startMs)} long</span></section>
      </>}
      {hostedReady && <HostedExcerptPlayer annotationId={annotation.id} media={hostedReady.media} getPublicUrl={getPublicUrl} />}
      {hostedTranscript && <ExcerptTranscript transcript={hostedTranscript} youtubeHover={youtubeHover} clipTarget={clipTarget} />}
      {hostedRemoved && (
        <section className="detail-media-removed" aria-labelledby="detail-media-removed-heading">
          <span className="section-label" id="detail-media-removed-heading">Archived excerpt</span>
          <p>This archived excerpt is no longer available. The annotation and original source remain accessible.</p>
        </section>
      )}
      <section className="detail-commentary" {...commentaryHover}><span className="section-label">Commentary</span><p>{annotation.commentaryText}</p></section>
      {annotation.kind === 'article' && annotation.audio && audioUrl && <section className="detail-audio" aria-labelledby="detail-audio-heading"><span className="section-label" id="detail-audio-heading">Audio commentary</span><audio controls preload="metadata" src={audioUrl} aria-label="Published audio commentary" onError={() => setAudioError('Audio commentary could not be played. Check your connection and try again.')} /><span className="audio-duration">{formatAudioDuration(annotation.audio.durationMs)}</span>{audioError && <p className="inline-error" role="alert">{audioError}</p>}</section>}
      <div className="detail-secondary-actions"><span>{annotation.commentCount.toLocaleString()} comments</span>{publicUrl && <a href={publicUrl} target="_blank" rel="noopener noreferrer">Share / public page ↗</a>}</div>
      <Comments supabase={supabase} annotationId={annotation.id} currentUserId={currentUserId} onSignIn={onSignIn} onProfile={navigation.openProfile} autoFocus={focusComments} onCountChange={(commentCount) => setAnnotation((current) => current ? { ...current, commentCount } : current)} onMutation={onSocialMutation} />
    </article>
  );
}

export function ProfileView({
  supabase,
  profileId,
  currentUserId,
  onSignIn,
  navigation,
  cache,
  getPublicUrl,
  youtubeHover = null,
  articleHover = null,
}: {
  supabase: SupabaseClient;
  profileId: string;
  navigation: NavigationCallbacks;
  cache: SessionSocialCache;
  getPublicUrl: (path: string) => string | null;
  youtubeHover?: YouTubeHoverConnection | null;
  articleHover?: ArticleHoverConnection | null;
} & AuthProps) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  useEffect(() => {
    let current = true;
    void queryProfile(supabase, profileId)
      .then((result) => { if (current) { setProfile(result); setStatus(result ? 'ready' : 'missing'); } })
      .catch(() => { if (current) setStatus('error'); });
    return () => { current = false; };
  }, [profileId, supabase]);

  if (status === 'loading') return <div className="compact-state view-state" role="status"><strong>Loading creator</strong><span>Retrieving public profile…</span></div>;
  if (status === 'missing') return <div className="compact-state view-state"><strong>Profile unavailable</strong><span>This public creator could not be found.</span></div>;
  if (status === 'error' || !profile) return <div className="compact-state compact-state-error view-state" role="alert"><strong>Profile unavailable</strong><span>Check your connection and try again.</span></div>;
  const publicUrl = getPublicUrl(`/p/${profile.id}`);

  return (
    <div className="profile-view">
      <header className="profile-header">
        <Avatar name={profile.displayName} url={profile.avatarUrl} size={54} />
        <div><span className="section-label">Creator</span><h1>{profile.displayName}</h1></div>
        <div className="profile-stats"><span><strong>{profile.annotationCount}</strong> annotations</span><span><strong>{profile.followerCount}</strong> followers</span><span><strong>{profile.followingCount}</strong> following</span></div>
        <FollowControl supabase={supabase} profile={profile} currentUserId={currentUserId} onSignIn={onSignIn} onCountChange={(followerCount) => setProfile((current) => current ? { ...current, followerCount } : current)} />
        {publicUrl && <a className="secondary-link" href={publicUrl} target="_blank" rel="noopener noreferrer">Open public profile ↗</a>}
      </header>
      <AnnotationCollection supabase={supabase} cache={cache} cacheKey={`profile:${profile.id}`} profileId={profile.id} navigation={navigation} getPublicUrl={getPublicUrl} youtubeHover={youtubeHover} articleHover={articleHover} emptyTitle="No published annotations" emptyMessage="This creator has not published an annotation yet." compactHeading="Published annotations" />
    </div>
  );
}
