// React glue for the Sakuga VFX components (element types in sakuga-elements.d.ts, sounds in sfx.ts).
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
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

/**
 * A success the player earned (a right guess, group or call): the button lands its check and glint, with
 * キラッ. Only while the button is on the page: a detached one would draw its glint at the page's corner.
 */
export function landDone(button: SakugaButtonElement | null) {
  if (!button?.isConnected) return;
  button.done();
  playSfx('kira');
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
