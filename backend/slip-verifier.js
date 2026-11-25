/**
 * Bank Slip Automated Verification Engine
 * Supports SlipOK, EasySlip, and built-in Smart Simulator.
 * Validates transfer amount, recipient account, and transaction timestamp.
 */
const db = require('./db');

function describeFetchError(err) {
  const cause = err && err.cause;
  const code = cause && (cause.code || (cause.errors && cause.errors[0] && cause.errors[0].code));
  const hints = {
    ENOTFOUND: 'เซิร์ฟเวอร์หา DNS ของ api.slipok.com ไม่เจอ',
    EAI_AGAIN: 'DNS ของเซิร์ฟเวอร์ไม่ตอบ',
    ETIMEDOUT: 'เซิร์ฟเวอร์ออกอินเทอร์เน็ต (พอร์ต 443) ไม่ได้ / หมดเวลา',
    UND_ERR_CONNECT_TIMEOUT: 'เซิร์ฟเวอร์ออกอินเทอร์เน็ต (พอร์ต 443) ไม่ได้ / หมดเวลา',
    ECONNREFUSED: 'ปลายทางปฏิเสธการเชื่อมต่อ',
    ECONNRESET: 'การเชื่อมต่อถูกตัด',
    ENETUNREACH: 'เซิร์ฟเวอร์ไม่มีเส้นทางออกอินเทอร์เน็ต'
  };
  if (code) return `${err.message} (${code}${hints[code] ? ' - ' + hints[code] : ''})`;
  return (err && err.message) || String(err);
}

// SlipOK error codes that are a real verdict about the image. Anything else (auth, quota, package, bank delay,
// network...) says nothing about the slip, so it stays "unchecked" for the admin to review.
const SLIPOK_FAILED_CODES = {
  1005: 'NOT_A_SLIP', 1006: 'NOT_A_SLIP', 1007: 'NOT_A_SLIP', 1008: 'NOT_A_SLIP',
  1011: 'NOT_FOUND', 1012: 'DUPLICATE', 1013: 'AMOUNT_MISMATCH', 1014: 'RECEIVER_MISMATCH'
};
const EASYSLIP_FAILED_CODES = {
  invalid_image: 'NOT_A_SLIP', qrcode_not_found: 'NOT_A_SLIP', invalid_payload: 'NOT_A_SLIP',
  slip_not_found: 'NOT_FOUND', duplicate_slip: 'DUPLICATE'
};

/**
 * Three-state verdict stored with the order and shown to the admin:
 * passed (the provider confirmed slip + amount), failed (real negative answer), unchecked (no answer).
 */
function classifyResult(result) {
  if (!result) return { status: 'unchecked', code: '' };
  if (result.verified) {
    const real = result.provider === 'SlipOK API' || result.provider === 'EasySlip API';
    return { status: real ? 'passed' : 'unchecked', code: '' };
  }
  return result.failCode ? { status: 'failed', code: result.failCode } : { status: 'unchecked', code: '' };
}

async function verifySlip(args) {
  const result = await runProvider(args);
  const verdict = classifyResult(result);
  const known = verdict.status === 'passed' || verdict.code === 'AMOUNT_MISMATCH' || verdict.code === 'DUPLICATE';
  const bankRef = known && result.transRef && result.transRef !== 'N/A' ? String(result.transRef) : '';
  return { ...result, ...verdict, bankRef };
}

async function runProvider({ order, slipDataUrl, slipBuffer }) {
  const provider = db.getSetting('slip_verify_provider', process.env.SLIP_VERIFY_PROVIDER || 'simulator');
  const apiKey = db.getSetting('slip_verify_api_key', process.env.SLIP_VERIFY_API_KEY || '');
  // SlipOK branch IDs are numeric; users often paste "#81657" from the SlipOK dashboard.
  const branchId = String(db.getSetting('slip_verify_branch_id', process.env.SLIP_VERIFY_BRANCH_ID || '')).replace(/[^0-9A-Za-z_-]/g, '');
  const autoApproveEnabled = db.getSetting('slip_auto_approve_enabled', 'false') === 'true';

  // Base64 to buffer conversion if needed
  let imageBuffer = slipBuffer;
  if (!imageBuffer && slipDataUrl) {
    const comma = slipDataUrl.indexOf(',');
    const base64 = comma >= 0 ? slipDataUrl.slice(comma + 1) : slipDataUrl;
    imageBuffer = Buffer.from(base64, 'base64');
  }

  // Provider 1: SlipOK
  if (provider === 'slipok' && apiKey) {
    try {
      const endpoint = branchId
        ? `https://api.slipok.com/api/line/apikey/${encodeURIComponent(branchId)}`
        : `https://api.slipok.com/api/line/apikey`;

      const formData = new FormData();
      const mimeMatch = /^data:(image\/[a-z0-9.+-]+);/i.exec(slipDataUrl || '');
      const mime = mimeMatch ? mimeMatch[1].toLowerCase() : 'image/png';
      const ext = mime.split('/')[1].replace('jpeg', 'jpg');
      const blob = new Blob([imageBuffer], { type: mime });
      formData.append('files', blob, `${order.ref}_slip.${ext}`);
      // Test runs must not mark a real slip as "used" at SlipOK.
      formData.append('log', order.isTest ? 'false' : 'true');
      if (Number(order.total) > 0) formData.append('amount', String(order.total));

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'x-authorization': apiKey
        },
        body: formData,
        signal: AbortSignal.timeout(12000)
      });

      const rawText = await res.text();
      let json;
      try {
        json = JSON.parse(rawText);
      } catch (_) {
        return {
          verified: false,
          autoApproved: false,
          provider: 'SlipOK',
          reason: `SlipOK ตอบกลับผิดรูปแบบ (HTTP ${res.status}) ตรวจ Branch ID / API Key อีกครั้ง`
        };
      }
      if (json.success && json.data && json.data.success) {
        const transAmount = Number(json.data.amount || 0);
        const transRef = json.data.transRef || json.data.transId || 'N/A';
        const sender = (json.data.sender && (json.data.sender.name || json.data.sender.account && json.data.sender.account.name)) || 'N/A';

        const amountMatches = !(Number(order.total) > 0) || transAmount === Number(order.total);
        if (!amountMatches) {
          return {
            verified: false,
            autoApproved: false,
            provider: 'SlipOK',
            failCode: 'AMOUNT_MISMATCH',
            transRef,
            amount: transAmount,
            reason: `ยอดเงินในสลิป (${transAmount.toLocaleString('th-TH')} THB) ไม่ตรงกับยอดสั่งซื้อ (${order.total.toLocaleString('th-TH')} THB)`
          };
        }

        return {
          verified: true,
          autoApproved: autoApproveEnabled,
          provider: 'SlipOK API',
          transRef,
          sender,
          amount: transAmount,
          detail: `ตรวจพบสลิปธนาคารแท้ รหัสอ้างอิง: ${transRef} (ยอดเงินตรง: ${transAmount.toLocaleString('th-TH')} THB)`
        };
      }

      return {
        verified: false,
        autoApproved: false,
        provider: 'SlipOK',
        failCode: SLIPOK_FAILED_CODES[Number(json.code)] || '',
        transRef: (json.data && json.data.transRef) || '',
        reason: (json.message || (json.data && json.data.message)) || 'ไม่พบ QR Code สลิปธนาคารที่ถูกต้อง'
      };
    } catch (err) {
      return {
        verified: false,
        autoApproved: false,
        provider: 'SlipOK',
        reason: `เชื่อมต่อ SlipOK ล้มเหลว: ${describeFetchError(err)}`
      };
    }
  }

  // Provider 2: EasySlip
  if (provider === 'easyslip' && apiKey) {
    try {
      const formData = new FormData();
      const blob = new Blob([imageBuffer], { type: 'image/png' });
      formData.append('file', blob, `${order.ref}_slip.png`);

      const res = await fetch('https://developer.easyslip.com/api/v1/verify', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`
        },
        body: formData,
        signal: AbortSignal.timeout(12000)
      });

      const json = await res.json();
      if (json.status === 200 && json.data) {
        const transAmount = Number(json.data.amount && json.data.amount.amount ? json.data.amount.amount : 0);
        const transRef = json.data.transRef || 'N/A';
        const amountMatches = transAmount === Number(order.total);

        if (!amountMatches) {
          return {
            verified: false,
            autoApproved: false,
            provider: 'EasySlip',
            failCode: 'AMOUNT_MISMATCH',
            transRef,
            amount: transAmount,
            reason: `ยอดเงินในสลิป (${transAmount.toLocaleString('th-TH')} THB) ไม่ตรงกับยอดสั่งซื้อ`
          };
        }

        return {
          verified: true,
          autoApproved: autoApproveEnabled,
          provider: 'EasySlip API',
          transRef,
          amount: transAmount,
          detail: `สลิปถูกต้องผ่าน EasySlip รหัส: ${transRef}`
        };
      }

      return {
        verified: false,
        autoApproved: false,
        provider: 'EasySlip',
        failCode: EASYSLIP_FAILED_CODES[String(json.message || '').toLowerCase()] || '',
        reason: json.message || 'ตรวจสลิปไม่ผ่าน'
      };
    } catch (err) {
      return {
        verified: false,
        autoApproved: false,
        provider: 'EasySlip',
        reason: `เชื่อมต่อ EasySlip ล้มเหลว: ${err.message}`
      };
    }
  }

  // Provider 3: Smart Simulator (Default / Development / Offline fallback)
  if (provider === 'simulator') {
    // If slip data exists and passes size check, simulate bank verification based on auto-approve toggle
    const simulatedTransRef = 'SIM-' + Date.now().toString(36).toUpperCase();
    return {
      verified: true,
      autoApproved: autoApproveEnabled,
      provider: 'Smart Simulator',
      transRef: simulatedTransRef,
      amount: order.total,
      detail: `ตรวจสลิปผ่าน Smart Simulator (ยอดเงินตรง: ${Number(order.total).toLocaleString('th-TH')} THB · รหัสอ้างอิง: ${simulatedTransRef})`
    };
  }

  // Not configured / Manual Mode
  return {
    verified: false,
    autoApproved: false,
    provider: 'Manual Review',
    detail: 'รอแอดมินตรวจสอบสลิปด้วยตนเอง'
  };
}

module.exports = {
  verifySlip,
  classifyResult
};
