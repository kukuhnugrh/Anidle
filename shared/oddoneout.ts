// Odd One Out (beta, unlimited only): ODD_ONE_OUT_ROUNDS rounds of ODD_ONE_OUT_SIZE titles. All but
// one share a link (shared/connections.ts); the player picks the one that does not. One pick per round.
import { LINK_KINDS, parseLink, sampleFranchises, usableLinks, type BoardCandidate, type LinkKind } from './connections.js';
import { MODE_MAX_POINTS, ODD_ONE_OUT_ROUNDS, ODD_ONE_OUT_SIZE } from './modes.js';

/** A right pick; a wrong one scores 0. */
export const ODD_ONE_OUT_POINTS = MODE_MAX_POINTS.oddoneout / ODD_ONE_OUT_ROUNDS;

/** A round of a new puzzle: the link the others share, and its titles with the odd one last. */
export interface OddRound {
  link: string;
  malIds: number[];
}

/** Whether every title of `titles` carries one same link. */
const shareALink = (titles: readonly BoardCandidate[]) => titles[0]!.links.some((link) => titles.every((t) => t.links.includes(link)));

/**
 * The rounds of a new puzzle, or null when the pool cannot fill them. Links are drawn kind first (a
 * genre as often as a studio or a year), each link once, every title from its own franchise. A round
 * has exactly one answer: the odd title lacks the link, and no other title can be left out so that the
 * rest (odd one included) still share some link.
 */
export function drawOddRounds(candidates: readonly BoardCandidate[], random: (size: number) => number, attempts = 400): OddRound[] | null {
  const members = usableLinks(candidates);
  const byKind = new Map<LinkKind, string[]>();
  for (const link of members.keys()) {
    const { kind } = parseLink(link);
    const list = byKind.get(kind);
    if (list) list.push(link);
    else byKind.set(kind, [link]);
  }
  const kinds = LINK_KINDS.filter((k) => byKind.has(k));
  if (!kinds.length || candidates.length < ODD_ONE_OUT_SIZE) return null;

  const rounds: OddRound[] = [];
  const usedFranchises = new Set<number>();
  const usedLinks = new Set<string>();
  for (let attempt = 0; attempt < attempts && rounds.length < ODD_ONE_OUT_ROUNDS; attempt++) {
    const links = byKind.get(kinds[random(kinds.length)]!)!;
    const link = links[random(links.length)]!;
    if (usedLinks.has(link)) continue;
    const group = sampleFranchises(
      members.get(link)!.filter((c) => !usedFranchises.has(c.franchise)),
      ODD_ONE_OUT_SIZE - 1,
      random,
    );
    if (!group) continue;
    const taken = new Set(group.map((c) => c.franchise));
    let odd: BoardCandidate | null = null;
    for (let n = 0; n < 40 && !odd; n++) {
      const c = candidates[random(candidates.length)]!;
      if (usedFranchises.has(c.franchise) || taken.has(c.franchise) || c.links.includes(link)) continue;
      // Leaving out any one of the group instead must not leave four that share a link.
      if (group.every((_, skip) => !shareALink([...group.filter((__, i) => i !== skip), c]))) odd = c;
    }
    if (!odd) continue;
    usedLinks.add(link);
    for (const c of [...group, odd]) usedFranchises.add(c.franchise);
    rounds.push({ link, malIds: [...group.map((c) => c.malId), odd.malId] });
  }
  return rounds.length === ODD_ONE_OUT_ROUNDS ? rounds : null;
}
