import React, { useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { DeliveryCheckout } from './CheckoutV2';
import DeliveryQuoteRequest from './DeliveryQuoteRequest';
import { SPLIT_MAY } from '../../lib/customerCopy';

export default function ProjectDeliveryPanel({ lines, automatic, approved }: {
  lines: { productId: string; variantId: string; packs: number }[];
  automatic: boolean;
  approved: boolean;
}) {
  const flags = useQuery(api.v2Admin.publicFlags);
  const [zip, setZip] = useState('');
  if (!approved) return <p>Sign in with an approved trade account to continue. Retail purchases are available on Louie Mae.</p>;
  if (!flags) return <p>Checking checkout availability…</p>;
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
