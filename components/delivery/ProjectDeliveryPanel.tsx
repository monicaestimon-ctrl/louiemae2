import React, { useState } from 'react';
import { useRecoverableQuery } from '../../contexts/useRecoverableQuery';
import { api } from '../../convex/_generated/api';
import { DeliveryCheckout } from './CheckoutV2';
import DeliveryQuoteRequest from './DeliveryQuoteRequest';
import { SPLIT_MAY } from '../../lib/customerCopy';

export default function ProjectDeliveryPanel({ lines, automatic, approved }: {
  lines: { productId: string; variantId: string; packs: number }[];
  automatic: boolean;
  approved: boolean;
}) {
  const availability = useRecoverableQuery(api.v2Admin.publicFlags, approved ? {} : 'skip');
  const flags = availability.data;
  const [zip, setZip] = useState('');
  if (!approved) return <p>Sign in with an approved trade account to continue. Retail purchases are available on Louie Mae.</p>;
  if (availability.status === 'unavailable') return <div role="status">
    <p>Project checkout availability could not be verified. Please try again.</p>
    <button type="button" onClick={availability.retry}>Retry checkout availability</button>
  </div>;
  if (!flags) return <p role="status">Checking checkout availability…</p>;
  if (!flags.tradeCheckout) return <p>Trade checkout is being prepared. Contact the House team for this project.</p>;
  return <section aria-label="Project delivery and checkout">
    <h3>Delivery and final pricing</h3>
    <p>{SPLIT_MAY}</p>
    {automatic && flags.delivery ? <DeliveryCheckout lines={lines} channel="trade" /> : <>
      <p>This project needs a confirmed delivery quote before payment.</p>
      <label>Destination ZIP <input value={zip} onChange={e => setZip(e.target.value)} inputMode="numeric" maxLength={10} /></label>
      <DeliveryQuoteRequest key={JSON.stringify({ lines, zip })} lines={lines} postalCode={zip} channel="trade" />
    </>}
  </section>;
}
