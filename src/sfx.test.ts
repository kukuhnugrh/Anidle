import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { soundFor, type SfxName } from './sfx';

const control = (localName: string, attrs: Record<string, string> = {}, props: { disabled?: boolean; checked?: boolean } = {}) => ({
  localName,
  ...props,
  getAttribute: (name: string) => attrs[name] ?? null,
});

describe('soundFor', () => {
  it('gives each Sakuga control its word', () => {
    expect(soundFor('click', control('sakuga-button'))).toBe('don');
    expect(soundFor('click', control('sakuga-button', { variant: 'secondary' }))).toBe('kachi');
    expect(soundFor('change', control('sakuga-tabs'))).toBe('shu');
    expect(soundFor('change', control('sakuga-slider'))).toBe('shu');
    expect(soundFor('change', control('sakuga-toggle', {}, { checked: true }))).toBe('pon');
    expect(soundFor('change', control('sakuga-toggle', {}, { checked: false }))).toBe('pon-off');
  });

  it('stays quiet for disabled controls, other events and other elements', () => {
    expect(soundFor('click', control('sakuga-button', {}, { disabled: true }))).toBeNull();
    // A tab's or a toggle's click is heard through its change; a slider's moves are not, only its release.
    expect(soundFor('click', control('sakuga-tabs'))).toBeNull();
    expect(soundFor('click', control('sakuga-toggle'))).toBeNull();
    expect(soundFor('input', control('sakuga-slider'))).toBeNull();
    expect(soundFor('click', control('button'))).toBeNull();
    expect(soundFor('change', control('input'))).toBeNull();
  });
});

/** A stand-in Web Audio context: records how many were made and every level a gain is set to. */
function fakeAudio() {
  const made: FakeContext[] = [];
  const gainLevels: number[] = [];
  const param = (levels?: number[]) => ({
    value: 1,
    setValueAtTime: (v: number) => void levels?.push(v),
    exponentialRampToValueAtTime: (v: number) => void levels?.push(v),
  });
  const node = () => ({ connect: () => undefined });
  class FakeContext {
    state = 'running';
    currentTime = 0;
    sampleRate = 8000;
    destination = node();
    constructor() {
      made.push(this);
    }
    resume = () => Promise.resolve();
    createGain = () => ({ ...node(), gain: param(gainLevels) });
    createOscillator = () => ({ ...node(), type: 'sine', frequency: param(), start: () => undefined, stop: () => undefined });
    createBiquadFilter = () => ({ ...node(), type: 'lowpass', frequency: param(), Q: param() });
    createBufferSource = () => ({ ...node(), buffer: null, start: () => undefined, stop: () => undefined });
    createBuffer = (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) });
    createDynamicsCompressor = () => ({ ...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() });
  }
  return { FakeContext, made, gainLevels };
}

describe('sound effects switch and playback', () => {
  // sfx.ts reads the switch from storage when it loads, so each test imports a fresh copy of it.
  let store = new Map<string, string>();
  let audio = fakeAudio();

  beforeEach(() => {
    vi.resetModules();
    store = new Map();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    audio = fakeAudio();
    vi.stubGlobal('AudioContext', audio.FakeContext);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is on by default and plays every sound through one shared context, never above full scale', async () => {
    const sfx = await import('./sfx');
    const names: SfxName[] = ['don', 'kachi', 'kira', 'shu', 'zuza', 'pon', 'pon-off'];
    for (const name of names) sfx.playSfx(name);
    expect(audio.made).toHaveLength(1);
    expect(audio.gainLevels.length).toBeGreaterThan(names.length);
    expect(Math.max(...audio.gainLevels)).toBeLessThanOrEqual(1);
  });

  it('keeps its own off switch in localStorage and makes no sound while off', async () => {
    const sfx = await import('./sfx');
    sfx.setSfxOn(false);
    expect(store.get('anidle:sfx')).toBe('off');
    sfx.playSfx('don');
    expect(audio.made).toHaveLength(0);

    // A later visit reads the switch back.
    vi.resetModules();
    const again = await import('./sfx');
    again.playSfx('don');
    expect(audio.made).toHaveLength(0);
    again.setSfxOn(true);
    expect(store.get('anidle:sfx')).toBe('on');
    again.playSfx('don');
    expect(audio.made).toHaveLength(1);
  });

  it('does not touch the song volume key', async () => {
    const sfx = await import('./sfx');
    sfx.setSfxOn(false);
    expect([...store.keys()]).toEqual(['anidle:sfx']);
  });

  it('hears clicks in the capture phase, before page handlers can disable the button', async () => {
    const sfx = await import('./sfx');
    const listeners: Array<{ type: string; capture: unknown; fn: (e: Event) => void }> = [];
    vi.stubGlobal('document', {
      addEventListener: (type: string, fn: (e: Event) => void, capture?: unknown) => listeners.push({ type, capture, fn }),
      removeEventListener: () => undefined,
    });
    class FakeElement {
      closest = () => control('sakuga-button');
    }
    vi.stubGlobal('Element', FakeElement);
    sfx.installSfx();
    expect(listeners.map((l) => [l.type, l.capture])).toEqual([
      ['click', true],
      ['change', true],
    ]);
    listeners[0]!.fn({ type: 'click', target: new FakeElement() } as unknown as Event);
    expect(audio.made).toHaveLength(1);
  });
});
