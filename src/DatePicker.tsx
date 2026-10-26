import { FIRST_DAILY_DATE, shiftDate, todayWib } from '../shared/modes';
import { fmtDate } from './format';

/** ← date → over the daily puzzles (FIRST_DAILY_DATE … today); the date itself opens a calendar. */
export function DatePicker({ date, onChange }: { date: string; onChange: (date: string) => void }) {
  const today = todayWib();
  return (
    <div className="date-nav">
      <button className="ghost small" disabled={date <= FIRST_DAILY_DATE} onClick={() => onChange(shiftDate(date, -1))} aria-label="Previous day">
        ←
      </button>
      <label className="date-pick" title="Pick a day">
        <b>{fmtDate(date)}</b>
        <input
          type="date"
          value={date}
          min={FIRST_DAILY_DATE}
          max={today}
          onChange={(e) => e.target.value && e.target.value >= FIRST_DAILY_DATE && e.target.value <= today && onChange(e.target.value)}
          aria-label="Pick a day"
        />
      </label>
      <button className="ghost small" disabled={date >= today} onClick={() => onChange(shiftDate(date, 1))} aria-label="Next day">
        →
      </button>
      {date !== today && (
        <button className="small" onClick={() => onChange(today)}>
          Today
        </button>
      )}
    </div>
  );
}
