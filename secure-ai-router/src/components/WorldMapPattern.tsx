import React from 'react';

// Faint vector world map dots matching Cloudflare's enterprise radar background
export const WorldMapPattern: React.FC<{ className?: string }> = ({ className = '' }) => {
  return (
    <svg
      className={`absolute inset-0 w-full h-full pointer-events-none opacity-30 select-none ${className}`}
      viewBox="0 0 1000 500"
      preserveAspectRatio="xMidYMid slice"
      fill="#94A3B8"
    >
      <defs>
        <pattern id="world-dot" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="0.75" fill="#94A3B8" opacity="0.35" />
        </pattern>
      </defs>

      {/* Continents soft silhouette with dot fill */}
      <g opacity="0.45">
        {/* North America */}
        <path
          d="M 120 100 Q 180 80, 240 90 Q 280 120, 260 170 Q 230 210, 180 230 Q 150 250, 140 270 Q 120 250, 110 200 Q 90 170, 100 130 Z"
          fill="url(#world-dot)"
        />
        <path
          d="M 150 110 Q 200 95, 230 115 Q 240 150, 210 180 Q 180 190, 140 170 Z"
          fill="#E2E8F0"
          opacity="0.35"
        />

        {/* South America */}
        <path
          d="M 230 280 Q 280 290, 290 340 Q 270 410, 230 450 Q 210 400, 220 330 Z"
          fill="url(#world-dot)"
        />

        {/* Europe */}
        <path
          d="M 450 90 Q 520 85, 540 120 Q 520 160, 480 170 Q 450 160, 440 120 Z"
          fill="url(#world-dot)"
        />
        <path
          d="M 460 105 Q 500 100, 520 125 Q 490 145, 460 135 Z"
          fill="#E2E8F0"
          opacity="0.4"
        />

        {/* Africa */}
        <path
          d="M 460 180 Q 540 190, 560 250 Q 540 340, 500 370 Q 460 350, 450 260 Q 440 210, 460 180 Z"
          fill="url(#world-dot)"
        />

        {/* Asia */}
        <path
          d="M 550 90 Q 750 70, 820 130 Q 800 230, 720 260 Q 640 240, 580 200 Q 550 160, 550 90 Z"
          fill="url(#world-dot)"
        />
        <path
          d="M 600 110 Q 720 100, 770 150 Q 730 210, 650 190 Z"
          fill="#E2E8F0"
          opacity="0.35"
        />

        {/* Australia */}
        <path
          d="M 750 320 Q 830 330, 840 380 Q 800 420, 740 400 Q 730 350, 750 320 Z"
          fill="url(#world-dot)"
        />
      </g>
    </svg>
  );
};
