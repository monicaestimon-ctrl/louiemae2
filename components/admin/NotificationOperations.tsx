import React, { useState } from 'react';
import { useMutation, usePaginatedQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { customerMessage } from '../../lib/errors';

type Status = 'queued' | 'sending' | 'failed' | 'sent' | 'suppressed';
export default function NotificationOperations({ canResolve }: { canResolve: boolean }) {
  const [filter, setFilter] = useState<Status>('failed');
  const { results, status, loadMore } = usePaginatedQuery(
    api.sysNotifyAdmin.reviewQueue,
    { status: filter },
    { initialNumItems: 20 }
  );
  const [selected, setSelected] = useState<Id<'sysNotifications'> | null>(null);
  return (
    <section className="border p-3 space-y-2">
      <h4>Transactional notification recovery</h4>
      <p className="text-xs">
        Provider acceptance does not guarantee inbox delivery. Historical messages without a receipt
        need reconciliation; they are not automatically resent.
      </p>
      <label>
        Queue status
        <select
          className="block border p-2"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as Status);
            setSelected(null);
          }}
        >
          <option value="failed">Failed / review required</option>
          <option value="queued">Queued</option>
          <option value="sending">Sending</option>
          <option value="sent">Accepted / historical unverified</option>
          <option value="suppressed">Retries stopped</option>
        </select>
      </label>
      {status === 'LoadingFirstPage' && <p>Loading notifications…</p>}
      {status !== 'LoadingFirstPage' && !results.length && <p>No records in this queue.</p>}
      {results.map((row) => (
        <div className="border-t pt-2" key={row.id}>
          <p>
            {row.template} · {row.recipient} ·{' '}
            {row.providerId
              ? 'Provider accepted'
              : row.reviewRequired
                ? 'Reconciliation required'
                : row.status}{' '}
            · {row.attempts} attempts
          </p>
          {row.providerId && <p className="break-all">Provider receipt: {row.providerId}</p>}
          {row.error && <p>{row.error}</p>}
          {canResolve && !row.providerId && (
            <button type="button" className="underline" onClick={() => setSelected(row.id)}>
              Review this message
            </button>
          )}
          {selected === row.id && canResolve && !row.providerId && (
            <NotificationReview key={row.id} id={row.id} />
          )}
        </div>
      ))}
      {status === 'CanLoadMore' && (
        <button type="button" onClick={() => loadMore(20)}>
          Load more notifications
        </button>
      )}
    </section>
  );
}
function NotificationReview({ id }: { id: Id<'sysNotifications'> }) {
  const resolve = useMutation(api.sysNotifyAdmin.resolve);
  const [evidence, setEvidence] = useState(''),
    [providerId, setProviderId] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  async function act(decision: 'confirm_accepted' | 'cancel' | 'retry_not_sent') {
    setBusy(true);
    setMessage('');
    try {
      await resolve({
        id,
        decision,
        evidence,
        ...(providerId ? { providerId } : {}),
        confirmedNotSent: confirmed,
      });
      setMessage('Recorded.');
    } catch (error) {
      setMessage(customerMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset className="grid gap-2 border p-2">
      <legend>Provider reconciliation</legend>
      <label>
        Evidence / provider log reference
        <textarea
          className="block w-full border p-2"
          value={evidence}
          maxLength={2000}
          onChange={(e) => setEvidence(e.target.value)}
        />
      </label>
      <label>
        Provider acceptance receipt (if already accepted)
        <input
          className="block w-full border p-2"
          value={providerId}
          maxLength={200}
          onChange={(e) => setProviderId(e.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />{' '}
        I checked provider records and confirmed this message was never accepted.
      </label>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy || !evidence.trim() || !providerId}
          onClick={() => act('confirm_accepted')}
        >
          Record provider acceptance
        </button>
        <button
          type="button"
          disabled={busy || !evidence.trim() || !confirmed || !!providerId}
          onClick={() => act('retry_not_sent')}
        >
          Queue verified unsent message
        </button>
        <button disabled={busy || !evidence.trim()} onClick={() => act('cancel')}>
          Stop retries (does not unsend)
        </button>
      </div>
      <p role="status">{message}</p>
    </fieldset>
  );
}
