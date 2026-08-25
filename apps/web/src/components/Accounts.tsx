import type { AccountStatus } from '@weft/shared';

export function Accounts({ accounts }: { accounts: AccountStatus[] }) {
  return (
    <div className="accounts">
      {accounts.map((a) => (
        <span key={a.email} className={a.needsReconnect ? 'account account-stale' : 'account'}>
          <span className="account-dot" />
          {a.email}
          <span className="account-meta">
            {a.needsReconnect
              ? 'needs reconnecting'
              : a.messageCount > 0
                ? `${a.messageCount.toLocaleString()} messages`
                : 'not synced yet'}
          </span>
          {a.needsReconnect && (
            <a className="account-fix" href={`/api/accounts/connect?email=${encodeURIComponent(a.email)}`}>
              Reconnect
            </a>
          )}
        </span>
      ))}
      <a className="account-add" href="/api/accounts/connect">
        + Connect an account
      </a>
    </div>
  );
}
