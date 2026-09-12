import React from 'react';

// Official-grade crisp vector logos for AI providers and Cloudflare
export const OpenAILogo: React.FC<{ size?: number; className?: string }> = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path
      d="M22.28 9.24a5.95 5.95 0 0 0-.53-4.04 6.07 6.07 0 0 0-5.18-3.14 5.97 5.97 0 0 0-4.32 1.63A5.95 5.95 0 0 0 7.9 2.06a6.07 6.07 0 0 0-4.6 3.93 6.03 6.03 0 0 0 .73 5.48 5.95 5.95 0 0 0-.52 4.05 6.07 6.07 0 0 0 5.17 3.14 5.96 5.96 0 0 0 4.33-1.63 5.96 5.96 0 0 0 4.34 1.63 6.07 6.07 0 0 0 4.6-3.93 6.04 6.04 0 0 0-.67-5.47zM12 14.5a2.5 2.5 0 1 1 2.5-2.5 2.5 2.5 0 0 1-2.5 2.5z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12 4.5v5m-4.5 4.5 4.5-2.5m2.5 0 4.5 2.5m-7 4.5v-5m4.5-4.5-4.5 2.5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

export const AnthropicLogo: React.FC<{ size?: number; className?: string }> = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path
      d="M13.92 4.5h-3.84L3.2 20h3.96l1.7-4.4h6.28l1.7 4.4h3.96L13.92 4.5zm-3.66 8.36 1.74-4.52 1.74 4.52h-3.48z"
      fill="currentColor"
    />
  </svg>
);

export const GoogleGeminiLogo: React.FC<{ size?: number; className?: string }> = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="geminiGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#1B6EF3" />
        <stop offset="35%" stopColor="#5B5BF7" />
        <stop offset="65%" stopColor="#A259FF" />
        <stop offset="100%" stopColor="#E25555" />
      </linearGradient>
    </defs>
    <path
      d="M12 2C12 7.52 7.52 12 2 12c5.52 0 10 4.48 10 10 0-5.52 4.48-10 10-10-5.52 0-10-4.48-10-10z"
      fill="url(#geminiGrad)"
    />
  </svg>
);

export const DeepSeekLogo: React.FC<{ size?: number; className?: string }> = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <defs>
      <linearGradient id="deepseekGrad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
        <stop stopColor="#0066FF" />
        <stop offset="1" stopColor="#0051C3" />
      </linearGradient>
    </defs>
    <path
      d="M5 15.5c1.8 3 5 4.8 8.8 4.5 4.8-.4 8.7-4.4 8.7-9.2 0-4-3-7.3-7-7.8-2-.2-4 .4-5.5 1.6L5 15.5z"
      fill="url(#deepseekGrad)"
    />
    <circle cx="16.5" cy="8.5" r="1.5" fill="#FFFFFF" />
    <path
      d="M2.5 14.5c1.2 0 2.5 1 3.5 2.5"
      stroke="#0066FF"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

export const MistralLogo: React.FC<{ size?: number; className?: string }> = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <rect x="3" y="4" width="3.6" height="16" fill="#FF5E1E" rx="0.75" />
    <rect x="7.8" y="8" width="3.6" height="12" fill="#FF702E" rx="0.75" />
    <rect x="12.6" y="8" width="3.6" height="12" fill="#FF823E" rx="0.75" />
    <rect x="17.4" y="4" width="3.6" height="16" fill="#FF944E" rx="0.75" />
  </svg>
);

export const LocalModelsLogo: React.FC<{ size?: number; className?: string }> = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <rect x="2.5" y="4" width="19" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
    <rect x="2.5" y="13" width="19" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="6.5" cy="7.5" r="1" fill="#10B981" />
    <circle cx="9.5" cy="7.5" r="0.8" fill="currentColor" opacity="0.5" />
    <circle cx="6.5" cy="16.5" r="1" fill="#10B981" />
    <circle cx="9.5" cy="16.5" r="0.8" fill="currentColor" opacity="0.5" />
    <line x1="14" y1="7.5" x2="18.5" y2="7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.6" />
    <line x1="14" y1="16.5" x2="18.5" y2="16.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.6" />
  </svg>
);

export const CloudflareCloudLogo: React.FC<{ size?: number; className?: string }> = ({ size = 28, className = '' }) => (
  <svg width={size} height={Math.round(size * 0.65)} viewBox="0 0 46 30" fill="none" className={className}>
    <defs>
      <linearGradient id="cf-flame-grad" x1="4" y1="6" x2="42" y2="28" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#F6821F" />
        <stop offset="50%" stopColor="#FAAD3F" />
        <stop offset="100%" stopColor="#F38020" />
      </linearGradient>
    </defs>
    {/* Main Cloud Base */}
    <path
      d="M36.2 14.8a8.8 8.8 0 0 0-8.2-5.8c-1.6 0-3.1.5-4.4 1.3A6.5 6.5 0 0 0 17.8 7a6.6 6.6 0 0 0-6.5 5.6A7.7 7.7 0 0 0 4 20.2c0 4.2 3.4 7.6 7.6 7.6h23.8c3.8 0 6.9-3.1 6.9-6.9 0-3.3-2.3-6.1-5.5-6.8z"
      fill="url(#cf-flame-grad)"
    />
    {/* Foreground Flame Wave */}
    <path
      d="M33.5 20H11.6c-2.3 0-4.2-1.9-4.2-4.2 0-2.2 1.7-4 3.9-4.2.3 0 .6 0 .9.1a8.2 8.2 0 0 1 7.3-5.1c3.1 0 5.8 1.7 7.2 4.2a7.8 7.8 0 0 1 4.2 7.9c.8.3 1.7.7 2.5 1.3z"
      fill="#F6821F"
      opacity="0.85"
    />
  </svg>
);
