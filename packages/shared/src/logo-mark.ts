export const LOGO_SHORTCODE = '|*';
export const LOGO_MARK_VIEWBOX = '0 0 64 64';

/** Shared Logo C geometry: left margin rule + 8-spoke asterisk. */
export const LOGO_MARK_RULE = {
  x: 16,
  y1: 10,
  y2: 54,
} as const;

export const LOGO_MARK_ASTERISK = {
  cx: 40,
  cy: 32,
  radius: 11,
} as const;

/** Thick enough that 16–32px chrome icons and inline ~1em marks stay readable. */
export const LOGO_MARK_STROKE_WIDTH = 4;

export type LogoMarkSegment =
  | { type: 'text'; value: string }
  | { type: 'mark' };

export function asteriskRays(
  cx = LOGO_MARK_ASTERISK.cx,
  cy = LOGO_MARK_ASTERISK.cy,
  radius = LOGO_MARK_ASTERISK.radius,
): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  const rays: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (let index = 0; index < 4; index += 1) {
    const angle = (index * Math.PI) / 4;
    const dx = Math.cos(angle) * radius;
    const dy = Math.sin(angle) * radius;
    rays.push({
      x1: cx - dx,
      y1: cy - dy,
      x2: cx + dx,
      y2: cy + dy,
    });
  }
  return rays;
}

export function splitLogoShortcode(text: string): LogoMarkSegment[] {
  if (!text.includes(LOGO_SHORTCODE)) {
    return [{ type: 'text', value: text }];
  }

  const parts = text.split(LOGO_SHORTCODE);
  const segments: LogoMarkSegment[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part !== undefined && part !== '') {
      segments.push({ type: 'text', value: part });
    }
    if (index < parts.length - 1) {
      segments.push({ type: 'mark' });
    }
  }
  return segments;
}
