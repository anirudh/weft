import type { WeekDay } from '@weft/shared';

export function ThisWeek({ days }: { days: WeekDay[] }) {
  return (
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
  );
}
