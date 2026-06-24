import { describe, expect, it } from 'vitest';
import { getCjAutomationConfig, readBooleanEnv } from './cjAutomation';

describe('CJ automation configuration', () => {
  it('defaults to create-only mode with webhook signature verification on', () => {
    const config = getCjAutomationConfig({});

    expect(config.mode).toBe('create_only');
    expect(config.autoFulfillmentEnabled).toBe(false);
    expect(config.autoBalancePayEnabled).toBe(false);
    expect(config.webhookSignatureVerificationRequired).toBe(true);
    expect(config.fulfillmentAutomationReady).toBe(false);
    expect(config.balancePaymentReady).toBe(false);
    expect(config.warnings).toContain('CJ_API_KEY is not configured.');
  });

  it('supports manual-payment automation when fulfillment is enabled without balance payment', () => {
    const config = getCjAutomationConfig({
      CJ_API_KEY: 'cj_live_key',
      CJ_WEBHOOK_URL: 'https://louiemae.com/cj/webhook',
      CJ_AUTO_FULFILLMENT_ENABLED: 'true',
      CJ_AUTO_BALANCE_PAY_ENABLED: 'false',
    });

    expect(config.mode).toBe('manual_payment');
    expect(config.fulfillmentAutomationReady).toBe(true);
    expect(config.balancePaymentReady).toBe(false);
    expect(config.warnings).toContain('CJ fulfillment automation can prepare orders, but balance payment remains manual.');
  });

  it('requires API key, webhook URL, fulfillment, balance payment, and signature verification for balance-payment readiness', () => {
    const config = getCjAutomationConfig({
      CJ_API_KEY: 'cj_live_key',
      CJ_WEBHOOK_URL: 'https://louiemae.com/cj/webhook',
      CJ_AUTO_FULFILLMENT_ENABLED: 'true',
      CJ_AUTO_BALANCE_PAY_ENABLED: 'true',
      CJ_WEBHOOK_VERIFY_SIGNATURE: 'true',
    });

    expect(config.mode).toBe('balance_payment');
    expect(config.fulfillmentAutomationReady).toBe(true);
    expect(config.balancePaymentReady).toBe(true);
    expect(config.warnings).toEqual([]);
  });

  it('does not allow balance payment readiness when webhook signatures are disabled', () => {
    const config = getCjAutomationConfig({
      CJ_API_KEY: 'cj_live_key',
      CJ_WEBHOOK_URL: 'https://louiemae.com/cj/webhook',
      CJ_AUTO_FULFILLMENT_ENABLED: 'true',
      CJ_AUTO_BALANCE_PAY_ENABLED: 'true',
      CJ_WEBHOOK_VERIFY_SIGNATURE: 'false',
    });

    expect(config.mode).toBe('balance_payment');
    expect(config.balancePaymentReady).toBe(false);
    expect(config.warnings).toContain('Automatic balance payment requires CJ_WEBHOOK_VERIFY_SIGNATURE=true.');
  });

  it('parses common boolean env values', () => {
    expect(readBooleanEnv('1')).toBe(true);
    expect(readBooleanEnv('YES')).toBe(true);
    expect(readBooleanEnv('off', true)).toBe(false);
    expect(readBooleanEnv(undefined, true)).toBe(true);
    expect(readBooleanEnv('unexpected', false)).toBe(false);
  });
});

