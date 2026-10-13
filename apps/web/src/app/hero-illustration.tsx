import {
  LOGO_MARK_ASTERISK,
  LOGO_MARK_RULE,
  LOGO_MARK_STROKE_WIDTH,
  LOGO_MARK_VIEWBOX,
  asteriskRays,
} from "@annotated/shared/logo-mark";

function HeroSourceMark() {
  return (
    <svg
      x="238"
      y="58"
      width="16"
      height="16"
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
      <rect
        x={LOGO_MARK_ASTERISK.cx - LOGO_MARK_ASTERISK.radius - 3}
        y={LOGO_MARK_ASTERISK.cy - 5}
        width={(LOGO_MARK_ASTERISK.radius + 3) * 2}
        height={10}
        fill="var(--highlighter)"
      />
      {asteriskRays().map((ray, index) => (
        <line
          key={index}
          x1={ray.x1}
          y1={ray.y1}
          x2={ray.x2}
          y2={ray.y2}
          stroke="var(--highlighter-ink)"
          strokeWidth={LOGO_MARK_STROKE_WIDTH}
          strokeLinecap="butt"
        />
      ))}
    </svg>
  );
}

export function HeroIllustration() {
  return (
    <svg
      className="hero-illustration"
      viewBox="0 0 360 168"
      role="img"
      aria-label="A highlighted article passage connected to a margin note with a Needs context verdict and a source badge."
    >
      <g className="hero-illustration-article">
        <rect className="hero-illustration-sheet" x="1" y="10" width="200" height="148" rx="12" />
        <rect className="hero-illustration-line" x="16" y="26" width="146" height="7" rx="3.5" />
        <rect className="hero-illustration-line" x="16" y="42" width="118" height="7" rx="3.5" />
        <rect className="hero-illustration-highlight" x="12" y="58" width="176" height="26" rx="5" />
        <text className="hero-illustration-passage" x="20" y="71">
          figures are comparisons
        </text>
        <rect className="hero-illustration-line" x="16" y="96" width="156" height="7" rx="3.5" />
        <rect className="hero-illustration-line" x="16" y="112" width="128" height="7" rx="3.5" />
        <rect className="hero-illustration-line" x="16" y="128" width="92" height="7" rx="3.5" />
      </g>

      <path
        className="hero-illustration-connector"
        pathLength="1"
        d="M188 71 C 208 71, 210 36, 228 36"
      />

      <g className="hero-illustration-note">
        <rect className="hero-illustration-note-card" x="226" y="12" width="133" height="140" rx="12" />
        <rect className="hero-illustration-chip" x="236" y="24" width="112" height="22" rx="11" />
        <text className="hero-illustration-chip-label" x="292" y="35" textAnchor="middle">
          Needs context
        </text>
        <rect className="hero-illustration-badge" x="236" y="54" width="100" height="24" rx="12" />
        <HeroSourceMark />
        <text className="hero-illustration-source" x="258" y="66">
          source
        </text>
        <rect className="hero-illustration-line" x="236" y="92" width="108" height="6" rx="3" />
        <rect className="hero-illustration-line" x="236" y="106" width="84" height="6" rx="3" />
        <rect className="hero-illustration-line" x="236" y="120" width="60" height="6" rx="3" />
      </g>
    </svg>
  );
}
