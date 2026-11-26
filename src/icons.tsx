// Inline stroke icons (24×24 viewBox), sized by CSS via `.icon`.
import type { ReactNode } from 'react';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const ShuffleIcon = () => (
  <Icon>
    <path d="M16 4h4v4M4 20 20 4M20 16v4h-4M15 15l5 5M4 4l5 5" />
  </Icon>
);

export const DatabaseIcon = () => (
  <Icon>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </Icon>
);

export const UserIcon = () => (
  <Icon>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20.5c1.6-3.6 4.5-5.5 8-5.5s6.4 1.9 8 5.5" />
  </Icon>
);

export const LogoutIcon = () => (
  <Icon>
    <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15" />
    <path d="M10 8l-4 4 4 4M6 12h10" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const BackIcon = () => (
  <Icon>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
);

export const ArrowIcon = () => (
  <Icon>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

export const PuzzleIcon = () => (
  <Icon>
    <path d="M9 3.5h6v3a2 2 0 1 0 4 0h1.5v6h-3a2 2 0 1 0 0 4h3V20.5h-17v-17H9z" />
  </Icon>
);

export const MusicIcon = () => (
  <Icon>
    <path d="M9 18V5.5l11-2V16" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="17.5" cy="16" r="2.5" />
  </Icon>
);

export const DiscIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" />
  </Icon>
);

export const PlayIcon = () => (
  <Icon>
    <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
  </Icon>
);

export const PauseIcon = () => (
  <Icon>
    <path d="M8 5.5v13M16 5.5v13" strokeWidth="3" />
  </Icon>
);

export const UsersIcon = () => (
  <Icon>
    <circle cx="9" cy="8.5" r="3.5" />
    <path d="M2.5 20c1.2-3.2 3.6-5 6.5-5s5.3 1.8 6.5 5" />
    <path d="M15.5 5.3a3.5 3.5 0 0 1 0 6.4M17.5 15.4c2 .7 3.3 2.3 4 4.6" />
  </Icon>
);

export const TrophyIcon = () => (
  <Icon>
    <path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z" />
    <path d="M7.5 6H4.5v1.5A3 3 0 0 0 7.5 10.5M16.5 6h3v1.5a3 3 0 0 1-3 3M12 13.5V17M8.5 20.5h7M9.5 17h5v3.5h-5z" />
  </Icon>
);

export const ClockIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

export const FlaskIcon = () => (
  <Icon>
    <path d="M9.5 3.5h5M10.5 3.5v5.5l-5.2 9.1A1.6 1.6 0 0 0 6.7 20.5h10.6a1.6 1.6 0 0 0 1.4-2.4l-5.2-9.1V3.5M7.6 14.5h8.8" />
  </Icon>
);

export const ShareIcon = () => (
  <Icon>
    <path d="M12 15V3.5M7.5 8 12 3.5 16.5 8" />
    <path d="M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5" />
  </Icon>
);

export const ImageIcon = () => (
  <Icon>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <circle cx="9" cy="10" r="1.8" />
    <path d="M4 17.5l5-4.5 3.5 3 3-2.5 4.5 4" />
  </Icon>
);

export const ShieldIcon = () => (
  <Icon>
    <path d="M12 3.5 19 6v5.5c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6z" />
    <path d="M9 12l2 2 4-4" />
  </Icon>
);

export const LockIcon = () => (
  <Icon>
    <rect x="5" y="10.5" width="14" height="10" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </Icon>
);

export const UnlockIcon = () => (
  <Icon>
    <rect x="5" y="10.5" width="14" height="10" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 7.7-1.5" />
  </Icon>
);

export const ListIcon = () => (
  <Icon>
    <path d="M9 6.5h11M9 12h11M9 17.5h11" />
    <circle cx="4.75" cy="6.5" r="1.25" />
    <circle cx="4.75" cy="12" r="1.25" />
    <circle cx="4.75" cy="17.5" r="1.25" />
  </Icon>
);

/** Settings: two sliders. */
export const SettingsIcon = () => (
  <Icon>
    <path d="M4 7.5h8.5M17.5 7.5H20M4 16.5h2.5M11.5 16.5H20" />
    <circle cx="15" cy="7.5" r="2.5" />
    <circle cx="9" cy="16.5" r="2.5" />
  </Icon>
);

const SPEAKER = 'M4 9.5h3.5L12 5.5v13l-4.5-4H4z';

export const VolumeIcon = () => (
  <Icon>
    <path d={SPEAKER} />
    <path d="M15.5 9a4 4 0 0 1 0 6" />
    <path d="M18.5 6.5a8 8 0 0 1 0 11" />
  </Icon>
);

export const VolumeLowIcon = () => (
  <Icon>
    <path d={SPEAKER} />
    <path d="M15.5 9a4 4 0 0 1 0 6" />
  </Icon>
);

export const MuteIcon = () => (
  <Icon>
    <path d={SPEAKER} />
    <path d="M16 9.5l5 5M21 9.5l-5 5" />
  </Icon>
);

/** The impact burst of an anime sound effect. */
const BURST = 'M12 2.8l1.6 5.2 4.9-2.5-2.5 4.9 5.2 1.6-5.2 1.6 2.5 4.9-4.9-2.5-1.6 5.2-1.6-5.2-4.9 2.5 2.5-4.9-5.2-1.6 5.2-1.6-2.5-4.9 4.9 2.5z';

export const SfxIcon = () => (
  <Icon>
    <path d={BURST} />
  </Icon>
);

export const SfxOffIcon = () => (
  <Icon>
    <path d={BURST} />
    <path d="M3.5 3.5l17 17" />
  </Icon>
);
