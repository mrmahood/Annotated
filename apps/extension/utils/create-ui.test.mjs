import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const APP_URL = new URL('../entrypoints/sidepanel/App.tsx', import.meta.url);
const STYLE_URL = new URL('../entrypoints/sidepanel/style.css', import.meta.url);

test('Create is the visible compatibility label and the switcher uses a segmented radiogroup', async () => {
  const source = await readFile(APP_URL, 'utf8');
  assert.match(source, /view === 'context' \? 'Create'/);
  assert.doesNotMatch(source, /currentScreen\.view === 'context' \? 'Context'/);
  assert.match(source, /<h1 className="visually-hidden">Create<\/h1>/);
  assert.match(source, /<fieldset className="create-mode-switcher">/);
  assert.match(source, /<legend className="visually-hidden">Create mode<\/legend>/);
  assert.match(source, /className="create-mode-segmented"/);
  assert.match(source, /role="radiogroup"/);
  assert.match(source, /CREATE_MODES\.map\(\(mode\) =>/);
  assert.match(source, /type="radio" name="create-mode"/);
  assert.match(source, /disabled=\{unavailable\}/);
  assert.match(source, /CreateModeIcon/);
  assert.match(source, /className="create-mode-thumb"/);
  assert.match(source, /role="status" aria-live="polite"/);
  assert.doesNotMatch(source, /create-mode-option/);
  assert.doesNotMatch(source, /create-mode-state/);
});

test('unavailable, recommended, checking, and draft copy live in one status line', async () => {
  const source = await readFile(APP_URL, 'utf8');
  assert.match(source, /savedDraftModes\[mode\]/);
  assert.match(source, /Draft saved:/);
  assert.match(source, /getModeCapabilitySummary\(modeSelection\)/);
  assert.match(source, /detachedDraftModes\[selectedCreateMode\]/);
  assert.match(source, /This draft belongs to another connected source\./);
  assert.match(source, /Discard \{CREATE_MODE_LABELS\[selectedCreateMode\]\} draft and start here/);
  assert.doesNotMatch(source, /'Available'/);
  assert.doesNotMatch(source, /'Unavailable'/);
  assert.doesNotMatch(source, /if \(detection\.status === 'not-audio-page'\) void clearAudioDraft/);
});

test('the switcher and editor actions have explicit 390 and 340 pixel contracts', async () => {
  const style = await readFile(STYLE_URL, 'utf8');
  assert.match(style, /@media \(max-width: 390px\)/);
  assert.match(style, /@media \(max-width: 340px\)/);
  assert.match(style, /\.create-mode-segment \{ min-height: 32px;/);
  assert.match(style, /\.create-mode-segmented \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/);
  assert.match(style, /\.clip-control-row \{ grid-template-columns: 1fr; \}/);
  assert.match(style, /\.clip-time-grid-editable \{ grid-template-columns: 1fr; \}/);
  assert.match(style, /\.create-actions \{ grid-template-columns: 1fr; \}/);
  assert.match(style, /--accent:/);
  assert.match(style, /--motion-duration: 180ms/);
  assert.match(style, /--motion-easing:/);
});

test('player selection is a bounded native radio group and gates every clip action', async () => {
  const [source, style] = await Promise.all([
    readFile(APP_URL, 'utf8'),
    readFile(STYLE_URL, 'utf8'),
  ]);
  assert.match(source, /<fieldset className="player-selector">/);
  assert.match(source, /<legend>Choose \{label\} player<\/legend>/);
  assert.match(source, /type="radio"\s+name=\{`\$\{mode\}-player`\}/);
  assert.match(source, /\{index \+ 1\} of \{discovery\.candidates\.length\}/);
  assert.match(source, /Too many \{label\} players/);
  assert.match(source, /disabled=\{!videoPlayerSelected/);
  assert.match(source, /disabled=\{!audioPlayerSelected/);
  assert.match(source, /getPlayerActionToken\('video'/);
  assert.match(source, /getPlayerActionToken\('audio'/);
  assert.match(source, /runSelectedPlayerAction\(token,/);
  assert.match(source, /playerTokenIsCurrent\(token\)/);
  assert.match(source, /videoRangeDisplay\.length/);
  assert.match(source, /audioRangeDisplay\.length/);
  assert.match(source, /<ClipRangeFields/);
  assert.match(source, /idPrefix="video"/);
  assert.match(source, /idPrefix="audio"/);
  assert.match(source, /Set start/);
  assert.match(source, /Set end/);
  assert.match(source, /type times such as 1:00 and 2:30/);
  assert.match(style, /\.player-option-label[^}]*overflow-wrap: anywhere/);
});

test('processing copy describes queued work instead of a missing worker', async () => {
  const source = await readFile(APP_URL, 'utf8');
  assert.match(source, /mediaCaptureState\.status === 'processing' && <span>Uploaded and queued\. Processing is in progress\.<\/span>/);
  assert.doesNotMatch(source, /until the media worker ships/);
});

test('generic webpage video publishes through the article-backed hosted begin path', async () => {
  const source = await readFile(APP_URL, 'utf8');
  assert.match(source, /from '\.\.\/\.\.\/utils\/connected-source'/);
  assert.match(source, /getSourceState,/);
  assert.match(source, /isWebpageVideoCapableSource,/);
  assert.match(source, /hostedVideoBeginRpc\(sourceState\.source\.url\) !== 'begin_hosted_webpage_video_annotation'/);
  assert.match(source, /const genericVideo = isWebpageVideoCapableSource\(sourceState\.source\)/);
  assert.match(source, /beginHostedTikTokAnnotation/);
  assert.match(source, /kind: 'tiktok'/);
  assert.match(source, /publishTikTokClip/);
  assert.match(source, /\[probe\.mode, probe\.genericVideo\]/);
  assert.match(source, /videoDetectionResolved: true, videoAvailable: playerDiscoveryMakesModeAvailable\(discovery\)/);
  assert.match(source, /world: probe\.genericVideo \? 'MAIN' : 'ISOLATED'/);
  assert.match(source, /world: genericVideo \? 'MAIN' : 'ISOLATED'/);
  assert.match(source, /webVideoClipDraftBelongsToSource/);
  assert.match(source, /beginHostedWebpageVideoAnnotation/);
  assert.match(source, /kind: 'web-video'/);
  assert.match(source, /publishWebpageVideoClip/);
  assert.match(source, /canPublishWebpageVideo/);
  assert.match(source, /mediaType: isAudioOnlyCaptureSourceKind\(source\.kind\) \? 'audio' : 'video'/);
  assert.doesNotMatch(source, /kind: 'youtube-audio'/);
  assert.doesNotMatch(source, /kind: 'tiktok-audio'/);
  assert.doesNotMatch(source, /kind: 'web-video-audio'/);
  assert.match(source, /videoCommentaryRecorder/);
  assert.match(source, /audioCommentaryRecorder/);
  assert.match(source, /hasPublishableCommentary/);
  assert.doesNotMatch(source, /Publishing not enabled/);
  assert.doesNotMatch(source, /separately authorized article-backed hosted-video server contract/);
  assert.doesNotMatch(source, /beginHostedYouTubeAnnotation\(supabase, \{[\s\S]{0,500}webVideoSource/);
  assert.doesNotMatch(source, /Brightcove|brightcove|cross-origin adapter/);
});

test('Create Video and Audio keep Set start / Set end and add typed clip fields', async () => {
  const [source, fields, style, capabilities] = await Promise.all([
    readFile(APP_URL, 'utf8'),
    readFile(new URL('../entrypoints/sidepanel/clip-range-fields.tsx', import.meta.url), 'utf8'),
    readFile(STYLE_URL, 'utf8'),
    readFile(new URL('./create-mode-capabilities.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(source, /useTypedClipRange/);
  assert.match(source, /commitVideoRange/);
  assert.match(source, /commitAudioRange/);
  assert.match(source, /videoRangeEntry\.allowsPublish/);
  assert.match(source, /audioRangeEntry\.allowsPublish/);
  assert.match(source, />Set start</);
  assert.match(source, />Set end</);
  assert.match(fields, /id=\{startId\}/);
  assert.match(fields, /id=\{endId\}/);
  assert.match(fields, /placeholder="1:00"/);
  assert.match(fields, /placeholder="2:30"/);
  assert.match(fields, /htmlFor=\{startId\}/);
  assert.match(style, /\.clip-time-grid input \{/);
  assert.match(style, /\.clip-field-error/);
  assert.match(source, /getSpotifyEpisodeIdentity/);
  assert.match(source, /beginHostedSpotifyAnnotation/);
  assert.match(source, /Spotify episode/);
  assert.match(source, /kind: 'spotify'/);
  assert.match(capabilities, /Start the preview, or sign in if it is gated/);
  assert.match(source, /Preview \/ Jump to start and Publish seek the now-playing bar to the clip start/);
  assert.match(source, /The Spotify player could not seek to the clip start/);
  assert.doesNotMatch(source, /Sign in to Spotify in this tab to capture an episode/);
});

test('Create offers one quiet title field for Text, Video, and Audio', async () => {
  const source = await readFile(APP_URL, 'utf8');
  assert.match(source, /function TitleField\(/);
  assert.match(source, /<input/);
  assert.match(source, /placeholder="Add a title…"/);
  assert.doesNotMatch(source, /<TextWithLogoMark/);
  assert.match(source, /<TitleField id="youtube-title"/);
  assert.match(source, /<TitleField id="audio-clip-title"/);
  assert.match(source, /<TitleField id="annotation-title"/);
  assert.match(source, /annotationTitle: videoDraftState\.title/);
  assert.match(source, /annotationTitle: audioDraftState\.title/);
  assert.match(source, /annotationTitle: title/);
  assert.doesNotMatch(source, />TITLE</);
  assert.doesNotMatch(source, />AUDIO TITLE</);
  assert.doesNotMatch(source, />Video title</);
  assert.match(source, /className="visually-hidden" htmlFor=\{id\}>Title</);
});
