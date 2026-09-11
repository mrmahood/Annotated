import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const APP_URL = new URL('../entrypoints/sidepanel/App.tsx', import.meta.url);
const STYLE_URL = new URL('../entrypoints/sidepanel/style.css', import.meta.url);
const SOCIAL_URL = new URL('../entrypoints/sidepanel/social-components.tsx', import.meta.url);
const RECORDER_URL = new URL('../entrypoints/sidepanel/audio-recorder.tsx', import.meta.url);

test('Create, Feed, and Me drop redundant view intros and let tabs name the surface', async () => {
  const [app, style] = await Promise.all([
    readFile(APP_URL, 'utf8'),
    readFile(STYLE_URL, 'utf8'),
  ]);

  assert.match(app, /<h1 className="visually-hidden">Create<\/h1>/);
  assert.match(app, /<h1 className="visually-hidden">Feed<\/h1>/);
  assert.match(app, /<h1 className="visually-hidden">Me<\/h1>/);
  assert.match(app, /currentScreen\.kind !== 'root' && \(/);
  assert.match(app, /className="app-bar"/);
  assert.match(app, /<span className="view-title">\{currentScreen\.kind === 'profile' \? 'Creator' : 'Annotation'\}<\/span>/);
  assert.match(app, /<nav className="top-tabs" aria-label="Primary">/);
  assert.doesNotMatch(app, /app-bar-root/);
  assert.doesNotMatch(app, /className="wordmark"/);
  assert.doesNotMatch(app, />Public activity</);
  assert.doesNotMatch(app, />Recent annotations</);
  assert.doesNotMatch(app, />Private account</);
  assert.doesNotMatch(app, />New annotation</);
  assert.doesNotMatch(app, />Connected source</);
  assert.doesNotMatch(app, /className="view-intro"/);
  assert.match(style, /\.visually-hidden \{/);
  assert.match(style, /\.app-header \{/);
  assert.match(style, /position: sticky/);
  assert.match(style, /\.top-tabs \{/);
  assert.doesNotMatch(style, /\.app-bar-root \{/);
  assert.match(style, /--accent:/);
  assert.match(style, /--motion-duration: 180ms/);
});

test('Create commentary is a placeholder field plus recorder, not labeled chrome', async () => {
  const [app, recorder] = await Promise.all([
    readFile(APP_URL, 'utf8'),
    readFile(RECORDER_URL, 'utf8'),
  ]);

  assert.match(app, /function CommentaryField/);
  assert.match(app, /placeholder="Add a note…"/);
  assert.match(app, /<CommentaryField id="youtube-commentary"/);
  assert.match(app, /<CommentaryField id="audio-clip-commentary"/);
  assert.match(app, /<CommentaryField id="annotation-commentary"/);
  assert.doesNotMatch(app, />Your commentary</);
  assert.doesNotMatch(app, /Add typed commentary, a voice clip, or both/);
  assert.match(app, /type times such as 1:00 and 2:30/);
  assert.match(app, /<h2 id="create-heading" className="visually-hidden">Create clip<\/h2>/);
  assert.match(app, /<h2 id="create-heading" className="visually-hidden">Create audio clip<\/h2>/);
  assert.match(app, /<h2 id="create-heading" className="visually-hidden">Create annotation<\/h2>/);
  assert.match(recorder, /<h2 className="visually-hidden" id="audio-commentary-heading">Voice note<\/h2>/);
  assert.doesNotMatch(recorder, />Audio commentary</);
  assert.doesNotMatch(recorder, />Optional</);
  assert.doesNotMatch(recorder, /WebM · 5:00 max/);
  assert.match(app, /videoCommentaryRecorder/);
  assert.match(app, /hasPublishableCommentary/);
});

test('extension detail keeps annotation-first order and hides leftover source kickers', async () => {
  const social = await readFile(SOCIAL_URL, 'utf8');
  const detail = social.slice(
    social.indexOf('export function AnnotationDetailView'),
    social.indexOf('export function ProfileView'),
  );

  assert.match(detail, /className="detail-commentary"/);
  assert.ok(
    detail.indexOf('className="detail-commentary"') < detail.indexOf('className="detail-source"'),
    'annotation block must precede source',
  );
  assert.doesNotMatch(detail, />Commentary</);
  assert.doesNotMatch(detail, />The annotation</);
  assert.doesNotMatch(detail, />Voice commentary</);
  assert.doesNotMatch(detail, />Audio commentary</);
  assert.match(detail, /className="visually-hidden">Original article</);
  assert.match(detail, /className="visually-hidden">YouTube source</);
  assert.match(detail, /className="visually-hidden">Saved clip</);
  assert.match(detail, /className="visually-hidden">Captured passage</);
  assert.match(social, /<h3 className="visually-hidden">Add a comment<\/h3>/);
  assert.doesNotMatch(social, /<span className="section-label">Creator</);
});
