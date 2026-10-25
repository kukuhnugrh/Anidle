import { describe, expect, it } from 'vitest';
import { anidleScore, compareAnidle, summarizeAnidle, type AnidleAnime } from './anidle';
import { difficultyOf, exclusionReason } from './catalog';
import { franchiseIds } from './franchise';
import { indexTitles, normalizeTitle, searchTitles } from './normalize';

const anime = (over: Partial<AnidleAnime>): AnidleAnime => ({
  malId: 1,
  title: 'A',
  mediaType: 'tv',
  year: 2020,
  season: 'fall',
  episodes: 12,
  score: 8,
  source: 'manga',
  studios: ['Madhouse'],
  genres: ['Action', 'Drama'],
  themes: [],
  demographics: ['Shounen'],
  franchiseId: null,
  ...over,
});

describe('compareAnidle', () => {
  const answer = anime({ malId: 52991, year: 2023, score: 9.3, episodes: 28, franchiseId: 52991 });

  it('points numeric clues toward the answer', () => {
    const f = compareAnidle(answer, anime({ malId: 2, year: 2010, score: 9.5, episodes: 28 }));
    expect(f.year.direction).toBe('higher');
    expect(f.score.direction).toBe('lower');
    expect(f.episodes.direction).toBe('equal');
  });

  it('treats a missing number as unknown, not as a mismatch direction', () => {
    expect(compareAnidle(answer, anime({ malId: 2, episodes: null })).episodes.direction).toBe('unknown');
  });

  it('grades list overlap: full, partial, none, and both-empty as full', () => {
    expect(compareAnidle(answer, anime({ malId: 2, genres: ['Drama', 'Action'] })).genres.overlap).toBe('full');
    const partial = compareAnidle(answer, anime({ malId: 2, genres: ['Action', 'Comedy'] })).genres;
    expect(partial.overlap).toBe('partial');
    expect(partial.items).toEqual([
      { name: 'Action', hit: true },
      { name: 'Comedy', hit: false },
    ]);
    expect(compareAnidle(answer, anime({ malId: 2, genres: ['Comedy'] })).genres.overlap).toBe('none');
    expect(compareAnidle(answer, anime({ malId: 2, themes: [] })).themes.overlap).toBe('full');
    // A superset of the answer's genres is not a full match.
    expect(compareAnidle(answer, anime({ malId: 2, genres: ['Action', 'Drama', 'Comedy'] })).genres.overlap).toBe('partial');
  });

  it('accepts the same franchise as correct but not exact', () => {
    const sequel = compareAnidle(answer, anime({ malId: 59978, franchiseId: 52991 }));
    expect(sequel.correct).toBe(true);
    expect(sequel.exact).toBe(false);
    expect(compareAnidle(answer, anime({ malId: 3, franchiseId: null })).correct).toBe(false);
    // Two unrelated titles without a franchise must not match each other through null.
    expect(compareAnidle(anime({ malId: 5, franchiseId: null }), anime({ malId: 6, franchiseId: null })).correct).toBe(false);
  });
});

describe('anidleScore', () => {
  it('drops 100 per extra guess with a floor of 100, and is 0 when unsolved', () => {
    expect(anidleScore(true, 1)).toBe(1000);
    expect(anidleScore(true, 4)).toBe(700);
    expect(anidleScore(true, 10)).toBe(100);
    expect(anidleScore(false, 10)).toBe(0);
  });
});

describe('difficultyOf', () => {
  it('buckets by MAL members, with unknown counted as hard', () => {
    expect(difficultyOf(2_000_000)).toBe('easy');
    expect(difficultyOf(500_000)).toBe('easy');
    expect(difficultyOf(499_999)).toBe('medium');
    expect(difficultyOf(200_000)).toBe('medium');
    expect(difficultyOf(199_999)).toBe('hard');
    expect(difficultyOf(null)).toBe('hard');
  });
});

describe('summarizeAnidle', () => {
  const answer = anime({ malId: 100, year: 2018, score: 8.5, episodes: 24, season: 'spring', source: 'manga', genres: ['Action', 'Drama'] });
  const guess = (over: Partial<AnidleAnime>) => compareAnidle(answer, anime({ malId: Math.random(), ...over }));

  it('narrows numeric ranges to the tightest bounds from every guess', () => {
    const s = summarizeAnidle([guess({ year: 2010, score: 9 }), guess({ year: 2015, score: 7 }), guess({ year: 2022, score: 8.9 })]);
    expect(s.year).toEqual({ exact: null, above: 2015, below: 2022 });
    expect(s.score).toEqual({ exact: null, above: 7, below: 8.9 });
  });

  it('records an exact number once a guess matched it', () => {
    expect(summarizeAnidle([guess({ episodes: 12 }), guess({ episodes: 24 })]).episodes.exact).toBe(24);
  });

  it('keeps confirmed and ruled-out values, ignoring guesses with an unknown value', () => {
    const s = summarizeAnidle([guess({ source: 'novel', season: null }), guess({ source: 'original', season: 'fall' })]);
    expect(s.source).toEqual({ known: null, ruledOut: ['novel', 'original'] });
    expect(s.season.ruledOut).toEqual(['fall']);
    expect(summarizeAnidle([guess({ source: 'manga' })]).source.known).toEqual({ value: 'manga' });
  });

  it('collects list items the answer has and does not have, and flags a complete match', () => {
    const s = summarizeAnidle([guess({ genres: ['Action', 'Comedy'] }), guess({ genres: ['Romance'] })]);
    expect(s.genres).toEqual({ has: ['Action'], not: ['Comedy', 'Romance'], complete: false });
    expect(summarizeAnidle([guess({ genres: ['Drama', 'Action'] })]).genres.complete).toBe(true);
  });
});

describe('franchiseIds', () => {
  it('links titles through a middle entry and labels the component by its smallest id', () => {
    const ids = franchiseIds([
      [300, 200], // S3 → S2
      [200, 100], // S2 → S1
      [900, 950],
    ]);
    expect(ids.get(300)).toBe(100);
    expect(ids.get(200)).toBe(100);
    expect(ids.get(950)).toBe(900);
    expect(ids.has(42)).toBe(false);
  });
});

describe('normalize & search', () => {
  it('folds case, macrons and punctuation', () => {
    expect(normalizeTitle('Shōnen: Hero-Academia!!')).toBe('shonen hero academia');
    expect(normalizeTitle('葬送のフリーレン')).toBe('葬送のフリーレン');
  });

  const index = indexTitles([
    { id: 1, names: ['Sousou no Frieren', "Frieren: Beyond Journey's End"], year: 2023, type: 'tv' },
    { id: 2, names: ['Sousou no Frieren 2nd Season'], year: 2026, type: 'tv' },
    { id: 3, names: ['Shingeki no Kyojin', 'Attack on Titan'], year: 2013, type: 'tv' },
  ]);

  it('matches any name, every word, and ranks prefix matches first', () => {
    expect(searchTitles(index, 'frieren').map((e) => e.id)).toEqual([1, 2]);
    expect(searchTitles(index, 'titan attack').map((e) => e.id)).toEqual([3]);
    expect(searchTitles(index, 'beyond journey').map((e) => e.id)).toEqual([1]);
  });

  it('skips already guessed titles', () => {
    expect(searchTitles(index, 'frieren', 8, new Set([1])).map((e) => e.id)).toEqual([2]);
  });
});

describe('exclusionReason', () => {
  it('keeps music/PV and Hentai/Erotica out of every pool', () => {
    expect(exclusionReason('tv', [1, 22])).toBeNull();
    expect(exclusionReason('music', [1])).toBe('media_type:music');
    expect(exclusionReason('ova', [12])).toBe('genre:12');
    expect(exclusionReason(null, [])).toBe('media_type:none');
    expect(exclusionReason('tv', [1], 'not_yet_aired')).toBe('status:not_yet_aired');
    expect(exclusionReason('tv', [1], 'currently_airing')).toBeNull();
  });
});
