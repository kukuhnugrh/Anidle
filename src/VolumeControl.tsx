import { MuteIcon, VolumeIcon, VolumeLowIcon } from './icons';
import { setVolume, useVolume } from './volume';

/** Mute button and slider for the site-wide song volume (see volume.ts). */
export function VolumeControl({ className = '' }: { className?: string }) {
  const { level, muted } = useVolume();
  const silent = muted || level === 0;
  const pct = Math.round(level * 100);
  const label = silent ? 'Muted' : `${pct}%`;
  return (
    <div className={`volume ${className}`} title={`Song volume: ${label}`}>
      <button
        className="icon-button volume-toggle"
        onClick={() => setVolume(silent ? { muted: false, level: level || 0.5 } : { muted: true })}
        aria-label={silent ? 'Unmute songs' : 'Mute songs'}
      >
        {silent ? <MuteIcon /> : level < 0.5 ? <VolumeLowIcon /> : <VolumeIcon />}
      </button>
      <input
        className="seek volume-slider"
        type="range"
        min={0}
        max={100}
        value={muted ? 0 : pct}
        onChange={(e) => setVolume({ level: Number(e.target.value) / 100, muted: false })}
        aria-label="Song volume"
        aria-valuetext={label}
      />
      <span className="volume-value">{silent ? 'Off' : pct}</span>
    </div>
  );
}
