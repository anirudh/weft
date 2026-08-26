import type { MailRow } from '@weft/shared';

/** Sender · subject · date, per artboard N. Rank column leads each row. */
export function MailTable({ rows, ranked }: { rows: MailRow[]; ranked: boolean }) {
  const when = (iso: string) => {
    const d = new Date(iso);
    const days = (Date.now() - d.getTime()) / 86_400_000;
    if (days < 1) return d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' });
    if (days < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' });
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };

  return (
    <table className="mail">
      <thead>
        <tr>
          <th className="col-rank">#</th>
          <th className="col-sender">Sender</th>
          <th>Subject</th>
          <th className="col-date">Date</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m, i) => (
          <tr key={`${m.accountEmail}:${m.id}`}>
            <td className="col-rank">{i + 1}</td>
            <td className="col-sender" title={m.fromEmail}>
              {m.isSent && <span className="sent-tag">sent</span>}
              {m.fromName || m.fromEmail}
            </td>
            <td className="col-subject">
              <a
                href={`https://mail.google.com/mail/u/${encodeURIComponent(m.accountEmail)}/#all/${m.threadId}`}
                target="_blank"
                rel="noreferrer"
              >
                {m.subject || <span className="faint">(no subject)</span>}
              </a>
            </td>
            <td className="col-date">{when(m.receivedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
