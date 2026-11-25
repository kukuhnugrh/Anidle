import { FIRST_DAILY_DATE, shiftDate, todayUtc7 } from '../shared/modes';
import { fmtDate } from './format';

/** ← date → over the daily puzzles (FIRST_DAILY_DATE … today); the date itself opens a calendar. */
export function DatePicker({ date, onChange }: { date: string; onChange: (date: string) => void }) {
  const today = todayUtc7();
  return (
    <div className="date-nav">
      {/* The name goes on the arrow itself: the component's inner button takes its name from what is inside it. */}
      <sakuga-button variant="secondary" disabled={date <= FIRST_DAILY_DATE} onClick={(e) => !e.currentTarget.disabled && onChange(shiftDate(date, -1))}>
        <span role="img" aria-label="Previous day">
          ←
        </span>
      </sakuga-button>
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
      <sakuga-button variant="secondary" disabled={date >= today} onClick={(e) => !e.currentTarget.disabled && onChange(shiftDate(date, 1))}>
        <span role="img" aria-label="Next day">
          →
        </span>
      </sakuga-button>
      {date !== today && (
        <sakuga-button variant="secondary" onClick={() => onChange(today)}>
          Today
        </sakuga-button>
      )}
    </div>
  );
}
