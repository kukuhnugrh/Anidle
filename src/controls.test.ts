import { describe, expect, it } from 'vitest';
import { buttonLook } from './ConfirmButton';
import { roundTabOptions } from './GameParts';

describe('roundTabOptions', () => {
  it('marks won and lost rounds and lists none past the current one', () => {
    expect(roundTabOptions(['won', 'lost', null], 2, false)).toEqual([
      { value: '0', label: 'Round 1 ✓' },
      { value: '1', label: 'Round 2 ✗' },
      { value: '2', label: 'Round 3' },
    ]);
    expect(roundTabOptions(['won', null, null], 1, false).map((o) => o.label)).toEqual(['Round 1 ✓', 'Round 2']);
  });

  it('lists every round once the puzzle is over (current past the last round)', () => {
    expect(roundTabOptions(['won', null, 'lost'], 3, false).map((o) => o.label)).toEqual(['Round 1 ✓', 'Round 2', 'Round 3 ✗']);
  });

  it('drops the word in compact tabs', () => {
    expect(roundTabOptions(['won', 'lost', null, null, null], 2, true).map((o) => o.label)).toEqual(['1 ✓', '2 ✗', '3']);
  });
});

describe('buttonLook', () => {
  it('maps the app button classes to a Sakuga button', () => {
    expect(buttonLook('primary')).toEqual({ primary: true, className: undefined });
    expect(buttonLook('danger-fill')).toEqual({ primary: true, className: 'danger' });
    expect(buttonLook('ghost danger')).toEqual({ primary: false, className: 'danger' });
    expect(buttonLook('ghost small')).toEqual({ primary: false, className: 'small' });
    expect(buttonLook('ghost')).toEqual({ primary: false, className: undefined });
  });
});
