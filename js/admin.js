/**
 * Admin Dashboard controller:
 * - Admin PIN authentication & session management
 * - Slip inspection & SHA-256 anti-duplicate badge
 * - Approve / Reject slip
 * - LINE Official Account (Messaging API) Channel Access Token settings & Flex preview
 * - Gate Check-in QR Code Scanner with anti-passback duplicate entry protection
 * - Sales breakdown by zone & CSV/Excel export
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const TOKEN_KEY = 'thaiticket.adminToken.v1';
  let currentFilter = 'all';
  let ordersCache = [];
  let rejectTargetRef = null;

  function getAuthHeaders(extra) {
    const headers = Object.assign({}, extra || {});
    try {
      const token = sessionStorage.getItem(TOKEN_KEY);
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch {
      /* ignore */
    }
    return headers;
  }

  function showLoginModal(msg) {
    if ($('adminLoginError')) $('adminLoginError').textContent = msg || '';
    if ($('adminLogoutBtn')) $('adminLogoutBtn').hidden = true;
    window.UI.open('adminLoginModal');
    setTimeout(() => {
      if ($('adminPinInput')) $('adminPinInput').focus();
    }, 60);
  }

  async function checkAdminSession() {
    try {
      const res = await fetch('/api/admin/session', { headers: getAuthHeaders() });
      const data = await res.json();
      if (data && data.authenticated) {
        if ($('adminLogoutBtn')) $('adminLogoutBtn').hidden = false;
        window.UI.close('adminLoginModal');
        await Promise.all([loadStats(), loadOrders()]);
      } else {
        showLoginModal('');
      }
    } catch {
      showLoginModal('');
    }
  }

  async function loginAdmin() {
    const pin = ($('adminPinInput').value || '').trim();
    const errEl = $('adminLoginError');
    if (!pin) {
      errEl.textContent = 'กรุณากรอกรหัส PIN แอดมิน';
      return;
    }
    errEl.textContent = '';
    $('adminLoginBtn').disabled = true;
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      const data = await res.json();
      if (!data.ok) {
        errEl.textContent = data.error || 'รหัส PIN ไม่ถูกต้อง';
        return;
      }
      try {
        if (data.token) sessionStorage.setItem(TOKEN_KEY, data.token);
      } catch {
        /* ignore */
      }
      $('adminPinInput').value = '';
      if ($('adminLogoutBtn')) $('adminLogoutBtn').hidden = false;
      window.UI.close('adminLoginModal');
      window.UI.toast('เข้าสู่ระบบแอดมินสำเร็จ');
      await Promise.all([loadStats(), loadOrders()]);
    } catch (err) {
      errEl.textContent = err.message || 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ';
    } finally {
      $('adminLoginBtn').disabled = false;
    }
  }

  async function logoutAdmin() {
    try {
      await fetch('/api/admin/logout', { method: 'POST', headers: getAuthHeaders() });
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    showLoginModal('ออกจากระบบเรียบร้อยแล้ว');
  }

  function statusBadge(status) {
    if (status === 'pending') return '<span class="badge-pending">รอตรวจสอบสลิป</span>';
    if (status === 'rejected') return '<span class="badge-rejected">ปฏิเสธสลิป</span>';
    return '<span class="badge-accent">อนุมัติแล้ว</span>';
  }

  function lineStatusBadge(order) {
    if (order.lineSent === 1) {
      return '<span class="badge-accent">ส่งเข้า LINE OA แล้ว</span>';
    }
    if (order.lineSent === 2) {
      return '<span class="badge-accent">สร้างข้อความ LINE Flex แล้ว</span>';
    }
    return '<span class="text-muted" style="font-size:11px;">ยังไม่ส่ง LINE</span>';
  }

  function checkInBadge(order) {
    if (order.checkedInAt) {
      const timeStr = new Date(order.checkedInAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      return `<span class="badge-checkedin">✔ เข้างานแล้ว (${window.UI.escapeHtml(timeStr)})</span>`;
    }
    return '';
  }

  async function loadStats() {
    try {
      const res = await fetch('/api/admin/stats', { headers: getAuthHeaders() });
      if (!res.ok) return;
      const stats = await res.json();
      if (stats.unauthorized) {
        showLoginModal();
        return;
      }
      $('kpiPending').textContent = (stats.pendingCount || 0).toLocaleString('th-TH');
      $('kpiApprovedTickets').textContent = (stats.approvedTickets || 0).toLocaleString('th-TH') + ' ใบ';
      if ($('kpiCheckedInTickets')) {
        $('kpiCheckedInTickets').textContent = (stats.checkedInTickets || 0).toLocaleString('th-TH') + ' ใบ';
      }
      $('kpiRevenue').textContent = (stats.approvedRevenue || 0).toLocaleString('th-TH') + ' THB';
      $('kpiRejected').textContent = (stats.rejectedCount || 0).toLocaleString('th-TH');

      const zoneBox = $('zoneBreakdown');
      if (!stats.byZone || !stats.byZone.length) {
        zoneBox.innerHTML = `<p class="text-muted">ยังไม่มีรายการที่อนุมัติแล้ว</p>`;
      } else {
        const esc = window.UI.escapeHtml;
        zoneBox.innerHTML = stats.byZone
          .map(
            (z) => `
            <div class="zone-chip">
              <div>
                <div style="font-weight:700;">${esc(z.zone)}</div>
                <div class="text-muted" style="font-size:12px;">${z.tickets} ใบ (${z.orders} รายการ)</div>
              </div>
              <div style="font-weight:700;color:var(--color-accent);">${z.revenue.toLocaleString('th-TH')} THB</div>
            </div>`
          )
          .join('');
      }
    } catch {
      /* ignore */
    }
  }

  async function loadOrders() {
    const container = $('adminOrdersList');
    try {
      const res = await fetch(`/api/orders?status=${encodeURIComponent(currentFilter)}`, {
        headers: getAuthHeaders()
      });
      if (!res.ok) throw new Error('โหลดข้อมูลไม่สำเร็จ');
      const data = await res.json();
      if (data.unauthorized) {
        showLoginModal();
        return;
      }
      ordersCache = data.orders || [];
      renderOrders();
      renderQuickScanChips();
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><p class="empty-title">ไม่สามารถโหลดข้อมูลได้</p><p class="text-muted">${window.UI.escapeHtml(err.message)}</p></div>`;
    }
  }

  function renderOrders() {
    const container = $('adminOrdersList');
    if (!ordersCache.length) {
      container.innerHTML = `
        <div class="empty-state card">
          <p class="empty-title">ไม่มีรายการคำสั่งซื้อในหมวดนี้</p>
          <p class="text-muted">เมื่อลูกค้าแนบสลิปจากหน้าจองบัตร รายการจะแสดงที่นี่ทันที</p>
        </div>`;
      return;
    }

    const esc = window.UI.escapeHtml;
    container.innerHTML = ordersCache
      .map((o) => {
        const issuedStr = new Date(o.issuedAt).toLocaleString('th-TH');
        const shortHash = (o.slipHash || '').slice(0, 14);
        return `
        <article class="order-card" data-order-ref="${esc(o.ref)}">
          <div class="order-slip-thumb" data-action="zoom-slip" data-ref="${esc(o.ref)}" title="คลิกเพื่อดูรูปสลิปขนาดใหญ่">
            <img src="${esc(o.slipData)}" alt="สลิป ${esc(o.ref)}">
            <span class="order-slip-zoom-tag">ขยายดูสลิป</span>
          </div>

          <div class="order-info">
            <div class="order-top-row">
              <span class="order-ref">${esc(o.ref)}</span>
              ${statusBadge(o.status)}
              ${lineStatusBadge(o)}
              ${checkInBadge(o)}
              <span class="text-muted" style="font-size:12px;">สั่งซื้อเมื่อ ${esc(issuedStr)}</span>
            </div>

            <div class="order-title">${esc(o.title)}</div>

            <div class="order-meta-grid">
              <div class="order-meta-item">
                <small>ผู้ถือบัตร</small>
                <strong>${esc(o.holderName)} (${esc(o.holderPhone)})</strong>
              </div>
              <div class="order-meta-item">
                <small>โซน / จำนวน</small>
                <strong>${esc(o.zone)} · ${o.qty} ใบ</strong>
              </div>
              <div class="order-meta-item">
                <small>ยอดโอนตามรายการ</small>
                <strong style="color:var(--color-accent);">${Number(o.total).toLocaleString('th-TH')} THB</strong>
              </div>
              <div class="order-meta-item">
                <small>LINE User ID</small>
                <strong>${esc(o.lineUserId || '(ไม่ได้ระบุ)')}</strong>
              </div>
            </div>

            <div class="order-hash">
              ✔ ตรวจสลิปซ้ำผ่าน (SHA-256: ${esc(shortHash)}…)
              ${o.checkedInAt ? ` · <span style="color:var(--color-accent);">เข้างานเมื่อ ${esc(new Date(o.checkedInAt).toLocaleString('th-TH'))} (${esc(o.checkedInBy || 'Gate A')})</span>` : ''}
              ${o.status === 'rejected' && o.rejectReason ? ` · <span style="color:#FF6B6B;">เหตุผลที่ปฏิเสธ: ${esc(o.rejectReason)}</span>` : ''}
            </div>
          </div>

          <div class="order-actions">
            ${
              o.status === 'pending'
                ? `
              <button class="btn-primary" data-action="approve" data-ref="${esc(o.ref)}">อนุมัติ & ส่งบัตร LINE</button>
              <button class="btn-outline" data-action="reject" data-ref="${esc(o.ref)}">ปฏิเสธสลิป</button>
            `
                : o.status === 'approved'
                  ? `
              <button class="btn-primary" data-action="scan-ticket" data-ref="${esc(o.ref)}">${o.checkedInAt ? 'ตรวจสถานะเข้างาน' : 'สแกนเช็กอินเข้างาน'}</button>
              <button class="btn-default" data-action="preview-line" data-ref="${esc(o.ref)}">ดูข้อความ LINE OA</button>
              <button class="btn-outline" data-action="resend-line" data-ref="${esc(o.ref)}">ส่งเข้า LINE ซ้ำ</button>
            `
                  : `
              <button class="btn-primary" data-action="approve" data-ref="${esc(o.ref)}">อนุมัติใหม่อีกครั้ง</button>
            `
            }
          </div>
        </article>`;
      })
      .join('');
  }

  function renderQuickScanChips() {
    const box = $('quickScanChips');
    if (!box) return;
    const approved = ordersCache.filter((o) => o.status === 'approved');
    if (!approved.length) {
      box.innerHTML = `<span class="text-muted" style="font-size:12px;">ยังไม่มีบัตรที่อนุมัติแล้วในรายการปัจจุบัน</span>`;
      return;
    }
    const esc = window.UI.escapeHtml;
    box.innerHTML = approved
      .slice(0, 8)
      .map(
        (o) => `
        <button type="button" class="quick-scan-chip" data-scan-ref="${esc(o.ref)}">
          ${esc(o.ref)} · ${esc(o.holderName)} ${o.checkedInAt ? '(เข้างานแล้ว)' : ''}
        </button>`
      )
      .join('');
  }

  function openScannerModal(prefillRef) {
    renderQuickScanChips();
    if (prefillRef && $('scanCodeInput')) {
      $('scanCodeInput').value = `THAITICKET|${prefillRef}`;
    }
    window.UI.open('gateScannerModal');
    if (prefillRef) {
      submitCheckIn();
    } else if ($('scanCodeInput')) {
      $('scanCodeInput').focus();
    }
  }

  async function submitCheckIn() {
    const code = ($('scanCodeInput').value || '').trim();
    const staffName = ($('scanStaffInput').value || '').trim() || 'Gate A';
    const resultBox = $('scanResultBox');
    if (!code) {
      window.UI.toast('กรุณากรอกรหัส QR Code หรือรหัสการจอง', 'error');
      return;
    }

    $('submitScanBtn').disabled = true;
    try {
      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ code, staffName })
      });
      const data = await res.json();
      if (data.unauthorized) {
        window.UI.close('gateScannerModal');
        showLoginModal();
        return;
      }

      const esc = window.UI.escapeHtml;
      resultBox.hidden = false;
      if (data.ok && data.code === 'CHECKED_IN') {
        const o = data.order;
        resultBox.className = 'scan-result-box is-pass';
        resultBox.innerHTML = `
          <div style="font-size:16px; font-weight:700; color:var(--color-accent); margin-bottom:6px;">
            ✅ เช็กอินสำเร็จ — อนุญาตให้เข้างาน (${esc(o.ref)})
          </div>
          <div style="font-size:13px; color:#fff;">
            <strong>${esc(o.title)}</strong> · โซน ${esc(o.zone)} (${o.qty} ใบ)<br>
            ผู้ถือบัตร: <strong>${esc(o.holderName)} (${esc(o.holderPhone)})</strong><br>
            บันทึกเวลาเข้างาน: ${esc(new Date(o.checkedInAt).toLocaleString('th-TH'))} โดย ${esc(o.checkedInBy)}
          </div>
        `;
        window.UI.toast(`เช็กอินบัตร ${o.ref} เข้างานสำเร็จ`);
        await Promise.all([loadStats(), loadOrders()]);
      } else {
        const o = data.order;
        const msg = data.message || data.error || 'ไม่สามารถเช็กอินได้';
        resultBox.className = 'scan-result-box is-duplicate';
        resultBox.innerHTML = `
          <div style="font-size:16px; font-weight:700; color:#FF6B6B; margin-bottom:6px;">
            ⛔ ปฏิเสธการเข้างาน (${esc(data.code || 'ERROR')})
          </div>
          <div style="font-size:13px; color:#fff;">
            ${esc(msg)}
            ${
              o
                ? `<br><span class="text-muted">ผู้ถือบัตร: ${esc(o.holderName)} (${esc(o.holderPhone)}) · โซน ${esc(o.zone)} (${o.qty} ใบ)</span>`
                : ''
            }
          </div>
        `;
        window.UI.toast(msg, 'error');
      }
    } catch (err) {
      window.UI.toast(err.message, 'error');
    } finally {
      $('submitScanBtn').disabled = false;
    }
  }

  async function approveOrder(ref, btn) {
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(ref)}/approve`, {
        method: 'POST',
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (data.unauthorized) {
        showLoginModal();
        return;
      }
      if (!data.ok) throw new Error(data.error || 'อนุมัติไม่สำเร็จ');
      window.UI.toast(`อนุมัติรายการ ${ref} และส่งบัตรทาง LINE OA เรียบร้อย`);
      await Promise.all([loadStats(), loadOrders()]);
    } catch (err) {
      window.UI.toast(err.message, 'error');
      if (btn) btn.disabled = false;
    }
  }

  function openRejectModal(ref) {
    rejectTargetRef = ref;
    $('rejectRefLabel').textContent = ref;
    $('rejectReasonInput').value = 'ยอดเงินในสลิปไม่ตรงกับยอดสั่งซื้อ';
    window.UI.open('rejectModal');
  }

  async function confirmReject() {
    if (!rejectTargetRef) return;
    const reason = $('rejectReasonInput').value.trim() || 'สลิปไม่ผ่านการตรวจสอบ';
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(rejectTargetRef)}/reject`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ reason })
      });
      const data = await res.json();
      if (data.unauthorized) {
        showLoginModal();
        return;
      }
      if (!data.ok) throw new Error(data.error || 'ปฏิเสธไม่สำเร็จ');
      window.UI.close('rejectModal');
      window.UI.toast(`ปฏิเสธสลิปรายการ ${rejectTargetRef} แล้ว`);
      await Promise.all([loadStats(), loadOrders()]);
    } catch (err) {
      window.UI.toast(err.message, 'error');
    }
  }

  async function resendLine(ref, btn) {
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(ref)}/send-line`, {
        method: 'POST',
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (data.unauthorized) {
        showLoginModal();
        return;
      }
      if (!data.ok) throw new Error(data.error || 'ส่ง LINE ไม่สำเร็จ');
      window.UI.toast(data.lineResult.message || 'ส่งข้อความเข้า LINE OA แล้ว');
      await loadOrders();
    } catch (err) {
      window.UI.toast(err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function openSlipZoom(order) {
    $('slipZoomImg').src = order.slipData;
    $('slipZoomTitle').textContent = `สลิปการโอนเงิน · ${order.ref} (${Number(order.total).toLocaleString('th-TH')} THB)`;
    $('slipZoomMeta').textContent = `ผู้ถือบัตร: ${order.holderName} (${order.holderPhone}) · SHA-256: ${order.slipHash}`;
    window.UI.open('slipZoomModal');
  }

  function openLinePreview(order) {
    const esc = window.UI.escapeHtml;
    const msg = (order.lineLog && order.lineLog.message) || 'สร้างข้อความ LINE Flex Message สำเร็จ';
    $('adminLinePreviewBody').innerHTML = `
      <p class="text-muted" style="margin-bottom:12px;">${esc(msg)}</p>
      <div class="line-flex-card">
        <div class="line-flex-header">
          <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700;">
            <span style="color:#B40000;">THAI TICKET</span>
            <span style="color:#229BFF;">E-TICKET</span>
          </div>
          <div style="font-size:16px;font-weight:700;color:#fff;margin-top:6px;">${esc(order.title)}</div>
          <div style="font-size:12px;color:#ccc;margin-top:2px;">${esc(order.date)} · ${esc(order.venue)}</div>
        </div>
        <div class="line-flex-body">
          <div class="line-flex-row">
            <div><small>ผู้ถือบัตร</small><strong>${esc(order.holderName)}</strong></div>
            <div><small>เบอร์โทรศัพท์</small><strong>${esc(order.holderPhone)}</strong></div>
          </div>
          <div class="line-flex-row">
            <div><small>โซนที่นั่ง</small><strong>${esc(order.zone)}</strong></div>
            <div><small>จำนวน / ยอดชำระ</small><strong style="color:#229BFF;">${order.qty} ใบ (${Number(order.total).toLocaleString('th-TH')} THB)</strong></div>
          </div>
          <div class="line-flex-ref">
            <small>รหัสการจอง (แสดงหน้างาน)</small>
            <strong>${esc(order.ref)}</strong>
          </div>
        </div>
      </div>
    `;
    window.UI.open('adminLinePreviewModal');
  }

  let auditLogsCache = [];

  async function openSettingsModal() {
    try {
      const res = await fetch('/api/settings', { headers: getAuthHeaders() });
      const data = await res.json();
      if (data.unauthorized) {
        showLoginModal();
        return;
      }
      $('settingTokenStatus').textContent = data.hasLineToken
        ? `ตั้งค่าแล้ว (${data.lineTokenMasked})`
        : 'ยังไม่ได้ตั้งค่า (ทำงานในโหมดพรีวิว Flex Message อัตโนมัติ)';
      $('settingPromptpayInput').value = data.promptpayId || '0954654698';
      if ($('settingMerchantNameInput')) {
        $('settingMerchantNameInput').value = data.merchantName || 'Thai Ticket Concert Co., Ltd.';
      }
      $('settingLineTokenInput').value = '';
      if ($('settingAdminPinInput')) $('settingAdminPinInput').value = '';
    } catch {
      /* ignore */
    }
    window.UI.open('lineSettingsModal');
  }

  async function saveSettings() {
    const token = $('settingLineTokenInput').value.trim();
    const promptpayId = $('settingPromptpayInput').value.trim();
    const merchantName = $('settingMerchantNameInput') ? $('settingMerchantNameInput').value.trim() : '';
    const adminPin = $('settingAdminPinInput') ? $('settingAdminPinInput').value.trim() : '';
    const payload = { promptpayId, merchantName };
    if (token) payload.lineChannelAccessToken = token;
    if (adminPin) payload.adminPin = adminPin;

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.unauthorized) {
        window.UI.close('lineSettingsModal');
        showLoginModal();
        return;
      }
      if (!data.ok) throw new Error(data.error || 'บันทึกไม่สำเร็จ');
      window.UI.close('lineSettingsModal');
      window.UI.toast(`บันทึกการตั้งค่าเรียบร้อย (พร้อมเพย์: ${data.promptpayId})`);
    } catch (err) {
      window.UI.toast(err.message, 'error');
    }
  }

  function renderAuditLogs() {
    const box = $('auditLogList');
    if (!box) return;
    const q = (($('auditSearchInput') && $('auditSearchInput').value) || '').trim().toLowerCase();
    const filtered = auditLogsCache.filter(
      (l) =>
        !q ||
        (l.action || '').toLowerCase().includes(q) ||
        (l.targetRef || '').toLowerCase().includes(q) ||
        (l.detail || '').toLowerCase().includes(q) ||
        (l.actor || '').toLowerCase().includes(q)
    );

    if (!filtered.length) {
      box.innerHTML = `<div class="empty-state"><p class="text-muted">ไม่พบประวัติการทำงานที่ค้นหา</p></div>`;
      return;
    }

    const esc = window.UI.escapeHtml;
    box.innerHTML = filtered
      .map((l) => {
        const timeStr = new Date(l.createdAt).toLocaleString('th-TH');
        const isDanger = l.action.includes('REJECT') || l.action.includes('BLOCKED') || l.action.includes('FAILED');
        const badgeClass = isDanger ? 'badge-rejected' : 'badge-accent';
        return `
        <div class="zone-chip" style="align-items:flex-start; gap:12px;">
          <div style="flex:1;">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:4px;">
              <span class="${badgeClass}">${esc(l.action)}</span>
              ${l.targetRef ? `<strong style="color:var(--color-accent); font-size:12px;">${esc(l.targetRef)}</strong>` : ''}
              <span class="text-muted" style="font-size:11px;">โดย ${esc(l.actor)} · ${esc(timeStr)}</span>
            </div>
            <div style="font-size:13px; color:#fff;">${esc(l.detail)}</div>
          </div>
        </div>`;
      })
      .join('');
  }

  async function openAuditLogModal() {
    window.UI.open('auditLogModal');
    const box = $('auditLogList');
    if (box) box.innerHTML = `<p class="text-muted">กำลังโหลดประวัติการทำงาน...</p>`;
    try {
      const res = await fetch('/api/admin/audit-logs', { headers: getAuthHeaders() });
      const data = await res.json();
      if (data.unauthorized) {
        window.UI.close('auditLogModal');
        showLoginModal();
        return;
      }
      auditLogsCache = data.logs || [];
      renderAuditLogs();
    } catch {
      if (box) box.innerHTML = `<p class="text-muted">ไม่สามารถโหลดประวัติการทำงานได้</p>`;
    }
  }

  let adminEventsCache = [];

  function resetEventForm() {
    $('evIdInput').value = '';
    $('evTitleInput').value = '';
    $('evVenueInput').value = '';
    $('evDateInput').value = '';
    $('evPriceRangeInput').value = '1,800 - 6,500 THB';
    $('evQuotaVip').value = '50';
    $('evQuotaA').value = '100';
    $('evQuotaB').value = '120';
    $('evQuotaC').value = '150';
    $('evFormModeTitle').textContent = '+ เพิ่มคอนเสิร์ตใหม่ / แก้ไขโควตาที่นั่ง';
  }

  function renderAdminEvents() {
    const box = $('adminEventsList');
    if (!box) return;
    if (!adminEventsCache.length) {
      box.innerHTML = `<p class="text-muted">ยังไม่มีรายการคอนเสิร์ต</p>`;
      return;
    }
    const esc = window.UI.escapeHtml;
    box.innerHTML = adminEventsCache
      .map(
        (ev) => `
        <div class="zone-chip" style="cursor:pointer;" data-edit-event-id="${ev.id}">
          <div>
            <div style="font-weight:700; color:#fff;">${esc(ev.title)}</div>
            <div class="text-muted" style="font-size:12px;">${esc(ev.date)} · ${esc(ev.venue)}</div>
            <div style="font-size:11px; color:var(--color-accent); margin-top:2px;">
              คงเหลือรวม ${ev.remainingTotal}/${ev.totalQuota} ที่นั่ง (VIP:${ev.remainingVip}/${ev.quotaVip} · A:${ev.remainingA}/${ev.quotaA} · B:${ev.remainingB}/${ev.quotaB} · C:${ev.remainingC}/${ev.quotaC})
            </div>
          </div>
          <span class="btn-outline btn-sm">แก้ไขโควตา</span>
        </div>`
      )
      .join('');
  }

  async function openEventManagerModal() {
    resetEventForm();
    window.UI.open('eventManagerModal');
    try {
      const res = await fetch('/api/events', { cache: 'no-store' });
      const data = await res.json();
      if (data && data.ok) {
        adminEventsCache = data.events || [];
        renderAdminEvents();
      }
    } catch {
      /* ignore */
    }
  }

  async function saveAdminEvent() {
    const id = $('evIdInput').value ? Number($('evIdInput').value) : null;
    const title = $('evTitleInput').value.trim();
    const venue = $('evVenueInput').value.trim();
    const date = $('evDateInput').value.trim();
    const priceRange = $('evPriceRangeInput').value.trim();
    const quotaVip = Number($('evQuotaVip').value || 50);
    const quotaA = Number($('evQuotaA').value || 100);
    const quotaB = Number($('evQuotaB').value || 120);
    const quotaC = Number($('evQuotaC').value || 150);

    if (!title || !venue || !date) {
      window.UI.toast('กรุณากรอกชื่อคอนเสิร์ต สถานที่ และวันที่แสดงให้ครบถ้วน', 'error');
      return;
    }

    $('saveEventBtn').disabled = true;
    try {
      const res = await fetch('/api/admin/events', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id, title, venue, date, priceRange, quotaVip, quotaA, quotaB, quotaC })
      });
      const data = await res.json();
      if (data.unauthorized) {
        window.UI.close('eventManagerModal');
        showLoginModal();
        return;
      }
      if (!data.ok) throw new Error(data.error || 'บันทึกไม่สำเร็จ');
      adminEventsCache = data.events || [];
      renderAdminEvents();
      resetEventForm();
      window.UI.toast('บันทึกข้อมูลคอนเสิร์ตและโควตาที่นั่งเรียบร้อยแล้ว');
    } catch (err) {
      window.UI.toast(err.message, 'error');
    } finally {
      $('saveEventBtn').disabled = false;
    }
  }

  async function confirmRestoreBackup() {
    const input = $('restoreBackupInput');
    const file = input && input.files && input.files[0];
    if (!file) {
      window.UI.toast('กรุณาเลือกไฟล์สำรองข้อมูล (.json) ก่อนกดกู้คืน', 'error');
      return;
    }
    $('confirmRestoreBtn').disabled = true;
    try {
      const text = await file.text();
      const snapshot = JSON.parse(text);
      const res = await fetch('/api/admin/restore', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ snapshot })
      });
      const data = await res.json();
      if (data.unauthorized) {
        window.UI.close('backupModal');
        showLoginModal();
        return;
      }
      if (!data.ok) throw new Error(data.error || 'กู้คืนข้อมูลไม่สำเร็จ');
      window.UI.close('backupModal');
      window.UI.toast('กู้คืนข้อมูลฐานข้อมูลสำเร็จเรียบร้อย');
      await Promise.all([loadStats(), loadOrders()]);
    } catch (err) {
      window.UI.toast(err.message || 'ไฟล์สำรองข้อมูลไม่ถูกต้อง', 'error');
    } finally {
      $('confirmRestoreBtn').disabled = false;
    }
  }

  function bind() {
    document.querySelectorAll('.filter-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.status;
        loadOrders();
      });
    });

    $('adminOrdersList').addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const ref = target.dataset.ref;
      const action = target.dataset.action;
      const order = ordersCache.find((o) => o.ref === ref);
      if (!order) return;

      if (action === 'approve') approveOrder(ref, target);
      else if (action === 'reject') openRejectModal(ref);
      else if (action === 'zoom-slip') openSlipZoom(order);
      else if (action === 'preview-line') openLinePreview(order);
      else if (action === 'resend-line') resendLine(ref, target);
      else if (action === 'scan-ticket') openScannerModal(ref);
    });

    $('adminLoginBtn').addEventListener('click', loginAdmin);
    $('adminPinInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loginAdmin();
    });
    if ($('adminLogoutBtn')) {
      $('adminLogoutBtn').addEventListener('click', logoutAdmin);
    }

    $('openScannerBtn').addEventListener('click', () => openScannerModal());
    $('closeScannerBtn').addEventListener('click', () => window.UI.close('gateScannerModal'));
    $('submitScanBtn').addEventListener('click', submitCheckIn);
    $('scanCodeInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitCheckIn();
    });
    $('quickScanChips').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-scan-ref]');
      if (!chip) return;
      $('scanCodeInput').value = `THAITICKET|${chip.dataset.scanRef}`;
      submitCheckIn();
    });

    if ($('openEventManagerBtn')) {
      $('openEventManagerBtn').addEventListener('click', openEventManagerModal);
    }
    if ($('closeEventManagerBtn')) {
      $('closeEventManagerBtn').addEventListener('click', () => window.UI.close('eventManagerModal'));
    }
    if ($('evResetFormBtn')) {
      $('evResetFormBtn').addEventListener('click', resetEventForm);
    }
    if ($('saveEventBtn')) {
      $('saveEventBtn').addEventListener('click', saveAdminEvent);
    }
    if ($('adminEventsList')) {
      $('adminEventsList').addEventListener('click', (e) => {
        const card = e.target.closest('[data-edit-event-id]');
        if (!card) return;
        const ev = adminEventsCache.find((x) => x.id === Number(card.dataset.editEventId));
        if (!ev) return;
        $('evIdInput').value = String(ev.id);
        $('evTitleInput').value = ev.title;
        $('evVenueInput').value = ev.venue;
        $('evDateInput').value = ev.date;
        $('evPriceRangeInput').value = ev.priceRange;
        $('evQuotaVip').value = String(ev.quotaVip);
        $('evQuotaA').value = String(ev.quotaA);
        $('evQuotaB').value = String(ev.quotaB);
        $('evQuotaC').value = String(ev.quotaC);
        $('evFormModeTitle').textContent = `กำลังแก้ไขคอนเสิร์ต #${ev.id}: ${ev.title}`;
      });
    }

    if ($('openBackupModalBtn')) {
      $('openBackupModalBtn').addEventListener('click', () => window.UI.open('backupModal'));
    }
    if ($('closeBackupModalBtn')) {
      $('closeBackupModalBtn').addEventListener('click', () => window.UI.close('backupModal'));
    }
    if ($('confirmRestoreBtn')) {
      $('confirmRestoreBtn').addEventListener('click', confirmRestoreBackup);
    }

    if ($('openAuditLogBtn')) {
      $('openAuditLogBtn').addEventListener('click', openAuditLogModal);
    }
    if ($('closeAuditLogBtn')) {
      $('closeAuditLogBtn').addEventListener('click', () => window.UI.close('auditLogModal'));
    }
    if ($('auditSearchInput')) {
      $('auditSearchInput').addEventListener('input', renderAuditLogs);
    }

    $('openLineSettingsBtn').addEventListener('click', openSettingsModal);
    $('saveSettingsBtn').addEventListener('click', saveSettings);
    $('closeSettingsBtn').addEventListener('click', () => window.UI.close('lineSettingsModal'));

    $('confirmRejectBtn').addEventListener('click', confirmReject);
    $('closeRejectBtn').addEventListener('click', () => window.UI.close('rejectModal'));

    $('closeSlipZoomBtn').addEventListener('click', () => window.UI.close('slipZoomModal'));
    $('closeAdminLinePreviewBtn').addEventListener('click', () => window.UI.close('adminLinePreviewModal'));
    $('refreshAdminBtn').addEventListener('click', () => {
      loadStats();
      loadOrders();
      window.UI.toast('อัปเดตข้อมูลล่าสุดแล้ว');
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bind();
    checkAdminSession();
  });
})();
