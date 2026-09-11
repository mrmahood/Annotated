import {
  LOGO_MARK_RULE,
  LOGO_MARK_STROKE_WIDTH,
  LOGO_MARK_VIEWBOX,
  asteriskRays,
  splitLogoShortcode,
} from '@annotated/shared/logo-mark';

export function LogoMark({ className = 'logo-mark' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox={LOGO_MARK_VIEWBOX}
      aria-hidden="true"
      focusable="false"
    >
      <line
        x1={LOGO_MARK_RULE.x}
        y1={LOGO_MARK_RULE.y1}
        x2={LOGO_MARK_RULE.x}
        y2={LOGO_MARK_RULE.y2}
        stroke="currentColor"
        strokeWidth={LOGO_MARK_STROKE_WIDTH}
        strokeLinecap="butt"
      />
      {asteriskRays().map((ray, index) => (
        <line
          key={index}
          x1={ray.x1}
          y1={ray.y1}
          x2={ray.x2}
          y2={ray.y2}
          stroke="currentColor"
          strokeWidth={LOGO_MARK_STROKE_WIDTH}
          strokeLinecap="butt"
        />
      ))}
    </svg>
  );
}

export function TextWithLogoMark({ text }: { text: string }) {
  return (
    <>
      {splitLogoShortcode(text).map((segment, index) => (
        segment.type === 'mark' ? (
          <LogoMark key={index} className="logo-mark logo-mark-inline" />
        ) : (
          segment.value
        )
      ))}
    </>
  );
}
