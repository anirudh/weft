import type { HorizonPayload, WeekDay } from '@weft/shared';

type Later = HorizonPayload['later'];

/**
 * The calendar surface. Since commitments left the task list, this is the only
 * place they appear — so it has to hold the ones the seven-day grid cannot:
 * flights next month, the first day of school, anything the extractor could not
 * date. Those sit underneath, quietly, rather than competing with this week.
 */
const localDate = (iso: string) => {
  const [year = 1970, month = 1, day = 1] = iso.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
};

const weekday = (day: WeekDay) => localDate(day.date).toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase();

const dayLabel = (day: WeekDay) => day.isToday
  ? 'Today'
  : `${weekday(day)} ${localDate(day.date).getDate()}`;

const rangeLabel = (days: WeekDay[]) => {
  if (days.length === 0) return '';
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  if (!firstDay || !lastDay) return '';
  const first = localDate(firstDay.date);
  const last = localDate(lastDay.date);
  const month = last.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase();
  if (first.getMonth() === last.getMonth()) return `${first.getDate()}–${last.getDate()} ${month}`;
  const firstMonth = first.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase();
  return `${first.getDate()} ${firstMonth}–${last.getDate()} ${month}`;
};

type TimelineRow = { key: string; label: string; items: WeekDay['items'] };

const timelineRows = (days: WeekDay[]): TimelineRow[] => {
  const rows: TimelineRow[] = [];
  for (let index = 0; index < days.length;) {
    const day = days[index];
    if (!day) break;
    if (day.items.length > 0) {
      rows.push({ key: day.date, label: dayLabel(day), items: day.items });
      index += 1;
      continue;
    }

    let end = index;
    while (end + 1 < days.length && days[end + 1]?.items.length === 0) end += 1;
    const first = days[index];
    const last = days[end];
    if (!first || !last) break;
    rows.push({
      key: `${first.date}:${last.date}`,
      label: index === end ? dayLabel(first) : `${weekday(first)}–${weekday(last)}`,
      items: [],
    });
    index = end + 1;
  }
  return rows;
};

export function ThisWeek({ days, later, compact = false }: { days: WeekDay[]; later: Later; compact?: boolean }) {
  if (compact) {
    return (
      <div className="timeline">
        <div className="timeline-head">
          <span>Next 7 days</span>
          <span>{rangeLabel(days)}</span>
        </div>
        <div className="timeline-rows">
          {timelineRows(days).map((row) => (
            <div className="timeline-row" key={row.key}>
              <span className="timeline-date">{row.label}</span>
              {row.items.length === 0 ? (
                <span className="timeline-clear">Clear</span>
              ) : (
                <span className="timeline-items">
                  <span className="timeline-title">{row.items.map((item) => item.title).join(' · ')}</span>
                  {row.items.length > 1 && <span className="timeline-meta">{row.items.length} commitments</span>}
                </span>
              )}
            </div>
          ))}
        </div>

        {later.length > 0 && (
          <details className="timeline-later">
            <summary>Later · {later.length}</summary>
            <ul>
              {later.map((item) => (
                <li key={item.id}>
                  <span>{item.whenLabel}</span>
                  <strong>{item.title}</strong>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    );
  }

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
