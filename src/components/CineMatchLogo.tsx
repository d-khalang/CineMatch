import React, { useId } from 'react';

interface CineMatchLogoProps {
  className?: string;
  showGlow?: boolean;
}

export const CineMatchLogo: React.FC<CineMatchLogoProps> = ({
  className = 'w-full h-full',
  showGlow = true,
}) => {
  const uniqueId = useId().replace(/:/g, '_');
  const screenGradId = `screen-grad-${uniqueId}`;
  const ambientBeamId = `ambient-beam-${uniqueId}`;
  const glowFilterId = `screen-glow-${uniqueId}`;

  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="CineMatch Logo — Human and Robot watching cinema screen together"
    >
      <defs>
        {/* Screen Display Gradient */}
        <linearGradient id={screenGradId} x1="20" y1="12" x2="80" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity="0.95" />
          <stop offset="50%" stopColor="var(--accent-secondary)" stopOpacity="0.85" />
          <stop offset="100%" stopColor="var(--accent-hover)" stopOpacity="0.8" />
        </linearGradient>

        {/* Ambient Projector Beam Projection */}
        <linearGradient id={ambientBeamId} x1="50" y1="46" x2="50" y2="88" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity="0" />
        </linearGradient>

        {/* Soft Ambient Glow */}
        {showGlow && (
          <filter id={glowFilterId} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        )}
      </defs>

      {/* 1. Ambient Light Beam from Screen */}
      <polygon points="18,48 82,48 96,88 4,88" fill={`url(#${ambientBeamId})`} />

      {/* 2. TV / Cinema Screen (Lowest layer in 3D perspective) */}
      <rect
        x="18"
        y="10"
        width="64"
        height="38"
        rx="6"
        fill="var(--bg-canvas)"
        stroke="var(--accent-secondary)"
        strokeWidth="2"
        filter={showGlow ? `url(#${glowFilterId})` : undefined}
      />
      {/* Screen Glowing Display */}
      <rect x="21" y="13" width="58" height="32" rx="3.5" fill={`url(#${screenGradId})`} />

      {/* Minimal Star/Glint in Film Screen */}
      <circle cx="50" cy="29" r="5" stroke="#FFFFFF" strokeWidth="1.6" strokeDasharray="2.5 1.5" fill="none" opacity="0.85" />
      <circle cx="50" cy="29" r="1.8" fill="#FFFFFF" opacity="0.95" />

      {/* Minimal TV Stand */}
      <path d="M44 48 L56 48 M50 48 L50 53 M43 53 L57 53" stroke="var(--border-subtle)" strokeWidth="1.5" strokeLinecap="round" />

      {/* 3. Foreground Characters (Viewed from the Back) */}

      {/* LEFT: Human Silhouette */}
      <g className="transition-transform duration-200">
        {/* Human Head */}
        <circle cx="36" cy="55" r="9.5" fill="var(--bg-surface-elevated)" stroke="var(--accent-secondary)" strokeWidth="2.4" />
        {/* Human Torso & Left Shoulder */}
        <path
          d="M16 88 C16 73, 24 66, 36 66 C45 66, 49 71, 50 77 L50 88 Z"
          fill="var(--bg-surface-elevated)"
          stroke="var(--accent-secondary)"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
      </g>

      {/* RIGHT: Robot Silhouette */}
      <g className="transition-transform duration-200">
        {/* Robot Antenna */}
        <line x1="66" y1="40" x2="66" y2="46" stroke="var(--accent-primary)" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="66" cy="39" r="2.2" fill="var(--accent-primary)" />

        {/* Robot Head */}
        <rect x="55" y="46" width="22" height="16" rx="5" fill="var(--bg-surface-elevated)" stroke="var(--accent-primary)" strokeWidth="2.4" />

        {/* Robot Ear Sensors */}
        <rect x="52" y="50.5" width="3" height="7" rx="1.5" fill="var(--accent-primary)" />
        <rect x="77" y="50.5" width="3" height="7" rx="1.5" fill="var(--accent-primary)" />

        {/* Robot Neck Joint */}
        <rect x="62" y="62" width="8" height="3" rx="1" fill="var(--accent-primary)" opacity="0.75" />

        {/* Robot Torso & Right Shoulder */}
        <path
          d="M50 77 C52 70, 58 66, 66 66 C75 66, 83 70, 84 88 L50 88 Z"
          fill="var(--bg-surface-elevated)"
          stroke="var(--accent-primary)"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
      </g>

      {/* Minimal Shoulder Contact Point (The Match Connection) */}
      <circle cx="50" cy="79" r="1.4" fill="var(--accent-primary)" opacity="0.9" />
    </svg>
  );
};
