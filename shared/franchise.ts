import { normalizeTitle } from './normalize.js';

/**
 * Groups titles connected by prequel/sequel edges. Edges may go through titles that are not in
 * the pool (S1 and S3 are linked through S2 even when S2 was never fetched), so every node seen in
 * an edge takes part. Each component is identified by its smallest mal_id.
 */
export function franchiseIds(edges: Iterable<readonly [number, number]>): Map<number, number> {
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    for (let node = x; node !== root; ) {
      const next = parent.get(node)!;
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  const add = (x: number) => {
    if (!parent.has(x)) parent.set(x, x);
  };
  for (const [a, b] of edges) {
    add(a);
    add(b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
  }
  const out = new Map<number, number>();
  for (const node of parent.keys()) out.set(node, find(node));
  return out;
}

/**
 * Whether a MAL 'other' relation still joins one show: a special, OVA, ONA or movie named after the show
 * it belongs to ("Kobayashi-san Chi no OO Dragon" beside "Kobayashi-san Chi no Maid Dragon", "… NG-shuu"
 * extras). Both titles start with the same words: at least two, and at least half the shorter title or
 * three. Two TV series stay apart even when their names match (Yu☆Gi☆Oh! GX and Zexal, White Album 2).
 */
export function otherIsSameShow(a: { title: string; mediaType: string | null }, b: { title: string; mediaType: string | null }): boolean {
  if (a.mediaType === 'tv' && b.mediaType === 'tv') return false;
  const wa = normalizeTitle(a.title).split(' ');
  const wb = normalizeTitle(b.title).split(' ');
  let shared = 0;
  while (shared < wa.length && shared < wb.length && wa[shared] === wb[shared]) shared++;
  return shared >= 2 && (shared * 2 >= Math.min(wa.length, wb.length) || shared >= 3);
}
