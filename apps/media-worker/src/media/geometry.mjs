import { mediaCoreFailure } from '../domain/media-core-error.mjs';

const CSS_TOLERANCE = 1;
const ASPECT_TOLERANCE = 0.01;

function finite(value, label, minimum = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    mediaCoreFailure('transcoding', 'unsafe_geometry', `${label} is invalid.`);
  }
  return value;
}

function close(left, right, tolerance = CSS_TOLERANCE) {
  return Math.abs(left - right) <= tolerance;
}

function assertStableObject(start, end, keys, label, tolerance = CSS_TOLERANCE, minimumByKey = {}) {
  if (!start || !end || typeof start !== 'object' || typeof end !== 'object') {
    mediaCoreFailure('transcoding', 'unsafe_geometry', `${label} end sampling is missing.`);
  }
  for (const key of keys) {
    const minimum = minimumByKey[key] ?? 0;
    const startValue = finite(start[key], `${label}.start.${key}`, minimum);
    const endValue = finite(end[key], `${label}.end.${key}`, minimum);
    if (!close(startValue, endValue, tolerance)) {
      mediaCoreFailure('transcoding', 'unsafe_geometry', `${label}.${key} changed during capture.`);
    }
  }
}

function assertRectConsistent(rect, label) {
  const x = finite(rect.x, `${label}.x`, -CSS_TOLERANCE);
  const y = finite(rect.y, `${label}.y`, -CSS_TOLERANCE);
  const width = finite(rect.width, `${label}.width`, 1);
  const height = finite(rect.height, `${label}.height`, 1);
  const left = finite(rect.left, `${label}.left`, -CSS_TOLERANCE);
  const top = finite(rect.top, `${label}.top`, -CSS_TOLERANCE);
  const right = finite(rect.right, `${label}.right`);
  const bottom = finite(rect.bottom, `${label}.bottom`);
  if (!close(x, left) || !close(y, top) || !close(right, left + width) || !close(bottom, top + height)) {
    mediaCoreFailure('transcoding', 'unsafe_geometry', `${label} edges are inconsistent.`);
  }
}

function evenFloor(value) {
  return Math.floor(value / 2) * 2;
}

function evenCeil(value) {
  return Math.ceil(value / 2) * 2;
}

export function calculateVideoCrop(metadata, encodedWidth, encodedHeight) {
  const viewport = metadata?.viewport;
  const videoElement = metadata?.video_element;
  const fullscreen = metadata?.fullscreen;
  if (!viewport || !videoElement || !fullscreen) {
    mediaCoreFailure('transcoding', 'unsafe_geometry', 'Required video geometry is missing.');
  }
  const objectFit = metadata.computed_style?.object_fit;
  const objectPosition = metadata.computed_style?.object_position;
  if (!['contain', 'cover', 'fill', 'none', 'scale-down'].includes(objectFit) || typeof objectPosition !== 'string' || objectPosition.length > 100) {
    mediaCoreFailure('transcoding', 'unsafe_geometry', 'Computed video style is invalid.');
  }
  finite(metadata.intrinsic_video?.width, 'intrinsic_video.width', 1);
  finite(metadata.intrinsic_video?.height, 'intrinsic_video.height', 1);

  assertStableObject(viewport.start, viewport.end, ['width', 'height', 'scroll_x', 'scroll_y'], 'viewport');
  const startDpr = finite(viewport.start?.device_pixel_ratio, 'viewport.start.device_pixel_ratio', 0.1);
  const endDpr = finite(viewport.end?.device_pixel_ratio, 'viewport.end.device_pixel_ratio', 0.1);
  if (!close(startDpr, endDpr, 0.001)) {
    mediaCoreFailure('transcoding', 'unsafe_geometry', 'Viewport device pixel ratio changed during capture.');
  }
  assertStableObject(
    videoElement.start,
    videoElement.end,
    ['x', 'y', 'width', 'height', 'top', 'right', 'bottom', 'left'],
    'video_element',
    CSS_TOLERANCE,
    { x: -CSS_TOLERANCE, y: -CSS_TOLERANCE, top: -CSS_TOLERANCE, left: -CSS_TOLERANCE },
  );
  if (typeof fullscreen.start !== 'boolean' || typeof fullscreen.end !== 'boolean' || fullscreen.start !== fullscreen.end) {
    mediaCoreFailure('transcoding', 'unsafe_geometry', 'Fullscreen state changed or is missing.');
  }

  const startViewport = viewport.start;
  const startRect = videoElement.start;
  assertRectConsistent(startRect, 'video_element.start');
  assertRectConsistent(videoElement.end, 'video_element.end');
  const viewportWidth = finite(startViewport.width, 'viewport.start.width', 1);
  const viewportHeight = finite(startViewport.height, 'viewport.start.height', 1);
  finite(encodedWidth, 'encoded_width', 2);
  finite(encodedHeight, 'encoded_height', 2);

  if (
    startRect.left < -CSS_TOLERANCE || startRect.top < -CSS_TOLERANCE ||
    startRect.right > viewportWidth + CSS_TOLERANCE ||
    startRect.bottom > viewportHeight + CSS_TOLERANCE
  ) {
    mediaCoreFailure('transcoding', 'unsafe_geometry', 'The selected video is not fully visible.');
  }

  const encodedAspect = encodedWidth / encodedHeight;
  const viewportAspect = viewportWidth / viewportHeight;
  const track = metadata.capture_track?.tracks?.find((item) => item?.kind === 'video');
  const trackWidth = track?.settings?.width;
  const trackHeight = track?.settings?.height;
  if (trackWidth !== undefined || trackHeight !== undefined) {
    finite(trackWidth, 'capture_track.video.width', 2);
    finite(trackHeight, 'capture_track.video.height', 2);
    const trackAspect = trackWidth / trackHeight;
    if (Math.abs(trackAspect - encodedAspect) / encodedAspect > ASPECT_TOLERANCE) {
      mediaCoreFailure('transcoding', 'unsafe_geometry', 'Captured track and probed frame aspect ratios do not match.');
    }
  }

  const aspectMismatch = Math.abs(encodedAspect - viewportAspect) / viewportAspect > ASPECT_TOLERANCE;
  if (aspectMismatch && (
    trackWidth === undefined || trackHeight === undefined ||
    track.settings?.resizeMode !== 'crop-and-scale'
  )) {
    mediaCoreFailure('transcoding', 'unsafe_geometry', 'Encoded frame and viewport aspect ratios do not match safely.');
  }
  const uniformScale = Math.min(encodedWidth / viewportWidth, encodedHeight / viewportHeight);
  const scaleX = aspectMismatch ? uniformScale : encodedWidth / viewportWidth;
  const scaleY = aspectMismatch ? uniformScale : encodedHeight / viewportHeight;
  const offsetX = aspectMismatch ? (encodedWidth - viewportWidth * uniformScale) / 2 : 0;
  const offsetY = aspectMismatch ? (encodedHeight - viewportHeight * uniformScale) / 2 : 0;
  const x = Math.max(0, evenFloor(offsetX + startRect.left * scaleX));
  const y = Math.max(0, evenFloor(offsetY + startRect.top * scaleY));
  const right = Math.min(encodedWidth, evenCeil(offsetX + startRect.right * scaleX));
  const bottom = Math.min(encodedHeight, evenCeil(offsetY + startRect.bottom * scaleY));
  const width = evenFloor(right - x);
  const height = evenFloor(bottom - y);
  if (width < 2 || height < 2 || x + width > encodedWidth || y + height > encodedHeight) {
    mediaCoreFailure('transcoding', 'unsafe_geometry', 'Calculated crop is outside the encoded frame.');
  }

  return { x, y, width, height, scaleX, scaleY, offsetX, offsetY };
}
