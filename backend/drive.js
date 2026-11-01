/**
 * Google Drive API v3 Integration Module
 * Uses Node.js native crypto & fetch (Zero external dependencies)
 * Handles Service Account JWT (RS256) auth & multipart file uploads.
 */
const crypto = require('node:crypto');
const db = require('./db');

function base64UrlEncode(strOrBuffer) {
  const buf = Buffer.isBuffer(strOrBuffer) ? strOrBuffer : Buffer.from(strOrBuffer, 'utf8');
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Creates a signed JWT for Google Service Account OAuth2 exchange.
 */
function createServiceAccountJwt(clientEmail, privateKeyPem, scopes = ['https://www.googleapis.com/auth/drive.file']) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientEmail,
    scope: scopes.join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signatureInput);
  signer.end();

  // Normalize private key formatting if newlines were escaped
  const cleanKey = privateKeyPem.replace(/\\n/g, '\n');
  const signature = signer.sign(cleanKey);
  const encodedSignature = base64UrlEncode(signature);

  return `${signatureInput}.${encodedSignature}`;
}

/**
 * Fetches an OAuth2 access token from Google using the signed JWT.
 */
async function getAccessToken(clientEmail, privateKeyPem) {
  const jwt = createServiceAccountJwt(clientEmail, privateKeyPem);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Google OAuth2 Error (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  return data.access_token;
}

/**
 * Uploads slip image buffer to Google Drive.
 */
async function uploadSlipToDrive({ buffer, mimeType = 'image/png', fileName, ref }) {
  const webhookUrl = db.getSetting('google_drive_webhook_url', process.env.GOOGLE_DRIVE_WEBHOOK_URL || '');
  const folderId = db.getSetting('google_drive_folder_id', process.env.GOOGLE_DRIVE_FOLDER_ID || '');
  const clientEmail = db.getSetting('google_service_account_email', process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '');
  const privateKey = db.getSetting('google_service_account_private_key', process.env.GOOGLE_PRIVATE_KEY || '');

  // 1. Easy Mode: Google Apps Script Webhook URL (ไม่ต้องใช้ Service Account)
  const effectiveWebhook = webhookUrl || (folderId && folderId.startsWith('https://script.google.com') ? folderId : '');
  if (effectiveWebhook && effectiveWebhook.startsWith('https://script.google.com')) {
    try {
      const safeFileName = fileName || `slip_${ref}_${Date.now()}.png`;
      const res = await fetch(effectiveWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: safeFileName,
          mimeType,
          base64: buffer.toString('base64'),
          ref
        })
      });
      const data = await res.json();
      if (data && (data.ok || data.fileUrl || data.webViewLink)) {
        return {
          ok: true,
          configured: true,
          fileId: data.fileId || '',
          fileName: safeFileName,
          viewLink: data.fileUrl || data.webViewLink || ''
        };
      }
      return { ok: false, error: data.error || 'Google Apps Script ส่งคืนสถานะไม่สำเร็จ' };
    } catch (err) {
      return { ok: false, error: `Apps Script Upload Error: ${err.message}` };
    }
  }

  // 2. Standard Mode: Service Account Credentials
  if (!folderId || !clientEmail || !privateKey) {
    return {
      ok: false,
      configured: false,
      message: 'Google Drive ยังไม่ได้กำหนดค่า Credentials (จัดเก็บรูปภาพในระบบเรียบร้อยแล้ว)'
    };
  }

  try {
    const accessToken = await getAccessToken(clientEmail, privateKey);
    const safeFileName = fileName || `slip_${ref}_${Date.now()}.png`;

    const metadata = {
      name: safeFileName,
      parents: [folderId],
      description: `Payment slip for order ${ref} - Thai Ticket Hub`,
      properties: { orderRef: ref }
    };

    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const multipartRequestBody = Buffer.concat([
      Buffer.from(
        delimiter +
          'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
          JSON.stringify(metadata) +
          delimiter +
          `Content-Type: ${mimeType}\r\n\r\n`
      ),
      buffer,
      Buffer.from(closeDelimiter)
    ]);

    const uploadRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Content-Length': String(multipartRequestBody.length)
        },
        body: multipartRequestBody
      }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      return { ok: false, error: `Drive Upload Failed: ${errText}` };
    }

    const file = await uploadRes.json();

    // Make viewable via link if requested
    try {
      await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ role: 'reader', type: 'anyone' })
      });
    } catch (_) {}

    const viewLink =
      file.webViewLink || `https://drive.google.com/file/d/${file.id}/view?usp=sharing`;

    return {
      ok: true,
      configured: true,
      fileId: file.id,
      fileName: file.name,
      viewLink
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Tests connection to Google Drive folder with given credentials.
 */
async function testDriveConnection({ folderId, clientEmail, privateKey, webhookUrl }) {
  const effectiveWebhook = webhookUrl || (folderId && folderId.startsWith('https://script.google.com') ? folderId : '');
  if (effectiveWebhook && effectiveWebhook.startsWith('https://script.google.com')) {
    try {
      const pingBuffer = Buffer.from('test');
      const res = await fetch(effectiveWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: 'ping_test.txt',
          mimeType: 'text/plain',
          base64: pingBuffer.toString('base64'),
          ref: 'TEST'
        })
      });
      if (!res.ok) {
        return { ok: false, message: `Google Apps Script ตอบกลับ HTTP ${res.status}` };
      }
      const data = await res.json();
      if (data && (data.ok || data.fileUrl || data.webViewLink)) {
        return {
          ok: true,
          message: 'เชื่อมต่อ Google Apps Script Webhook สำเร็จ! ไฟล์ทดสอบถูกส่งเข้า Drive แล้ว'
        };
      }
      return { ok: false, message: `Google Apps Script แจ้งเตือน: ${data.error || 'ไม่สามารถสร้างไฟล์ได้'}` };
    } catch (err) {
      return { ok: false, message: `เกิดข้อผิดพลาดในการเรียก Webhook: ${err.message}` };
    }
  }

  if (!folderId || !clientEmail || !privateKey) {
    return { ok: false, message: 'กรุณากรอกข้อมูล Google Drive (หรือใส่ Google Apps Script Webhook URL)' };
  }
  try {
    const accessToken = await getAccessToken(clientEmail, privateKey);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,mimeType`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, message: `ไม่สามารถเข้าถึงโฟลเดอร์ (${res.status}): ตรวจสอบว่าได้แชร์สิทธิ์ Editor ให้ ${clientEmail} แล้วหรือยัง` };
    }
    const folder = await res.json();
    return {
      ok: true,
      message: `เชื่อมต่อ Google Drive สำเร็จ! พบโฟลเดอร์: "${folder.name}" (${folder.id})`
    };
  } catch (err) {
    return { ok: false, message: `เกิดข้อผิดพลาด: ${err.message}` };
  }
}

module.exports = {
  uploadSlipToDrive,
  testDriveConnection
};
