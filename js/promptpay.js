/**
 * PromptPay (Thai QR Payment / EMVCo) payload builder.
 * Works in the browser (window.PromptPay) and in Node (module.exports) for tests.
 */
(function (root) {
  const AID_PROMPTPAY = 'A000000677010111';

  function tlv(id, value) {
    return id + String(value.length).padStart(2, '0') + value;
  }

  // CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) as required by EMVCo.
  function crc16(input) {
    let crc = 0xffff;
    for (let i = 0; i < input.length; i++) {
      crc ^= input.charCodeAt(i) << 8;
      for (let b = 0; b < 8; b++) {
        crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  function normalizeTarget(id) {
    const digits = String(id).replace(/\D/g, '');
    if (digits.length === 10 && digits.startsWith('0')) {
      // Mobile number -> 0066XXXXXXXXX (13 digits), sub-tag 01
      return { tag: '01', value: ('0066' + digits.slice(1)).padStart(13, '0') };
    }
    if (digits.length === 13) {
      // National ID / Tax ID, sub-tag 02
      return { tag: '02', value: digits };
    }
    throw new Error('PromptPay ID ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขประจำตัว 13 หลัก');
  }

  function buildPayload(id, amount) {
    const target = normalizeTarget(id);
    const hasAmount = typeof amount === 'number' && amount > 0;
    if (amount !== undefined && !hasAmount) {
      throw new Error('ยอดชำระต้องมากกว่า 0');
    }
    const merchant = tlv('00', AID_PROMPTPAY) + tlv(target.tag, target.value);
    let payload =
      tlv('00', '01') +
      tlv('01', hasAmount ? '12' : '11') +
      tlv('29', merchant) +
      tlv('53', '764') +
      (hasAmount ? tlv('54', amount.toFixed(2)) : '') +
      tlv('58', 'TH');
    payload += '6304';
    return payload + crc16(payload);
  }

  const api = { buildPayload, crc16 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PromptPay = api;
})(typeof window !== 'undefined' ? window : globalThis);
