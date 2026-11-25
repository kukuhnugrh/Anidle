import { describe, expect, it } from 'vitest';
import { characterRoundMark } from './CharacterGame';
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

describe('characterRoundMark', () => {
  const slot = (name: boolean, anime: boolean) => ({ name: { solved: name }, anime: { solved: anime } });

  it('ticks a round only when every field was right, crosses one with none right', () => {
    expect(characterRoundMark({ finished: true, slots: [slot(true, true), slot(true, true)] })).toBe('won');
    expect(characterRoundMark({ finished: true, slots: [slot(false, false), slot(false, false)] })).toBe('lost');
  });

  it('leaves a part-right or open round unmarked', () => {
    expect(characterRoundMark({ finished: true, slots: [slot(true, false), slot(false, false)] })).toBeNull();
    expect(characterRoundMark({ finished: false, slots: [slot(false, false)] })).toBeNull();
  });
});

describe('buttonLook', () => {
  it('maps the app button classes to a Sakuga button', () => {
    expect(buttonLook('primary')).toEqual({ primary: true, className: undefined });
    expect(buttonLook('ghost danger')).toEqual({ primary: false, className: 'danger' });
    expect(buttonLook('ghost small')).toEqual({ primary: false, className: 'small' });
    expect(buttonLook('ghost')).toEqual({ primary: false, className: undefined });
  });
});
