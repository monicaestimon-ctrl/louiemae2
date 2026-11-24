import { useEffect, useState } from 'react';
import { useMutation } from 'convex/react';
import type { Id } from '../convex/_generated/dataModel';
import { api } from '../convex/_generated/api';
import { existingVisitorId } from '../lib/partnerLink';

/** Join an existing eligible browser visit to the authenticated account. Never
 * creates a visitor ID, blocks shopping, or retries a rejected request in a loop. */
export function useReferralAssociation(authenticated: boolean) {
  const associate = useMutation(api.prgAttribution.associateVisitor);
  const [status, setStatus] = useState<'idle' | 'pending' | 'complete' | 'unavailable'>('idle');
  useEffect(() => {
    if (!authenticated) { setStatus('idle'); return; }
    let stopped = false, running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let boundVisitor: string | null = null;
    let continuation: { cursor?: string; cutoff?: number; expectedUserId?: Id<'users'> } = {};
    const run = async () => {
      if (running || stopped) return;
      running = true;
      try {
        // Yield after 20 bounded pages; larger histories resume without
        // restarting the prefix. Every page rechecks server identity and consent.
        for (let page = 0; page < 20 && !stopped; page++) {
          const visitorKey = existingVisitorId();
          const stored = localStorage.getItem('lm:consent');
          if (!visitorKey || stored === 'denied') { continuation = {}; setStatus('idle'); return; }
          if (boundVisitor !== visitorKey) { continuation = {}; boundVisitor = visitorKey; }
          const consent = stored === 'granted' ? 'granted' : 'unknown';
          setStatus('pending');
          const result = await associate({ visitorKey, consent, ...continuation });
          if (stopped) return;
          if (!result?.userId || result.isDone) { continuation = {}; setStatus(result?.userId ? 'complete' : 'idle'); return; }
          if (!result.cursor || result.cutoff === null) throw Error('Invalid referral continuation');
          continuation = { cursor: result.cursor, cutoff: result.cutoff, expectedUserId: result.userId };
        }
        if (!stopped) timer = setTimeout(() => { void run(); }, 60_000);
      } catch {
        continuation = {}; // later retries recheck ownership without changing prior assignments
        if (!stopped) setStatus('unavailable'); // retry only on a later focus
      } finally { running = false; }
    };
    const resume = () => { if (timer) clearTimeout(timer); void run(); };
    void run();
    window.addEventListener('focus', resume);
    window.addEventListener('storage', resume);
    return () => { stopped = true; if (timer) clearTimeout(timer); window.removeEventListener('focus', resume); window.removeEventListener('storage', resume); };
  }, [authenticated, associate]);
  return status;
}
