import { describe, expect, it } from 'vitest';
import { hiddenSpans, showsTitle, titleKeys } from './titleText';

describe('showsTitle', () => {
  const aot = titleKeys(['Shingeki no Kyojin', 'Attack on Titan', '進撃の巨人', 'SnK', null]);

  it('finds a title in rough OCR of a logo (real Tesseract output)', () => {
    expect(showsTitle('rw > «attack owetitanes p= ~~. vg', aot)).toBe(true);
    expect(showsTitle('フー ドア ー ト ・ オ ン ラ イン', titleKeys(['Sword Art Online', 'ソードアート・オンライン']))).toBe(true);
  });

  it('ignores frame noise and names too short to tell apart', () => {
    // Real OCR of AoT OP1 frames without the logo.
    expect(showsTitle('Nan #1557 5 “~ BEDE 上 ““ of タン ~~', aot)).toBe(false);
    expect(showsTitle('a” J 5 - h = 4 - “4 =F r', aot)).toBe(false);
    expect(titleKeys(['SnK', 'K', 'Mob'])).toEqual([]);
  });

  it('allows one edit per four Latin characters, not more', () => {
    const charlotte = titleKeys(['Charlotte']);
    expect(showsTitle('* a vd Charlate |', charlotte)).toBe(true);
    expect(showsTitle('ang 3 Charloggd', charlotte)).toBe(false);
    expect(showsTitle('NARUT0', titleKeys(['Naruto']))).toBe(true);
    expect(showsTitle('NAR0T0', titleKeys(['Naruto']))).toBe(false);
  });

  it('needs short CJK names exactly', () => {
    const keys = titleKeys(['鬼滅の刃']);
    expect(showsTitle('「鬼滅の刃」', keys)).toBe(true);
    expect(showsTitle('鬼減の刃', keys)).toBe(false);
  });
});

describe('hiddenSpans', () => {
  it('pads each second and merges neighbours', () => {
    expect(hiddenSpans([9, 6, 7, 30])).toEqual([
      [4.5, 10.5],
      [28.5, 31.5],
    ]);
    expect(hiddenSpans([0])).toEqual([[0, 1.5]]);
    expect(hiddenSpans([])).toEqual([]);
  });
});
