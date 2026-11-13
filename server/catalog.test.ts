import { describe, expect, it } from 'vitest';
import { catalogSong } from './catalog';

describe('catalogSong', () => {
  const row = { kind: 'op' as const, members: 600_000, clip_key: 'v1/clip/a.mp4', scanned: 1 };

  it('is ready once scanned and, for easy and medium songs, clipped', () => {
    expect(catalogSong(row)).toEqual({ kind: 'op', difficulty: 'easy', ready: true });
    expect(catalogSong({ ...row, scanned: 0 }).ready).toBeUndefined();
    expect(catalogSong({ ...row, clip_key: null }).ready).toBeUndefined();
  });

  it('counts a clip the encoder rejected (streamed) as done', () => {
    expect(catalogSong({ ...row, members: 300_000, clip_key: '' })).toEqual({ kind: 'op', difficulty: 'medium', ready: true });
  });

  it('needs only the scan for hard songs, which get no clip', () => {
    expect(catalogSong({ ...row, members: 1_000, clip_key: null }).ready).toBe(true);
    expect(catalogSong({ ...row, members: null, clip_key: null, scanned: 0 })).toEqual({ kind: 'op', difficulty: 'hard' });
  });
});
