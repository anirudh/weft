import type { HorizonPayload, WeekDay } from '@weft/shared';

type Later = HorizonPayload['later'];

/**
 * The calendar surface. Since commitments left the task list, this is the only
 * place they appear — so it has to hold the ones the seven-day grid cannot:
 * flights next month, the first day of school, anything the extractor could not
 * date. Those sit underneath, quietly, rather than competing with this week.
 */
export function ThisWeek({ days, later }: { days: WeekDay[]; later: Later }) {
  return (
    <>
      <div className="week">
        {days.map((d) => (
          <div key={d.date} className={d.items.length ? (d.isToday ? 'day day-today' : 'day day-full') : 'day'}>
            <span className={d.isToday ? 'day-label day-label-today' : 'day-label'}>
              {d.isToday ? 'Today' : d.label}
            </span>
            {d.items.length === 0
              ? <span className="day-empty">Nothing</span>
              : d.items.map((i) => <span key={i.id} className="day-item">{i.title}</span>)}
          </div>
        ))}
      </div>

      {later.length > 0 && (
        <div className="later">
          <span className="later-label">Later</span>
          <ul className="later-list">
            {later.map((i) => (
              <li key={i.id}>
                <span className="later-when">{i.whenLabel}</span>
                <span className="later-title">{i.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
