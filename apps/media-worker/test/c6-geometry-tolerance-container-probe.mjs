import { calculateVideoCrop } from '/opt/annotated/src/media/geometry.mjs';

function metadata(left) {
  const rect = { x: left, y: 90, width: 960, height: 540, top: 90, right: left + 960, bottom: 630, left };
  return {
    viewport: {
      start: { width: 1280, height: 720, device_pixel_ratio: 1, scroll_x: 0, scroll_y: 0 },
      end: { width: 1280, height: 720, device_pixel_ratio: 1, scroll_x: 0, scroll_y: 0 },
    },
    video_element: { start: rect, end: structuredClone(rect) },
    intrinsic_video: { width: 1920, height: 1080 },
    computed_style: { object_fit: 'contain', object_position: '50% 50%' },
    fullscreen: { start: false, end: false },
    capture_track: {
      tracks: [{ kind: 'video', settings: { width: 1280, height: 720 } }],
    },
  };
}

const accepted = calculateVideoCrop(metadata(-1), 640, 360);
if (accepted.x !== 0 || accepted.width !== 480 || accepted.height !== 272) {
  throw new Error('The documented one-CSS-pixel tolerance did not produce the bounded crop.');
}

let rejected = false;
try {
  calculateVideoCrop(metadata(-1.01), 640, 360);
} catch (error) {
  rejected = error?.code === 'unsafe_geometry';
}
if (!rejected) throw new Error('Geometry beyond the one-CSS-pixel tolerance did not fail closed.');
