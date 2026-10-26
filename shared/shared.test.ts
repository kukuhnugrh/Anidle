import { describe, expect, it } from 'vitest';
import { anidleScore, compareAnidle, maskSynopsis, summarizeAnidle, type AnidleAnime } from './anidle';
import { characterDifficultyOf, isRomaji } from './characters';
import { difficultyOf, exclusionReason } from './catalog';
import { franchiseIds } from './franchise';
import { roundDifficulties } from './modes';
import { indexNames, normalizeTitle, searchNames, titleHint } from './normalize';

const anime = (over: Partial<AnidleAnime>): AnidleAnime => ({
  malId: 1,
  title: 'A',
  year: 2020,
  score: 8,
  source: 'manga',
  studios: ['Madhouse'],
  genres: ['Action', 'Drama'],
  tags: ['Shounen'],
  franchiseId: null,
  ...over,
});

describe('compareAnidle', () => {
  const answer = anime({ malId: 52991, year: 2023, score: 9.3, franchiseId: 52991 });

  it('points numeric clues toward the answer', () => {
    const f = compareAnidle(answer, anime({ malId: 2, year: 2010, score: 9.5 }));
    expect(f.year.direction).toBe('higher');
    expect(f.score.direction).toBe('lower');
    expect(compareAnidle(answer, anime({ malId: 2, year: 2023 })).year.direction).toBe('equal');
  });

  it('treats a missing number as unknown, not as a mismatch direction', () => {
    expect(compareAnidle(answer, anime({ malId: 2, score: null })).score.direction).toBe('unknown');
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
    expect(compareAnidle(anime({ tags: [] }), anime({ malId: 2, tags: [] })).tags.overlap).toBe('full');
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
  it('drops 2,000 per extra guess from 20,000 to 2,000 on the 10th, and is 0 when unsolved', () => {
    expect(anidleScore(true, 1)).toBe(20_000);
    expect(anidleScore(true, 4)).toBe(14_000);
    expect(anidleScore(true, 10)).toBe(2_000);
    expect(anidleScore(false, 10)).toBe(0);
  });
});

describe('characterDifficultyOf', () => {
  it("buckets by the character's own MAL favorites", () => {
    expect(characterDifficultyOf(88_366)).toBe('easy'); // Naruto
    expect(characterDifficultyOf(5_000)).toBe('easy');
    expect(characterDifficultyOf(4_999)).toBe('medium');
    expect(characterDifficultyOf(500)).toBe('medium');
    expect(characterDifficultyOf(499)).toBe('hard');
  });
});

describe('isRomaji', () => {
  it('accepts Latin names with macrons, digits and punctuation, and rejects other scripts', () => {
    expect(isRomaji('Hitokiri Battousai')).toBe(true);
    expect(isRomaji('Yūji Ōta')).toBe(true);
    expect(isRomaji('No. 2B (Unit-01)')).toBe(true);
    expect(isRomaji('宮村 伊澄')).toBe(false);
    expect(isRomaji('Nazunacchi ナズナ')).toBe(false);
    expect(isRomaji('박은하')).toBe(false);
  });
});

describe('maskSynopsis', () => {
  const names = ['Shingeki no Kyojin', 'Attack on Titan'];

  it('masks the titles, their distinctive words with plurals, and drops the source credit', () => {
    const s = maskSynopsis('Centuries ago, the Titans appeared. Attack on Titan follows Eren. Shingeki no Kyojin! [Written by MAL Rewrite]', names);
    expect(s).toBe('Centuries ago, the ▇▇▇ appeared. ▇▇▇ follows Eren. ▇▇▇!');
  });

  it('keeps common title words on their own and drops the source credit', () => {
    expect(maskSynopsis('A final battle in a fantasy world. (Source: Crunchyroll)', ['Final Fantasy'])).toBe('A final battle in a ▇▇▇ world.');
    expect(maskSynopsis('Kyojin-like giants roam.', names)).toBe('▇▇▇-like giants roam.');
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
  const answer = anime({ malId: 100, year: 2018, score: 8.5, source: 'manga', genres: ['Action', 'Drama'] });
  const guess = (over: Partial<AnidleAnime>) => compareAnidle(answer, anime({ malId: Math.random(), ...over }));

  it('narrows numeric ranges to the tightest bounds from every guess', () => {
    const s = summarizeAnidle([guess({ year: 2010, score: 9 }), guess({ year: 2015, score: 7 }), guess({ year: 2022, score: 8.9 })]);
    expect(s.year).toEqual({ exact: null, above: 2015, below: 2022 });
    expect(s.score).toEqual({ exact: null, above: 7, below: 8.9 });
  });

  it('records an exact number once a guess matched it', () => {
    expect(summarizeAnidle([guess({ year: 2012 }), guess({ year: 2018 })]).year.exact).toBe(2018);
  });

  it('keeps confirmed and ruled-out values, ignoring guesses with an unknown value', () => {
    const s = summarizeAnidle([guess({ source: 'novel' }), guess({ source: null }), guess({ source: 'original' })]);
    expect(s.source).toEqual({ known: null, ruledOut: ['novel', 'original'] });
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

  const index = indexNames([
    { id: 1, names: ['Sousou no Frieren', "Frieren: Beyond Journey's End"], year: 2023, type: 'tv' },
    { id: 2, names: ['Sousou no Frieren 2nd Season'], year: 2026, type: 'tv' },
    { id: 3, names: ['Shingeki no Kyojin', 'Attack on Titan'], year: 2013, type: 'tv' },
  ]);

  it('matches any name, every word, and ranks prefix matches first', () => {
    expect(searchNames(index, 'frieren').map((h) => h.entry.id)).toEqual([1, 2]);
    expect(searchNames(index, 'titan attack').map((h) => h.entry.id)).toEqual([3]);
    expect(searchNames(index, 'beyond journey').map((h) => h.entry.id)).toEqual([1]);
  });

  it('reports the name that matched, so another name can stand for the entry', () => {
    expect(searchNames(index, 'attack on')[0]!.name).toBe('Attack on Titan');
    expect(searchNames(index, 'sousou no frieren')[0]!.name).toBe('Sousou no Frieren');
  });

  it('skips already guessed titles', () => {
    expect(searchNames(index, 'frieren', 8, new Set([1])).map((h) => h.entry.id)).toEqual([2]);
  });
});

describe('titleHint', () => {
  it("keeps each word's first letter, spaces and punctuation, and masks the rest", () => {
    expect(titleHint('Naruto')).toBe('N_____');
    expect(titleHint('Shingeki no Kyojin')).toBe('S_______ n_ K_____');
    expect(titleHint('Re:Zero kara Hajimeru Isekai Seikatsu 2nd Season')).toBe('R_:Z___ k___ H_______ I_____ S_______ 2__ S_____');
    expect(titleHint('Shōnen')).toBe('S_____');
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

describe('roundDifficulties', () => {
  it('stages easy then medium for the daily pool and for "every difficulty"', () => {
    for (const pool of [[], ['easy', 'medium'], ['medium', 'easy']] as const) {
      expect([0, 1, 2].map((r) => roundDifficulties(pool, r))).toEqual([['easy'], ['medium'], ['medium']]);
    }
  });

  it('keeps a narrowed pool for every round', () => {
    expect(roundDifficulties(['hard'], 0)).toEqual(['hard']);
    expect(roundDifficulties(['easy'], 2)).toEqual(['easy']);
    expect(roundDifficulties(['medium', 'hard'], 0)).toEqual(['medium', 'hard']);
  });
});
