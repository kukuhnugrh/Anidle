import { useRef, useState } from 'react';
import { MuteIcon, SfxIcon, SfxOffIcon, VolumeIcon, VolumeLowIcon } from './icons';
import { useElementEvent } from './sakuga';
import { setSfxOn, useSfxOn } from './sfx';
import { setVolume, useVolume } from './volume';

/**
 * Mute button and slider for the site-wide song volume (see volume.ts), and the sound-effects switch
 * (sfx.ts). Shown in the top bar's settings panel, only while it is open: a hidden slider would still
 * draw its effects, at the page's corner.
 */
export function Volume() {
  const { level, muted } = useVolume();
  const sfxOn = useSfxOn();
  // The mute button makes the value jump; a slider following it would throw its fast-drag clouds. A new
  // slider starts at its value instead.
  const [jumps, setJumps] = useState(0);
  const silent = muted || level === 0;
  const pct = Math.round(level * 100);
  return (
    <div className="volume" title={`Song volume: ${silent ? 'Muted' : `${pct}%`}`}>
      <button
        className="icon-button"
        onClick={() => {
          setJumps((n) => n + 1);
          setVolume(silent ? { muted: false, level: level || 0.5 } : { muted: true });
        }}
        aria-label={silent ? 'Unmute songs' : 'Mute songs'}
      >
        {silent ? <MuteIcon /> : level < 0.5 ? <VolumeLowIcon /> : <VolumeIcon />}
      </button>
      <VolumeSlider key={jumps} value={muted ? 0 : pct} />
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

function VolumeSlider({ value }: { value: number }) {
  const slider = useRef<SakugaSliderElement>(null);
  useElementEvent(slider, 'input', (el) => setVolume({ level: Number(el.value) / 100, muted: false }));
  return <sakuga-slider ref={slider} className="volume-slider" label="Song volume" min="0" max="100" unit="%" value={value} />;
}
