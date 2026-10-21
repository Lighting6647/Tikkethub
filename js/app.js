/** Event listing, live zone quota sync, promo code calculation, and ticket holder validation. */
let eventsData = [
  { id: 1, title: 'ECHOES OF ASIA WORLD TOUR 2026', category: 'world', date: '14 - 15 พ.ย. 2026', venue: 'อิมแพ็ค อารีน่า เมืองทองธานี', priceRange: '1,800 - 6,500 THB', badge: 'เปิดจำหน่าย', isAccent: true, gradient: 'linear-gradient(135deg, #4d1313, #1f1f1f)', image: 'https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?auto=format&fit=crop&w=1200&q=80', remainingTotal: 420 },
  { id: 2, title: 'K-POP FESTIVAL LIVE IN BKK 2026', category: 'kpop', date: '28 พ.ย. 2026', venue: 'ราชมังคลากีฬาสถาน', priceRange: '2,200 - 7,000 THB', badge: 'บัตรเหลือน้อย', isAccent: true, gradient: 'linear-gradient(135deg, #1b3852, #181818)', image: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=1000&q=80', remainingTotal: 360 },
  { id: 3, title: 'THAI ROCK REVOLUTION 2026', category: 'thai', date: '5 ธ.ค. 2026', venue: 'ไบเทค บางนา (Hall 100)', priceRange: '1,200 - 3,500 THB', badge: 'จำหน่ายแล้ว 70%', isAccent: false, gradient: 'linear-gradient(135deg, #3d1c1c, #1f1f1f)', image: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=1000&q=80', remainingTotal: 395 },
  { id: 4, title: 'BIG MOUNTAIN INDIE CAMP 2026', category: 'fest', date: '12 - 13 ธ.ค. 2026', venue: 'The Ocean เขาใหญ่', priceRange: '1,500 - 2,800 THB', badge: 'EARLY BIRD', isAccent: true, gradient: 'linear-gradient(135deg, #19403a, #1a1a1a)', image: 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=1000&q=80', remainingTotal: 530 },
  { id: 5, title: 'PARK HYUNG-SIK ASIAN FAN MEETING', category: 'fanmeeting', date: '19 ธ.ค. 2026', venue: 'พารากอน ฮอลล์, สยามพารากอน', priceRange: '2,500 - 5,900 THB', badge: 'VIP สิทธิพิเศษ', isAccent: false, gradient: 'linear-gradient(135deg, #2b1f3d, #1c1c1c)', image: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=1000&q=80', remainingTotal: 310 },
  { id: 6, title: 'SYNTHWAVE & RETRO NIGHT BKK', category: 'world', date: '26 ธ.ค. 2026', venue: 'Union Hall, ยูเนี่ยน มอลล์', priceRange: '1,600 - 3,200 THB', badge: 'เปิดจำหน่าย', isAccent: true, gradient: 'linear-gradient(135deg, #44143a, #1a1a1a)', image: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&w=1000&q=80', remainingTotal: 340 }
];

const MAX_QTY = 4;
const HOLDER_KEY = 'thaiticket.holder.v1';
let currentCategory = 'all';
let searchQuery = '';
let selectedEvent = null;
let selectedZonePrice = 6500;
let selectedZoneName = 'VIP Standing';
let currentQty = 1;
let activePromo = null;

const ICON_CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>';
const ICON_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>';

function filterClientEvents(list) {
  let deletedIds = [];
  try {
    const raw = localStorage.getItem('thaiticket.deletedEventIds.v1');
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) deletedIds = parsed.map(Number).filter(Boolean);
  } catch {
    deletedIds = [];
  }
  const deletedSet = new Set(deletedIds);
  return (Array.isArray(list) ? list : []).filter((ev) => ev && !deletedSet.has(Number(ev.id)));
}

async function syncEventsFromServer() {
  try {
    const res = await fetch('/api/events', { cache: 'no-store' });
    const data = await res.json();
    if (data && data.ok && Array.isArray(data.events) && data.events.length) {
      eventsData = filterClientEvents(data.events);
      renderEvents();
    }
  } catch {
    eventsData = filterClientEvents(eventsData);
    renderEvents();
  }
}

function renderEvents() {
  const esc = UI.escapeHtml;
  const container = document.getElementById('eventsContainer');
  const q = searchQuery.toLowerCase();
  const activeEvents = filterClientEvents(eventsData);
  const filtered = activeEvents.filter(
    (ev) => (currentCategory === 'all' || ev.category === currentCategory) &&
      (ev.title.toLowerCase().includes(q) || ev.venue.toLowerCase().includes(q))
  );

  if (!filtered.length) {
    container.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><p>ไม่พบรายการคอนเสิร์ตที่ตรงกับคำค้นหาของคุณ</p></div>';
    return;
  }

  container.innerHTML = filtered.map((ev) => {
    const bgStyle = ev.image
      ? `background: linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.85) 100%), url('${esc(ev.image)}') center / cover no-repeat;`
      : `background:${ev.gradient};`;
    return `
    <div class="card event-card" data-event-id="${ev.id}">
      <div class="event-card-image" style="${bgStyle}">
        <div class="event-card-cover">${esc(ev.title)}</div>
        <div class="event-badge-tag"><span class="${ev.isAccent ? 'badge-accent' : 'badge-primary'}">${esc(ev.badge)}</span></div>
      </div>
      <div class="event-card-body">
        <h3 class="event-title">${esc(ev.title)}</h3>
        <div class="event-details">
          <div class="event-detail-item">${ICON_CAL}<span>${esc(ev.date)}</span></div>
          <div class="event-detail-item">${ICON_PIN}<span>${esc(ev.venue)}</span></div>
          ${ev.remainingTotal !== undefined ? `<div class="event-detail-item"><span style="color:var(--color-accent);font-size:12px;font-weight:600;">🎟️ บัตรคงเหลือ ${Number(ev.remainingTotal).toLocaleString('th-TH')} ที่นั่ง</span></div>` : ''}
        </div>
        <div class="event-price-box">
          <div>
            <span class="price-label">ราคาเริ่มต้น</span>
            <div class="price-value">${esc(ev.priceRange)}</div>
          </div>
          <button class="btn-primary" data-event-id="${ev.id}">ซื้อบัตร</button>
        </div>
      </div>
    </div>`;
  }).join('');

  if (window.GSAPThemeStudio && typeof window.GSAPThemeStudio.setupTiltCards === 'function') {
    window.GSAPThemeStudio.setupTiltCards();
  }
}

function filterCategory(cat, btn) {
  currentCategory = cat;
  document.querySelectorAll('.subnav-item button').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  renderEvents();
}

function validateThaiCitizenId(idStr) {
  if (!idStr) return false;
  const trimmed = String(idStr).trim();
  // Foreign passport: contains letters and has length 7-15
  if (/[a-zA-Z]/.test(trimmed)) {
    return trimmed.length >= 7 && trimmed.length <= 15;
  }
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length !== 13) return false;
  if (digits[0] === '0') return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(digits[i], 10) * (13 - i);
  }
  const checkDigit = (11 - (sum % 11)) % 10;
  return checkDigit === parseInt(digits[12], 10);
}

function formatPhoneInput(val) {
  const digits = String(val || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length === 0) return '';
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function formatIdCardInput(val) {
  const raw = String(val || '').trim();
  if (!raw) return '';
  // If it's alphanumeric/passport (contains letters)
  if (/[a-zA-Z]/.test(raw)) {
    return raw.toUpperCase().slice(0, 15);
  }
  const digits = raw.replace(/\D/g, '').slice(0, 13);
  let res = '';
  if (digits.length > 0) res += digits.substring(0, 1);
  if (digits.length > 1) res += '-' + digits.substring(1, 5);
  if (digits.length > 5) res += '-' + digits.substring(5, 10);
  if (digits.length > 10) res += '-' + digits.substring(10, 12);
  if (digits.length > 12) res += '-' + digits.substring(12, 13);
  return res;
}

function loadSavedHolder() {
  try {
    const raw = localStorage.getItem(HOLDER_KEY);
    const clearBtn = document.getElementById('clearSavedHolderBtn');
    const badgeEl = document.getElementById('savedHolderBadge');
    if (!raw) {
      if (clearBtn) clearBtn.hidden = true;
      if (badgeEl) badgeEl.hidden = true;
      return;
    }
    const saved = JSON.parse(raw);
    let loadedAny = false;
    const nameEl = document.getElementById('holderName');
    const phoneEl = document.getElementById('holderPhone');
    const idEl = document.getElementById('holderIdCard');
    const lineEl = document.getElementById('holderLineId');

    if (saved.holderName && nameEl && !nameEl.value) {
      nameEl.value = saved.holderName;
      loadedAny = true;
    }
    if (saved.holderPhone && phoneEl && !phoneEl.value) {
      phoneEl.value = formatPhoneInput(saved.holderPhone);
      loadedAny = true;
    }
    if (saved.holderIdCard && idEl && !idEl.value) {
      idEl.value = formatIdCardInput(saved.holderIdCard);
      loadedAny = true;
    }
    if (saved.lineUserId && lineEl && !lineEl.value) {
      lineEl.value = saved.lineUserId;
      loadedAny = true;
    }
    if (clearBtn) clearBtn.hidden = !loadedAny;
    if (badgeEl) badgeEl.hidden = !loadedAny;
  } catch {
    /* ignore */
  }
}

function clearSavedHolderInfo() {
  try {
    localStorage.removeItem(HOLDER_KEY);
  } catch {
    /* ignore */
  }
  const nameEl = document.getElementById('holderName');
  const phoneEl = document.getElementById('holderPhone');
  const idEl = document.getElementById('holderIdCard');
  const lineEl = document.getElementById('holderLineId');
  if (nameEl) nameEl.value = '';
  if (phoneEl) phoneEl.value = '';
  if (idEl) idEl.value = '';
  if (lineEl) lineEl.value = '';
  const clearBtn = document.getElementById('clearSavedHolderBtn');
  if (clearBtn) clearBtn.hidden = true;
  const badgeEl = document.getElementById('savedHolderBadge');
  if (badgeEl) badgeEl.hidden = true;
  if (window.UI && typeof window.UI.toast === 'function') {
    window.UI.toast('ล้างข้อมูลผู้ซื้อที่บันทึกไว้ในเครื่องเรียบร้อย');
  }
}

function getCurrentSubtotal() {
  const selectedSeatObjs = window.SeatMap ? window.SeatMap.getSelectedSeats() : [];
  return selectedSeatObjs.length
    ? selectedSeatObjs.reduce((sum, s) => sum + s.price, 0)
    : selectedZonePrice * currentQty;
}

function computeNetTotal() {
  const subtotal = getCurrentSubtotal();
  if (!activePromo) {
    return { subtotal, discountAmount: 0, netTotal: subtotal };
  }
  const discountAmount =
    activePromo.discountType === 'percent'
      ? Math.round((subtotal * activePromo.discountValue) / 100)
      : Math.min(subtotal - 1, Number(activePromo.discountValue));
  return {
    subtotal,
    discountAmount,
    netTotal: Math.max(1, subtotal - discountAmount)
  };
}

function openBookingModal(title, date, venue) {
  selectedEvent = { title, date, venue };
  document.getElementById('modalEventTitle').textContent = title;
  document.getElementById('modalEventVenue').textContent = `${venue} · ${date}`;
  currentQty = 1;
  activePromo = null;
  document.getElementById('ticketQty').textContent = currentQty;
  const errEl = document.getElementById('holderError');
  if (errEl) errEl.textContent = '';
  const promoInput = document.getElementById('promoCodeInput');
  if (promoInput) promoInput.value = '';
  const promoMsg = document.getElementById('promoStatusMsg');
  if (promoMsg) {
    promoMsg.hidden = true;
    promoMsg.textContent = '';
  }
  loadSavedHolder();
  setBookingMode('map');
  if (window.SeatMap && typeof window.SeatMap.syncStatuses === 'function') {
    window.SeatMap.syncStatuses();
  }
  const first = document.querySelector('.zone-btn');
  if (first) first.click();
  updatePriceDisplay();
  UI.open('bookingModal');
}

function closeBookingModal() {
  UI.close('bookingModal');
}

function selectZone(name, price, btn) {
  selectedZoneName = name;
  selectedZonePrice = price;
  document.querySelectorAll('.zone-btn').forEach((b) => b.classList.remove('selected'));
  btn.classList.add('selected');
  updatePriceDisplay();
}

function changeQty(delta) {
  const selectedSeats = window.SeatMap ? window.SeatMap.getSelectedSeats() : [];
  if (selectedSeats.length > 0) {
    // If user has picked seats on the map, adjust seat selection or inform user
    const nextQty = Math.min(MAX_QTY, Math.max(1, currentQty + delta));
    if (nextQty !== currentQty) {
      currentQty = nextQty;
      // Auto adjust selected seats to match requested quantity using active zone
      if (window.SeatMap) {
        window.SeatMap.autoSelectForZone(selectedZoneName, currentQty);
      }
    }
  } else {
    currentQty = Math.min(MAX_QTY, Math.max(1, currentQty + delta));
  }
  const qtyEl = document.getElementById('ticketQty');
  if (qtyEl) qtyEl.textContent = currentQty;
  updatePriceDisplay();
}

function updatePriceDisplay() {
  const { subtotal, discountAmount, netTotal } = computeNetTotal();
  const labelEl = document.getElementById('summaryPriceLabel');
  if (discountAmount > 0 && activePromo) {
    if (labelEl) {
      labelEl.innerHTML = `ยอดชำระสุทธิ <span style="color:var(--color-accent);">(ลด -${discountAmount.toLocaleString('th-TH')} THB จาก ${activePromo.code})</span>`;
    }
    document.getElementById('totalPriceDisplay').textContent = netTotal.toLocaleString('th-TH') + ' THB';
  } else {
    if (labelEl) labelEl.textContent = 'ยอดชำระสุทธิ';
    document.getElementById('totalPriceDisplay').textContent = subtotal.toLocaleString('th-TH') + ' THB';
  }
}

async function applyPromoCode() {
  const input = document.getElementById('promoCodeInput');
  const msgEl = document.getElementById('promoStatusMsg');
  const code = (input ? input.value : '').trim().toUpperCase();
  const subtotal = getCurrentSubtotal();

  if (!code) {
    activePromo = null;
    if (msgEl) {
      msgEl.hidden = false;
      msgEl.style.color = '#FF6B6B';
      msgEl.textContent = 'กรุณากรอกโค้ดส่วนลดก่อนกดใช้งาน';
    }
    updatePriceDisplay();
    return;
  }

  try {
    const res = await fetch('/api/promo/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, subtotal })
    });
    const data = await res.json();
    if (!data.ok) {
      activePromo = null;
      if (msgEl) {
        msgEl.hidden = false;
        msgEl.style.color = '#FF6B6B';
        msgEl.textContent = data.error || 'โค้ดส่วนลดไม่ถูกต้อง';
      }
      updatePriceDisplay();
      return;
    }
    activePromo = data;
    if (msgEl) {
      msgEl.hidden = false;
      msgEl.style.color = 'var(--color-accent)';
      msgEl.textContent = `✔ ใช้โค้ด ${data.code} สำเร็จ (${data.description}) · ลดทันที ${data.discountAmount.toLocaleString('th-TH')} THB`;
    }
    updatePriceDisplay();
    UI.toast(`ใช้โค้ดส่วนลด ${data.code} ลด ${data.discountAmount.toLocaleString('th-TH')} THB เรียบร้อย`);
  } catch {
    UI.toast('ไม่สามารถตรวจสอบโค้ดส่วนลดได้', 'error');
  }
}

function setBookingMode(mode) {
  const mapView = document.getElementById('seatMapView');
  const zoneView = document.getElementById('quickZoneView');
  const tabMap = document.getElementById('tabSeatMap');
  const tabZone = document.getElementById('tabQuickZone');
  if (!mapView || !zoneView) return;
  if (mode === 'map') {
    mapView.hidden = false;
    zoneView.hidden = true;
    if (tabMap) tabMap.classList.add('active');
    if (tabZone) tabZone.classList.remove('active');
    if (window.SeatMap) window.SeatMap.render('seatMapContainer');
  } else {
    mapView.hidden = true;
    zoneView.hidden = false;
    if (tabMap) tabMap.classList.remove('active');
    if (tabZone) tabZone.classList.add('active');
  }
}

function confirmBooking() {
  if (!selectedEvent) return;
  const nameEl = document.getElementById('holderName');
  const phoneEl = document.getElementById('holderPhone');
  const idEl = document.getElementById('holderIdCard');
  const lineEl = document.getElementById('holderLineId');
  const errEl = document.getElementById('holderError');

  [nameEl, phoneEl, idEl, lineEl].forEach((el) => el && el.classList.remove('input-error'));

  const holderName = (nameEl ? nameEl.value : '').trim();
  const holderPhone = (phoneEl ? phoneEl.value : '').trim();
  const holderIdCard = (idEl ? idEl.value : '').trim();
  const lineUserId = (lineEl ? lineEl.value : '').trim();
  const digits = holderPhone.replace(/\D/g, '');
  const idDigits = holderIdCard.replace(/\D/g, '');

  if (holderName.length < 2) {
    if (errEl) errEl.textContent = 'กรุณากรอกชื่อ-นามสกุลผู้ถือบัตร (บังคับใส่)';
    if (nameEl) {
      nameEl.classList.add('input-error');
      nameEl.focus();
    }
    return;
  }
  if (digits.length < 9 || digits.length > 10) {
    if (errEl) errEl.textContent = 'กรุณากรอกเบอร์โทรศัพท์ 9-10 หลักให้ถูกต้อง (บังคับใส่)';
    if (phoneEl) {
      phoneEl.classList.add('input-error');
      phoneEl.focus();
    }
    return;
  }
  if (!holderIdCard) {
    if (errEl) errEl.textContent = 'กรุณากรอกเลขประจำตัวประชาชน 13 หลัก หรือเลขพาสปอร์ต (บังคับใส่)';
    if (idEl) {
      idEl.classList.add('input-error');
      idEl.focus();
    }
    return;
  }
  if (/[a-zA-Z]/.test(holderIdCard)) {
    if (!validateThaiCitizenId(holderIdCard)) {
      if (errEl) errEl.textContent = 'เลขพาสปอร์ตต้องมีความยาว 7-15 ตัวอักษร (เช่น AA1234567)';
      if (idEl) {
        idEl.classList.add('input-error');
        idEl.focus();
      }
      return;
    }
  } else {
    if (idDigits.length !== 13) {
      if (errEl) errEl.textContent = 'กรุณากรอกเลขประจำตัวประชาชน 13 หลักให้ครบถ้วน (บังคับใส่)';
      if (idEl) {
        idEl.classList.add('input-error');
        idEl.focus();
      }
      return;
    }
    if (!validateThaiCitizenId(holderIdCard)) {
      if (errEl) errEl.textContent = 'เลขประจำตัวประชาชน 13 หลักไม่ถูกต้องตามสูตรคำนวณ Checksum ของกรมการปกครอง';
      if (idEl) {
        idEl.classList.add('input-error');
        idEl.focus();
      }
      return;
    }
  }
  if (!lineUserId) {
    if (errEl) errEl.textContent = 'กรุณากรอก LINE ID หรือกดปุ่มดึงรหัส LINE อัตโนมัติ (บังคับใส่ เพื่อรับบัตร)';
    if (lineEl) {
      lineEl.classList.add('input-error');
      lineEl.focus();
    }
    return;
  }
  if (errEl) errEl.textContent = '';

  const rememberCb = document.getElementById('rememberHolderCheckbox');
  const shouldRemember = !rememberCb || rememberCb.checked;
  try {
    if (shouldRemember) {
      localStorage.setItem(HOLDER_KEY, JSON.stringify({ holderName, holderPhone, holderIdCard, lineUserId }));
    } else {
      localStorage.removeItem(HOLDER_KEY);
    }
  } catch {
    /* ignore */
  }

  const seats = window.SeatMap ? window.SeatMap.getSelectedSeatCodes() : [];
  const { netTotal, discountAmount } = computeNetTotal();

  closeBookingModal();
  Checkout.start({
    ...selectedEvent,
    zone: selectedZoneName,
    unitPrice: selectedZonePrice,
    qty: currentQty,
    total: netTotal,
    promoCode: activePromo ? activePromo.code : '',
    discountAmount,
    seats,
    holderName,
    holderPhone,
    holderIdCard,
    lineUserId
  });
}

async function fetchLineIdFromWebhook() {
  const btn = document.getElementById('fetchLineIdBtn');
  const nameEl = document.getElementById('holderName');
  const lineEl = document.getElementById('holderLineId');
  const hintEl = document.getElementById('lineWebhookHint');
  const displayName = (nameEl && nameEl.value.trim()) || 'ลูกค้า Thai Ticket';

  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/line/simulate-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName, text: 'บัตร' })
    });
    const data = await res.json();
    const userId = (data.contact && data.contact.userId) || data.userId;
    const contactName = (data.contact && data.contact.displayName) || data.displayName || displayName;
    if (data && data.ok && userId && lineEl) {
      lineEl.value = userId;
      if (hintEl) {
        hintEl.innerHTML = `<span style="color:var(--color-accent);">✔ เชื่อมต่อ LINE OA สำเร็จ (${UI.escapeHtml(contactName)} · ${UI.escapeHtml(userId.slice(0, 12))}…)</span>`;
      }
      UI.toast('ดึงรหัส LINE User ID จาก LINE OA Webhook เรียบร้อยแล้ว');
    }
  } catch {
    UI.toast('ไม่สามารถดึงรหัส LINE อัตโนมัติได้ กรุณาลองอีกครั้ง', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function scrollToEvents() {
  document.getElementById('eventsSection').scrollIntoView({ behavior: 'smooth' });
}

function refreshCartCount() {
  document.getElementById('cartCount').textContent = TicketStore.count();
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('searchInput').addEventListener('input', (e) => {
      searchQuery = e.target.value.trim();
      renderEvents();
    });
    document.getElementById('eventsContainer').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-event-id]');
      if (!btn) return;
      const ev = eventsData.find((x) => x.id === Number(btn.dataset.eventId));
      if (ev) openBookingModal(ev.title, ev.date, ev.venue);
    });
    document.getElementById('cartButton').addEventListener('click', () => TicketViewer.openList());
    document.addEventListener('tickets:changed', () => {
      refreshCartCount();
      syncEventsFromServer();
    });
    const idCardInput = document.getElementById('holderIdCard');
    if (idCardInput) {
      idCardInput.addEventListener('input', (e) => {
        e.target.value = formatIdCardInput(e.target.value);
      });
    }
    const phoneInput = document.getElementById('holderPhone');
    if (phoneInput) {
      phoneInput.addEventListener('input', (e) => {
        e.target.value = formatPhoneInput(e.target.value);
      });
    }
    ['holderName', 'holderPhone', 'holderIdCard', 'holderLineId'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          el.classList.remove('input-error');
          const errEl = document.getElementById('holderError');
          if (errEl) errEl.textContent = '';
        });
      }
    });
    if (window.SeatMap && typeof window.SeatMap.onChange === 'function') {
      window.SeatMap.onChange((selectedSeats) => {
        if (selectedSeats && selectedSeats.length > 0) {
          currentQty = selectedSeats.length;
          const lastSeat = selectedSeats[selectedSeats.length - 1];
          if (lastSeat) {
            selectedZoneName = lastSeat.zone;
            selectedZonePrice = lastSeat.price;
          }
        }
        const qtyEl = document.getElementById('ticketQty');
        if (qtyEl) qtyEl.textContent = currentQty;
        updatePriceDisplay();
      });
    }
    renderEvents();
    syncEventsFromServer();
    TicketStore.syncAll().then(refreshCartCount);
  });
}

if (typeof window !== 'undefined') {
  window.validateThaiCitizenId = validateThaiCitizenId;
  window.formatPhoneInput = formatPhoneInput;
  window.formatIdCardInput = formatIdCardInput;
  window.clearSavedHolderInfo = clearSavedHolderInfo;
}
if (typeof module !== 'undefined') {
  module.exports = {
    validateThaiCitizenId,
    formatPhoneInput,
    formatIdCardInput,
    loadSavedHolder,
    clearSavedHolderInfo
  };
}
