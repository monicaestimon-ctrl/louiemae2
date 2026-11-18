import type { HolmProduct } from './catalog';
import { formatHolmPrice } from './formatHolmPrice';

export function ProductPrice({
  p,
  mode = 'retail',
  qty = 1,
  big = false,
}: {
  p: Pick<HolmProduct, 'price' | 'trade'>;
  mode?: 'retail' | 'trade';
  qty?: number;
  big?: boolean;
}) {
  const retail = p.price * qty;
  const trade = (p.trade ?? p.price) * qty;
  return (
    <span className="num">
      {formatHolmPrice(mode === 'trade' ? trade : retail, !big && qty === 1)}
      {mode === 'trade' && !big && (
        <>
          {' '}
          <s className="mute" style={{ fontSize: 11 }}>
            {formatHolmPrice(retail)}
          </s>
        </>
      )}
    </span>
  );
}
