/**
 * Payment configuration.
 * IMPORTANT: replace PROMPTPAY_ID with the real receiving PromptPay number
 * (10-digit mobile number or 13-digit national/tax ID) before going live.
 */
window.APP_CONFIG = Object.freeze({
  PROMPTPAY_ID: '0954654698',
  MERCHANT_NAME: 'Thai Ticket Concert Co., Ltd.',
  PAYMENT_TIMEOUT_SECONDS: 15 * 60,
  SLIP_MAX_BYTES: 5 * 1024 * 1024,
  SLIP_ALLOWED_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
  STORAGE_KEY: 'thaiticket.tickets.v1'
});
