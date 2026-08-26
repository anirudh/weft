import type { Obligation } from '@weft/shared';
import { LoopCard } from './LoopCard.js';

type Props = {
  yours: Obligation[];
  theirs: Obligation[];
  completed: Obligation[];
  dismissed: Obligation[];
  onClear: (id: number, how: 'complete' | 'dismiss' | 'reopen') => void;
  onDecide: (o: Obligation, state: 'kept' | 'cancelled') => void;
  busy: number | null;
  compact?: boolean;
  showCleared?: boolean;
};

export function OpenLoops({
  yours,
  theirs,
  completed,
  dismissed,
  onClear,
  onDecide,
  busy,
  compact = false,
  showCleared = true,
}: Props) {
  const card = (o: Obligation, primary = false) => (
    <LoopCard
      key={o.id}
      o={o}
      primary={primary}
      onClear={onClear}
      onDecide={onDecide}
      busy={busy === o.id}
      compact={compact}
    />
  );
  // Completed and dismissed sit together under Your court: both are things you
  // cleared today, and both need to stay reachable long enough to undo.
  const cleared = [...completed, ...dismissed];

  if (compact) {
    return (
      <div className="courts courts-compact">
        <div className="court court-compact">
          <span className="court-label court-label-compact">Your court</span>
          {yours.length === 0 && <p className="loop-row-empty">Nothing needs you.</p>}
          <div className="loop-rows">{yours.map((o, i) => card(o, i === 0 && o.bucket === 'today'))}</div>

          <span className="court-label court-label-compact court-label-theirs">Their court</span>
          {theirs.length === 0 && <p className="loop-row-empty">Nothing outstanding from anyone else.</p>}
          <div className="loop-rows">{theirs.map((o) => card(o))}</div>

          {showCleared && cleared.length > 0 && (
            <>
              <span className="court-label court-label-quiet court-label-spaced">Cleared today</span>
              <div className="loop-rows">{cleared.map((o) => card(o))}</div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="courts">
      <div className="court">
        <span className="court-label">Your court</span>
        {yours.length === 0 && <p className="empty">Nothing needs you.</p>}
        {yours.map((o, i) => card(o, i === 0 && o.bucket === 'today'))}
        {cleared.length > 0 && <span className="court-label court-label-quiet court-label-spaced">Cleared today</span>}
        {cleared.map((o) => card(o))}
      </div>
      <div className="court">
        <span className="court-label court-label-quiet">Their court</span>
        {theirs.length === 0 && <p className="empty">Nothing outstanding from anyone else.</p>}
        {theirs.map((o) => card(o))}
      </div>
    </div>
  );
}

export function ClearedLoops(props: Props) {
  const cleared = [...props.completed, ...props.dismissed];
  return (
    <div className="loop-rows loop-rows-cleared">
      {cleared.map((obligation) => (
        <LoopCard
          key={obligation.id}
          o={obligation}
          primary={false}
          onClear={props.onClear}
          onDecide={props.onDecide}
          busy={props.busy === obligation.id}
          compact={props.compact}
        />
      ))}
    </div>
  );
}
