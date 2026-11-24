/** A platform checkout cannot be fulfilled by a different Stripe mode or connected account. */
export function acceptsPlatformPayment(
  livemode: boolean,
  account?: string,
  key = typeof process !== 'undefined' ? process.env.STRIPE_SECRET_KEY : undefined
) {
  return (
    !!key &&
    /^(sk|rk)_(live|test)_/.test(key) &&
    livemode === /^(sk|rk)_live_/.test(key) &&
    !account
  );
}
