// React glue for the Sakuga VFX components (element types in sakuga-elements.d.ts, sounds in sfx.ts).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { playSfx } from './sfx';

/**
 * Listens for `type` on the element in `ref`. Sakuga controls fire their own change/input events, which
 * React's onChange does not hear. The handler may change every render; the listener is added once.
 */
export function useElementEvent<E extends HTMLElement>(ref: RefObject<E | null>, type: string, handler: (el: E, e: Event) => void) {
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const listener = (e: Event) => latest.current(el, e);
    el.addEventListener(type, listener);
    return () => el.removeEventListener(type, listener);
  }, [ref, type]);
}

/** How long a primary button's press plays out (impact, rebound, smoke rings). */
const IMPACT_MS = 700;
/** How long a landed check stays: done()'s default hold. */
const DONE_MS = 1800;
/** Long enough to see a check land and glint: what a screen that is about to replace the button waits. */
const LAND_BEAT_MS = 650;

/**
 * The reaction of the primary button(s) of one action. The component fades a disabled button, which would
 * wash out its impact and its check, so `held` says when to keep it enabled-looking: call `pressed()` on
 * the click, `landed(button)` on a success the player earned (a right guess, group or call). The button's
 * own click handler keeps refusing clicks while the action is busy. `landed` resolves once the check has
 * been seen: await it before showing a state that removes the button (a finished round), else the check
 * would land on a button that is already gone.
 */
export function useButtonReaction() {
  const [held, setHeld] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const hold = useCallback((ms: number) => {
    clearTimeout(timer.current);
    setHeld(true);
    timer.current = setTimeout(() => setHeld(false), ms);
  }, []);
  const pressed = useCallback(() => hold(IMPACT_MS), [hold]);
  /** The check and glint, with キラッ. Only while the button is on the page: a detached one would draw its glint at the page's corner. */
  const landed = useCallback(
    (button: SakugaButtonElement | null) => {
      if (!button?.isConnected) return Promise.resolve();
      hold(DONE_MS);
      button.done();
      playSfx('kira');
      // Not Promise.withResolvers: it is missing before Safari 17.4, and a throw here turns a right answer into an error.
      return new Promise<void>((resolve) => setTimeout(resolve, LAND_BEAT_MS));
    },
    [hold],
  );
  return { held, pressed, landed };
}

/** The toast's ズザッ, when it lands (it streaks in for about this long). */
const TOAST_LANDS_MS = 150;

export function showToast(toast: SakugaToastElement | null, text: string) {
  if (!toast) return;
  toast.show(text);
  setTimeout(() => playSfx('zuza'), TOAST_LANDS_MS);
}

interface TabsProps<V extends string> {
  /** The tab list's accessible name. */
  label: string;
  options: ReadonlyArray<{ value: V; label: string }>;
  value: V;
  onChange: (value: V) => void;
}

/**
 * A <sakuga-tabs> strip, in a box that scrolls sideways when the tabs are wider than the page. It reads
 * its options once, so it is built again whenever their labels change.
 */
export function Tabs<V extends string>(props: TabsProps<V>) {
  return <TabStrip key={props.options.map((o) => o.label).join('\n')} {...props} />;
}

function TabStrip<V extends string>({ label, options, value, onChange }: TabsProps<V>) {
  const ref = useRef<SakugaTabsElement>(null);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  // Only when it differs: setting it snaps the tab, which would cut short the slide a click just started.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.selected !== index) el.selected = index;
  }, [index]);
  useElementEvent(ref, 'change', (el) => {
    const picked = options[el.selected];
    if (picked) onChange(picked.value);
  });
  return (
    <div className="tab-strip">
      <sakuga-tabs ref={ref} label={label}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </sakuga-tabs>
    </div>
  );
}
