import type { Difficulty } from '../shared/catalog';

/** "Round N" with the difficulty of what the round asks (several when its anime differ, e.g. Character). */
export function RoundTitle({ round, difficulties }: { round: number; difficulties: readonly Difficulty[] }) {
  return (
    <div className="round-title">
      <h2>Round {round + 1}</h2>
      {difficulties.map((d) => (
        <span key={d} className={`difficulty ${d}`}>
          {d}
        </span>
      ))}
    </div>
  );
}
