import { useCallback, useRef, useSyncExternalStore } from 'react';
import { MuteIcon, SfxIcon, SfxOffIcon, VolumeIcon, VolumeLowIcon } from './icons';
import { useElementEvent } from './sakuga';
import { setSfxOn, useSfxOn } from './sfx';
import { setVolume, useVolume } from './volume';

/** The layout's breakpoint (styles.css): the sidebar folds into a drawer and the volume moves to the top bar. */
const NARROW = '(max-width: 900px)';

function useNarrow() {
  const subscribe = useCallback((onChange: () => void) => {
    const query = matchMedia(NARROW);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return useSyncExternalStore(subscribe, () => matchMedia(NARROW).matches);
}

/**
 * Mute button and slider for the site-wide song volume (see volume.ts), and the sound-effects switch
 * (sfx.ts). Rendered only in the layout `on` names: a hidden slider would still draw its effects, at the
 * page's corner.
 */
export function VolumeControl({ className = '', on }: { className?: string; on: 'wide' | 'narrow' }) {
  return useNarrow() === (on === 'narrow') ? <Volume className={className} /> : null;
}

function Volume({ className }: { className: string }) {
  const { level, muted } = useVolume();
  const sfxOn = useSfxOn();
  const slider = useRef<SakugaSliderElement>(null);
  useElementEvent(slider, 'input', (el) => setVolume({ level: Number(el.value) / 100, muted: false }));
  const silent = muted || level === 0;
  const pct = Math.round(level * 100);
  return (
    <div className={`volume ${className}`} title={`Song volume: ${silent ? 'Muted' : `${pct}%`}`}>
      <button
        className="icon-button"
        onClick={() => setVolume(silent ? { muted: false, level: level || 0.5 } : { muted: true })}
        aria-label={silent ? 'Unmute songs' : 'Mute songs'}
      >
        {silent ? <MuteIcon /> : level < 0.5 ? <VolumeLowIcon /> : <VolumeIcon />}
      </button>
      <sakuga-slider ref={slider} className="volume-slider" label="Song volume" min="0" max="100" unit="%" value={muted ? 0 : pct} />
      <button
        className="icon-button"
        onClick={() => setSfxOn(!sfxOn)}
        aria-label={sfxOn ? 'Mute sound effects' : 'Unmute sound effects'}
        title={sfxOn ? 'Sound effects: on' : 'Sound effects: off'}
      >
        {sfxOn ? <SfxIcon /> : <SfxOffIcon />}
      </button>
    </div>
  );
}
