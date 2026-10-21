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
  const selectedOrderRefs = new Set();

  function updateBulkSelectionUi() {
    const validRefs = new Set(ordersCache.map((o) => o.ref));
    for (const r of Array.from(selectedOrderRefs)) {
      if (!validRefs.has(r)) selectedOrderRefs.delete(r);
    }
    const count = selectedOrderRefs.size;
    if ($('selectedOrdersCount')) {
      $('selectedOrdersCount').textContent = `เลือก ${count} รายการ`;
    }
    if ($('bulkApproveBtn')) {
      $('bulkApproveBtn').disabled = count === 0;
    }
    if ($('bulkCheckInBtn')) {
      $('bulkCheckInBtn').disabled = count === 0;
    }
    if ($('bulkDeleteBtn')) {
      $('bulkDeleteBtn').disabled = count === 0;
    }
    if ($('selectAllOrdersCheckbox')) {
      $('selectAllOrdersCheckbox').checked = ordersCache.length > 0 && count === ordersCache.length;
    }
  }

  function buildClientFallbackSlipSvg(t) {
    const ref = String(t.ref || 'TT0000').replace(/[<>&"']/g, '');
    const holder = String(t.holderName || 'ผู้ถือบัตร').replace(/[<>&"']/g, '');
    const phone = String(t.holderPhone || '-').replace(/[<>&"']/g, '');
    const zone = String(t.zone || 'VIP').replace(/[<>&"']/g, '');
    const qty = Number(t.qty || 1);
    const total = Number(t.total || 0).toLocaleString('th-TH');
    const dateStr = new Date(Number(t.issuedAt) || Date.now()).toLocaleString('th-TH');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640" viewBox="0 0 480 640">
      <rect width="480" height="640" rx="16" fill="#1E1E1E"/>
      <rect x="20" y="20" width="440" height="600" rx="12" fill="#2A2A2A" stroke="#444" stroke-width="2"/>
      <rect x="20" y="20" width="440" height="84" rx="12" fill="#B40000"/>
      <text x="240" y="58" fill="#FFFFFF" font-family="sans-serif" font-size="22" font-weight="bold" text-anchor="middle">THAI QR PROMPTPAY SLIP</text>
      <text x="240" y="84" fill="#FFDADA" font-family="sans-serif" font-size="14" text-anchor="middle">หลักฐานการชำระเงิน (ซิงก์จากบัตรของฉัน)</text>
      <circle cx="240" cy="156" r="32" fill="#229BFF"/>
      <text x="240" y="166" fill="#FFFFFF" font-family="sans-serif" font-size="28" font-weight="bold" text-anchor="middle">✓</text>
      <text x="240" y="218" fill="#68D391" font-family="sans-serif" font-size="20" font-weight="bold" text-anchor="middle">โอนเงินสำเร็จ (Payment Recorded)</text>
      <text x="240" y="264" fill="#229BFF" font-family="sans-serif" font-size="34" font-weight="bold" text-anchor="middle">${total} THB</text>
      <line x1="50" y1="296" x2="430" y2="296" stroke="#444" stroke-dasharray="6,6"/>
      <text x="55" y="340" fill="#999999" font-family="sans-serif" font-size="15">รหัสการจอง (Booking Ref)</text>
      <text x="425" y="340" fill="#FFFFFF" font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="end">${ref}</text>
      <text x="55" y="385" fill="#999999" font-family="sans-serif" font-size="15">ชื่อผู้โอน / ผู้ถือบัตร</text>
      <text x="425" y="385" fill="#FFFFFF" font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="end">${holder}</text>
      <text x="55" y="430" fill="#999999" font-family="sans-serif" font-size="15">เบอร์โทรศัพท์</text>
      <text x="425" y="430" fill="#FFFFFF" font-family="sans-serif" font-size="16" text-anchor="end">${phone}</text>
      <text x="55" y="475" fill="#999999" font-family="sans-serif" font-size="15">โซนที่นั่ง / จำนวน</text>
      <text x="425" y="475" fill="#229BFF" font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="end">${zone} (${qty} ใบ)</text>
      <text x="55" y="520" fill="#999999" font-family="sans-serif" font-size="15">เวลาทำรายการ</text>
      <text x="425" y="520" fill="#CCCCCC" font-family="sans-serif" font-size="14" text-anchor="end">${dateStr}</text>
      <line x1="50" y1="552" x2="430" y2="552" stroke="#444"/>
      <text x="240" y="588" fill="#888888" font-family="sans-serif" font-size="12" text-anchor="middle">Verified Client-Server Sync · Thai Ticket Hub</text>
    </svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function getDeletedOrderRefs() {
    try {
      const raw = localStorage.getItem('thaiticket.deletedOrderRefs.v1');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function getLocalBrowserTickets() {
    try {
      const raw = localStorage.getItem('thaiticket.tickets.v1');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      const deletedSet = new Set(getDeletedOrderRefs().map((r) => String(r).toUpperCase()));
      return Array.isArray(parsed)
        ? parsed.filter((t) => t && t.ref && !deletedSet.has(String(t.ref).toUpperCase()))
        : [];
    } catch {
      return [];
    }
  }

  function removeLocalBrowserTickets(refsToRemove) {
    if (!Array.isArray(refsToRemove) || !refsToRemove.length) return;
    const removeSet = new Set(refsToRemove.map((r) => String(r || '').trim().toUpperCase()).filter(Boolean));
    try {
      const deleted = new Set(getDeletedOrderRefs().map((r) => String(r).toUpperCase()));
      removeSet.forEach((r) => deleted.add(r));
      localStorage.setItem('thaiticket.deletedOrderRefs.v1', JSON.stringify(Array.from(deleted)));
    } catch {
      /* ignore */
    }
    try {
      const raw = localStorage.getItem('thaiticket.tickets.v1');
      if (!raw) return;
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return;
      const filtered = list.filter((t) => !t || !t.ref || !removeSet.has(String(t.ref).toUpperCase()));
      localStorage.setItem('thaiticket.tickets.v1', JSON.stringify(filtered));
    } catch {
      /* ignore */
    }
  }

  function upsertLocalBrowserTicket(updated) {
    if (!updated || !updated.ref) return;
    try {
      const list = getLocalBrowserTickets();
      const idx = list.findIndex((t) => String(t.ref).toUpperCase() === String(updated.ref).toUpperCase());
      const copy = { ...updated };
      if (copy.slipData && copy.slipData.length > 220000) {
        delete copy.slipData;
      }
      if (idx > -1) {
        list[idx] = { ...list[idx], ...copy };
        localStorage.setItem('thaiticket.tickets.v1', JSON.stringify(list));
      }
    } catch {
      /* ignore */
    }
  }

  async function runBulkOrderAction(action) {
    const refs = Array.from(selectedOrderRefs);
    if (!refs.length) {
      window.UI.toast('กรุณาเลือกรายการคำสั่งซื้ออย่างน้อย 1 รายการ', 'error');
      return;
    }
    const approveBtn = $('bulkApproveBtn');
    const checkInBtn = $('bulkCheckInBtn');
    const deleteBtn = $('bulkDeleteBtn');
    if (approveBtn) approveBtn.disabled = true;
    if (checkInBtn) checkInBtn.disabled = true;
    if (deleteBtn) deleteBtn.disabled = true;

    try {
      const res = await fetch('/api/admin/orders/bulk-action', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action,
          refs,
          staffName: 'Gate A (Bulk)',
          tickets: action === 'delete' ? [] : getLocalBrowserTickets()
        })
      });
      const data = await res.json();
      if (data.unauthorized) {
        showLoginModal();
        return;
      }
      if (!data.ok) throw new Error(data.error || 'ดำเนินการแบบกลุ่มไม่สำเร็จ');

      if (action === 'delete') {
        removeLocalBrowserTickets(refs);
      } else if (Array.isArray(data.results)) {
        data.results.forEach((r) => {
          if (r && r.order) upsertLocalBrowserTicket(r.order);
        });
      }

      const actionLabel =
        action === 'approve'
          ? `อนุมัติสลิปและส่งบัตรเข้า LINE OA แบบกลุ่มสำเร็จ ${data.successCount}/${data.totalRequested} รายการ`
          : action === 'delete'
            ? `ลบคำสั่งซื้อที่เลือกสำเร็จ ${data.successCount}/${data.totalRequested} รายการ`
            : `เช็กอินเข้างานแบบกลุ่มสำเร็จ ${data.successCount}/${data.totalRequested} รายการ`;
      window.UI.toast(actionLabel);
      selectedOrderRefs.clear();
      await Promise.all([loadStats(), loadOrders()]);
    } catch (err) {
      window.UI.toast(err.message, 'error');
      updateBulkSelectionUi();
    }
  }

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
    if ($('adminRoleBadge')) $('adminRoleBadge').hidden = true;
    window.UI.open('adminLoginModal');
    setTimeout(() => {
      if ($('adminPinInput')) $('adminPinInput').focus();
    }, 60);
  }

  let currentUserRole = 'admin';

  function applyRolePermissions(role) {
    currentUserRole = role === 'gate_staff' ? 'gate_staff' : 'admin';
    const isStaff = currentUserRole === 'gate_staff';

    const roleBadge = $('adminRoleBadge');
    if (roleBadge) {
      roleBadge.hidden = false;
      roleBadge.className = isStaff ? 'role-pill-badge is-gate-staff' : 'role-pill-badge';
      roleBadge.textContent = isStaff ? '🛡️ สตาฟหน้าประตู (Gate Staff)' : '👑 แอดมินหลัก (Full Admin)';
    }

    document.querySelectorAll('[data-admin-only="true"]').forEach((el) => {
      el.hidden = isStaff;
    });

    if ($('adminMainHeading')) {
      $('adminMainHeading').textContent = isStaff
        ? 'ระบบจุดตรวจบัตรเข้าฮอลล์ & มอนิเตอร์ประตู (Gate Staff Mode)'
        : 'ระบบจัดการคำสั่งซื้อ ตรวจสลิป และเช็กอินหน้างาน';
    }
    if ($('adminMainSubheading')) {
      $('adminMainSubheading').textContent = isStaff
        ? 'โหมดเจ้าหน้าที่หน้าประตู: จำกัดสิทธิ์เฉพาะสแกน QR Code เช็กอิน ตรวจสอบลายเซ็น HMAC-SHA256 และดูมอนิเตอร์ความเร็วคนเข้าฮอลล์ (ซ่อนข้อมูลรายได้และการตั้งค่าบัญชี)'
        : 'ตรวจสอบสลิปโอนเงิน ป้องกันสลิปซ้ำด้วย SHA-256 อนุมัติส่งบัตรเข้า LINE OA และสแกน QR Code เช็กอินเข้างาน';
    }

    if (isStaff) {
      currentFilter = 'approved';
      document.querySelectorAll('.filter-tab').forEach((b) => {
        b.classList.toggle('active', b.dataset.status === 'approved');
      });
    }
  }

  async function checkAdminSession() {
    try {
      const res = await fetch('/api/admin/session', { headers: getAuthHeaders() });
      const data = await res.json();
      if (data && data.authenticated) {
        if ($('adminLogoutBtn')) $('adminLogoutBtn').hidden = false;
        applyRolePermissions(data.role || 'admin');
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
      errEl.textContent = 'กรุณากรอกรหัส PIN แอดมินหรือเจ้าหน้าที่หน้าประตู';
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
      applyRolePermissions(data.role || 'admin');
      window.UI.close('adminLoginModal');
      window.UI.toast(
        data.role === 'gate_staff'
          ? '🛡️ เข้าสู่ระบบในโหมดเจ้าหน้าที่จุดตรวจบัตรหน้างาน (Gate Staff)'
          : '👑 เข้าสู่ระบบแอดมินหลักสำเร็จ'
      );
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

  function mergeOrdersWithLocalBrowser(serverOrders, filterStatus) {
    const deletedSet = new Set(getDeletedOrderRefs().map((r) => String(r).toUpperCase()));
    const map = new Map();
    if (Array.isArray(serverOrders)) {
      serverOrders.forEach((o) => {
        if (o && o.ref && !deletedSet.has(String(o.ref).toUpperCase())) {
          map.set(String(o.ref).toUpperCase(), o);
        }
      });
    }
    const localList = getLocalBrowserTickets();
    localList.forEach((t) => {
      if (!t || !t.ref) return;
      const key = String(t.ref).toUpperCase();
      if (deletedSet.has(key)) return;
      if (!map.has(key)) {
        const status = ['pending', 'approved', 'rejected'].includes(t.status) ? t.status : 'pending';
        map.set(key, {
          ...t,
          ref: key,
          title: t.title || 'ECHOES OF ASIA WORLD TOUR 2026',
          date: t.date || '14 - 15 พ.ย. 2026',
          venue: t.venue || 'อิมแพ็ค อารีน่า เมืองทองธานี',
          zone: t.zone || 'VIP Standing',
          qty: Number(t.qty || 1),
          total: Number(t.total || 0),
          holderName: t.holderName || 'ลูกค้าผู้จองบัตร',
          holderPhone: t.holderPhone || '-',
          holderIdCard: t.holderIdCard || '',
          lineUserId: t.lineUserId || '',
          status,
          issuedAt: Number(t.issuedAt || Date.now()),
          slipData: t.slipData || buildClientFallbackSlipSvg(t),
          slipHash: t.slipHash || key.toLowerCase()
        });
      } else {
        // Keep localStorage synced with latest server order status
        upsertLocalBrowserTicket(map.get(key));
      }
    });
    let merged = Array.from(map.values()).sort((a, b) => Number(b.issuedAt || 0) - Number(a.issuedAt || 0));
    if (filterStatus && filterStatus !== 'all') {
      merged = merged.filter((o) => o.status === filterStatus);
    }
    return merged;
  }

  function applyStatsToDom(stats) {
    if (!stats) return;
    const localAll = mergeOrdersWithLocalBrowser([], 'all');
    if ((stats.totalOrders || 0) === 0 && localAll.length > 0) {
      let pendingCount = 0;
      let approvedCount = 0;
      let rejectedCount = 0;
      let approvedTickets = 0;
      let approvedRevenue = 0;
      let checkedInTickets = 0;
      const byZone = {};
      localAll.forEach((r) => {
        if (r.status === 'pending') pendingCount++;
        else if (r.status === 'rejected') rejectedCount++;
        else if (r.status === 'approved') {
          approvedCount++;
          approvedRevenue += Number(r.total || 0);
          approvedTickets += Number(r.qty || 1);
          if (r.checkedInAt > 0) checkedInTickets += Number(r.qty || 1);
          if (!byZone[r.zone]) byZone[r.zone] = { zone: r.zone, tickets: 0, orders: 0, revenue: 0 };
          byZone[r.zone].tickets += Number(r.qty || 1);
          byZone[r.zone].orders += 1;
          byZone[r.zone].revenue += Number(r.total || 0);
        }
      });
      stats = {
        ...stats,
        totalOrders: localAll.length,
        pendingCount,
        approvedCount,
        rejectedCount,
        approvedTickets,
        approvedRevenue,
        checkedInTickets,
        byZone: Object.values(byZone).sort((a, b) => b.revenue - a.revenue)
      };
    }

    const isStaff = currentUserRole === 'gate_staff' || stats.revenueHidden;
    $('kpiPending').textContent = (stats.pendingCount || 0).toLocaleString('th-TH');
    $('kpiApprovedTickets').textContent = (stats.approvedTickets || 0).toLocaleString('th-TH') + ' ใบ';
    if ($('kpiCheckedInTickets')) {
      $('kpiCheckedInTickets').textContent = (stats.checkedInTickets || 0).toLocaleString('th-TH') + ' ใบ';
    }
    $('kpiRevenue').textContent = isStaff
      ? '🔒 จำกัดสิทธิ์'
      : (stats.approvedRevenue || 0).toLocaleString('th-TH') + ' THB';
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
            <div style="font-weight:700;color:var(--color-accent);">${isStaff ? `${z.tickets} ที่นั่ง` : `${z.revenue.toLocaleString('th-TH')} THB`}</div>
          </div>`
        )
        .join('');
    }
  }

  async function loadStats() {
    try {
      await syncLocalClientTickets();
      const res = await fetch('/api/admin/stats', { headers: getAuthHeaders() });
      if (!res.ok) return;
      const stats = await res.json();
      if (stats.unauthorized) {
        showLoginModal();
        return;
      }
      applyStatsToDom(stats);
    } catch {
      /* ignore */
    }
  }

  async function syncLocalClientTickets() {
    try {
      const parsed = getLocalBrowserTickets();
      if (!parsed.length) return null;
      const res = await fetch('/api/orders/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tickets: parsed,
          status: currentFilter,
          includeSlip: true
        })
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  async function loadOrders() {
    const container = $('adminOrdersList');
    try {
      const recovered = await syncLocalClientTickets();
      const res = await fetch(`/api/orders?status=${encodeURIComponent(currentFilter)}`, {
        headers: getAuthHeaders()
      });
      if (!res.ok) throw new Error('โหลดข้อมูลไม่สำเร็จ');
      const data = await res.json();
      if (data.unauthorized) {
        showLoginModal();
        return;
      }
      const baseOrders =
        Array.isArray(data.orders) && data.orders.length
          ? data.orders
          : recovered && Array.isArray(recovered.orders)
            ? recovered.orders
            : [];
      ordersCache = mergeOrdersWithLocalBrowser(baseOrders, currentFilter);
      if (recovered && recovered.stats) {
        applyStatsToDom(recovered.stats);
      }
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
      updateBulkSelectionUi();
      return;
    }

    const esc = window.UI.escapeHtml;
    const isStaff = currentUserRole === 'gate_staff';
    container.innerHTML = ordersCache
      .map((o) => {
        const issuedStr = new Date(o.issuedAt).toLocaleString('th-TH');
        const shortHash = (o.slipHash || '').slice(0, 14);
        const isChecked = selectedOrderRefs.has(o.ref);
        return `
        <article class="order-card" data-order-ref="${esc(o.ref)}">
          ${
            isStaff
              ? ''
              : `<div class="order-slip-thumb" data-action="zoom-slip" data-ref="${esc(o.ref)}" title="คลิกเพื่อดูรูปสลิปขนาดใหญ่">
                  <img src="${esc(o.slipData)}" alt="สลิป ${esc(o.ref)}">
                  <span class="order-slip-zoom-tag">ขยายดูสลิป</span>
                </div>`
          }

          <div class="order-info">
            <div class="order-top-row">
              <input type="checkbox" class="order-select-checkbox" data-select-ref="${esc(o.ref)}" aria-label="เลือกรายการ ${esc(o.ref)}" ${isChecked ? 'checked' : ''}>
              <span class="order-ref">${esc(o.ref)}</span>
              ${statusBadge(o.status)}
              ${lineStatusBadge(o)}
              ${checkInBadge(o)}
              ${o.qrSignature ? `<span class="badge-hmac" title="ลายเซ็นดิจิทัล HMAC-SHA256 ป้องกันการปลอมแปลง QR">🔐 SIG:${esc(o.qrSignature)}</span>` : ''}
              ${!isStaff && o.driveViewLink ? `<a href="${esc(o.driveViewLink)}" target="_blank" rel="noopener" class="badge-drive" style="display:inline-flex; align-items:center; gap:4px; font-size:11px; padding:2px 8px; border-radius:4px; background:rgba(34, 155, 255, 0.15); color:var(--color-accent); text-decoration:none; border:1px solid rgba(34,155,255,0.3);">📁 Google Drive ↗</a>` : ''}
              ${o.verifiedBy ? `<span class="badge-verify" style="display:inline-flex; align-items:center; gap:4px; font-size:11px; padding:2px 8px; border-radius:4px; background:rgba(104, 211, 145, 0.15); color:#68D391; border:1px solid rgba(104, 211, 145, 0.3);">✔ ${esc(o.verifiedBy)}</span>` : ''}
              <span class="text-muted" style="font-size:12px;">สั่งซื้อเมื่อ ${esc(issuedStr)}</span>
            </div>

            <div class="order-title">${esc(o.title)}</div>

            <div class="order-meta-grid">
              <div class="order-meta-item">
                <small>ผู้ถือบัตร</small>
                <strong>${esc(o.holderName)} (${esc(o.holderPhone)})</strong>
              </div>
              <div class="order-meta-item">
                <small>เลขบัตร ปชช. / Passport</small>
                <strong style="color:var(--color-accent);">${esc(o.holderIdCard || '-')}</strong>
              </div>
              <div class="order-meta-item">
                <small>โซน / จำนวน</small>
                <strong>${esc(o.zone)} · ${o.qty} ใบ</strong>
              </div>
              <div class="order-meta-item">
                <small>ยอดโอนตามรายการ</small>
                <strong style="color:var(--color-accent);">${isStaff ? '🔒 จำกัดสิทธิ์แอดมิน' : `${Number(o.total).toLocaleString('th-TH')} THB`}</strong>
              </div>
              <div class="order-meta-item">
                <small>LINE User ID</small>
                <strong>${esc(o.lineUserId || '(ไม่ได้ระบุ)')}</strong>
              </div>
            </div>

            <div class="order-hash">
              ✔ ตรวจสลิปซ้ำผ่าน (SHA-256: ${esc(shortHash)}…)
              ${o.verificationDetail ? ` · <span style="color:#68D391;">${esc(o.verificationDetail)}</span>` : ''}
              ${!isStaff && o.driveViewLink ? ` · <a href="${esc(o.driveViewLink)}" target="_blank" rel="noopener" style="color:var(--color-accent);">เปิดดูรูปใน Google Drive ↗</a>` : ''}
              ${o.checkedInAt ? ` · <span style="color:var(--color-accent);">เข้างานเมื่อ ${esc(new Date(o.checkedInAt).toLocaleString('th-TH'))} (${esc(o.checkedInBy || 'Gate A')})</span>` : ''}
              ${o.status === 'rejected' && o.rejectReason ? ` · <span style="color:#FF6B6B;">เหตุผลที่ปฏิเสธ: ${esc(o.rejectReason)}</span>` : ''}
            </div>
          </div>

          <div class="order-actions">
            ${
              isStaff
                ? o.status === 'approved'
                  ? `<button class="btn-primary" data-action="scan-ticket" data-ref="${esc(o.ref)}">${o.checkedInAt ? 'ตรวจสถานะเข้างาน' : 'สแกนเช็กอินเข้างาน'}</button>`
                  : `<span class="text-muted" style="font-size:12px;">รอแอดมินอนุมัติสลิป</span>`
                : o.status === 'pending'
                  ? `
                <button class="btn-primary" data-action="approve" data-ref="${esc(o.ref)}">อนุมัติ & ส่งบัตร LINE</button>
                <button class="btn-outline" data-action="reject" data-ref="${esc(o.ref)}">ปฏิเสธสลิป</button>
                <button class="btn-outline" data-action="delete" data-ref="${esc(o.ref)}" style="border-color:rgba(255,107,107,0.45); color:#FF6B6B;">🗑️ ลบรายการ</button>
              `
                  : o.status === 'approved'
                    ? `
                <button class="btn-primary" data-action="scan-ticket" data-ref="${esc(o.ref)}">${o.checkedInAt ? 'ตรวจสถานะเข้างาน' : 'สแกนเช็กอินเข้างาน'}</button>
                <button class="btn-default" data-action="preview-line" data-ref="${esc(o.ref)}">ดูข้อความ LINE OA</button>
                <button class="btn-outline" data-action="resend-line" data-ref="${esc(o.ref)}">ส่งเข้า LINE ซ้ำ</button>
                <button class="btn-outline" data-action="delete" data-ref="${esc(o.ref)}" style="border-color:rgba(255,107,107,0.45); color:#FF6B6B;">🗑️ ลบรายการ</button>
              `
                    : `
                <button class="btn-primary" data-action="approve" data-ref="${esc(o.ref)}">อนุมัติใหม่อีกครั้ง</button>
                <button class="btn-outline" data-action="delete" data-ref="${esc(o.ref)}" style="border-color:rgba(255,107,107,0.45); color:#FF6B6B;">🗑️ ลบรายการ</button>
              `
            }
          </div>
        </article>`;
      })
      .join('');

    updateBulkSelectionUi();
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
        <button type="button" class="quick-scan-chip" data-scan-ref="${esc(o.ref)}" data-scan-payload="${esc(o.qrPayload || `THAITICKET|${o.ref}`)}">
          ${esc(o.ref)} · ${esc(o.holderName)} ${o.checkedInAt ? '(เข้างานแล้ว)' : ''}
        </button>`
      )
      .join('');
  }

  // Camera Barcode/QR Scanner Engine with Multi-Camera Selector
  let activeCameraStream = null;
  let availableCameraDevices = [];
  let currentCameraDeviceIndex = 0;
  let isCameraScanningActive = false;
  let qrScannerFrameLoop = null;
  let lastCameraScanCode = '';
  let lastCameraScanTimestamp = 0;

  async function initCameraDevicesList() {
    const select = $('cameraDeviceSelect');
    if (!select) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      select.innerHTML = '<option value="">เบราว์เซอร์ไม่รองรับ MediaDevices API</option>';
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      availableCameraDevices = devices.filter((d) => d.kind === 'videoinput');
      if (!availableCameraDevices.length) {
        select.innerHTML = '<option value="">ไม่พบอุปกรณ์กล้องที่เชื่อมต่อ</option>';
        return;
      }
      select.innerHTML = availableCameraDevices
        .map((dev, idx) => {
          let label = dev.label || `กล้อง #${idx + 1}`;
          if (/back|rear|environment/i.test(label)) label = `📷 ${label} (กล้องหลัง)`;
          else if (/front|user|facetime/i.test(label)) label = `🤳 ${label} (กล้องหน้า)`;
          else label = `🎥 ${label}`;
          return `<option value="${dev.deviceId}">${label}</option>`;
        })
        .join('');
    } catch {
      select.innerHTML = '<option value="">กรุณาอนุญาตการเข้าถึงกล้อง</option>';
    }
  }

  async function startCameraScanner(targetDeviceId) {
    stopCameraScanner();
    const video = $('scannerVideo');
    const placeholder = $('cameraOffPlaceholder');
    const hint = $('scannerStatusHint');
    const btnToggle = $('btnToggleCameraFeed');
    if (!video || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

    if (placeholder) placeholder.hidden = true;
    if (btnToggle) btnToggle.textContent = '⏹️ ปิดกล้อง';
    if (hint) hint.textContent = 'กำลังเชื่อมต่อกล้อง...';

    try {
      const constraints = {
        video: targetDeviceId
          ? { deviceId: { exact: targetDeviceId } }
          : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      activeCameraStream = stream;
      video.srcObject = stream;
      await video.play().catch(() => {});

      // Refresh devices list once permission is granted (to get actual labels)
      await initCameraDevicesList();
      const currentTrack = stream.getVideoTracks()[0];
      if (currentTrack) {
        const settings = currentTrack.getSettings ? currentTrack.getSettings() : {};
        if (settings.deviceId && $('cameraDeviceSelect')) {
          $('cameraDeviceSelect').value = settings.deviceId;
          const idx = availableCameraDevices.findIndex((d) => d.deviceId === settings.deviceId);
          if (idx >= 0) currentCameraDeviceIndex = idx;
        }
      }

      isCameraScanningActive = true;
      if (hint) hint.textContent = 'ส่อง QR Code บนบัตรเข้างานให้อยู่ในกรอบ';
      startQrFrameDetection();
    } catch (err) {
      if (placeholder) {
        placeholder.hidden = false;
        placeholder.innerHTML = `<span>⚠️ ไม่สามารถเปิดกล้องได้: ${window.UI.escapeHtml(err.message)}<br><small style="color:var(--color-muted);">สามารถพิมพ์รหัสเพื่อเช็กอินได้ตามปกติ</small></span>`;
      }
      if (btnToggle) btnToggle.textContent = '▶️ เปิดกล้อง';
      if (hint) hint.textContent = 'กล้องไม่พร้อมใช้งาน';
    }
  }

  // 1. Flashlight / Torch Controller
  let torchActive = false;

  async function toggleTorch() {
    const btn = $('btnToggleTorch');
    if (!activeCameraStream) {
      window.UI.toast('กรุณาเปิดกล้องก่อนใช้งานไฟฉาย', 'info');
      return;
    }
    const track = activeCameraStream.getVideoTracks()[0];
    if (!track) return;
    const capabilities = track.getCapabilities ? track.getCapabilities() : {};
    if (!capabilities.torch) {
      window.UI.toast('กล้องหรือเบราว์เซอร์ของอุปกรณ์นี้ไม่รองรับการควบคุมไฟฉาย', 'info');
      return;
    }
    try {
      torchActive = !torchActive;
      await track.applyConstraints({ advanced: [{ torch: torchActive }] });
      if (btn) {
        btn.textContent = torchActive ? '🔦 ไฟฉาย: เปิด' : '🔦 ไฟฉาย: ปิด';
        btn.style.color = torchActive ? '#F5A623' : '';
        btn.style.borderColor = torchActive ? '#F5A623' : '';
      }
      window.UI.toast(torchActive ? 'เปิดไฟฉายแล้ว' : 'ปิดไฟฉายแล้ว');
    } catch (err) {
      window.UI.toast(`ไม่สามารถปรับไฟฉายได้: ${err.message}`, 'error');
    }
  }

  function stopCameraScanner() {
    isCameraScanningActive = false;
    torchActive = false;
    const btnTorch = $('btnToggleTorch');
    if (btnTorch) {
      btnTorch.textContent = '🔦 ไฟฉาย: ปิด';
      btnTorch.style.color = '';
      btnTorch.style.borderColor = '';
    }
    if (qrScannerFrameLoop) {
      cancelAnimationFrame(qrScannerFrameLoop);
      qrScannerFrameLoop = null;
    }
    if (activeCameraStream) {
      activeCameraStream.getTracks().forEach((t) => t.stop());
      activeCameraStream = null;
    }
    const video = $('scannerVideo');
    if (video) {
      video.srcObject = null;
    }
    const placeholder = $('cameraOffPlaceholder');
    const btnToggle = $('btnToggleCameraFeed');
    if (placeholder) placeholder.hidden = false;
    if (btnToggle) btnToggle.textContent = '▶️ เปิดกล้อง';
  }

  function toggleCameraFeed() {
    if (activeCameraStream && isCameraScanningActive) {
      stopCameraScanner();
      window.UI.toast('ปิดการใช้งานกล้องแล้ว');
    } else {
      const select = $('cameraDeviceSelect');
      const devId = select ? select.value : '';
      startCameraScanner(devId);
      window.UI.toast('เปิดกล้องสแกนบัตรแล้ว');
    }
  }

  async function switchCameraDevice() {
    if (!availableCameraDevices.length) {
      await initCameraDevicesList();
    }
    if (availableCameraDevices.length < 2) {
      window.UI.toast('มีกล้องเชื่อมต่อเพียงตัวเดียว', 'info');
      return;
    }
    currentCameraDeviceIndex = (currentCameraDeviceIndex + 1) % availableCameraDevices.length;
    const nextDevice = availableCameraDevices[currentCameraDeviceIndex];
    if (nextDevice && $('cameraDeviceSelect')) {
      $('cameraDeviceSelect').value = nextDevice.deviceId;
      await startCameraScanner(nextDevice.deviceId);
      window.UI.toast(`สลับไปยัง ${nextDevice.label || 'กล้องตัวถัดไป'}`);
    }
  }

  // 2. Thai Voice Feedback & Web Audio Sound Packs
  let gateVoiceEnabled = true;

  function toggleGateVoice() {
    gateVoiceEnabled = !gateVoiceEnabled;
    const btn = $('btnToggleGateVoice');
    if (btn) {
      btn.textContent = gateVoiceEnabled ? '🔊 เสียงพูด: เปิด' : '🔇 เสียงพูด: ปิด';
      btn.style.color = gateVoiceEnabled ? '#68D391' : 'var(--color-muted)';
    }
    window.UI.toast(gateVoiceEnabled ? 'เปิดเสียงพูดสังเคราะห์แจ้งผลภาษาไทยแล้ว' : 'ปิดเสียงพูดแล้ว');
  }

  function speakGateResult(text) {
    if (!gateVoiceEnabled || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'th-TH';
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      const voices = window.speechSynthesis.getVoices();
      const thaiVoice = voices.find((v) => v.lang === 'th-TH' || (v.lang && v.lang.startsWith('th')));
      if (thaiVoice) utterance.voice = thaiVoice;
      window.speechSynthesis.speak(utterance);
    } catch {}
  }

  let sharedAudioCtx = null;
  function getAudioContext() {
    try {
      if (!sharedAudioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) sharedAudioCtx = new AudioCtx();
      }
      if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
        sharedAudioCtx.resume();
      }
    } catch {}
    return sharedAudioCtx;
  }

  // Pre-unlock audio on user interaction
  ['click', 'touchstart', 'touchend'].forEach((ev) => {
    document.addEventListener(ev, () => getAudioContext(), { passive: true });
  });

  function triggerHapticFeedback(type) {
    if (!('vibrate' in navigator)) return;
    try {
      if (type === 'pass') {
        navigator.vibrate([160, 60, 200]);
      } else if (type === 'duplicate') {
        navigator.vibrate([300, 100, 300, 100, 300]);
      } else {
        navigator.vibrate([250, 80, 250]);
      }
    } catch {}
  }

  function playGateSound(type) {
    triggerHapticFeedback(type);
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      if (type === 'pass') {
        const playTone = (freq, start, dur) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + start);
          gain.gain.setValueAtTime(0.4, now + start);
          gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + start);
          osc.stop(now + start + dur);
        };
        // Loud, crisp celebratory two-tone chime (F#5 -> B5)
        playTone(739.99, 0, 0.18);
        playTone(987.77, 0.12, 0.45);
      } else if (type === 'duplicate') {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        osc1.type = 'sawtooth';
        osc2.type = 'sawtooth';
        osc1.frequency.setValueAtTime(160, now);
        osc2.frequency.setValueAtTime(175, now);
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.38);
        osc2.stop(now + 0.38);
      } else if (type === 'invalid') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.linearRampToValueAtTime(1050, now + 0.15);
        osc.frequency.linearRampToValueAtTime(800, now + 0.3);
        osc.frequency.linearRampToValueAtTime(1050, now + 0.45);
        gain.gain.setValueAtTime(0.38, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.5);
      }
    } catch {}
  }

  // 3. Offline Gate Check-in Engine (Cache, Local Validation & Outbox Sync)
  let offlineRosterCache = [];
  let offlineCheckinQueue = [];

  function loadOfflineStorage() {
    try {
      const rawRoster = localStorage.getItem('tt_offline_roster');
      offlineRosterCache = rawRoster ? JSON.parse(rawRoster) : [];
      const rawQueue = localStorage.getItem('tt_offline_queue');
      offlineCheckinQueue = rawQueue ? JSON.parse(rawQueue) : [];
    } catch {
      offlineRosterCache = [];
      offlineCheckinQueue = [];
    }
    updateOfflineUi();
  }

  function saveOfflineStorage() {
    try {
      localStorage.setItem('tt_offline_roster', JSON.stringify(offlineRosterCache));
      localStorage.setItem('tt_offline_queue', JSON.stringify(offlineCheckinQueue));
    } catch {}
    updateOfflineUi();
  }

  function updateOfflineUi() {
    const isOnline = navigator.onLine !== false;
    const badge = $('gateOnlineBadge');
    if (badge) {
      badge.className = isOnline ? 'badge-status-online' : 'badge-status-offline';
      badge.textContent = isOnline ? '🟢 ออนไลน์ (Real-time)' : '📡 โหมดออฟไลน์ (Offline Mode)';
    }
    const countEl = $('gateOfflineRosterCount');
    if (countEl) {
      countEl.textContent = `แคชตรวจบัตรในเครื่อง: ${offlineRosterCache.length} รายการ`;
    }
    const syncBtn = $('btnSyncOfflineQueue');
    const syncCount = $('syncQueueCount');
    if (syncBtn && syncCount) {
      syncCount.textContent = String(offlineCheckinQueue.length);
      syncBtn.hidden = offlineCheckinQueue.length === 0;
    }
  }

  async function downloadOfflineRoster() {
    const btn = $('btnDownloadOfflineRoster');
    if (btn) btn.disabled = true;
    try {
      window.UI.toast('กำลังดาวน์โหลดข้อมูลบัตรเพื่อเตรียมสแกนออฟไลน์...');
      const res = await fetch('/api/checkin/offline-roster', { headers: getAuthHeaders() });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'ดาวน์โหลดไม่สำเร็จ');
      offlineRosterCache = data.roster || [];
      saveOfflineStorage();
      window.UI.toast(`บันทึกแคชบัตรสำหรับสแกนออฟไลน์แล้ว (${offlineRosterCache.length} รายการ)`);
    } catch (err) {
      window.UI.toast(`เกิดข้อผิดพลาดในการโหลดแคช: ${err.message}`, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function syncOfflineQueue() {
    if (!offlineCheckinQueue.length) {
      window.UI.toast('ไม่มีรายการเช็กอินค้างในคิวออฟไลน์');
      return;
    }
    if (navigator.onLine === false) {
      window.UI.toast('ยังไม่มีการเชื่อมต่ออินเทอร์เน็ต กรุณารอต่อเน็ตก่อนซิงก์', 'error');
      return;
    }
    const btn = $('btnSyncOfflineQueue');
    if (btn) btn.disabled = true;
    try {
      window.UI.toast(`กำลังซิงก์รายการเช็กอินออฟไลน์ ${offlineCheckinQueue.length} รายการขึ้นเซิร์ฟเวอร์...`);
      const res = await fetch('/api/checkin/sync', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ checkins: offlineCheckinQueue })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'ซิงก์ไม่สำเร็จ');
      const synced = data.syncedCount || 0;
      offlineCheckinQueue = [];
      saveOfflineStorage();
      window.UI.toast(`ซิงก์ข้อมูลขึ้นเซิร์ฟเวอร์สำเร็จเรียบร้อย (${synced} รายการ)`);
      await Promise.all([loadStats(), loadOrders()]);
    } catch (err) {
      window.UI.toast(`ซิงก์ไม่สำเร็จ: ${err.message}`, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function verifyCheckInOffline(rawCode, staffName) {
    const trimmed = String(rawCode || '').trim();
    const parts = trimmed.split('|');
    let ref = '';
    if (parts.length >= 2 && parts[0] === 'THAITICKET') {
      ref = parts[1].trim().toUpperCase();
    } else {
      const m = trimmed.match(/[A-Z0-9]{4,8}-[A-Z0-9]{3,6}/i);
      ref = m ? m[0].toUpperCase() : trimmed.toUpperCase();
    }

    const existing = offlineRosterCache.find((o) => o.ref === ref);
    if (!existing) {
      playGateSound('invalid');
      speakGateResult('ไม่พบบัตรนี้ในแคชออฟไลน์ค่ะ');
      return {
        ok: false,
        code: 'NOT_FOUND_OFFLINE',
        message: `ไม่พบรหัสบัตร "${ref}" ในแคชออฟไลน์ (กรุณากดอัปเดตแคชออฟไลน์เมื่อมีเน็ต)`
      };
    }

    // Verify HMAC-SHA256 signature if present
    const sigPart = parts.find((p) => String(p).toUpperCase().startsWith('SIG:'));
    if (sigPart && existing.qrSignature) {
      const providedSig = String(sigPart).slice(4).trim().toUpperCase();
      if (providedSig !== existing.qrSignature.toUpperCase()) {
        playGateSound('invalid');
        speakGateResult('ตรวจพบบัตรปลอมแปลง ลายเซ็นไม่ถูกต้องค่ะ');
        return {
          ok: false,
          code: 'INVALID_SIGNATURE',
          message: `เตือนภัยความมั่นคง! ตรวจพบลายเซ็นดิจิทัล (HMAC-SHA256) ไม่ตรงกับต้นฉบับของบัตร ${existing.ref}`,
          order: existing
        };
      }
    }

    // Check duplicate in offline cache or queue
    const inQueue = offlineCheckinQueue.find((q) => q.ref === existing.ref);
    if (existing.checkedInAt > 0 || inQueue) {
      playGateSound('duplicate');
      speakGateResult('เตือนภัยค่ะ บัตรนี้ถูกสแกนเข้างานไปแล้ว');
      const timeStr = new Date(existing.checkedInAt || (inQueue && inQueue.timestamp) || Date.now()).toLocaleString('th-TH');
      return {
        ok: false,
        code: 'ALREADY_CHECKED_IN',
        message: `เตือนภัย! บัตร ${existing.ref} ถูกสแกนเข้างานไปแล้วเมื่อ ${timeStr}`,
        order: existing
      };
    }

    // Mark as checked-in locally & queue for sync
    existing.checkedInAt = Date.now();
    existing.checkedInBy = staffName;
    offlineCheckinQueue.push({
      code: rawCode,
      ref: existing.ref,
      staffName,
      timestamp: Date.now()
    });
    saveOfflineStorage();

    playGateSound('pass');
    speakGateResult(`ผ่านค่ะ โซน ${existing.zone} จำนวน ${existing.qty} ใบ`);

    return {
      ok: true,
      code: 'CHECKED_IN_OFFLINE',
      message: `เช็กอินสำเร็จ (โหมดออฟไลน์) — บันทึกลงเครื่องและรอซิงก์ (${existing.ref})`,
      order: existing
    };
  }

  let offscreenScanCanvas = null;
  let offscreenScanCtx = null;

  function startQrFrameDetection() {
    if (!isCameraScanningActive) return;
    const video = $('scannerVideo');
    if (!video || video.readyState < 2) {
      qrScannerFrameLoop = requestAnimationFrame(startQrFrameDetection);
      return;
    }

    // 1. Native BarcodeDetector (Chrome / Edge / Android)
    if ('BarcodeDetector' in window) {
      try {
        const detector = new window.BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39'] });
        detector
          .detect(video)
          .then((barcodes) => {
            if (barcodes && barcodes.length > 0) {
              const raw = barcodes[0].rawValue;
              handleDetectedQrCode(raw);
            }
          })
          .catch(() => {})
          .finally(() => {
            if (isCameraScanningActive) {
              qrScannerFrameLoop = requestAnimationFrame(startQrFrameDetection);
            }
          });
        return;
      } catch {}
    }

    // 2. Cross-platform jsQR canvas fallback (iOS Safari iPhone & iPad)
    if (window.jsQR && video.videoWidth > 0 && video.videoHeight > 0) {
      try {
        if (!offscreenScanCanvas) {
          offscreenScanCanvas = document.createElement('canvas');
          offscreenScanCtx = offscreenScanCanvas.getContext('2d', { willReadFrequently: true });
        }
        const w = Math.min(640, video.videoWidth);
        const h = Math.round((w / video.videoWidth) * video.videoHeight);
        if (offscreenScanCanvas.width !== w || offscreenScanCanvas.height !== h) {
          offscreenScanCanvas.width = w;
          offscreenScanCanvas.height = h;
        }
        offscreenScanCtx.drawImage(video, 0, 0, w, h);
        const imgData = offscreenScanCtx.getImageData(0, 0, w, h);
        const qrCode = window.jsQR(imgData.data, imgData.width, imgData.height, {
          inversionAttempts: 'dontInvert'
        });
        if (qrCode && qrCode.data) {
          handleDetectedQrCode(qrCode.data);
        }
      } catch {}
    }

    if (isCameraScanningActive) {
      qrScannerFrameLoop = requestAnimationFrame(startQrFrameDetection);
    }
  }

  function handleDetectedQrCode(code) {
    if (!code) return;
    const trimmed = String(code).trim();
    const now = Date.now();
    if (trimmed === lastCameraScanCode && now - lastCameraScanTimestamp < 2500) {
      return;
    }
    lastCameraScanCode = trimmed;
    lastCameraScanTimestamp = now;

    const aimBox = document.querySelector('.scanner-aim-box');
    if (aimBox) {
      aimBox.style.boxShadow = '0 0 0 9999px rgba(0, 0, 0, 0.45), 0 0 24px #68D391';
      setTimeout(() => {
        aimBox.style.boxShadow = '';
      }, 900);
    }

    if ($('scanCodeInput')) {
      $('scanCodeInput').value = trimmed;
    }
    submitCheckIn();
  }

  let hudCountdownTimer = null;

  function dismissScannerHudAlert() {
    if (hudCountdownTimer) {
      clearInterval(hudCountdownTimer);
      hudCountdownTimer = null;
    }
    const hud = $('scannerHudAlert');
    if (hud) hud.hidden = true;
    lastCameraScanCode = '';
  }

  function showScannerHudAlert(data) {
    const hud = $('scannerHudAlert');
    const card = $('hudAlertCard');
    if (!hud || !card) return;

    if (hudCountdownTimer) {
      clearInterval(hudCountdownTimer);
      hudCountdownTimer = null;
    }

    const esc = window.UI.escapeHtml;
    const isPass = data.ok && (data.code === 'CHECKED_IN' || data.code === 'CHECKED_IN_OFFLINE');
    const isDup = data.code === 'ALREADY_CHECKED_IN';
    const isOffline = data.code === 'CHECKED_IN_OFFLINE';
    const o = data.order || {};

    card.className = 'hud-alert-card ' + (isPass ? 'is-pass' : (isDup ? 'is-duplicate' : 'is-invalid'));

    if ($('hudIcon')) $('hudIcon').textContent = isPass ? '✅' : (isDup ? '⛔' : '⚠️');
    if ($('hudTitle')) {
      $('hudTitle').textContent = isPass
        ? `เช็กอินสำเร็จ — ผ่านเข้างาน ${isOffline ? '(โหมดออฟไลน์)' : ''}`
        : (isDup ? 'เตือนภัย! บัตรนี้ถูกสแกนเข้างานไปแล้ว' : (data.message || data.error || 'ปฏิเสธการเข้างาน'));
    }

    if ($('hudName')) {
      $('hudName').textContent = o.holderName ? `${o.holderName} (${o.holderPhone || '-'})` : `รหัสบัตร: ${o.ref || data.ref || '-'}`;
    }
    if ($('hudMeta')) {
      $('hudMeta').textContent = o.zone ? `โซน ${o.zone} · ${o.qty || 1} ใบ · ประตู ${esc(o.checkedInBy || 'Gate A')}` : (o.title || '');
    }
    if ($('hudSig')) {
      $('hudSig').textContent = `🔐 ลายเซ็นดิจิทัล: SIG:${esc(o.qrSignature || data.qrSignature || 'VERIFIED')} (ยืนยันบัตรแท้)`;
    }

    hud.hidden = false;

    // Laser & Aim Box flash
    const laser = document.querySelector('.scanner-laser');
    if (laser) {
      laser.style.background = isPass ? '#68D391' : '#FF6B6B';
      laser.style.boxShadow = isPass ? '0 0 16px #68D391' : '0 0 16px #FF6B6B';
      setTimeout(() => {
        laser.style.background = '';
        laser.style.boxShadow = '';
      }, 1000);
    }

    let remainSec = isPass ? 2.5 : 4.0;
    const countdownEl = $('hudCountdown');
    if (countdownEl) countdownEl.textContent = `พร้อมสแกนคนถัดไปใน ${remainSec.toFixed(1)}s`;

    hudCountdownTimer = setInterval(() => {
      remainSec -= 0.5;
      if (countdownEl) {
        countdownEl.textContent = `พร้อมสแกนคนถัดไปใน ${Math.max(0, remainSec).toFixed(1)}s`;
      }
      if (remainSec <= 0) {
        dismissScannerHudAlert();
      }
    }, 500);

    const btnNext = $('hudNextBtn');
    if (btnNext) {
      btnNext.onclick = () => dismissScannerHudAlert();
    }
  }

  function openScannerModal(prefillRef) {
    renderQuickScanChips();
    loadOfflineStorage();
    dismissScannerHudAlert();
    if (prefillRef && $('scanCodeInput')) {
      const targetOrder = ordersCache.find((o) => o.ref === prefillRef);
      $('scanCodeInput').value = (targetOrder && targetOrder.qrPayload) ? targetOrder.qrPayload : `THAITICKET|${prefillRef}`;
    }
    window.UI.open('gateScannerModal');
    if (prefillRef) {
      submitCheckIn();
    } else {
      if ($('scanCodeInput')) $('scanCodeInput').focus();
      initCameraDevicesList().then(() => {
        startCameraScanner();
      });
    }
  }

  function closeScannerModal() {
    dismissScannerHudAlert();
    stopCameraScanner();
    window.UI.close('gateScannerModal');
  }

  function testTamperedQrScan() {
    const sampleOrder = ordersCache.find((o) => o.status === 'approved') || ordersCache[0];
    const sampleRef = sampleOrder ? sampleOrder.ref : 'TT1001';
    if ($('scanCodeInput')) {
      $('scanCodeInput').value = `THAITICKET|${sampleRef}|VIP Standing|99|SIG:FAKE00000000`;
    }
    submitCheckIn();
  }

  function renderScanResultBox(data) {
    showScannerHudAlert(data);
    const resultBox = $('scanResultBox');
    if (!resultBox) return;
    const esc = window.UI.escapeHtml;
    resultBox.hidden = false;

    if (data.ok && (data.code === 'CHECKED_IN' || data.code === 'CHECKED_IN_OFFLINE')) {
      const o = data.order;
      const isOffline = data.code === 'CHECKED_IN_OFFLINE';
      resultBox.className = 'scan-result-box is-pass';
      resultBox.innerHTML = `
        <div style="font-size:16px; font-weight:700; color:var(--color-accent); margin-bottom:6px;">
          ✅ เช็กอินสำเร็จ — อนุญาตให้เข้างาน (${esc(o.ref)}) ${isOffline ? '<span class="badge-status-offline" style="font-size:12px;">(โหมดออฟไลน์)</span>' : ''}
        </div>
        <div style="font-size:13px; color:#fff;">
          <strong>${esc(o.title || '')}</strong> · โซน ${esc(o.zone || '')} (${o.qty || 1} ใบ)<br>
          ผู้ถือบัตร: <strong>${esc(o.holderName || '')} (${esc(o.holderPhone || '')})</strong> · ปชช./Passport: <strong>${esc(o.holderIdCard || '-')}</strong><br>
          🔐 ลายเซ็นดิจิทัล HMAC-SHA256: <strong style="color:#68D391;">SIG:${esc(data.qrSignature || o.qrSignature || 'VERIFIED')} (ยืนยันบัตรแท้)</strong><br>
          บันทึกเวลาเข้างาน: ${esc(new Date(o.checkedInAt || Date.now()).toLocaleString('th-TH'))} โดย ${esc(o.checkedInBy || 'Gate')}
        </div>
      `;
      window.UI.toast(`เช็กอินบัตร ${o.ref} เข้างานสำเร็จ ${isOffline ? '(ออฟไลน์)' : ''}`);
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
              ? `<br><span class="text-muted">ผู้ถือบัตร: ${esc(o.holderName)} (${esc(o.holderPhone)}) · ปชช.: ${esc(o.holderIdCard || '-')} · โซน ${esc(o.zone)} (${o.qty} ใบ)</span>`
              : ''
          }
        </div>
      `;
      window.UI.toast(msg, 'error');
    }
  }

  async function submitCheckIn() {
    const code = ($('scanCodeInput').value || '').trim();
    const staffName = ($('scanStaffInput').value || '').trim() || 'Gate A';
    if (!code) {
      window.UI.toast('กรุณากรอกรหัส QR Code หรือรหัสการจอง', 'error');
      return;
    }

    $('submitScanBtn').disabled = true;

    // Offline mode direct execution
    if (navigator.onLine === false) {
      const offlineRes = verifyCheckInOffline(code, staffName);
      renderScanResultBox(offlineRes);
      $('submitScanBtn').disabled = false;
      return;
    }

    try {
      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ code, staffName, tickets: getLocalBrowserTickets() })
      });
      const data = await res.json();
      if (data.unauthorized) {
        window.UI.close('gateScannerModal');
        showLoginModal();
        return;
      }

      if (data.ok && data.code === 'CHECKED_IN') {
        playGateSound('pass');
        const o = data.order;
        upsertLocalBrowserTicket(o);
        speakGateResult(`ผ่านค่ะ โซน ${o.zone} จำนวน ${o.qty} ใบ`);
      } else if (data.code === 'ALREADY_CHECKED_IN') {
        playGateSound('duplicate');
        speakGateResult('เตือนภัยค่ะ บัตรนี้ถูกสแกนเข้างานไปแล้ว');
      } else if (data.code === 'INVALID_SIGNATURE') {
        playGateSound('invalid');
        speakGateResult('ตรวจพบบัตรปลอมแปลง ลายเซ็นไม่ถูกต้องค่ะ');
      } else {
        playGateSound('duplicate');
        speakGateResult('ไม่สามารถเข้างานได้ค่ะ');
      }

      renderScanResultBox(data);
      if (data.ok) {
        await Promise.all([loadStats(), loadOrders()]);
      }
    } catch (err) {
      if (offlineRosterCache.length > 0) {
        const offlineRes = verifyCheckInOffline(code, staffName);
        renderScanResultBox(offlineRes);
      } else {
        window.UI.toast(`เกิดข้อผิดพลาดในการเชื่อมต่อ: ${err.message}`, 'error');
      }
    } finally {
      $('submitScanBtn').disabled = false;
    }
  }

  async function approveOrder(ref, btn) {
    if (btn) btn.disabled = true;
    try {
      const orderSnapshot = ordersCache.find((o) => o.ref === ref) || null;
      const res = await fetch(`/api/orders/${encodeURIComponent(ref)}/approve`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ orderSnapshot, tickets: getLocalBrowserTickets() })
      });
      const data = await res.json();
      if (data.unauthorized) {
        showLoginModal();
        return;
      }
      if (!data.ok) throw new Error(data.error || 'อนุมัติไม่สำเร็จ');
      if (data.order) upsertLocalBrowserTicket(data.order);
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
      const orderSnapshot = ordersCache.find((o) => o.ref === rejectTargetRef) || null;
      const res = await fetch(`/api/orders/${encodeURIComponent(rejectTargetRef)}/reject`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ reason, orderSnapshot, tickets: getLocalBrowserTickets() })
      });
      const data = await res.json();
      if (data.unauthorized) {
        showLoginModal();
        return;
      }
      if (!data.ok) throw new Error(data.error || 'ปฏิเสธไม่สำเร็จ');
      if (data.order) upsertLocalBrowserTicket(data.order);
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
      const orderSnapshot = ordersCache.find((o) => o.ref === ref) || null;
      const res = await fetch(`/api/orders/${encodeURIComponent(ref)}/send-line`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ orderSnapshot, tickets: getLocalBrowserTickets() })
      });
      const data = await res.json();
      if (data.unauthorized) {
        showLoginModal();
        return;
      }
      if (!data.ok) throw new Error(data.error || 'ส่ง LINE ไม่สำเร็จ');
      if (data.order) upsertLocalBrowserTicket(data.order);
      window.UI.toast(data.lineResult.message || 'ส่งข้อความเข้า LINE OA แล้ว');
      await loadOrders();
    } catch (err) {
      window.UI.toast(err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function deleteOrder(ref, btn) {
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(ref)}/delete`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ ref })
      });
      const data = await res.json();
      if (data.unauthorized) {
        showLoginModal();
        return;
      }
      if (!data.ok) throw new Error(data.error || 'ลบรายการไม่สำเร็จ');
      removeLocalBrowserTickets([ref]);
      selectedOrderRefs.delete(ref);
      ordersCache = ordersCache.filter((o) => o.ref !== ref);
      renderOrders();
      window.UI.toast(`ลบคำสั่งซื้อ ${ref} ออกจากระบบเรียบร้อยแล้ว`);
      await Promise.all([loadStats(), loadOrders()]);
    } catch (err) {
      window.UI.toast(err.message, 'error');
      if (btn) btn.disabled = false;
    }
  }

  let slipZoomScale = 1;
  let slipZoomRotate = 0;

  function updateSlipTransform() {
    const img = $('slipZoomImg');
    if (img) {
      img.style.transform = `scale(${slipZoomScale}) rotate(${slipZoomRotate}deg)`;
    }
  }

  function openSlipZoom(order) {
    slipZoomScale = 1;
    slipZoomRotate = 0;
    const img = $('slipZoomImg');
    img.src = order.slipData;
    updateSlipTransform();

    $('slipZoomTitle').textContent = `สลิปการโอนเงิน · ${order.ref} (${Number(order.total).toLocaleString('th-TH')} THB)`;
    $('slipZoomMeta').textContent = `ผู้ถือบัตร: ${order.holderName} (${order.holderPhone}) · เวลาสั่งซื้อ: ${new Date(order.issuedAt).toLocaleString('th-TH')} · SHA-256: ${order.slipHash}`;

    const driveLink = $('slipDriveDirectLink');
    if (driveLink) {
      if (order.driveViewLink) {
        driveLink.href = order.driveViewLink;
        driveLink.hidden = false;
      } else {
        driveLink.hidden = true;
      }
    }

    const badgeBox = $('slipVerifyBadgeBox');
    if (badgeBox) {
      const parts = [];
      if (order.verifiedBy) {
        parts.push(`<span style="color:#68D391;">✔ ตรวจสอบผ่าน: ${window.UI.escapeHtml(order.verifiedBy)}</span>`);
      }
      if (order.verificationDetail) {
        parts.push(`<span style="color:var(--color-muted); font-size:11px;">(${window.UI.escapeHtml(order.verificationDetail)})</span>`);
      }
      if (order.driveViewLink) {
        parts.push(`<span style="color:var(--color-accent); font-size:11px;">· สำรองไฟล์ใน Google Drive แล้ว</span>`);
      }
      badgeBox.innerHTML = parts.join(' ') || '<span style="color:var(--color-muted);">รอแอดมินตรวจสอบสลิปด้วยตนเอง</span>';
    }

    window.UI.open('slipZoomModal');
  }

  let currentPreviewOrder = null;

  function buildLineFlexJson(order) {
    return {
      type: 'flex',
      altText: `บัตรคอนเสิร์ต ${order.title} (${order.ref}) อนุมัติแล้ว`,
      contents: {
        type: 'bubble',
        size: 'mega',
        header: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#1E1E1E',
          paddingAll: '20px',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                { type: 'text', text: 'THAI TICKET', color: '#B40000', weight: 'bold', size: 'sm' },
                { type: 'text', text: 'E-TICKET', color: '#229BFF', weight: 'bold', size: 'sm', align: 'end' }
              ]
            },
            { type: 'text', text: order.title, color: '#FFFFFF', weight: 'bold', size: 'lg', wrap: true, margin: 'md' },
            { type: 'text', text: `${order.date} · ${order.venue}`, color: '#CCCCCC', size: 'xs', wrap: true, margin: 'sm' }
          ]
        },
        body: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#333333',
          paddingAll: '20px',
          spacing: 'md',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                {
                  type: 'box',
                  layout: 'vertical',
                  contents: [
                    { type: 'text', text: 'ผู้ถือบัตร', color: '#999999', size: 'xs' },
                    { type: 'text', text: order.holderName, color: '#FFFFFF', weight: 'bold', size: 'sm', wrap: true }
                  ]
                },
                {
                  type: 'box',
                  layout: 'vertical',
                  contents: [
                    { type: 'text', text: 'เบอร์โทรศัพท์', color: '#999999', size: 'xs' },
                    { type: 'text', text: order.holderPhone, color: '#FFFFFF', weight: 'bold', size: 'sm' }
                  ]
                }
              ]
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                {
                  type: 'box',
                  layout: 'vertical',
                  contents: [
                    { type: 'text', text: 'โซนที่นั่ง', color: '#999999', size: 'xs' },
                    { type: 'text', text: order.zone, color: '#FFFFFF', weight: 'bold', size: 'sm' }
                  ]
                },
                {
                  type: 'box',
                  layout: 'vertical',
                  contents: [
                    { type: 'text', text: 'จำนวน / ยอดชำระ', color: '#999999', size: 'xs' },
                    {
                      type: 'text',
                      text: `${order.qty} ใบ (${Number(order.total).toLocaleString('th-TH')} THB)`,
                      color: '#229BFF',
                      weight: 'bold',
                      size: 'sm'
                    }
                  ]
                }
              ]
            },
            { type: 'separator', color: '#555555', margin: 'lg' },
            {
              type: 'box',
              layout: 'vertical',
              margin: 'lg',
              alignItems: 'center',
              contents: [
                { type: 'text', text: 'รหัสการจอง (แสดงหน้างาน)', color: '#999999', size: 'xs' },
                { type: 'text', text: order.ref, color: '#FFFFFF', weight: 'bold', size: 'xl', margin: 'xs' },
                { type: 'text', text: 'สถานะ: ชำระเงินและอนุมัติแล้ว', color: '#229BFF', size: 'xs', margin: 'sm' }
              ]
            }
          ]
        }
      }
    };
  }

  function renderSmartphoneFlex(order) {
    currentPreviewOrder = order;
    const esc = window.UI.escapeHtml;
    const seatsText = order.seats && order.seats.length ? order.seats.join(', ') : '';

    $('adminLinePreviewBody').innerHTML = `
      <div class="line-flex-card">
        <div class="line-flex-header">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:700;">
            <span style="color:#B40000; letter-spacing:0.5px;">THAI TICKET</span>
            <span style="background:rgba(34,155,255,0.2); color:#229BFF; padding:2px 6px; border-radius:4px;">E-TICKET OFFICIAL</span>
          </div>
          <div style="font-size:15px;font-weight:700;color:#fff;margin-top:8px; line-height:1.3;">${esc(order.title)}</div>
          <div style="font-size:11px;color:#cbd5e1;margin-top:4px;">📅 ${esc(order.date)} · 📍 ${esc(order.venue)}</div>
        </div>

        <div class="line-flex-body">
          <div class="line-flex-row">
            <div>
              <small>ผู้ถือบัตร</small>
              <strong>${esc(order.holderName)}</strong>
            </div>
            <div>
              <small>เบอร์โทรศัพท์</small>
              <strong>${esc(order.holderPhone)}</strong>
            </div>
          </div>

          <div class="line-flex-row">
            <div>
              <small>โซนที่นั่ง ${seatsText ? `(${esc(seatsText)})` : ''}</small>
              <strong>${esc(order.zone)}</strong>
            </div>
            <div>
              <small>จำนวน / ยอดชำระ</small>
              <strong style="color:var(--color-accent);">${order.qty} ใบ (${Number(order.total).toLocaleString('th-TH')} THB)</strong>
            </div>
          </div>

          <div class="line-flex-ref">
            <small>รหัสการจองสำหรับแสดงหน้างาน</small>
            <div style="font-size:22px; font-weight:800; color:#FFFFFF; letter-spacing:1px; margin-top:2px;">${esc(order.ref)}</div>
            <div style="font-size:11px; color:#68D391; margin-top:4px;">🟢 ผ่านการตรวจสอบและอนุมัติสิทธิ์เรียบร้อย</div>
          </div>

          <div style="margin-top:10px;background:#181818;border-radius:8px;padding:12px;text-align:center;border:1px solid rgba(255,255,255,0.08);">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=10&data=${encodeURIComponent(order.qrPayload || ('THAITICKET|' + order.ref))}" alt="QR Code สแกนเข้างาน" style="width:140px;height:140px;margin:0 auto;display:block;border-radius:6px;background:#fff;padding:6px;">
            <p style="font-size:11px;color:#68D391;margin-top:6px;font-weight:700;margin-bottom:2px;">📷 ยื่น QR Code นี้ที่จุดตรวจเพื่อสแกนเข้างาน</p>
            <p style="font-size:10px;color:#888;margin:0;">🔐 ลายเซ็นดิจิทัล HMAC-SHA256 ป้องกันบัตรปลอม</p>
          </div>

          <div style="display:flex; flex-direction:column; gap:6px; margin-top:10px;">
            <button type="button" class="btn-primary btn-block" style="padding:8px; font-size:12px;" onclick="window.open('ticket.html?ref=${encodeURIComponent(order.ref)}','_blank')">
              🎫 เปิดดูบัตรจริง & Dynamic Pass
            </button>
          </div>
        </div>
      </div>
      <div class="phone-bubble-time">อ่านแล้ว 09:41</div>
    `;
  }

  function openLinePreview(order) {
    if (!order) {
      order = ordersCache.find((o) => o.status === 'approved') || ordersCache[0] || {
        ref: 'TT9999-DEMO',
        title: 'ECHOES OF ASIA WORLD TOUR 2026',
        date: '14 - 15 พ.ย. 2026',
        venue: 'อิมแพ็ค อารีน่า เมืองทองธานี',
        zone: 'VIP Standing',
        qty: 2,
        total: 13000,
        holderName: 'คุณสมชาย สายเปย์',
        holderPhone: '0812345678',
        seats: ['VIP-01', 'VIP-02']
      };
    }

    // Populate dropdown
    const select = $('linePreviewOrderSelect');
    if (select) {
      const esc = window.UI.escapeHtml;
      select.innerHTML = ordersCache.length
        ? ordersCache
            .map(
              (o) =>
                `<option value="${esc(o.ref)}" ${o.ref === order.ref ? 'selected' : ''}>${esc(o.ref)} · ${esc(o.holderName)} (${esc(o.zone)})</option>`
            )
            .join('')
        : `<option value="${order.ref}" selected>${order.ref} · ${order.holderName}</option>`;
      select.onchange = (e) => {
        const target = ordersCache.find((x) => x.ref === e.target.value);
        if (target) renderSmartphoneFlex(target);
      };
    }

    renderSmartphoneFlex(order);
    window.UI.open('adminLinePreviewModal');
  }

  function copyLineFlexJson() {
    if (!currentPreviewOrder) return;
    const jsonStr = JSON.stringify(buildLineFlexJson(currentPreviewOrder), null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(jsonStr)
        .then(() => {
          window.UI.toast('คัดลอก LINE Flex JSON ไปยังคลิปบอร์ดแล้ว');
        })
        .catch(() => {
          window.UI.toast('ไม่สามารถคัดลอกได้', 'error');
        });
    } else {
      window.UI.toast('คัดลอก LINE Flex JSON เรียบร้อย');
    }
  }

  let latestAnalyticsData = null;

  function printSettlementReport() {
    window.UI.toast('กำลังเปิดหน้าต่างพิมพ์ใบสรุปยอดปิดรอบการแสดง (เลือก Save as PDF เพื่อบันทึกไฟล์)');
    window.print();
  }

  function downloadSettlementHtml() {
    if (!latestAnalyticsData) return;
    const esc = window.UI.escapeHtml;
    const meta = latestAnalyticsData.settlementMeta || {};
    const k = latestAnalyticsData.kpis || {};
    const evs = latestAnalyticsData.eventSettlements || [];
    const promos = latestAnalyticsData.promoBreakdown || [];
    const issuedStr = new Date(meta.generatedAt || Date.now()).toLocaleString('th-TH');

    const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>ใบสรุปยอดปิดรอบการแสดง (${esc(meta.reportId || 'STL-REPORT')})</title>
<style>
  body { font-family: 'Noto Sans Thai', Tahoma, sans-serif; color: #111; margin: 28px; line-height: 1.45; }
  .head { border-bottom: 3px solid #B40000; padding-bottom: 12px; margin-bottom: 18px; display: flex; justify-content: space-between; }
  h1 { margin: 0 0 4px 0; font-size: 20px; color: #B40000; }
  table { width: 100%; border-collapse: collapse; margin: 14px 0 22px; font-size: 13px; }
  th, td { border: 1px solid #ccc; padding: 8px 10px; text-align: left; }
  th { background: #f3f3f3; }
  tfoot td { font-weight: 700; background: #fafafa; }
  .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
  .kpi-box { border: 1px solid #ccc; border-radius: 6px; padding: 10px; }
  .sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 32px; }
  .sign-box { border: 1px dashed #888; border-radius: 6px; padding: 18px; text-align: center; }
  .sign-line { border-bottom: 1px solid #333; height: 34px; margin: 16px 30px 8px; }
</style>
</head>
<body>
  <div class="head">
    <div>
      <h1>ใบสรุปยอดปิดรอบการแสดงและรายงานการเงิน (Official Event Settlement Report)</h1>
      <div>ผู้รับชำระเงิน: <strong>${esc(meta.merchantName || 'Thai Ticket Concert Co., Ltd.')}</strong> · พร้อมเพย์: <strong>${esc(meta.promptpayId || '0954654698')}</strong></div>
    </div>
    <div style="text-align:right; font-size:12px;">
      <div>เลขที่เอกสาร: <strong>${esc(meta.reportId || 'STL-2026')}</strong></div>
      <div>วันที่ออกรายงาน: ${esc(issuedStr)}</div>
    </div>
  </div>
  <div class="kpi-row">
    <div class="kpi-box"><small>รายได้สุทธิ (Net Revenue)</small><div style="font-size:18px;font-weight:700;color:#B40000;">${Number(k.totalNetRevenue || 0).toLocaleString('th-TH')} THB</div></div>
    <div class="kpi-box"><small>ยอดก่อนหักส่วนลด (Gross)</small><div style="font-size:18px;font-weight:700;">${Number(k.totalGrossRevenue || 0).toLocaleString('th-TH')} THB</div></div>
    <div class="kpi-box"><small>ส่วนลดโปรโมชันรวม</small><div style="font-size:18px;font-weight:700;">-${Number(k.totalDiscountGiven || 0).toLocaleString('th-TH')} THB</div></div>
    <div class="kpi-box"><small>บัตรที่จำหน่ายแล้ว / เช็กอิน</small><div style="font-size:18px;font-weight:700;">${k.totalTicketsSold || 0} ใบ (เช็กอิน ${k.checkedInCount || 0} ใบ)</div></div>
  </div>
  <h3>1. ตารางสรุปยอดขายแยกตามรอบการแสดง (Event Financial Settlement)</h3>
  <table>
    <thead>
      <tr>
        <th>คอนเสิร์ต / รอบการแสดง</th>
        <th>วันที่ & สถานที่</th>
        <th>บิลอนุมัติ</th>
        <th>บัตรที่ขายได้</th>
        <th>เช็กอินหน้างาน</th>
        <th>ยอดเต็ม (Gross)</th>
        <th>ส่วนลด (Discount)</th>
        <th>ยอดสุทธิ (Net THB)</th>
      </tr>
    </thead>
    <tbody>
      ${evs
        .map(
          (e) => `<tr>
        <td><strong>${esc(e.title)}</strong></td>
        <td>${esc(e.date)} · ${esc(e.venue)}</td>
        <td>${e.ordersCount} รายการ</td>
        <td>${e.ticketsSold} / ${e.totalQuota} ใบ</td>
        <td>${e.checkedInTickets} ใบ</td>
        <td>${Number(e.grossRevenue).toLocaleString('th-TH')} THB</td>
        <td>-${Number(e.discountAmount).toLocaleString('th-TH')} THB</td>
        <td><strong>${Number(e.netRevenue).toLocaleString('th-TH')} THB</strong></td>
      </tr>`
        )
        .join('')}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="2">รวมทั้งสิ้น (Grand Total)</td>
        <td>${k.approvedOrders || 0} รายการ</td>
        <td>${k.totalTicketsSold || 0} ใบ</td>
        <td>${k.checkedInCount || 0} ใบ</td>
        <td>${Number(k.totalGrossRevenue || 0).toLocaleString('th-TH')} THB</td>
        <td>-${Number(k.totalDiscountGiven || 0).toLocaleString('th-TH')} THB</td>
        <td>${Number(k.totalNetRevenue || 0).toLocaleString('th-TH')} THB</td>
      </tr>
    </tfoot>
  </table>
  <h3>2. สรุปการใช้โค้ดส่วนลดโปรโมชัน (Promo Code Settlement)</h3>
  <table>
    <thead>
      <tr><th>รหัสโค้ด</th><th>รายละเอียดแคมเปญ</th><th>จำนวนที่ใช้</th><th>ส่วนลดที่มอบให้รวม</th><th>ยอดชำระสุทธิจากโค้ด</th></tr>
    </thead>
    <tbody>
      ${promos
        .map(
          (p) => `<tr>
        <td><strong>${esc(p.code)}</strong></td>
        <td>${esc(p.description)}</td>
        <td>${p.usedCount} รายการ</td>
        <td>-${Number(p.totalDiscount).toLocaleString('th-TH')} THB</td>
        <td>${Number(p.netRevenue).toLocaleString('th-TH')} THB</td>
      </tr>`
        )
        .join('')}
    </tbody>
  </table>
  <div class="sign-grid">
    <div class="sign-box">
      <strong>ผู้จัดงาน / Promoter Representative</strong>
      <div class="sign-line"></div>
      <div>วันที่ ____ / ____ / ________</div>
    </div>
    <div class="sign-box">
      <strong>ฝ่ายการเงินและบัญชี / Finance & Settlement Auditor</strong>
      <div class="sign-line"></div>
      <div>วันที่ ____ / ____ / ________</div>
    </div>
  </div>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `thaiticket-settlement-${(meta.reportId || 'report').toLowerCase()}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    window.UI.toast('ดาวน์โหลดไฟล์ใบสรุปยอดปิดรอบการแสดงเรียบร้อยแล้ว');
  }

  async function openAnalyticsModal() {
    const box = $('analyticsModalContent');
    if (!box) return;
    box.innerHTML = `<div class="empty-state"><p>กำลังประมวลผลสถิติและใบสรุปยอดปิดรอบการแสดง...</p></div>`;
    window.UI.open('analyticsModal');

    try {
      const res = await fetch('/api/admin/analytics', { headers: getAuthHeaders() });
      const data = await res.json();
      if (data.unauthorized) {
        window.UI.close('analyticsModal');
        showLoginModal();
        return;
      }
      if (!data.ok) throw new Error(data.error || 'ดึงข้อมูลไม่สำเร็จ');

      latestAnalyticsData = data;
      const esc = window.UI.escapeHtml;
      const meta = data.settlementMeta || {};
      const k = data.kpis;
      const z = data.zones;
      const p = data.promos;
      const evs = data.eventSettlements || [];
      const promoList = data.promoBreakdown || [];
      const v = data.hourlyVelocity || [];
      const maxVelocityCount = Math.max(1, ...v.map((item) => item.count));
      const generatedTime = new Date(meta.generatedAt || Date.now()).toLocaleString('th-TH');

      box.innerHTML = `
        <div class="analytics-grid" id="printableSettlementArea">
          <!-- Official Settlement Header -->
          <div class="settlement-report-header" id="settlementReportHeader">
            <div>
              <div style="font-size:11px; color:var(--color-accent); font-weight:700; letter-spacing:0.5px;">OFFICIAL FINANCIAL SETTLEMENT REPORT · ใบสรุปยอดปิดรอบการแสดง</div>
              <div style="font-size:16px; font-weight:700; color:#fff; margin-top:2px;">${esc(meta.merchantName || 'Thai Ticket Concert Co., Ltd.')}</div>
              <div class="text-muted" style="font-size:12px;">บัญชีพร้อมเพย์รับชำระ: <strong>${esc(meta.promptpayId || '0954654698')}</strong></div>
            </div>
            <div style="text-align:right; font-size:12px;">
              <div>เลขที่ใบสรุปยอด: <strong style="color:var(--color-accent);" id="settlementReportId">${esc(meta.reportId || 'STL-2026')}</strong></div>
              <div class="text-muted">ออกรายงานเมื่อ: ${esc(generatedTime)}</div>
            </div>
          </div>

          <!-- KPI Cards -->
          <div class="analytics-kpis">
            <div class="analytics-kpi-card">
              <span class="analytics-kpi-title">รายได้สุทธิ (Net Revenue)</span>
              <span class="analytics-kpi-val" style="color:var(--color-accent);">${Number(k.totalNetRevenue).toLocaleString('th-TH')} <small style="font-size:12px;">THB</small></span>
              <span class="analytics-kpi-sub">ยอดก่อนหักส่วนลด: ${Number(k.totalGrossRevenue).toLocaleString('th-TH')} THB</span>
            </div>
            <div class="analytics-kpi-card">
              <span class="analytics-kpi-title">ยอดเฉลี่ยต่อบิล (AOV)</span>
              <span class="analytics-kpi-val">${Number(k.aov).toLocaleString('th-TH')} <small style="font-size:12px;">THB</small></span>
              <span class="analytics-kpi-sub">คำสั่งซื้อที่อนุมัติ: ${k.approvedOrders} / ${k.totalOrders} รายการ</span>
            </div>
            <div class="analytics-kpi-card">
              <span class="analytics-kpi-title">อัตราการจองรวม (Occupancy)</span>
              <span class="analytics-kpi-val" style="color:#6ee7b7;">${k.overallOccupancyPct}%</span>
              <span class="analytics-kpi-sub">จำหน่ายแล้ว ${k.totalTicketsSold} / ${k.totalCapacity} ที่นั่ง</span>
            </div>
            <div class="analytics-kpi-card">
              <span class="analytics-kpi-title">เช็กอินหน้างาน (Gate Check-in)</span>
              <span class="analytics-kpi-val" style="color:#229BFF;">${k.checkedInCount} <small style="font-size:12px;">ใบ (${k.checkInRatePct}%)</small></span>
              <span class="analytics-kpi-sub">สแกนผ่านจุดตรวจแล้ว</span>
            </div>
          </div>

          <!-- Per-Event Financial Settlement Table -->
          <div class="heatmap-box">
            <div class="heatmap-box-title">
              <span>📑 ตารางสรุปยอดขายและรายได้สุทธิแยกตามคอนเสิร์ต (Event Settlement Breakdown)</span>
              <span style="font-size:11px; color:var(--color-muted); font-weight:normal;">เฉพาะรายการที่อนุมัติสลิปแล้ว</span>
            </div>
            <div class="settlement-table-wrap">
              <table class="settlement-table" id="eventSettlementTable">
                <thead>
                  <tr>
                    <th>คอนเสิร์ต / การแสดง</th>
                    <th>วันที่ & สถานที่</th>
                    <th>บิลอนุมัติ</th>
                    <th>บัตรที่ขาย / โควตา</th>
                    <th>เช็กอิน</th>
                    <th>ยอดเต็ม (Gross)</th>
                    <th>ส่วนลด</th>
                    <th>รายได้สุทธิ (Net)</th>
                  </tr>
                </thead>
                <tbody>
                  ${evs
                    .map(
                      (ev) => `
                    <tr>
                      <td><strong style="color:#fff;">${esc(ev.title)}</strong></td>
                      <td class="text-muted">${esc(ev.date)} · ${esc(ev.venue)}</td>
                      <td>${ev.ordersCount} รายการ</td>
                      <td>${ev.ticketsSold} / ${ev.totalQuota} ใบ</td>
                      <td style="color:var(--color-accent);">${ev.checkedInTickets} ใบ</td>
                      <td>${Number(ev.grossRevenue).toLocaleString('th-TH')} THB</td>
                      <td style="color:#F5A623;">-${Number(ev.discountAmount).toLocaleString('th-TH')} THB</td>
                      <td><strong style="color:var(--color-accent);">${Number(ev.netRevenue).toLocaleString('th-TH')} THB</strong></td>
                    </tr>`
                    )
                    .join('')}
                </tbody>
                <tfoot>
                  <tr>
                    <td colspan="2">รวมยอดปิดรอบทั้งหมด (Grand Settlement Total)</td>
                    <td>${k.approvedOrders} รายการ</td>
                    <td>${k.totalTicketsSold} ใบ</td>
                    <td style="color:var(--color-accent);">${k.checkedInCount} ใบ</td>
                    <td>${Number(k.totalGrossRevenue).toLocaleString('th-TH')} THB</td>
                    <td style="color:#F5A623;">-${Number(k.totalDiscountGiven).toLocaleString('th-TH')} THB</td>
                    <td style="color:var(--color-accent);">${Number(k.totalNetRevenue).toLocaleString('th-TH')} THB</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <!-- Seating Heatmap by Zone -->
          <div class="heatmap-box">
            <div class="heatmap-box-title">
              <span>🏟️ ความหนาแน่นและอัตราการจองแต่ละโซน (Venue Seating Heatmap)</span>
              <span style="font-size:11px; color:var(--color-muted); font-weight:normal;">คำนวณจากยอดที่นั่งจริง</span>
            </div>
            <div class="zone-heatmap-list">
              ${Object.keys(z)
                .map((key) => {
                  const zone = z[key];
                  return `
                  <div class="zone-heatmap-item">
                    <div class="zone-heatmap-header">
                      <div style="display:flex; align-items:center; gap:8px;">
                        <span class="zone-badge-pill" style="background:${zone.color};">${key}</span>
                        <strong>${zone.name}</strong>
                        <span class="text-muted">(${zone.price.toLocaleString('th-TH')} THB)</span>
                      </div>
                      <div>
                        <strong>${zone.sold} / ${zone.quota} ที่นั่ง</strong>
                        <span style="color:${zone.color}; font-weight:700; margin-left:6px;">(${zone.occupancyPct}%)</span>
                        <span class="text-muted" style="margin-left:6px;">· ยอดรวม ${Number(zone.revenue).toLocaleString('th-TH')} THB</span>
                      </div>
                    </div>
                    <div class="heatmap-track">
                      <div class="heatmap-fill" style="width:${zone.occupancyPct}%; background:${zone.color};"></div>
                    </div>
                  </div>
                `;
                })
                .join('')}
            </div>
          </div>

          <!-- Promo Code Settlement Table -->
          <div class="heatmap-box">
            <div class="heatmap-box-title">
              <span>🎟️ สรุปยอดการใช้โค้ดส่วนลดโปรโมชัน (Promo Code Settlement)</span>
              <span class="badge-accent">โควตา Early Bird คงเหลือ: ${p.earlyBirdRemainingQuota} สิทธิ์</span>
            </div>
            <div class="settlement-table-wrap">
              <table class="settlement-table" id="promoSettlementTable">
                <thead>
                  <tr>
                    <th>รหัสโค้ด</th>
                    <th>แคมเปญส่วนลด</th>
                    <th>จำนวนที่ใช้</th>
                    <th>ยอดส่วนลดรวม</th>
                    <th>ยอดชำระสุทธิจากโค้ด</th>
                  </tr>
                </thead>
                <tbody>
                  ${promoList
                    .map(
                      (pr) => `
                    <tr>
                      <td><strong style="color:var(--color-accent);">${esc(pr.code)}</strong></td>
                      <td>${esc(pr.description)}</td>
                      <td>${pr.usedCount} รายการ</td>
                      <td style="color:#F5A623;">-${Number(pr.totalDiscount).toLocaleString('th-TH')} THB</td>
                      <td><strong>${Number(pr.netRevenue).toLocaleString('th-TH')} THB</strong></td>
                    </tr>`
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Hourly Velocity -->
          <div class="heatmap-box">
            <div class="heatmap-box-title">
              <span>⚡ ความเร็วการสั่งซื้อบัตรรายชั่วโมง (24h Velocity Pace)</span>
              <span style="font-size:11px; color:var(--color-muted); font-weight:normal;">จำนวนคำสั่งซื้อในรอบ 24 ชั่วโมง</span>
            </div>
            <div class="velocity-grid">
              ${v
                .map((bucket) => {
                  const pct = Math.max(8, Math.round((bucket.count / maxVelocityCount) * 100));
                  return `
                  <div class="velocity-col">
                    <div class="velocity-bar-wrap">
                      <div class="velocity-bar" style="height:${pct}%;"></div>
                    </div>
                    <span class="velocity-count">${bucket.count} รายการ</span>
                    <span class="velocity-time">${bucket.label}</span>
                  </div>
                `;
                })
                .join('')}
            </div>
          </div>

          <!-- Official Sign-off Block for Print / PDF Settlement -->
          <div class="settlement-signoff-grid">
            <div class="settlement-signoff-box">
              <strong>ผู้จัดงาน / Promoter Representative</strong>
              <div class="settlement-signoff-line"></div>
              <div class="text-muted">ลงชื่อผู้รับรองยอดขาย · วันที่ ____/____/____</div>
            </div>
            <div class="settlement-signoff-box">
              <strong>ฝ่ายการเงินและบัญชี / Finance & Settlement Auditor</strong>
              <div class="settlement-signoff-line"></div>
              <div class="text-muted">ลงชื่อผู้ตรวจสอบสลิป · วันที่ ____/____/____</div>
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="settlement-actions-bar">
            <button type="button" class="btn-default" id="downloadSettlementHtmlBtn">📄 ดาวน์โหลดรายงานฉบับพิมพ์ (.html)</button>
            <button type="button" class="btn-primary" id="printSettlementFooterBtn">🖨️ สั่งพิมพ์ใบสรุปยอด / บันทึกเป็น PDF</button>
          </div>
        </div>
      `;

      if ($('printSettlementFooterBtn')) {
        $('printSettlementFooterBtn').addEventListener('click', printSettlementReport);
      }
      if ($('downloadSettlementHtmlBtn')) {
        $('downloadSettlementHtmlBtn').addEventListener('click', downloadSettlementHtml);
      }
    } catch (err) {
      box.innerHTML = `<p class="slip-error">เกิดข้อผิดพลาดในการโหลด Analytics: ${window.UI.escapeHtml(err.message)}</p>`;
    }
  }

  // Live Gate Throughput & Queue Monitor Modal
  async function loadGateMonitorData() {
    const box = $('gateMonitorContent');
    if (!box) return;
    try {
      const res = await fetch('/api/checkin/gate-monitor', { headers: getAuthHeaders() });
      const data = await res.json();
      if (data.unauthorized) {
        window.UI.close('gateMonitorModal');
        showLoginModal();
        return;
      }
      if (!data.ok) throw new Error(data.error || 'โหลดข้อมูลมอนิเตอร์ประตูไม่สำเร็จ');

      const esc = window.UI.escapeHtml;
      const s = data.summary || {};
      const gates = data.gates || [];
      const zones = data.zones || [];
      const recent = data.recentScans || [];
      const clearText =
        s.remainingTickets === 0
          ? 'เข้าครบ 100%'
          : s.estimatedClearanceMinutes
            ? `~${s.estimatedClearanceMinutes} นาที`
            : 'รอเริ่มสแกน';

      box.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:16px;">
          <!-- 4 Live Throughput KPIs -->
          <div class="analytics-kpis">
            <div class="analytics-kpi-card">
              <span class="analytics-kpi-title">ผู้ชมเข้าฮอลล์แล้ว (Checked-in Pax)</span>
              <span class="analytics-kpi-val" style="color:#68D391;">${Number(s.checkedInTickets || 0).toLocaleString('th-TH')} / ${Number(s.totalApprovedTickets || 0).toLocaleString('th-TH')} <small style="font-size:12px;">ใบ (${s.progressPct || 0}%)</small></span>
              <span class="analytics-kpi-sub">บิลที่สแกนแล้ว: ${s.checkedInOrders || 0} / ${s.totalApprovedOrders || 0} รายการ</span>
            </div>
            <div class="analytics-kpi-card">
              <span class="analytics-kpi-title">คิวรอเข้าฮอลล์ (Remaining Queue)</span>
              <span class="analytics-kpi-val" style="color:#F5A623;">${Number(s.remainingTickets || 0).toLocaleString('th-TH')} <small style="font-size:12px;">ใบ</small></span>
              <span class="analytics-kpi-sub">ผู้ถือบัตรที่อนุมัติแล้วแต่ยังไม่ถึงจุดตรวจ</span>
            </div>
            <div class="analytics-kpi-card">
              <span class="analytics-kpi-title">ความเร็วสแกนเข้าฮอลล์ (Throughput Rate)</span>
              <span class="analytics-kpi-val" style="color:var(--color-accent);">${s.paxPerMinute || 0} <small style="font-size:12px;">คน/นาที (Pax/min)</small></span>
              <span class="analytics-kpi-sub">สแกนในรอบ 15 นาทีล่าสุด: ${s.paxLast15m || 0} ใบ</span>
            </div>
            <div class="analytics-kpi-card">
              <span class="analytics-kpi-title">เวลาคาดการณ์ระบายคิวหมด (Est. Clearance)</span>
              <span class="analytics-kpi-val" style="color:#63b3ed;">${clearText}</span>
              <span class="analytics-kpi-sub">คำนวณจากความเร็วการสแกนปัจจุบัน</span>
            </div>
          </div>

          <!-- Gate-by-Gate Throughput Breakdown -->
          <div class="heatmap-box">
            <div class="heatmap-box-title">
              <span>🚪 สถิติปริมาณคนสแกนเข้างานแยกตามประตู (Gate-by-Gate Throughput)</span>
              <span style="font-size:11px; color:var(--color-muted); font-weight:normal;">คลิกที่การ์ดประตูเพื่อสลับจุดตรวจสแกนทันที</span>
            </div>
            <div class="gate-lanes-grid" id="gateMonitorLanesGrid">
              ${gates
                .map((g) => {
                  const lastStr = g.lastScanAt
                    ? new Date(g.lastScanAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    : 'ยังไม่มีการสแกน';
                  return `
                  <div class="gate-lane-card ${g.status === 'active' ? 'is-active' : 'is-standby'}" data-select-gate="${esc(g.gateName)}" title="คลิกเพื่อตั้งจุดสแกนเป็น ${esc(g.gateName)}">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
                      <strong style="color:#fff; font-size:13px;">${esc(g.gateName)}</strong>
                      <span class="${g.status === 'active' ? 'badge-status-online' : 'badge-pending'}" style="font-size:10px; padding:2px 6px;">
                        ${g.status === 'active' ? '🟢 กำลังสแกน' : '⚪ สแตนด์บาย'}
                      </span>
                    </div>
                    <div style="font-size:18px; font-weight:800; color:var(--color-accent);">
                      ${g.ticketsScanned} ใบ <small style="font-size:11px; color:var(--color-muted); font-weight:400;">(${g.ordersScanned} บิล · สัดส่วน ${g.sharePct}%)</small>
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:11px; color:#cbd5e1;">
                      <span>⚡ ความเร็ว: <strong>${g.paxPerMin} Pax/min</strong></span>
                      <span>🕒 ล่าสุด: ${esc(lastStr)}</span>
                    </div>
                    <div class="heatmap-track" style="height:6px; margin-top:2px;">
                      <div class="heatmap-fill" style="width:${Math.max(4, g.sharePct)}%; background:${g.status === 'active' ? '#68D391' : '#4a5568'};"></div>
                    </div>
                  </div>`;
                })
                .join('')}
            </div>
          </div>

          <!-- Per-Zone Arrival vs Sold Comparison -->
          <div class="heatmap-box">
            <div class="heatmap-box-title">
              <span>🏟️ อัตราผู้ชมที่เข้าฮอลล์แล้วเทียบกับบัตรที่ขายได้แยกตามโซน (Zone Arrival vs Sold)</span>
              <span style="font-size:11px; color:var(--color-muted); font-weight:normal;">อัปเดตเรียลไทม์จากจุดสแกน</span>
            </div>
            <div class="zone-heatmap-list">
              ${zones
                .map(
                  (z) => `
                  <div class="zone-heatmap-item">
                    <div class="zone-heatmap-header">
                      <div style="display:flex; align-items:center; gap:8px;">
                        <span class="zone-badge-pill" style="background:${z.color};">${esc(z.key)}</span>
                        <strong>${esc(z.label)}</strong>
                      </div>
                      <div>
                        <strong style="color:#68D391;">เข้าฮอลล์แล้ว ${z.checkedInTickets}</strong> / <strong>ขายแล้ว ${z.soldTickets} ใบ</strong>
                        <span style="color:${z.color}; font-weight:700; margin-left:6px;">(${z.arrivalPct}%)</span>
                        <span class="text-muted" style="margin-left:6px;">· คิวรอเข้าอีก ${z.remainingTickets} ใบ</span>
                      </div>
                    </div>
                    <div class="heatmap-track">
                      <div class="heatmap-fill" style="width:${z.arrivalPct}%; background:${z.color};"></div>
                    </div>
                  </div>`
                )
                .join('')}
            </div>
          </div>

          <!-- Live Recent Gate Pass Feed -->
          <div class="heatmap-box">
            <div class="heatmap-box-title">
              <span>📋 รายการสแกนผ่านประตูเข้าฮอลล์ล่าสุด (Live Gate Pass Feed)</span>
              <span style="font-size:11px; color:var(--color-muted); font-weight:normal;">10 รายการล่าสุด</span>
            </div>
            ${
              !recent.length
                ? `<p class="text-muted" style="font-size:12px;">ยังไม่มีประวัติการสแกนบัตรเข้าฮอลล์</p>`
                : `<div class="settlement-table-wrap">
                    <table class="settlement-table">
                      <thead>
                        <tr>
                          <th>เวลาเข้างาน</th>
                          <th>ประตู / จุดตรวจ</th>
                          <th>รหัสบัตร</th>
                          <th>ผู้ถือบัตร</th>
                          <th>โซน / เลขที่นั่ง</th>
                          <th>จำนวน</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${recent
                          .map((r) => {
                            const tStr = new Date(r.checkedInAt).toLocaleTimeString('th-TH', {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit'
                            });
                            const seatsStr = Array.isArray(r.seats) && r.seats.length ? ` (${r.seats.join(', ')})` : '';
                            return `
                            <tr>
                              <td style="color:#68D391; font-weight:600;">${esc(tStr)}</td>
                              <td><span class="badge-accent">${esc(r.checkedInBy)}</span></td>
                              <td><strong>${esc(r.ref)}</strong></td>
                              <td>${esc(r.holderName)}</td>
                              <td>${esc(r.zone)}${esc(seatsStr)}</td>
                              <td><strong>${r.qty} ใบ</strong></td>
                            </tr>`;
                          })
                          .join('')}
                      </tbody>
                    </table>
                  </div>`
            }
          </div>
        </div>
      `;

      const lanesGrid = $('gateMonitorLanesGrid');
      if (lanesGrid) {
        lanesGrid.addEventListener('click', (e) => {
          const card = e.target.closest('[data-select-gate]');
          if (!card) return;
          const gateName = card.dataset.selectGate;
          if ($('scanStaffInput')) {
            $('scanStaffInput').value = gateName;
          }
          window.UI.close('gateMonitorModal');
          openScannerModal();
          window.UI.toast(`ตั้งค่าจุดสแกนเป็น "${gateName}" เรียบร้อยแล้ว`);
        });
      }
    } catch (err) {
      box.innerHTML = `<p class="slip-error">เกิดข้อผิดพลาดในการโหลด Gate Monitor: ${window.UI.escapeHtml(err.message)}</p>`;
    }
  }

  async function openGateMonitorModal() {
    window.UI.open('gateMonitorModal');
    const box = $('gateMonitorContent');
    if (box) box.innerHTML = `<p class="text-muted">กำลังโหลดข้อมูลมอนิเตอร์ความเร็วการเข้าฮอลล์แยกตามประตู...</p>`;
    await loadGateMonitorData();
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
      if ($('settingBankNameInput')) {
        $('settingBankNameInput').value = data.bankName || '';
      }
      if ($('settingBankAccountInput')) {
        $('settingBankAccountInput').value = data.bankAccount || '';
      }
      if ($('settingDriveFolderInput')) {
        $('settingDriveFolderInput').value = data.googleDriveFolderId || '';
      }
      if ($('settingDriveEmailInput')) {
        $('settingDriveEmailInput').value = data.googleServiceAccountEmail || '';
      }
      if ($('settingDriveKeyInput')) {
        $('settingDriveKeyInput').value = '';
        $('settingDriveKeyInput').placeholder = data.hasGooglePrivateKey
          ? '•••••••• (ตั้งค่าแล้ว · เว้นว่างไว้หากไม่ต้องการเปลี่ยน)'
          : '-----BEGIN PRIVATE KEY----- ...';
      }
      if ($('settingSlipProviderInput')) {
        $('settingSlipProviderInput').value = data.slipVerifyProvider || 'simulator';
      }
      if ($('settingSlipApiKeyInput')) {
        $('settingSlipApiKeyInput').value = '';
        $('settingSlipApiKeyInput').placeholder = data.slipVerifyApiKeyMasked
          ? `•••••••• (${data.slipVerifyApiKeyMasked})`
          : 'วาง API Key จาก SlipOK / EasySlip';
      }
      if ($('settingSlipBranchInput')) {
        $('settingSlipBranchInput').value = data.slipVerifyBranchId || '';
      }
      if ($('settingSlipAutoApprove')) {
        $('settingSlipAutoApprove').checked = Boolean(data.slipAutoApproveEnabled);
      }
      if ($('settingAdminLineUserInput')) {
        $('settingAdminLineUserInput').value = data.adminLineUserId || '';
      }
      if ($('adminAlertTestStatus')) {
        $('adminAlertTestStatus').hidden = true;
      }
      $('settingLineTokenInput').value = '';
      if ($('settingAdminPinInput')) $('settingAdminPinInput').value = '';
      if ($('settingGateStaffPinInput')) $('settingGateStaffPinInput').value = '';
    } catch {
      /* ignore */
    }
    window.UI.open('lineSettingsModal');
  }

  async function saveSettings() {
    const token = $('settingLineTokenInput').value.trim();
    const promptpayId = $('settingPromptpayInput').value.trim();
    const merchantName = $('settingMerchantNameInput') ? $('settingMerchantNameInput').value.trim() : '';
    const bankName = $('settingBankNameInput') ? $('settingBankNameInput').value.trim() : '';
    const bankAccount = $('settingBankAccountInput') ? $('settingBankAccountInput').value.trim() : '';
    const adminPin = $('settingAdminPinInput') ? $('settingAdminPinInput').value.trim() : '';
    const gateStaffPin = $('settingGateStaffPinInput') ? $('settingGateStaffPinInput').value.trim() : '';
    const googleDriveFolderId = $('settingDriveFolderInput') ? $('settingDriveFolderInput').value.trim() : '';
    const googleServiceAccountEmail = $('settingDriveEmailInput') ? $('settingDriveEmailInput').value.trim() : '';
    const googleServiceAccountPrivateKey = $('settingDriveKeyInput') ? $('settingDriveKeyInput').value.trim() : '';
    const slipVerifyProvider = $('settingSlipProviderInput') ? $('settingSlipProviderInput').value : 'simulator';
    const slipVerifyApiKey = $('settingSlipApiKeyInput') ? $('settingSlipApiKeyInput').value.trim() : '';
    const slipVerifyBranchId = $('settingSlipBranchInput') ? $('settingSlipBranchInput').value.trim() : '';
    const slipAutoApproveEnabled = $('settingSlipAutoApprove') ? $('settingSlipAutoApprove').checked : false;
    const adminLineUserId = $('settingAdminLineUserInput') ? $('settingAdminLineUserInput').value.trim() : '';

    const payload = {
      promptpayId,
      merchantName,
      bankName,
      bankAccount,
      googleDriveFolderId,
      googleServiceAccountEmail,
      slipVerifyProvider,
      slipVerifyBranchId,
      slipAutoApproveEnabled,
      adminLineUserId
    };
    if (token) payload.lineChannelAccessToken = token;
    if (adminPin) payload.adminPin = adminPin;
    if (gateStaffPin) payload.gateStaffPin = gateStaffPin;
    if (googleServiceAccountPrivateKey) payload.googleServiceAccountPrivateKey = googleServiceAccountPrivateKey;
    if (slipVerifyApiKey) payload.slipVerifyApiKey = slipVerifyApiKey;

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
      window.UI.toast(`บันทึกการตั้งค่าเรียบร้อย (พร้อมเพย์: ${data.promptpayId}${data.bankAccount ? ' · บัญชี: ' + data.bankAccount : ''} · Cloud: Google Drive & ตรวจสลิป)`);
    } catch (err) {
      window.UI.toast(err.message, 'error');
    }
  }

  async function testDriveConnection() {
    const statusEl = $('driveTestStatus');
    const folderId = $('settingDriveFolderInput') ? $('settingDriveFolderInput').value.trim() : '';
    const clientEmail = $('settingDriveEmailInput') ? $('settingDriveEmailInput').value.trim() : '';
    const privateKey = $('settingDriveKeyInput') ? $('settingDriveKeyInput').value.trim() : '';

    if (statusEl) {
      statusEl.hidden = false;
      statusEl.style.color = 'var(--color-accent)';
      statusEl.textContent = '⏳ กำลังทดสอบเชื่อมต่อ Google Drive API...';
    }

    try {
      const res = await fetch('/api/admin/drive/test', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          googleDriveFolderId: folderId,
          googleServiceAccountEmail: clientEmail,
          googleServiceAccountPrivateKey: privateKey
        })
      });
      const data = await res.json();
      if (statusEl) {
        statusEl.style.color = data.ok ? '#68D391' : '#FF6B6B';
        statusEl.textContent = data.message || (data.ok ? 'เชื่อมต่อ Google Drive สำเร็จ' : 'เชื่อมต่อไม่สำเร็จ');
      }
    } catch (err) {
      if (statusEl) {
        statusEl.style.color = '#FF6B6B';
        statusEl.textContent = `เกิดข้อผิดพลาด: ${err.message}`;
      }
    }
  }

  async function testSlipVerification() {
    const statusEl = $('slipTestStatus');
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.style.color = 'var(--color-accent)';
      statusEl.textContent = '⏳ กำลังทดสอบระบบตรวจสลิป...';
    }

    try {
      const res = await fetch('/api/admin/slip/test', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ amount: 3600 })
      });
      const data = await res.json();
      if (statusEl) {
        if (data.ok && data.result) {
          statusEl.style.color = data.result.verified ? '#68D391' : '#FF6B6B';
          statusEl.textContent = `ผลการทดสอบ (${data.result.provider || 'Verifier'}): ${data.result.detail || data.result.reason || 'พร้อมทำงาน'}`;
        } else {
          statusEl.style.color = '#FF6B6B';
          statusEl.textContent = 'ทดสอบไม่สำเร็จ';
        }
      }
    } catch (err) {
      if (statusEl) {
        statusEl.style.color = '#FF6B6B';
        statusEl.textContent = `เกิดข้อผิดพลาด: ${err.message}`;
      }
    }
  }

  async function testAdminAlert() {
    const statusEl = $('adminAlertTestStatus');
    const adminLineUserId = $('settingAdminLineUserInput') ? $('settingAdminLineUserInput').value.trim() : '';
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.style.color = 'var(--color-accent)';
      statusEl.textContent = '⏳ กำลังส่งข้อความทดสอบแจ้งเตือนเข้า LINE แอดมิน...';
    }
    try {
      const res = await fetch('/api/admin/line/test-admin-alert', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ adminLineUserId })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'ส่งแจ้งเตือนไม่สำเร็จ');
      if (statusEl) {
        statusEl.style.color = '#68D391';
        statusEl.textContent = '✔ ส่งข้อความแจ้งเตือนเข้า LINE แอดมินสำเร็จเรียบร้อย!';
      }
      window.UI.toast('ส่งการแจ้งเตือนเข้า LINE แอดมินสำเร็จ!');
    } catch (err) {
      if (statusEl) {
        statusEl.style.color = '#FF6B6B';
        statusEl.textContent = `❌ เกิดข้อผิดพลาด: ${err.message}`;
      }
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

  function getDeletedEventIds() {
    try {
      const raw = localStorage.getItem('thaiticket.deletedEventIds.v1');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.map(Number).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  function markDeletedEventId(id) {
    const numId = Number(id);
    if (!numId) return;
    try {
      const set = new Set(getDeletedEventIds());
      set.add(numId);
      localStorage.setItem('thaiticket.deletedEventIds.v1', JSON.stringify(Array.from(set)));
    } catch {
      /* ignore */
    }
  }

  function unmarkDeletedEventId(id) {
    const numId = Number(id);
    if (!numId) return;
    try {
      const filtered = getDeletedEventIds().filter((x) => x !== numId);
      localStorage.setItem('thaiticket.deletedEventIds.v1', JSON.stringify(filtered));
    } catch {
      /* ignore */
    }
  }

  function filterDeletedEvents(events) {
    const deletedSet = new Set(getDeletedEventIds());
    return (Array.isArray(events) ? events : []).filter((ev) => ev && !deletedSet.has(Number(ev.id)));
  }

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
    if ($('deleteEventBtn')) $('deleteEventBtn').hidden = true;
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
        <div class="zone-chip" style="cursor:pointer; gap:10px;" data-edit-event-id="${ev.id}">
          <div style="flex:1;">
            <div style="font-weight:700; color:#fff;">${esc(ev.title)}</div>
            <div class="text-muted" style="font-size:12px;">${esc(ev.date)} · ${esc(ev.venue)}</div>
            <div style="font-size:11px; color:var(--color-accent); margin-top:2px;">
              คงเหลือรวม ${ev.remainingTotal}/${ev.totalQuota} ที่นั่ง (VIP:${ev.remainingVip}/${ev.quotaVip} · A:${ev.remainingA}/${ev.quotaA} · B:${ev.remainingB}/${ev.quotaB} · C:${ev.remainingC}/${ev.quotaC})
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
            <button type="button" class="btn-outline btn-sm" data-edit-event-btn="${ev.id}">แก้ไขโควตา</button>
            <button type="button" class="btn-outline btn-sm" data-delete-event-id="${ev.id}" style="border-color:rgba(255,107,107,0.45); color:#FF6B6B;">🗑️ ลบ</button>
          </div>
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
        adminEventsCache = filterDeletedEvents(data.events || []);
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
      if (id) unmarkDeletedEventId(id);
      adminEventsCache = filterDeletedEvents(data.events || []);
      try {
        localStorage.setItem('thaiticket.customEvents.v1', JSON.stringify(adminEventsCache));
      } catch {
        /* ignore */
      }
      renderAdminEvents();
      resetEventForm();
      window.UI.toast('บันทึกข้อมูลคอนเสิร์ตและโควตาที่นั่งเรียบร้อยแล้ว');
    } catch (err) {
      window.UI.toast(err.message, 'error');
    } finally {
      $('saveEventBtn').disabled = false;
    }
  }

  async function deleteAdminEvent(targetId) {
    const id = Number(targetId || ($('evIdInput') && $('evIdInput').value));
    if (!id) {
      window.UI.toast('กรุณาเลือกคอนเสิร์ตที่ต้องการลบ', 'error');
      return;
    }
    const targetEv = adminEventsCache.find((x) => Number(x.id) === id);
    const titleLabel = targetEv ? targetEv.title : `#${id}`;
    if ($('deleteEventBtn')) $('deleteEventBtn').disabled = true;

    try {
      const res = await fetch('/api/admin/events/delete', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (data.unauthorized) {
        window.UI.close('eventManagerModal');
        showLoginModal();
        return;
      }
      if (!data.ok) throw new Error(data.error || 'ลบคอนเสิร์ตไม่สำเร็จ');
      markDeletedEventId(id);
      adminEventsCache = filterDeletedEvents(data.events || adminEventsCache.filter((x) => Number(x.id) !== id));
      try {
        localStorage.setItem('thaiticket.customEvents.v1', JSON.stringify(adminEventsCache));
      } catch {
        /* ignore */
      }
      renderAdminEvents();
      if (Number($('evIdInput').value) === id) {
        resetEventForm();
      }
      window.UI.toast(`ลบคอนเสิร์ต "${titleLabel}" เรียบร้อยแล้ว`);
    } catch (err) {
      window.UI.toast(err.message, 'error');
    } finally {
      if ($('deleteEventBtn')) $('deleteEventBtn').disabled = false;
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

  let soundEnabled = true;
  let lastKnownPendingCount = null;
  let livePollingTimer = null;

  function initSoundSetting() {
    try {
      const saved = localStorage.getItem('thaiticket.admin.sound');
      if (saved !== null) soundEnabled = saved === 'true';
    } catch {
      /* ignore */
    }
    updateSoundBtnUi();
  }

  function updateSoundBtnUi() {
    const btn = $('toggleSoundBtn');
    if (btn) {
      btn.innerHTML = soundEnabled ? '🔔 เสียงเตือน: เปิด' : '🔕 เสียงเตือน: ปิด';
      btn.style.color = soundEnabled ? '#68D391' : 'var(--color-muted)';
    }
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    try {
      localStorage.setItem('thaiticket.admin.sound', String(soundEnabled));
    } catch {
      /* ignore */
    }
    updateSoundBtnUi();
    if (soundEnabled) {
      playNewOrderSound();
      window.UI.toast('เปิดเสียงแจ้งเตือนคำสั่งซื้อใหม่แล้ว');
    } else {
      window.UI.toast('ปิดเสียงแจ้งเตือนแล้ว');
    }
  }

  function playNewOrderSound() {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const playTone = (freq, start, duration) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
        gain.gain.setValueAtTime(0.25, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + duration);
      };
      // Chime: D5 (587.33Hz) then A5 (880.00Hz)
      playTone(587.33, 0, 0.22);
      playTone(880.00, 0.16, 0.45);
    } catch {
      /* ignore audio error */
    }
  }

  async function requestBrowserNotification() {
    if (!('Notification' in window)) {
      window.UI.toast('เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือนหน้าจอ', 'error');
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      updateNotifyBtnUi();
      if (perm === 'granted') {
        window.UI.toast('เปิดการแจ้งเตือนหน้าจอสำเร็จ');
        new Notification('🔔 Thai Ticket Hub', {
          body: 'เปิดระบบแจ้งเตือนคำสั่งซื้อสลิปใหม่บนหน้าจอเรียบร้อย!',
          icon: '/favicon.ico'
        });
      } else {
        window.UI.toast('การแจ้งเตือนถูกปิดกั้นในเบราว์เซอร์', 'error');
      }
    } catch {
      /* ignore */
    }
  }

  function updateNotifyBtnUi() {
    const btn = $('requestNotifyBtn');
    if (!btn || !('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      btn.innerHTML = '📲 แจ้งเตือนหน้าจอ: เปิดแล้ว';
      btn.style.color = '#68D391';
    } else {
      btn.innerHTML = '📲 เปิดแจ้งเตือนหน้าจอ';
      btn.style.color = '';
    }
  }

  let lastKnownTotalOrders = null;

  function startLivePolling() {
    if (livePollingTimer) clearInterval(livePollingTimer);
    window.addEventListener('storage', (e) => {
      if (e.key === 'thaiticket.tickets.v1') {
        loadOrders();
        loadStats();
      }
    });
    livePollingTimer = setInterval(async () => {
      const loginModal = $('adminLoginModal');
      if (loginModal && loginModal.classList.contains('active')) return;
      try {
        await syncLocalClientTickets();
        const res = await fetch('/api/admin/stats', {
          headers: getAuthHeaders()
        });
        const data = await res.json();
        if (data && !data.unauthorized) {
          const newPending = Number(data.pendingCount ?? data.pending ?? 0);
          const newTotal = Number(data.totalOrders ?? 0);
          if (lastKnownPendingCount !== null && newPending > lastKnownPendingCount) {
            const diff = newPending - lastKnownPendingCount;
            playNewOrderSound();
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification('🔔 มีคำสั่งซื้อใหม่รอตรวจสลิป!', {
                body: `มีรายการสั่งซื้อใหม่เข้ามา ${diff} รายการ (รอตรวจทั้งหมด: ${newPending} รายการ)`,
                icon: '/favicon.ico'
              });
            }
            window.UI.toast(`🔔 มีคำสั่งซื้อใหม่เข้ามา ${diff} รายการ! กรุณาตรวจสอบสลิป`, 'info');
            const kpi = $('kpiPending');
            if (kpi) {
              kpi.style.transition = 'transform 0.3s, color 0.3s';
              kpi.style.transform = 'scale(1.25)';
              kpi.style.color = '#FF6B6B';
              setTimeout(() => {
                kpi.style.transform = '';
                kpi.style.color = '';
              }, 1200);
            }
            await loadOrders();
          } else if (lastKnownTotalOrders !== null && newTotal !== lastKnownTotalOrders) {
            await loadOrders();
          } else if (!ordersCache.length && newTotal > 0) {
            await loadOrders();
          }
          lastKnownPendingCount = newPending;
          lastKnownTotalOrders = newTotal;
          await loadStats();
        }
      } catch {
        /* ignore */
      }
    }, 5000);
  }

  function bind() {
    document.querySelectorAll('.filter-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.status;
        selectedOrderRefs.clear();
        loadOrders();
      });
    });

    $('adminOrdersList').addEventListener('change', (e) => {
      const cb = e.target.closest('[data-select-ref]');
      if (!cb) return;
      const ref = cb.dataset.selectRef;
      if (cb.checked) selectedOrderRefs.add(ref);
      else selectedOrderRefs.delete(ref);
      updateBulkSelectionUi();
    });

    if ($('selectAllOrdersCheckbox')) {
      $('selectAllOrdersCheckbox').addEventListener('change', (e) => {
        if (e.target.checked) {
          ordersCache.forEach((o) => selectedOrderRefs.add(o.ref));
        } else {
          selectedOrderRefs.clear();
        }
        document.querySelectorAll('.order-select-checkbox').forEach((cb) => {
          cb.checked = e.target.checked;
        });
        updateBulkSelectionUi();
      });
    }

    if ($('bulkApproveBtn')) {
      $('bulkApproveBtn').addEventListener('click', () => runBulkOrderAction('approve'));
    }
    if ($('bulkCheckInBtn')) {
      $('bulkCheckInBtn').addEventListener('click', () => runBulkOrderAction('checkin'));
    }
    if ($('bulkDeleteBtn')) {
      $('bulkDeleteBtn').addEventListener('click', () => runBulkOrderAction('delete'));
    }

    $('adminOrdersList').addEventListener('click', (e) => {
      if (e.target.closest('[data-select-ref]')) return;
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const ref = target.dataset.ref;
      const action = target.dataset.action;
      const order = ordersCache.find((o) => o.ref === ref);
      if (!order) return;

      if (action === 'approve') approveOrder(ref, target);
      else if (action === 'reject') openRejectModal(ref);
      else if (action === 'delete') deleteOrder(ref, target);
      else if (action === 'zoom-slip') openSlipZoom(order);
      else if (action === 'preview-line') openLinePreview(order);
      else if (action === 'resend-line') resendLine(ref, target);
      else if (action === 'scan-ticket') openScannerModal(ref);
    });

    $('adminLoginBtn').addEventListener('click', loginAdmin);
    $('adminPinInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loginAdmin();
    });
    if ($('fillAdminPinBtn')) {
      $('fillAdminPinBtn').addEventListener('click', () => {
        $('adminPinInput').value = '123456';
        $('adminPinInput').focus();
      });
    }
    if ($('fillStaffPinBtn')) {
      $('fillStaffPinBtn').addEventListener('click', () => {
        $('adminPinInput').value = '888888';
        $('adminPinInput').focus();
      });
    }
    if ($('adminLogoutBtn')) {
      $('adminLogoutBtn').addEventListener('click', logoutAdmin);
    }

    $('openScannerBtn').addEventListener('click', () => openScannerModal());
    $('closeScannerBtn').addEventListener('click', closeScannerModal);
    if ($('openGateMonitorBtn')) {
      $('openGateMonitorBtn').addEventListener('click', openGateMonitorModal);
    }
    if ($('openGateMonitorFromScannerBtn')) {
      $('openGateMonitorFromScannerBtn').addEventListener('click', () => {
        closeScannerModal();
        openGateMonitorModal();
      });
    }
    if ($('refreshGateMonitorBtn')) {
      $('refreshGateMonitorBtn').addEventListener('click', () => {
        loadGateMonitorData();
        window.UI.toast('อัปเดตข้อมูลมอนิเตอร์ประตูเรียบร้อยแล้ว');
      });
    }
    if ($('switchToScannerFromMonitorBtn')) {
      $('switchToScannerFromMonitorBtn').addEventListener('click', () => {
        window.UI.close('gateMonitorModal');
        openScannerModal();
      });
    }
    if ($('closeGateMonitorBtn')) {
      $('closeGateMonitorBtn').addEventListener('click', () => window.UI.close('gateMonitorModal'));
    }
    if ($('cameraDeviceSelect')) {
      $('cameraDeviceSelect').addEventListener('change', (e) => startCameraScanner(e.target.value));
    }
    if ($('btnSwitchCamera')) {
      $('btnSwitchCamera').addEventListener('click', switchCameraDevice);
    }
    if ($('btnToggleCameraFeed')) {
      $('btnToggleCameraFeed').addEventListener('click', toggleCameraFeed);
    }
    if ($('btnToggleTorch')) {
      $('btnToggleTorch').addEventListener('click', toggleTorch);
    }
    if ($('btnToggleGateVoice')) {
      $('btnToggleGateVoice').addEventListener('click', toggleGateVoice);
    }
    if ($('btnDownloadOfflineRoster')) {
      $('btnDownloadOfflineRoster').addEventListener('click', downloadOfflineRoster);
    }
    if ($('btnSyncOfflineQueue')) {
      $('btnSyncOfflineQueue').addEventListener('click', syncOfflineQueue);
    }
    window.addEventListener('online', () => {
      updateOfflineUi();
      syncOfflineQueue();
    });
    window.addEventListener('offline', updateOfflineUi);
    const scannerModalEl = $('gateScannerModal');
    if (scannerModalEl) {
      const observer = new MutationObserver(() => {
        if (!scannerModalEl.classList.contains('active')) {
          stopCameraScanner();
        }
      });
      observer.observe(scannerModalEl, { attributes: true, attributeFilter: ['class'] });
    }
    $('submitScanBtn').addEventListener('click', submitCheckIn);
    $('scanCodeInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitCheckIn();
    });
    $('quickScanChips').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-scan-ref]');
      if (!chip) return;
      $('scanCodeInput').value = chip.dataset.scanPayload || `THAITICKET|${chip.dataset.scanRef}`;
      submitCheckIn();
    });
    if ($('testTamperedQrBtn')) {
      $('testTamperedQrBtn').addEventListener('click', testTamperedQrScan);
    }

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
    if ($('deleteEventBtn')) {
      $('deleteEventBtn').addEventListener('click', () => deleteAdminEvent());
    }
    if ($('adminEventsList')) {
      $('adminEventsList').addEventListener('click', (e) => {
        const delBtn = e.target.closest('[data-delete-event-id]');
        if (delBtn) {
          e.stopPropagation();
          deleteAdminEvent(Number(delBtn.dataset.deleteEventId));
          return;
        }
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
        if ($('deleteEventBtn')) $('deleteEventBtn').hidden = false;
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

    if ($('openAnalyticsBtn')) {
      $('openAnalyticsBtn').addEventListener('click', openAnalyticsModal);
    }
    if ($('printSettlementBtn')) {
      $('printSettlementBtn').addEventListener('click', printSettlementReport);
    }
    if ($('closeAnalyticsModalBtn')) {
      $('closeAnalyticsModalBtn').addEventListener('click', () => window.UI.close('analyticsModal'));
    }
    if ($('openLinePreviewNavBtn')) {
      $('openLinePreviewNavBtn').addEventListener('click', () => openLinePreview());
    }
    if ($('copyLineFlexJsonBtn')) {
      $('copyLineFlexJsonBtn').addEventListener('click', copyLineFlexJson);
    }

    $('closeSlipZoomBtn').addEventListener('click', () => window.UI.close('slipZoomModal'));
    if ($('btnZoomIn')) {
      $('btnZoomIn').addEventListener('click', () => {
        slipZoomScale = Math.min(3, slipZoomScale + 0.25);
        updateSlipTransform();
      });
    }
    if ($('btnZoomOut')) {
      $('btnZoomOut').addEventListener('click', () => {
        slipZoomScale = Math.max(0.5, slipZoomScale - 0.25);
        updateSlipTransform();
      });
    }
    if ($('btnZoomReset')) {
      $('btnZoomReset').addEventListener('click', () => {
        slipZoomScale = 1;
        slipZoomRotate = 0;
        updateSlipTransform();
      });
    }
    if ($('btnRotateSlip')) {
      $('btnRotateSlip').addEventListener('click', () => {
        slipZoomRotate = (slipZoomRotate + 90) % 360;
        updateSlipTransform();
      });
    }
    if ($('btnTestDrive')) {
      $('btnTestDrive').addEventListener('click', testDriveConnection);
    }
    if ($('btnTestSlip')) {
      $('btnTestSlip').addEventListener('click', testSlipVerification);
    }
    if ($('btnTestAdminAlert')) {
      $('btnTestAdminAlert').addEventListener('click', testAdminAlert);
    }
    if ($('toggleSoundBtn')) {
      $('toggleSoundBtn').addEventListener('click', toggleSound);
    }
    if ($('requestNotifyBtn')) {
      $('requestNotifyBtn').addEventListener('click', requestBrowserNotification);
    }

    $('closeAdminLinePreviewBtn').addEventListener('click', () => window.UI.close('adminLinePreviewModal'));
    $('refreshAdminBtn').addEventListener('click', () => {
      loadStats();
      loadOrders();
      window.UI.toast('อัปเดตข้อมูลล่าสุดแล้ว');
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bind();
    initSoundSetting();
    updateNotifyBtnUi();
    checkAdminSession();
    startLivePolling();
    loadOfflineStorage();
  });
})();
