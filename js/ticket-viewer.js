/**
 * E-ticket viewer (save / share / LINE OA preview / live pending status polling)
 * and "บัตรของฉัน" list synced with backend.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  let current = null;
  let currentBlob = null;
  let pollTimer = null;
  let securityTimer = null;

  function fileName(t) {
    return `ticket-${t.ref}.png`;
  }

  function computeLiveToken(ref, windowSlot) {
    const str = `${ref || 'TT'}:${windowSlot}`;
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const num = Math.abs(h) % 900000 + 100000;
    const s = String(num);
    return `TOKEN #${s.slice(0, 3)}-${s.slice(3)}`;
  }

  function tickSecurityBar() {
    if (!current || current.status !== 'approved') return;
    const now = new Date();
    const secInWindow = 30 - (Math.floor(now.getTime() / 1000) % 30);
    const slot = Math.floor(now.getTime() / 30000);
    if ($('liveSecurityToken')) {
      $('liveSecurityToken').textContent = computeLiveToken(current.ref, slot);
    }
    if ($('liveSecurityClock')) {
      $('liveSecurityClock').textContent = `เวลาปัจจุบัน: ${now.toLocaleTimeString('th-TH')}`;
    }
    if ($('liveSecurityCountdown')) {
      $('liveSecurityCountdown').textContent = String(secInWindow);
    }
    if ($('liveSecurityFill')) {
      $('liveSecurityFill').style.width = `${Math.round((secInWindow / 30) * 100)}%`;
    }
  }

  function startSecurityTicker(ticket) {
    if (securityTimer) {
      clearInterval(securityTimer);
      securityTimer = null;
    }
    const bar = $('liveTicketSecurityBar');
    if (!bar) return;
    if (ticket && ticket.status === 'approved') {
      bar.hidden = false;
      tickSecurityBar();
      securityTimer = setInterval(tickSecurityBar, 1000);
    } else {
      bar.hidden = true;
    }
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (securityTimer) {
      clearInterval(securityTimer);
      securityTimer = null;
    }
  }

  function updateStatusBanner(ticket) {
    const banner = $('ticketStatusBanner');
    if (!banner) return;
    const esc = window.UI.escapeHtml;
    startSecurityTicker(ticket);

    if (ticket.status === 'pending') {
      banner.className = 'ticket-status-banner is-pending';
      banner.innerHTML = `
        <div>
          <strong>รอแอดมินตรวจสอบสลิป</strong>
          <p>เมื่อแอดมินตรวจสอบยอดเงินและอนุมัติแล้ว บัตร E-Ticket จะถูกจัดส่งตรงเข้า LINE Official Account ของท่านทันที</p>
        </div>
      `;
      banner.hidden = false;
    } else if (ticket.status === 'rejected') {
      banner.className = 'ticket-status-banner is-rejected';
      banner.innerHTML = `
        <div>
          <strong>สลิปไม่ผ่านการอนุมัติ</strong>
          <p>เหตุผล: ${esc(ticket.rejectReason || 'ข้อมูลสลิปไม่ถูกต้อง')}</p>
        </div>
      `;
      banner.hidden = false;
    } else {
      const lineNote =
        ticket.lineSent === 1
          ? 'ส่งบัตรเข้า LINE Official Account สำเร็จแล้ว'
          : 'อนุมัติแล้ว · พร้อมบันทึกบัตรและส่งผ่าน LINE OA';
      banner.className = 'ticket-status-banner is-approved';
      banner.innerHTML = `
        <div>
          <strong>อนุมัติการชำระเงินเรียบร้อย</strong>
          <p>${esc(lineNote)}</p>
        </div>
        <button type="button" class="btn-outline btn-sm" id="ticketLinePreviewBtn">ดูข้อความ LINE OA</button>
      `;
      banner.hidden = false;
      const lineBtn = $('ticketLinePreviewBtn');
      if (lineBtn) lineBtn.addEventListener('click', () => showLinePreview(ticket));
    }
  }

  function showLinePreview(ticket) {
    const box = $('linePreviewBody');
    if (!box) return;
    const esc = window.UI.escapeHtml;
    const modeLabel =
      ticket.lineSent === 1
        ? '<span class="badge-accent">ส่งเข้า LINE จริงสำเร็จ (Messaging API)</span>'
        : '<span class="badge-accent">ตัวอย่าง LINE Flex Message (พร้อมส่งเมื่อใส่ Channel Access Token)</span>';

    const rawId = String(ticket.holderIdCard || '').trim();
    const idDigits = rawId.replace(/\D/g, '');
    const maskedId = idDigits.length === 13
      ? `${idDigits.slice(0, 1)}-${idDigits.slice(1, 5)}-xxxxx-xx-${idDigits.slice(12)}`
      : (rawId.length >= 7 ? `${rawId.slice(0, 2)}***${rawId.slice(-3)}` : (rawId || '-'));

    box.innerHTML = `
      <div style="margin-bottom:12px;">${modeLabel}</div>
      <div class="line-flex-card">
        <div class="line-flex-header">
          <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700;">
            <span style="color:#B40000;">THAI TICKET</span>
            <span style="color:#229BFF;">E-TICKET</span>
          </div>
          <div style="font-size:16px;font-weight:700;color:#fff;margin-top:6px;">${esc(ticket.title)}</div>
          <div style="font-size:12px;color:#ccc;margin-top:2px;">${esc(ticket.date)} · ${esc(ticket.venue)}</div>
        </div>
        <div class="line-flex-body">
          <div class="line-flex-row">
            <div><small>ผู้ถือบัตร</small><strong>${esc(ticket.holderName || '-')}</strong></div>
            <div><small>เบอร์โทรศัพท์</small><strong>${esc(ticket.holderPhone || '-')}</strong></div>
          </div>
          <div class="line-flex-row">
            <div><small>เลขบัตร ปชช. / Passport</small><strong>${esc(maskedId)}</strong></div>
            <div><small>โซนที่นั่ง</small><strong>${esc(ticket.zone)}</strong></div>
          </div>
          <div class="line-flex-row">
            <div><small>จำนวน / ยอดชำระ</small><strong style="color:#229BFF;">${ticket.qty} ใบ (${Number(ticket.total).toLocaleString('th-TH')} THB)</strong></div>
          </div>
          <div class="line-flex-ref">
            <small>รหัสการจอง (แสดงหน้างาน)</small>
            <strong>${esc(ticket.ref)}</strong>
            <div style="font-size:11px;color:#68D391;margin-top:2px;">🟢 ชำระเงิน & อนุมัติสิทธิ์เรียบร้อย</div>
          </div>
          <div style="margin-top:14px;background:#181818;border-radius:10px;padding:14px;text-align:center;border:1px solid rgba(255,255,255,0.08);">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=10&data=${encodeURIComponent(ticket.qrPayload || ('THAITICKET|' + ticket.ref))}" alt="QR Code สแกนเข้างาน" style="width:160px;height:160px;display:block;margin:0 auto;border-radius:6px;background:#fff;padding:6px;">
            <p style="font-size:11px;color:#68D391;margin-top:8px;font-weight:700;">📷 ยื่น QR Code นี้ที่จุดตรวจเพื่อสแกนเข้างาน</p>
            <p style="font-size:10px;color:#888;margin:0;">🔐 ลายเซ็นดิจิทัล HMAC-SHA256 ป้องกันบัตรปลอม</p>
          </div>
          <div style="margin-top:14px;">
            <a href="ticket.html?ref=${encodeURIComponent(ticket.ref)}" target="_blank" class="btn-primary btn-block" style="text-align:center;text-decoration:none;font-size:13px;display:block;padding:10px;">🎫 เปิดดูบัตรจริง & Dynamic Pass</a>
          </div>
        </div>
      </div>
    `;
    window.UI.open('linePreviewModal');
  }

  async function renderTicketCanvas(ticket) {
    const isApproved = ticket.status === 'approved' || !ticket.status;
    $('ticketSaveBtn').disabled = true;
    $('ticketShareBtn').hidden = true;

    try {
      const canvas = await window.TicketRenderer.render(ticket);
      currentBlob = await window.TicketRenderer.canvasToBlob(canvas);
      if (!current || current.ref !== ticket.ref) return;
      const img = $('ticketImage');
      if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
      img.dataset.url = URL.createObjectURL(currentBlob);
      img.src = img.dataset.url;
      img.alt = `บัตร ${ticket.title} หมายเลข ${ticket.ref}`;
      img.hidden = false;
      $('ticketSkeleton').hidden = true;

      // Unlock Save button once approved
      $('ticketSaveBtn').disabled = !isApproved;
      $('ticketSaveBtn').innerHTML = isApproved
        ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> บันทึกบัตร`
        : 'รอแอดมินอนุมัติสลิปก่อนบันทึกบัตร';

      if (isApproved) {
        const file = new File([currentBlob], fileName(ticket), { type: 'image/png' });
        $('ticketShareBtn').hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
      }
    } catch {
      $('ticketSkeleton').hidden = true;
      window.UI.toast('สร้างภาพบัตรไม่สำเร็จ กรุณาลองใหม่', 'error');
    }
  }

  async function show(ticketInput) {
    stopPolling();
    const latest = (await window.TicketStore.fetchOne(ticketInput.ref)) || ticketInput;
    current = latest;
    currentBlob = null;
    $('ticketImage').hidden = true;
    $('ticketSkeleton').hidden = false;
    $('ticketRefLabel').textContent = `${latest.ref} · ${latest.holderName || ''}`;
    updateStatusBanner(latest);
    window.UI.open('ticketModal');

    await renderTicketCanvas(latest);

    if (latest.status === 'pending') {
      pollTimer = setInterval(async () => {
        const modal = $('ticketModal');
        if (!modal || !modal.classList.contains('active') || !current) {
          stopPolling();
          return;
        }
        const refreshed = await window.TicketStore.fetchOne(current.ref);
        if (refreshed && refreshed.status !== current.status) {
          current = refreshed;
          updateStatusBanner(refreshed);
          await renderTicketCanvas(refreshed);
          document.dispatchEvent(new CustomEvent('tickets:changed'));
          if (refreshed.status === 'approved') {
            window.UI.toast('แอดมินอนุมัติสลิปแล้ว! กดบันทึกบัตรได้เลย');
            stopPolling();
          } else if (refreshed.status === 'rejected') {
            window.UI.toast('สลิปไม่ผ่านการอนุมัติ', 'error');
            stopPolling();
          }
        }
      }, 2000);
    }
  }

  function save() {
    if (!currentBlob || !current || (current.status && current.status !== 'approved')) return;
    const a = document.createElement('a');
    a.href = $('ticketImage').dataset.url;
    a.download = fileName(current);
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.UI.toast(`บันทึกบัตร ${current.ref} แล้ว`);
  }

  async function share() {
    if (!currentBlob || !current) return;
    const file = new File([currentBlob], fileName(current), { type: 'image/png' });
    try {
      await navigator.share({ files: [file], title: current.title });
    } catch (err) {
      if (err.name !== 'AbortError') window.UI.toast('แชร์ไม่สำเร็จ ใช้ปุ่มบันทึกแทนได้', 'error');
    }
  }

  function statusBadgeHtml(status) {
    if (status === 'pending') return '<span class="badge-pending">รอตรวจสอบสลิป (จะส่งเข้า LINE OA เมื่ออนุมัติ)</span>';
    if (status === 'rejected') return '<span class="badge-rejected">สลิปไม่ผ่าน</span>';
    return '<span class="badge-accent">🟢 ส่งบัตรเข้า LINE OA แล้ว</span>';
  }

  async function renderList() {
    const box = $('myTicketsList');
    box.innerHTML = `<div class="empty-state"><p class="text-muted">กำลังซิงค์ข้อมูลบัตรล่าสุด...</p></div>`;
    const list = await window.TicketStore.syncAll();
    document.dispatchEvent(new CustomEvent('tickets:changed'));

    const bannerHtml = `
      <div style="background:rgba(34,155,255,0.08);border:1px solid rgba(34,155,255,0.25);border-radius:10px;padding:12px;margin-bottom:14px;font-size:12px;line-height:1.5;">
        🛡️ <strong>นโยบายจัดส่งบัตรเข้า LINE OA เท่านั้น:</strong> บัตรคอนเสิร์ต E-Ticket และ QR Code เข้างาน จะถูกจัดส่งตรงเข้า <strong>LINE Official Account (@thaiticket)</strong> ของผู้ซื้อเท่านั้น เพื่อความปลอดภัยสูงสุดและป้องกันการสวมสิทธิ์
      </div>
    `;

    if (!list.length) {
      box.innerHTML = `
        ${bannerHtml}
        <div class="empty-state">
          <p class="empty-title">ยังไม่มีรายการบัตรในระบบ</p>
          <p class="text-muted">เลือกคอนเสิร์ตและแนบสลิปชำระเงิน บัตรจะถูกส่งเข้า LINE OA ของท่านทันทีหลังอนุมัติ</p>
        </div>`;
      return;
    }
    const esc = window.UI.escapeHtml;
    box.innerHTML = bannerHtml + list
      .map(
        (t) => {
          const raw = String(t.holderIdCard || '').trim();
          const idDigits = raw.replace(/\D/g, '');
          const masked = idDigits.length === 13
            ? `${idDigits.slice(0, 1)}-${idDigits.slice(1, 5)}-xxxxx-xx-${idDigits.slice(12)}`
            : (raw.length >= 7 ? `${raw.slice(0, 2)}***${raw.slice(-3)}` : (raw || '-'));
          const isApproved = t.status === 'approved' || !t.status;
          return `
          <article class="my-ticket">
            <div class="my-ticket-main">
              ${statusBadgeHtml(t.status)}
              <h4 class="my-ticket-title">${esc(t.title)}</h4>
              <p class="text-muted">${esc(t.date)} · ${esc(t.zone)} · ${t.qty} ใบ</p>
              <p class="text-muted">ผู้ถือบัตร: ${esc(t.holderName || '-')} (${esc(t.holderPhone || '-')}) · ปชช.: ${esc(masked)}</p>
              <p class="text-muted" style="font-size:11px;color:#68D391;">📲 LINE: ${esc(t.lineUserId || 'เชื่อมต่อกับ LINE OA')}</p>
              <p class="my-ticket-ref">${esc(t.ref)}</p>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;">
              <button class="btn-primary" data-ref="${esc(t.ref)}">${isApproved ? '🎫 ดูบัตร' : 'ดูสถานะ'}</button>
              ${isApproved ? `<a href="ticket.html?ref=${encodeURIComponent(t.ref)}" target="_blank" class="btn-outline btn-sm" style="text-align:center;text-decoration:none;">📱 Dynamic Pass</a>` : ''}
            </div>
          </article>`;
        }
      )
      .join('');
  }

  function openList() {
    renderList();
    window.UI.open('myTicketsModal');
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('ticketSaveBtn').addEventListener('click', save);
    $('ticketShareBtn').addEventListener('click', share);
    $('ticketCloseBtn').addEventListener('click', () => {
      stopPolling();
      window.UI.close('ticketModal');
    });
    $('ticketDoneBtn').addEventListener('click', () => {
      stopPolling();
      window.UI.close('ticketModal');
    });
    $('myTicketsCloseBtn').addEventListener('click', () => window.UI.close('myTicketsModal'));
    if ($('linePreviewCloseBtn')) {
      $('linePreviewCloseBtn').addEventListener('click', () => window.UI.close('linePreviewModal'));
    }
    $('myTicketsList').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-ref]');
      if (!btn) return;
      const t = window.TicketStore.get(btn.dataset.ref);
      if (t) {
        window.UI.close('myTicketsModal');
        show(t);
      }
    });
  });

  window.TicketViewer = { show, openList, showLinePreview };
})();
