/** Approved Louie Mae identity. Reuse this lockup; do not substitute other LM marks. */
export function HouseIcon({ className = '' }: { className?: string }) {
  return <img className={`lm-house-icon ${className}`} src="/images/brand/approved/house-icon.svg" alt="" width="100" height="104" />;
}

export function Wordmark() {
  return <span className="lm-brand-name">LOUIE MAE</span>;
}
