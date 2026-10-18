// E2E Test: Holder info + 1-click LINE OA Webhook auto-fill -> PromptPay QR -> Slip upload + OCR -> Anti-duplicate slip check
// -> Admin PIN Login -> Admin manual approval + LINE OA Flex Message -> Gate Check-in QR Scanner (pass + anti-passback block)
// -> Live E-Ticket unlock & PNG download -> CSV Export & Responsive check.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const db = require('../backend/db');

const BASE_URL = process.env.APP_URL || 'http://localhost:8080';
const SHOTS = process.env.SHOT_DIR || path.join(__dirname, 'screenshots');

async function isServerUp() {
  try {
    const res = await fetch(`${BASE_URL}/api/events`);
    return res.ok;
  } catch {
    return false;
  }
}

async function run() {
  let serverProcess = null;
  if (!(await isServerUp())) {
    serverProcess = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      stdio: 'ignore'
    });
    for (let i = 0; i < 40; i++) {
      if (await isServerUp()) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  db.clearAllForTest();

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  // Prepare distinct slip image for testing
  const slipPng1 = await page.screenshot({ clip: { x: 0, y: 0, width: 420, height: 600 } });

  // 1. Open booking modal and validate holder info required
  await page.click('button[data-event-id="1"]');
  await page.waitForSelector('#bookingModal.active');
  await page.fill('#holderName', '');
  await page.click('text=ชำระเงินและรับบัตร');
  assert.match(await page.textContent('#holderError'), /กรุณากรอกชื่อ/);

  // Test invalid Thai Citizen ID Checksum rejection
  await page.fill('#holderName', 'ธนภัทร วงศ์สวัสดิ์');
  await page.fill('#holderPhone', '0891234567');
  await page.fill('#holderIdCard', '1-1004-12345-67-8');
  await page.fill('#holderLineId', 'U1234567890abcdef1234567890abcdef');
  await page.click('text=ชำระเงินและรับบัตร');
  assert.match(await page.textContent('#holderError'), /สูตรคำนวณ Checksum ของกรมการปกครอง/);

  // Fill valid holder info (Valid Checksum ID: 1-1004-12345-67-3) + use 1-click LINE OA Webhook auto-fill button
  await page.fill('#holderIdCard', '1-1004-12345-67-3');
  const formattedPhone = await page.inputValue('#holderPhone');
  assert.equal(formattedPhone, '089-123-4567', 'Phone auto-formatted with hyphens');
  await page.click('#fetchLineIdBtn');
  await page.waitForFunction(() => {
    const el = document.getElementById('holderLineId');
    return el && el.value.startsWith('U');
  });
  const autoLineId = await page.inputValue('#holderLineId');
  assert.match(autoLineId, /^U[0-9a-f]{32}$/, 'LINE User ID auto-filled from Webhook');

  await page.click('text=ชำระเงินและรับบัตร');

  // 2. Payment modal opens with holder info + QR
  await page.waitForSelector('#paymentModal.active');
  assert.ok(await page.locator('#payQr svg').count(), 'QR rendered');
  assert.match(await page.textContent('#payHolder'), /ธนภัทร วงศ์สวัสดิ์/);
  assert.match(await page.textContent('#payIdCard'), /1-1004-xxxx-xxxxx-67-3|1-1004/);
  assert.ok(await page.isDisabled('#payConfirmBtn'));

  // 3. Upload valid slip #1 & submit
  await page.setInputFiles('#slipInput', { name: 'slip-kbank-1.png', mimeType: 'image/png', buffer: slipPng1 });
  await page.waitForFunction(() => !document.getElementById('payConfirmBtn').disabled);
  await page.click('#payConfirmBtn');

  // 4. Ticket modal opens in 'pending' state (waiting for Admin approval)
  await page.waitForSelector('#ticketModal.active', { timeout: 10000 });
  await page.waitForSelector('#ticketImage:not([hidden])', { timeout: 10000 });
  assert.match(await page.textContent('#ticketStatusBanner'), /รอแอดมินตรวจสอบสลิป/);
  assert.ok(await page.isDisabled('#ticketSaveBtn'), 'Save button locked while pending');

  // 5. Test duplicate slip rejection on a second booking attempt
  await page.click('#ticketDoneBtn');
  await page.click('button[data-event-id="2"]');
  await page.waitForSelector('#bookingModal.active');
  await page.click('text=ชำระเงินและรับบัตร');
  await page.waitForSelector('#paymentModal.active');
  await page.setInputFiles('#slipInput', { name: 'slip-duplicate.png', mimeType: 'image/png', buffer: slipPng1 });
  await page.waitForFunction(() => !document.getElementById('payConfirmBtn').disabled);
  await page.click('#payConfirmBtn');
  await page.waitForFunction(() => {
    const el = document.getElementById('slipError');
    return el && el.textContent.includes('สลิปนี้เคยถูกใช้ไปแล้ว');
  });
  assert.match(await page.textContent('#slipError'), /สลิปนี้เคยถูกใช้ไปแล้ว/, 'Duplicate slip blocked');
  await page.click('#payCancelBtn');

  // Re-open the pending ticket in customer page so we can watch it auto-unlock when Admin approves
  await page.click('#cartButton');
  await page.waitForSelector('#myTicketsModal.active');
  await page.click('.my-ticket button[data-ref]');
  await page.waitForSelector('#ticketModal.active');

  // 6. Open Admin Dashboard in a second tab -> verify Admin PIN Login modal
  const adminPage = await ctx.newPage();
  adminPage.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  adminPage.on('pageerror', (e) => errors.push(e.message));
  await adminPage.goto(`${BASE_URL}/admin.html`, { waitUntil: 'networkidle' });

  await adminPage.waitForSelector('#adminLoginModal.active');
  // Test wrong PIN first
  await adminPage.fill('#adminPinInput', '000000');
  await adminPage.click('#adminLoginBtn');
  await adminPage.waitForFunction(() => {
    const el = document.getElementById('adminLoginError');
    return el && el.textContent.includes('ไม่ถูกต้อง');
  });
  // Login with valid PIN 123456
  await adminPage.fill('#adminPinInput', '123456');
  await adminPage.click('#adminLoginBtn');
  await adminPage.waitForFunction(() => !document.getElementById('adminLoginModal').classList.contains('active'));

  await adminPage.waitForFunction(() => document.getElementById('kpiPending').textContent === '1');
  await adminPage.screenshot({ path: path.join(SHOTS, 'admin-pending.png') });

  // Configure LINE OA, PromptPay (0954654698) & Merchant Name settings in Admin
  await adminPage.click('#openLineSettingsBtn');
  await adminPage.waitForSelector('#lineSettingsModal.active');
  await adminPage.fill('#settingPromptpayInput', '0954654698');
  await adminPage.fill('#settingMerchantNameInput', 'Thai Ticket Concert Co., Ltd.');
  await adminPage.click('#saveSettingsBtn');
  await adminPage.waitForFunction(() => !document.getElementById('lineSettingsModal').classList.contains('active'));

  // Click Approve & Send LINE
  await adminPage.click('button[data-action="approve"]');
  await adminPage.waitForFunction(() => document.getElementById('kpiPending').textContent === '0');
  await adminPage.screenshot({ path: path.join(SHOTS, 'admin-approved.png') });

  // 7. Test Gate Check-in QR Scanner & Camera Device Selector (First scan = PASS, Second scan = BLOCKED DUPLICATE)
  await adminPage.click('button[data-action="scan-ticket"]');
  await adminPage.waitForSelector('#gateScannerModal.active');
  assert.ok(await adminPage.locator('#cameraDeviceSelect').count(), 'Camera device select rendered');
  assert.ok(await adminPage.locator('#btnSwitchCamera').count(), 'Switch camera button rendered');
  assert.ok(await adminPage.locator('#btnToggleTorch').count(), 'Flashlight torch toggle rendered');
  assert.ok(await adminPage.locator('#btnToggleGateVoice').count(), 'Thai gate voice feedback toggle rendered');
  assert.ok(await adminPage.locator('#gateOnlineBadge').count(), 'Gate online status badge rendered');
  assert.ok(await adminPage.locator('#btnDownloadOfflineRoster').count(), 'Download offline roster button rendered');
  assert.ok(await adminPage.locator('#scannerVideo').count(), 'Scanner video element rendered');

  // Test toggling torch & Thai voice
  await adminPage.click('#btnToggleTorch');
  await adminPage.click('#btnToggleGateVoice');
  assert.match(await adminPage.textContent('#btnToggleGateVoice'), /เสียงพูด: ปิด/);
  await adminPage.click('#btnToggleGateVoice');
  assert.match(await adminPage.textContent('#btnToggleGateVoice'), /เสียงพูด: เปิด/);

  // Test downloading offline roster cache
  await adminPage.click('#btnDownloadOfflineRoster');
  await adminPage.waitForFunction(() => {
    const el = document.getElementById('gateOfflineRosterCount');
    return el && el.textContent.includes('1 รายการ');
  });

  await adminPage.waitForFunction(() => {
    const box = document.getElementById('scanResultBox');
    return box && !box.hidden && box.textContent.includes('เช็กอินสำเร็จ');
  });
  assert.match(await adminPage.textContent('#scanResultBox'), /เช็กอินสำเร็จ — อนุญาตให้เข้างาน/);
  assert.match(await adminPage.textContent('#scanResultBox'), /HMAC-SHA256/);
  await adminPage.screenshot({ path: path.join(SHOTS, 'gate-checkin-pass.png') });

  // Scan the exact same ticket a second time -> must block duplicate entry!
  await adminPage.click('#submitScanBtn');
  await adminPage.waitForFunction(() => {
    const box = document.getElementById('scanResultBox');
    return box && box.textContent.includes('ALREADY_CHECKED_IN');
  });
  assert.match(await adminPage.textContent('#scanResultBox'), /ถูกสแกนเข้างานไปแล้ว/);
  await adminPage.screenshot({ path: path.join(SHOTS, 'gate-checkin-duplicate.png') });

  // Test HMAC-SHA256 anti-counterfeit QR verification: tampered QR must be blocked with INVALID_SIGNATURE
  await adminPage.click('#testTamperedQrBtn');
  await adminPage.waitForFunction(() => {
    const box = document.getElementById('scanResultBox');
    return box && box.textContent.includes('INVALID_SIGNATURE');
  });
  assert.match(await adminPage.textContent('#scanResultBox'), /ลายเซ็นดิจิทัล \(HMAC-SHA256\)/);
  await adminPage.screenshot({ path: path.join(SHOTS, 'gate-checkin-tampered-qr.png') });
  await adminPage.click('#closeScannerBtn');

  // Test Bulk Order Selection & Bulk Action Bar (#selectAllOrdersCheckbox + #bulkApproveBtn)
  await adminPage.check('#selectAllOrdersCheckbox');
  await adminPage.waitForFunction(() => {
    const el = document.getElementById('selectedOrdersCount');
    return el && el.textContent.includes('เลือก 1 รายการ');
  });
  await adminPage.click('#bulkApproveBtn');
  await adminPage.waitForFunction(() => {
    const el = document.getElementById('selectedOrdersCount');
    return el && el.textContent.includes('เลือก 0 รายการ');
  });

  // Verify Admin Audit Log records all actions including BULK_APPROVE_SLIP
  await adminPage.click('#openAuditLogBtn');
  await adminPage.waitForSelector('#auditLogModal.active');
  await adminPage.waitForFunction(() => {
    const el = document.getElementById('auditLogList');
    return el && el.textContent.includes('APPROVE_SLIP') && el.textContent.includes('GATE_CHECKIN') && el.textContent.includes('BULK_APPROVE_SLIP');
  });
  assert.match(await adminPage.textContent('#auditLogList'), /UPDATE_SETTINGS/);
  await adminPage.locator('#auditLogModal .modal-box').screenshot({ path: path.join(SHOTS, 'admin-audit-log.png') });
  await adminPage.click('#closeAuditLogBtn');

  // Preview LINE Flex Message in Admin
  await adminPage.click('button[data-action="preview-line"]');
  await adminPage.waitForSelector('#adminLinePreviewModal.active');
  await adminPage.locator('#adminLinePreviewModal .modal-box').screenshot({ path: path.join(SHOTS, 'line-flex-preview.png') });
  await adminPage.click('#closeAdminLinePreviewBtn');

  // Verify CSV export download from Admin
  const [csvDl] = await Promise.all([adminPage.waitForEvent('download'), adminPage.click('#exportCsvBtn')]);
  assert.equal(csvDl.suggestedFilename(), 'thaiticket-orders.csv');

  // Verify Guest List CSV export download from Admin (for on-site check-in & ID verification)
  const [guestListDl] = await Promise.all([adminPage.waitForEvent('download'), adminPage.click('#exportGuestListBtn')]);
  assert.match(guestListDl.suggestedFilename(), /^thaiticket-guest-list-.*\.csv$/);

  // 8. Customer's open ticket modal automatically updates to 'approved', shows Live Dynamic Security Pass, and unlocks Save PNG!
  await page.waitForFunction(() => {
    const btn = document.getElementById('ticketSaveBtn');
    const secBar = document.getElementById('liveTicketSecurityBar');
    return btn && !btn.disabled && secBar && !secBar.hidden;
  }, { timeout: 10000 });
  assert.match(await page.textContent('#ticketStatusBanner'), /อนุมัติการชำระเงินเรียบร้อย/);
  assert.match(await page.textContent('#liveSecurityToken'), /^TOKEN #\d{3}-\d{3}$/);
  await page.locator('#ticketModal .modal-box').screenshot({ path: path.join(SHOTS, 'live-dynamic-ticket.png') });

  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#ticketSaveBtn')]);
  assert.match(dl.suggestedFilename(), /^ticket-TT[A-Z0-9]{4}-[A-Z0-9]{4}\.png$/);
  await dl.saveAs(path.join(SHOTS, 'downloaded-ticket.png'));
  await page.click('#ticketDoneBtn');

  // Verify updated PromptPay number (095-465-4698), Merchant Name, Promo Code (EARLY10), Real-time SSE Seat Sync, and Copy button
  await page.click('button[data-event-id="1"]');
  await page.waitForSelector('#bookingModal.active');
  assert.match(await page.textContent('#seatRealtimeBadge'), /Live SSE/);

  // Test Real-time SSE Seat Hold from another peer session + Server-Side Expiration Worker auto-unlock
  await page.evaluate(async () => {
    await fetch('/api/seats/hold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seats: ['VIP-05'], sessionId: 'sess_peer_test_sse', durationMs: 1200 })
    });
  });
  await page.waitForFunction(() => {
    const btn = document.querySelector('button[data-seat-id="VIP-05"]');
    return btn && btn.classList.contains('seat-held-other');
  }, { timeout: 10000 });
  // Wait for Server-Side Expiration Worker to auto-unlock VIP-05 via SSE
  await page.waitForFunction(() => {
    const btn = document.querySelector('button[data-seat-id="VIP-05"]');
    return btn && !btn.classList.contains('seat-held-other');
  }, { timeout: 10000 });

  await page.fill('#promoCodeInput', 'EARLY10');
  await page.click('#applyPromoBtn');
  await page.waitForFunction(() => {
    const el = document.getElementById('promoStatusMsg');
    return el && !el.hidden && el.textContent.includes('ลดทันที 650 THB');
  });
  assert.equal(await page.textContent('#totalPriceDisplay'), '5,850 THB');
  await page.locator('#bookingModal .modal-box').screenshot({ path: path.join(SHOTS, 'promo-code-applied.png') });

  await page.click('text=ชำระเงินและรับบัตร');
  await page.waitForSelector('#paymentModal.active');
  await page.waitForFunction(() => {
    const el = document.getElementById('payPromptpayId');
    return el && el.textContent === '095-465-4698';
  });
  assert.equal(await page.textContent('#payPromptpayId'), '095-465-4698');
  assert.equal(await page.textContent('#payMerchant'), 'Thai Ticket Concert Co., Ltd.');
  assert.equal(await page.textContent('#payAmount'), '5,850.00');
  assert.match(await page.textContent('#payQty'), /โค้ด EARLY10/);
  await page.click('#copyPromptpayBtn');
  await page.locator('#payQrBox').screenshot({ path: path.join(SHOTS, 'promptpay-updated.png') });
  await page.click('#payCancelBtn');

  // 8.5 Test Event & Zone Quota Manager + 1-Click Database Backup in Admin
  await adminPage.click('#openEventManagerBtn');
  await adminPage.waitForSelector('#eventManagerModal.active');
  await adminPage.waitForFunction(() => {
    const el = document.getElementById('adminEventsList');
    return el && el.textContent.includes('ECHOES OF ASIA');
  });
  await adminPage.click('[data-edit-event-id="1"]');
  await adminPage.fill('#evQuotaVip', '75');
  await adminPage.click('#saveEventBtn');
  await adminPage.waitForFunction(() => {
    const el = document.getElementById('adminEventsList');
    return el && el.textContent.includes('/75');
  });
  await adminPage.locator('#eventManagerModal .modal-box').screenshot({ path: path.join(SHOTS, 'event-manager.png') });
  await adminPage.click('#closeEventManagerBtn');

  // Test 1-Click Database Backup Modal & JSON Snapshot Download
  await adminPage.click('#openBackupModalBtn');
  await adminPage.waitForSelector('#backupModal.active');
  await adminPage.locator('#backupModal .modal-box').screenshot({ path: path.join(SHOTS, 'backup-modal.png') });
  const [backupDl] = await Promise.all([adminPage.waitForEvent('download'), adminPage.click('#downloadBackupBtn')]);
  assert.equal(backupDl.suggestedFilename(), 'thaiticket-backup.json');
  await adminPage.click('#closeBackupModalBtn');

  // 8.6 Test Smartphone Mockup LINE Flex Preview Modal
  await adminPage.click('#openLinePreviewNavBtn');
  await adminPage.waitForSelector('#adminLinePreviewModal.active');
  await adminPage.waitForSelector('.phone-mockup-frame');
  assert.ok(await adminPage.locator('.phone-line-header').count(), 'smartphone line header rendered');
  await adminPage.locator('#adminLinePreviewModal .modal-box').screenshot({ path: path.join(SHOTS, 'smartphone-line-preview.png') });
  await adminPage.click('#closeAdminLinePreviewBtn');

  // 8.7 Test Promoter Analytics Dashboard, Zone Occupancy Heatmap & Printable Settlement Report Modal
  await adminPage.click('#openAnalyticsBtn');
  await adminPage.waitForSelector('#analyticsModal.active');
  await adminPage.waitForSelector('#eventSettlementTable');
  assert.ok((await adminPage.locator('.analytics-kpi-card').count()) >= 4, '4 KPI cards rendered in analytics');
  assert.ok((await adminPage.locator('.zone-heatmap-item').count()) >= 4, '4 zones rendered in seating heatmap');
  assert.match(await adminPage.textContent('#settlementReportHeader'), /OFFICIAL FINANCIAL SETTLEMENT REPORT/);
  assert.match(await adminPage.textContent('#eventSettlementTable'), /ECHOES OF ASIA WORLD TOUR 2026/);
  const [settlementDl] = await Promise.all([
    adminPage.waitForEvent('download'),
    adminPage.click('#downloadSettlementHtmlBtn')
  ]);
  assert.match(settlementDl.suggestedFilename(), /^thaiticket-settlement-.*\.html$/);
  await adminPage.locator('#analyticsModal .modal-box').screenshot({ path: path.join(SHOTS, 'promoter-analytics-heatmap.png') });
  await adminPage.click('#closeAnalyticsModalBtn');

  // 9. Responsive check across iPhone (375px, 390px, 430px), iPad (768px, 820px, 1024px), desktop (1280px)
  for (const w of [375, 390, 430, 768, 820, 1024, 1280]) {
    await page.setViewportSize({ width: w, height: 860 });
    const overflowCustomer = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflowCustomer <= 0, `customer no horizontal overflow at ${w}px`);

    await adminPage.setViewportSize({ width: w, height: 860 });
    const overflowAdmin = await adminPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflowAdmin <= 0, `admin no horizontal overflow at ${w}px`);

    const headerContained = await adminPage.evaluate(() => {
      const h = document.querySelector('.header').getBoundingClientRect();
      const a = document.querySelector('.admin-actions').getBoundingClientRect();
      return a.bottom <= h.bottom + 1 && a.top >= h.top - 1;
    });
    assert.ok(headerContained, `admin navbar buttons stay inside header at ${w}px`);
  }

  // Capture responsive visual screenshots for iPhone & iPad
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(SHOTS, 'iphone-customer-view.png'), fullPage: false });
  await adminPage.setViewportSize({ width: 390, height: 844 });
  await adminPage.screenshot({ path: path.join(SHOTS, 'iphone-admin-view.png'), fullPage: false });

  await page.setViewportSize({ width: 820, height: 1180 });
  await page.screenshot({ path: path.join(SHOTS, 'ipad-customer-view.png'), fullPage: false });
  await adminPage.setViewportSize({ width: 820, height: 1180 });
  await adminPage.screenshot({ path: path.join(SHOTS, 'ipad-admin-view.png'), fullPage: false });

  await adminPage.setViewportSize({ width: 1280, height: 900 });
  await adminPage.screenshot({ path: path.join(SHOTS, 'admin-navbar-fixed.png') });

  assert.deepEqual(errors, [], 'zero console errors');
  await browser.close();
  if (serverProcess) {
    try { serverProcess.kill(); } catch {}
  }
  console.log('E2E PASSED');
}

run().catch((e) => {
  console.error('E2E FAILED:', e);
  process.exit(1);
});
