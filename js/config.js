/**
 * Payment configuration.
 * IMPORTANT: replace PROMPTPAY_ID with the real receiving PromptPay number
 * (10-digit mobile number or 13-digit national/tax ID) before going live.
 */
window.APP_CONFIG = Object.freeze({
  PROMPTPAY_ID: '0804711301',
  MERCHANT_NAME: 'บจก. วีเอ็นที อีเว้นท์ ออร์แกไนเซอร์ จำกัด',
  BANK_NAME: 'ธนาคารกสิกรไทย (KBANK)',
  BANK_ACCOUNT: '1638790587',
  PAYMENT_TIMEOUT_SECONDS: 15 * 60,
  SLIP_MAX_BYTES: 5 * 1024 * 1024,
  SLIP_ALLOWED_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
  STORAGE_KEY: 'thaiticket.tickets.v1'
});
