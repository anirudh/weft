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
};

export function OpenLoops({ yours, theirs, completed, dismissed, onClear, onDecide, busy }: Props) {
  const card = (o: Obligation, primary = false) => (
    <LoopCard key={o.id} o={o} primary={primary} onClear={onClear} onDecide={onDecide} busy={busy === o.id} />
  );
  // Completed and dismissed sit together under Your court: both are things you
  // cleared today, and both need to stay reachable long enough to undo.
  const cleared = [...completed, ...dismissed];

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
