// The Sakuga VFX web components (public/sakuga/*.js, defined by index.html's script tags before the app renders).
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

declare global {
  interface SakugaButtonElement extends HTMLElement {
    disabled: boolean;
    /** Lands a check and a glint on a primary button; `hold` seconds before the check goes. */
    done(hold?: number): void;
    impact(): void;
  }
  interface SakugaTabsElement extends HTMLElement {
    /** Index of the selected tab; setting it moves the tab without a change event. */
    selected: number;
    readonly value: string;
  }
  interface SakugaToastElement extends HTMLElement {
    readonly open: boolean;
    show(text?: string): void;
    hide(): void;
  }
  interface SakugaSliderElement extends HTMLElement {
    value: string;
    readonly valueAsNumber: number;
    disabled: boolean;
  }
  interface SakugaToggleElement extends HTMLElement {
    checked: boolean;
    disabled: boolean;
  }
  interface SakugaInputElement extends HTMLElement {
    value: string;
    disabled: boolean;
  }
  interface SakugaTooltipElement extends HTMLElement {
    readonly open: boolean;
    show(on?: boolean): void;
  }
  interface HTMLElementTagNameMap {
    'sakuga-button': SakugaButtonElement;
    'sakuga-tabs': SakugaTabsElement;
    'sakuga-toast': SakugaToastElement;
    'sakuga-slider': SakugaSliderElement;
    'sakuga-toggle': SakugaToggleElement;
    'sakuga-input': SakugaInputElement;
    'sakuga-tooltip': SakugaTooltipElement;
  }
}

type Props<E extends HTMLElement, A> = DetailedHTMLProps<HTMLAttributes<E>, E> & A;
type Num = number | string;

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'sakuga-button': Props<SakugaButtonElement, { variant?: 'secondary'; type?: 'button' | 'submit'; disabled?: boolean }>;
      'sakuga-tabs': Props<SakugaTabsElement, { label?: string }>;
      'sakuga-toast': Props<SakugaToastElement, { duration?: Num; message?: string }>;
      'sakuga-slider': Props<SakugaSliderElement, { value?: Num; min?: Num; max?: Num; step?: Num; unit?: string; label?: string; name?: string; disabled?: boolean }>;
      'sakuga-toggle': Props<SakugaToggleElement, { label?: string; checked?: boolean; name?: string; value?: string; disabled?: boolean }>;
      'sakuga-input': Props<
        SakugaInputElement,
        { type?: 'text' | 'email' | 'search' | 'url' | 'tel' | 'password'; value?: string; placeholder?: string; label?: string; name?: string; autocomplete?: string; disabled?: boolean }
      >;
      'sakuga-tooltip': Props<SakugaTooltipElement, { text?: string; label?: string }>;
    }
  }
}
