/** Event listing, live zone quota sync, promo code calculation, and ticket holder validation. */
// Events always come from /api/events; nothing is hard-coded here.
let eventsData = [];

const MAX_QTY = 4;
const HOLDER_KEY = 'thaiticket.holder.v1';
let currentCategory = 'all';
let searchQuery = '';
let selectedEvent = null;
let selectedZonePrice = 6500;
let selectedZoneName = 'โต๊ะ VIP';
let currentTablePrices = { vip: 6500, a: 4500, b: 3200, c: 1800 };
if (typeof window !== 'undefined') window.currentTablePrices = currentTablePrices;
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

function loadLocalCustomEvents() {
  try {
    const raw = localStorage.getItem('thaiticket.customEvents.v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        eventsData = filterClientEvents(parsed);
        renderEvents();
        return true;
      }
    }
  } catch (_) {}
  return false;
}

async function syncEventsFromServer() {
  try {
    const res = await fetch('/api/events', { cache: 'no-store' });
    const data = await res.json();
    if (data && data.ok && Array.isArray(data.events)) {
      eventsData = data.events;
      try {
        localStorage.setItem('thaiticket.customEvents.v1', JSON.stringify(eventsData));
        localStorage.removeItem('thaiticket.deletedEventIds.v1');
      } catch (_) {}
      renderEvents();
    } else {
      loadLocalCustomEvents();
    }
  } catch {
    if (!loadLocalCustomEvents()) {
      eventsData = filterClientEvents(eventsData);
      renderEvents();
    }
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

  updateHeroCardForCategory(currentCategory);

  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><p>${searchQuery ? 'ไม่พบรายการคอนเสิร์ตที่ตรงกับคำค้นหาของคุณ' : 'ยังไม่มีงานในหมวดนี้'}</p></div>`;
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
          ${ev.remainingTotal !== undefined ? `<div class="event-detail-item"><span style="color:var(--color-accent);font-size:12px;font-weight:600;">🍽️ โต๊ะคงเหลือ ${Number(ev.remainingTotal).toLocaleString('th-TH')} โต๊ะ</span></div>` : ''}
        </div>
        <div class="event-price-box">
          <div>
            <span class="price-label">ราคาเริ่มต้น</span>
            <div class="price-value">${esc(ev.priceRange)}</div>
          </div>
          <button class="btn-primary" data-event-id="${ev.id}">จองโต๊ะ</button>
        </div>
      </div>
    </div>`;
  }).join('');

  if (window.GSAPThemeStudio && typeof window.GSAPThemeStudio.setupTiltCards === 'function') {
    window.GSAPThemeStudio.setupTiltCards();
  }
}

const CATEGORY_LABELS = { kpop: 'K-POP', thai: 'THAI ROCK', world: 'WORLD TOUR', fest: 'FESTIVAL', fanmeeting: 'FAN MEETING' };

// The hero card shows the first real event of the chosen category, or an empty state. It never shows demo data.
function updateHeroCardForCategory(cat) {
  if (typeof document === 'undefined') return;
  const card = document.getElementById('heroArtistCard');
  if (!card) return;
  const list = filterClientEvents(eventsData).filter((ev) => cat === 'all' || ev.category === cat);
  const ev = list[0] || null;
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const dateEl = document.getElementById('heroArtistDate');
  const priceBox = document.getElementById('heroArtistPriceBox');
  card.classList.toggle('is-empty', !ev);
  if (dateEl) dateEl.hidden = !ev;
  if (priceBox) priceBox.hidden = !ev;
  if (!ev) {
    card.style.removeProperty('background');
    card.onclick = null;
    card.setAttribute('aria-disabled', 'true');
    set('heroArtistTag', CATEGORY_LABELS[cat] || 'STAGE PASS');
    set('heroArtistTitle', 'ยังไม่มีงานในหมวดนี้');
    set('heroArtistGenre', 'งานใหม่จะแสดงที่นี่ทันทีที่เปิดจำหน่าย');
    return;
  }
  card.removeAttribute('aria-disabled');
  const img = String(ev.image || '').replace(/["\\\n\r]/g, '');
  // The theme sets the glass background with !important, so the poster needs it too.
  if (img) {
    card.style.setProperty('background', `linear-gradient(180deg, rgba(14, 16, 24, 0.35) 0%, rgba(10, 11, 16, 0.94) 100%), url("${img}") center / cover no-repeat`, 'important');
  } else {
    card.style.removeProperty('background');
  }
  card.onclick = () => openBookingModal(ev.title, ev.date, ev.venue);
  set('heroArtistTag', CATEGORY_LABELS[ev.category] || 'LIVE');
  set('heroArtistTitle', ev.title);
  set('heroArtistGenre', ev.venue || '');
  set('heroArtistPrice', ev.priceRange || '');
  set('heroArtistDate', ev.date || '');
}

function filterCategory(cat, btn) {
  currentCategory = cat;
  if (typeof document !== 'undefined') {
    document.querySelectorAll('.category-pills .pill-btn, .subnav-item').forEach((b) => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
  }
  renderEvents();
}

function onHeroSearch(val) {
  searchQuery = (val || '').trim();
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

const LINE_PROFILE_KEY = 'thaiticket.lineProfile.v1';

function applyAutoDetectedLineProfile(userId, displayName = '', sourceLabel = 'LINE OA') {
  const cleanId = String(userId || '').trim();
  if (!/^U[0-9a-fA-F]{32}$/.test(cleanId) && !/^U_/.test(cleanId)) return false;
  const cleanName = String(displayName || '').trim();

  try {
    localStorage.setItem(
      LINE_PROFILE_KEY,
      JSON.stringify({ userId: cleanId, displayName: cleanName, sourceLabel, updatedAt: Date.now() })
    );
    const prevRaw = localStorage.getItem(HOLDER_KEY);
    const prev = prevRaw ? JSON.parse(prevRaw) : {};
    localStorage.setItem(
      HOLDER_KEY,
      JSON.stringify({
        ...prev,
        holderName: prev.holderName || cleanName || '',
        lineUserId: cleanId
      })
    );
  } catch {
    /* ignore */
  }

  if (typeof document !== 'undefined') {
    const lineEl = document.getElementById('holderLineId');
    const nameEl = document.getElementById('holderName');
    const hintEl = document.getElementById('lineWebhookHint');
    if (lineEl) {
      lineEl.value = cleanId;
      lineEl.classList.remove('input-error');
    }
    if (nameEl && !nameEl.value && cleanName) {
      nameEl.value = cleanName;
    }
    updateLineConnectUi(cleanId, cleanName);
  }
  return true;
}

// ---------------------------------------------------------------------------
// LINE account connection (LIFF)
// Inside the LINE app the buyer is detected automatically. In other browsers
// one tap on "เข้าสู่ระบบด้วย LINE" logs in and comes back to the same booking.
// ---------------------------------------------------------------------------
const PENDING_BOOKING_KEY = 'stagepass.pendingBooking.v1';
let activeLiffId = '';
let liffReadyPromise = null;

function getConfiguredLiffId() {
  return activeLiffId || (window.APP_CONFIG && window.APP_CONFIG.LINE_LIFF_ID) || '';
}

function updateLineConnectUi(userId, displayName) {
  if (typeof document === 'undefined') return;
  const chip = document.getElementById('lineConnectedChip');
  const nameOut = document.getElementById('lineConnectedName');
  const loginBtn = document.getElementById('lineLoginBtn');
  const hintEl = document.getElementById('lineWebhookHint');
  const connected = Boolean(userId);
  if (chip) chip.hidden = !connected;
  if (nameOut) nameOut.textContent = displayName || (userId ? userId.slice(0, 10) + '…' : '-');
  if (loginBtn) loginBtn.hidden = connected;
  if (hintEl) {
    hintEl.textContent = connected
      ? 'บัตรจะถูกส่งเข้าแชท LINE OA ของบัญชีนี้ (ต้องแอดเพื่อน LINE OA ไว้ก่อน)'
      : 'กดปุ่มด้านบน ระบบจะดึงบัญชี LINE ของคุณให้อัตโนมัติ ไม่ต้องคัดลอกรหัสเอง';
  }
}

function updateLineFriendUi(isFriend) {
  const addBtn = typeof document !== 'undefined' ? document.getElementById('bookingAddLineOaBtn') : null;
  if (addBtn) addBtn.hidden = isFriend === true;
}

function loadLiffSdk() {
  if (window.liff) return Promise.resolve(window.liff);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
    script.async = true;
    script.onload = () => (window.liff ? resolve(window.liff) : reject(new Error('LIFF SDK missing')));
    script.onerror = () => reject(new Error('LIFF SDK failed to load'));
    document.head.appendChild(script);
  });
}

function ensureLiffReady() {
  const liffId = getConfiguredLiffId();
  if (!liffId) return Promise.reject(new Error('LIFF ID not configured'));
  if (!liffReadyPromise) {
    liffReadyPromise = loadLiffSdk()
      .then((liff) => liff.init({ liffId }).then(() => liff))
      .catch((err) => {
        liffReadyPromise = null;
        throw err;
      });
  }
  return liffReadyPromise;
}

async function syncLiffProfile(liff) {
  if (!liff.isLoggedIn()) return false;
  const profile = await liff.getProfile();
  if (!profile || !profile.userId) return false;
  applyAutoDetectedLineProfile(profile.userId, profile.displayName || '', 'LINE LIFF');
  if (typeof liff.getFriendship === 'function') {
    liff.getFriendship().then((f) => updateLineFriendUi(Boolean(f && f.friendFlag))).catch(() => {});
  }
  if (window.TicketStore && typeof window.TicketStore.syncAll === 'function') {
    window.TicketStore.syncAll({ lineUserId: profile.userId }).then(() => {
      refreshCartCount();
      const myModal = document.getElementById('myTicketsModal');
      if (myModal && myModal.classList.contains('active') && window.TicketViewer) {
        window.TicketViewer.openList();
      }
    });
  }
  return true;
}

function resumePendingBooking() {
  try {
    const raw = sessionStorage.getItem(PENDING_BOOKING_KEY);
    if (!raw) return;
    sessionStorage.removeItem(PENDING_BOOKING_KEY);
    const pending = JSON.parse(raw);
    if (pending && pending.title && Date.now() - (pending.at || 0) < 30 * 60 * 1000) {
      openBookingModal(pending.title, pending.date, pending.venue);
    }
  } catch {
    /* ignore */
  }
}

function initLineLiffAutoFill(liffId) {
  const cleanLiffId = String(liffId || '').trim();
  if (cleanLiffId) activeLiffId = cleanLiffId;
  if (!getConfiguredLiffId() || typeof window === 'undefined' || typeof document === 'undefined') return;

  // Only download the LIFF SDK up front when it is needed right away:
  // inside the LINE app, or when coming back from a LINE login redirect.
  const ua = navigator.userAgent || '';
  const inLineApp = / Line\//i.test(ua);
  const backFromLogin = /[?&](code|liffClientId|liff\.state|liffRedirectUri)=/.test(window.location.search);
  if (!inLineApp && !backFromLogin) return;

  ensureLiffReady()
    .then(async (liff) => {
      const ok = await syncLiffProfile(liff);
      if (!ok && liff.isInClient && liff.isInClient()) {
        liff.login();
        return;
      }
      if (ok) resumePendingBooking();
    })
    .catch(() => {
      /* ignore LIFF init error outside the LIFF endpoint domain */
    });
}

async function connectLineAccount(forceSwitch = false) {
  const btn = document.getElementById('lineLoginBtn');
  const errEl = document.getElementById('holderError');
  const liffId = getConfiguredLiffId();
  if (btn) btn.disabled = true;
  try {
    if (!liffId) throw new Error('no liff id');
    const liff = await ensureLiffReady();
    if (forceSwitch && liff.isLoggedIn() && !(liff.isInClient && liff.isInClient())) {
      liff.logout();
    }
    if (!forceSwitch && (await syncLiffProfile(liff))) {
      if (errEl) errEl.textContent = '';
      UI.toast('เชื่อมต่อบัญชี LINE เรียบร้อย');
      return;
    }
    if (selectedEvent) {
      try {
        sessionStorage.setItem(PENDING_BOOKING_KEY, JSON.stringify({ ...selectedEvent, at: Date.now() }));
      } catch {
        /* ignore */
      }
    }
    liff.login({ redirectUri: window.location.href.split('#')[0] });
  } catch {
    // Fallback: open this site inside the LINE app, where the account is detected automatically.
    if (liffId) {
      window.location.href = `https://liff.line.me/${liffId}`;
    } else {
      UI.toast('ยังเชื่อมต่อ LINE ไม่ได้ กรุณาเปิดเว็บนี้จากเมนูใน LINE OA', 'error');
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Kept for older markup / cached pages that still call the old button.
function fetchLineIdFromWebhook() {
  return connectLineAccount();
}

function loadSavedHolder() {
  try {
    const raw = localStorage.getItem(HOLDER_KEY);
    const lineProfileRaw = localStorage.getItem(LINE_PROFILE_KEY);
    const clearBtn = document.getElementById('clearSavedHolderBtn');
    const badgeEl = document.getElementById('savedHolderBadge');
    if (!raw && !lineProfileRaw) {
      if (clearBtn) clearBtn.hidden = true;
      if (badgeEl) badgeEl.hidden = true;
      return;
    }
    const saved = raw ? JSON.parse(raw) : {};
    const rememberCb = document.getElementById('rememberHolderCheckbox');
    if (rememberCb && raw) rememberCb.checked = true;
    const lineProf = lineProfileRaw ? JSON.parse(lineProfileRaw) : null;
    let loadedAny = false;
    const nameEl = document.getElementById('holderName');
    const phoneEl = document.getElementById('holderPhone');
    const idEl = document.getElementById('holderIdCard');
    const lineEl = document.getElementById('holderLineId');
    const hintEl = document.getElementById('lineWebhookHint');

    const effectiveName = saved.holderName || (lineProf && lineProf.displayName) || '';
    // Only trust a LINE ID that LINE itself gave us (LIFF login or a link sent by our bot).
    // Older saves could hold someone else's ID from the removed "fetch LINE ID" button.
    const effectiveLineId = (lineProf && lineProf.userId) || '';

    if (effectiveName && nameEl && !nameEl.value) {
      nameEl.value = effectiveName;
      loadedAny = true;
    }
    if (saved.holderPhone && phoneEl && !phoneEl.value) {
      phoneEl.value = formatPhoneInput(saved.holderPhone);
      loadedAny = true;
    }
    if (saved.holderIdCard) {
      // Drop ID numbers saved by older versions of the site.
      delete saved.holderIdCard;
      localStorage.setItem(HOLDER_KEY, JSON.stringify(saved));
    }
    if (effectiveLineId && lineEl) {
      lineEl.value = effectiveLineId;
      loadedAny = true;
    }
    updateLineConnectUi(lineEl ? lineEl.value : '', lineProf ? lineProf.displayName : '');
    if (clearBtn) clearBtn.hidden = !loadedAny;
    if (badgeEl) badgeEl.hidden = !loadedAny;
  } catch {
    /* ignore */
  }
}

function clearSavedHolderInfo() {
  try {
    localStorage.removeItem(HOLDER_KEY);
    localStorage.removeItem(LINE_PROFILE_KEY);
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
  updateLineConnectUi('', '');
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
  
  const evNameEl = document.getElementById('wizardEventName');
  if (evNameEl) evNameEl.textContent = title;
  
  const venueEl = document.getElementById('modalEventVenue');
  if (venueEl) venueEl.textContent = `${venue} · ${date}`;

  // Find matching event image
  const ev = (eventsData || []).find(e => e.title === title || e.venue === venue) || {};
  const posterEl = document.getElementById('wizardEventPoster');
  if (posterEl && ev && ev.image) {
    posterEl.style.backgroundImage = `url('${ev.image}')`;
  }

  // Update dynamic table prices for this specific event
  currentTablePrices = {
    vip: Number(ev.priceVip != null ? ev.priceVip : 6500),
    a: Number(ev.priceA != null ? ev.priceA : 4500),
    b: Number(ev.priceB != null ? ev.priceB : 3200),
    c: Number(ev.priceC != null ? ev.priceC : 1800)
  };
  window.currentTablePrices = currentTablePrices;

  const pVipEl = document.getElementById('zonePriceVip');
  if (pVipEl) pVipEl.textContent = `${currentTablePrices.vip.toLocaleString('th-TH')} THB`;
  const pAEl = document.getElementById('zonePriceA');
  if (pAEl) pAEl.textContent = `${currentTablePrices.a.toLocaleString('th-TH')} THB`;
  const pBEl = document.getElementById('zonePriceB');
  if (pBEl) pBEl.textContent = `${currentTablePrices.b.toLocaleString('th-TH')} THB`;
  const pCEl = document.getElementById('zonePriceC');
  if (pCEl) pCEl.textContent = `${currentTablePrices.c.toLocaleString('th-TH')} THB`;
  const rangeEl = document.getElementById('wizardEventPriceRange');
  if (rangeEl) {
    const prices = Object.values(currentTablePrices).filter((n) => n > 0);
    if (prices.length) {
      rangeEl.textContent = `ราคา ${Math.min(...prices).toLocaleString('th-TH')} - ${Math.max(...prices).toLocaleString('th-TH')} THB`;
    }
  }

  if (window.SeatMap && typeof window.SeatMap.updateTablePrices === 'function') {
    window.SeatMap.updateTablePrices(currentTablePrices);
  }

  // Configure Stage Layout & Seating Mode for this specific event
  if (window.SeatMap && typeof window.SeatMap.configureLayout === 'function') {
    window.SeatMap.configureLayout({
      stageLayout: ev.stageLayout || 'standard',
      seatingType: ev.seatingType || 'table',
      zoneTypes: {
        vip: ev.zoneTypeVip || (ev.seatingType !== 'hybrid' ? ev.seatingType : 'table') || 'table',
        a: ev.zoneTypeA || (ev.seatingType !== 'hybrid' ? ev.seatingType : 'table') || 'table',
        b: ev.zoneTypeB || (ev.seatingType !== 'hybrid' ? ev.seatingType : 'table') || 'table',
        c: ev.zoneTypeC || (ev.seatingType !== 'hybrid' ? ev.seatingType : 'table') || 'table'
      },
      seatsPerTable: ev.seatsPerTable || 4
    });
  }

  const zTypeVip = ev.zoneTypeVip || (ev.seatingType !== 'hybrid' ? ev.seatingType : 'table') || 'table';
  const zTypeA = ev.zoneTypeA || (ev.seatingType !== 'hybrid' ? ev.seatingType : 'table') || 'table';
  const zTypeB = ev.zoneTypeB || (ev.seatingType !== 'hybrid' ? ev.seatingType : 'table') || 'table';
  const zTypeC = ev.zoneTypeC || (ev.seatingType !== 'hybrid' ? ev.seatingType : 'table') || 'table';

  const typeNameMap = { table: 'โต๊ะ', seated: 'บัตรนั่ง', standing: 'บัตรยืน' };
  const vipName = `${typeNameMap[zTypeVip] || 'โต๊ะ'} VIP`;
  const aName = `${typeNameMap[zTypeA] || 'โต๊ะ'} โซน A`;
  const bName = `${typeNameMap[zTypeB] || 'โต๊ะ'} โซน B`;
  const cName = `${typeNameMap[zTypeC] || 'โต๊ะ'} โซน C`;

  const btnVip = document.getElementById('zoneBtnVip');
  if (btnVip) {
    const lbl = btnVip.querySelector('.zone-btn-name');
    if (lbl) lbl.textContent = `👑 ${vipName}`;
    btnVip.setAttribute('onclick', `selectZone('${vipName}', currentTablePrices.vip, this)`);
  }
  const btnA = document.getElementById('zoneBtnA');
  if (btnA) {
    const lbl = btnA.querySelector('.zone-btn-name');
    if (lbl) lbl.textContent = `🥇 ${aName}`;
    btnA.setAttribute('onclick', `selectZone('${aName}', currentTablePrices.a, this)`);
  }
  const btnB = document.getElementById('zoneBtnB');
  if (btnB) {
    const lbl = btnB.querySelector('.zone-btn-name');
    if (lbl) lbl.textContent = `🥈 ${bName}`;
    btnB.setAttribute('onclick', `selectZone('${bName}', currentTablePrices.b, this)`);
  }
  const btnC = document.getElementById('zoneBtnC');
  if (btnC) {
    const lbl = btnC.querySelector('.zone-btn-name');
    if (lbl) lbl.textContent = `🥉 ${cName}`;
    btnC.setAttribute('onclick', `selectZone('${cName}', currentTablePrices.c, this)`);
  }

  selectedZoneName = vipName;
  selectedZonePrice = currentTablePrices.vip;

  currentQty = 1;
  activePromo = null;
  const qtyEl = document.getElementById('ticketQty');
  if (qtyEl) qtyEl.textContent = currentQty;
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
  setBookingMode(getDefaultBookingMode());
  if (window.SeatMap && typeof window.SeatMap.syncStatuses === 'function') {
    window.SeatMap.syncStatuses();
  }
  const first = document.querySelector('.zone-btn');
  if (first) first.click();
  updatePriceDisplay();
  
  goToStep(2);
  UI.open('bookingModal');
}

// Slow phones (lite mode) start on the quick table list instead of drawing the full table map.
function getDefaultBookingMode() {
  const lite = typeof document !== 'undefined' && document.documentElement.classList.contains('lite-mode');
  return lite ? 'zone' : 'map';
}

function goToStep(stepNum) {
  if (typeof document === 'undefined') return;
  // Event info (old step 1) now sits as a header above seat + buyer details,
  // so every step number before payment shows the same combined screen.
  const step1 = document.getElementById('stepView1');
  const step2 = document.getElementById('stepView2');
  const pill2 = document.getElementById('stepPill2');
  const pill3 = document.getElementById('stepPill3');
  const modalTitle = document.getElementById('modalEventTitle');
  if (step1) step1.hidden = false;
  if (step2) step2.hidden = false;
  if (pill2) pill2.className = 'wizard-step-item active';
  if (pill3) pill3.className = 'wizard-step-item';
  if (modalTitle) modalTitle.textContent = 'ขั้นตอนที่ 1: เลือกโต๊ะ/บัตร และกรอกข้อมูล';
  if (stepNum === 1) return;
  const mapView = document.getElementById('seatMapView');
  if (mapView && !mapView.hidden && window.SeatMap && typeof window.SeatMap.syncStatuses === 'function') {
    window.SeatMap.syncStatuses();
  }
}

function selectEventRound(el) {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('.round-select-pill').forEach(p => p.classList.remove('active'));
  if (el) el.classList.add('active');
}

function backToStep2FromPayment() {
  if (typeof UI !== 'undefined') {
    UI.close('paymentModal');
    goToStep(2);
    UI.open('bookingModal');
  }
}

if (typeof window !== 'undefined') {
  window.goToStep = goToStep;
  window.selectEventRound = selectEventRound;
  window.backToStep2FromPayment = backToStep2FromPayment;
}

function closeBookingModal() {
  UI.close('bookingModal');
}

function selectZone(name, price, btn) {
  selectedZoneName = name;
  if (price != null) {
    selectedZonePrice = price;
  } else if (name.includes('VIP')) {
    selectedZonePrice = currentTablePrices.vip;
  } else if (name.includes('A')) {
    selectedZonePrice = currentTablePrices.a;
  } else if (name.includes('B')) {
    selectedZonePrice = currentTablePrices.b;
  } else if (name.includes('C')) {
    selectedZonePrice = currentTablePrices.c;
  }
  document.querySelectorAll('.zone-btn').forEach((b) => b.classList.remove('selected'));
  if (btn) btn.classList.add('selected');
  updatePriceDisplay();
}
if (typeof window !== 'undefined') {
  window.selectZone = selectZone;
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
    if (errEl) errEl.textContent = 'กรุณากดปุ่ม "เข้าสู่ระบบด้วย LINE" เพื่อรับบัตรทาง LINE';
    const loginBtn = document.getElementById('lineLoginBtn');
    if (loginBtn) loginBtn.focus();
    return;
  }
  if (!/^U[0-9a-fA-F]{32}$/.test(lineUserId) && !/^U_/.test(lineUserId)) {
    if (errEl) errEl.textContent = 'บัญชี LINE ไม่ถูกต้อง กรุณากดปุ่ม "เข้าสู่ระบบด้วย LINE" อีกครั้ง';
    updateLineConnectUi('', '');
    return;
  }
  if (errEl) errEl.textContent = '';

  const rememberCb = document.getElementById('rememberHolderCheckbox');
  const shouldRemember = !rememberCb || rememberCb.checked;
  try {
    if (shouldRemember) {
      // ID card numbers are never stored on the device (phones are often shared).
      localStorage.setItem(HOLDER_KEY, JSON.stringify({ holderName, holderPhone, lineUserId }));
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
    loadLocalCustomEvents();
    renderEvents();
    syncEventsFromServer();

    // Handle URL query parameters from LINE Rich Menu / Webhook Deep-Link (?lineUserId=U...&lineName=...&action=my-tickets)
    let deepLinkLineId = '';
    try {
      const params = new URLSearchParams(window.location.search);
      const urlLineId = params.get('lineUserId') || params.get('line_user_id') || '';
      const urlLineName = params.get('lineName') || params.get('displayName') || '';
      const urlAction = params.get('action');
      if (urlLineId && applyAutoDetectedLineProfile(urlLineId, urlLineName, 'LINE OA Deep-Link')) {
        deepLinkLineId = urlLineId.trim();
        if (window.UI && typeof window.UI.toast === 'function') {
          setTimeout(() => {
            window.UI.toast(`🟢 เชื่อมต่อบัญชี LINE อัตโนมัติสำเร็จ (${urlLineName || urlLineId.slice(0, 10) + '…'})`);
          }, 350);
        }
      }
      if (urlAction === 'my-tickets') {
        setTimeout(() => openMyTicketsModal(), 250);
      }
    } catch (_) {}

    TicketStore.syncAll({ lineUserId: deepLinkLineId }).then(refreshCartCount);

    // Cross-tab real-time listener for instant event & quota updates from Admin
    try {
      const bc = new BroadcastChannel('stagepass_events_channel');
      bc.onmessage = (msg) => {
        if (msg && msg.data && msg.data.type === 'EVENTS_UPDATED' && Array.isArray(msg.data.events)) {
          eventsData = filterClientEvents(msg.data.events);
          renderEvents();
        }
      };
    } catch (_) {}

    window.addEventListener('storage', (e) => {
      if (e.key === 'thaiticket.customEvents.v1' || e.key === 'stagepass_events_updated_at') {
        loadLocalCustomEvents();
        syncEventsFromServer();
      }
    });

    function applyStorefrontSettings(sf) {
      if (!sf) return;
      if (sf.headline) {
        const hl = document.querySelector('.hero-headline-elevate');
        if (hl) hl.textContent = sf.headline;
      }
      if (sf.searchPlaceholder) {
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.placeholder = sf.searchPlaceholder;
      }
      if (sf.lineOaUrl && !/@thaiticket/i.test(sf.lineOaUrl)) {
        document.querySelectorAll('a[href*="line.me"], a[href*="lin.ee"]').forEach(a => a.href = sf.lineOaUrl);
      }
      if (sf.facebookUrl) {
        document.querySelectorAll('a[href*="facebook.com"]').forEach(a => a.href = sf.facebookUrl);
      }
      if (sf.instagramUrl) {
        document.querySelectorAll('a[href*="instagram.com"]').forEach(a => a.href = sf.instagramUrl);
      }
      if (sf.promoImage && !sf.promoImage.includes('example.com')) {
        const heroCard = document.getElementById('heroArtistCard');
        if (heroCard && heroCard.classList.contains('is-empty')) {
          heroCard.style.backgroundImage = `linear-gradient(180deg, rgba(14, 16, 24, 0.45) 0%, rgba(10, 11, 16, 0.94) 100%), url('${sf.promoImage}')`;
        }
      }
    }

    try {
      const rawSf = localStorage.getItem('stagepass_storefront_settings');
      if (rawSf) {
        const parsed = JSON.parse(rawSf);
        if (parsed && parsed.promoImage && parsed.promoImage.includes('example.com')) {
          parsed.promoImage = '';
          localStorage.setItem('stagepass_storefront_settings', JSON.stringify(parsed));
        }
        applyStorefrontSettings(parsed);
      }
    } catch (_) {}

    // Storefront settings live sync for all visitors

    // Live sync from server for all visitors
    fetch('/api/storefront-settings', { cache: 'no-store' })
      .then(res => res.json())
      .then(data => {
        if (data && data.ok) {
          if (data.settings) applyStorefrontSettings(data.settings);
          const liffId = data.lineLiffId || (data.settings && data.settings.lineLiffId) || '';
          initLineLiffAutoFill(liffId);
        }
      })
      .catch(() => initLineLiffAutoFill(''));
  });
}

function openContactModal() {
  if (typeof UI !== 'undefined') {
    UI.open('contactModal');
  }
}

function openMyTicketsModal() {
  if (window.TicketViewer && typeof window.TicketViewer.openList === 'function') {
    window.TicketViewer.openList();
  } else if (typeof UI !== 'undefined') {
    UI.open('myTicketsModal');
  }
}

if (typeof window !== 'undefined') {
  window.validateThaiCitizenId = validateThaiCitizenId;
  window.formatPhoneInput = formatPhoneInput;
  window.formatIdCardInput = formatIdCardInput;
  window.clearSavedHolderInfo = clearSavedHolderInfo;
  window.applyAutoDetectedLineProfile = applyAutoDetectedLineProfile;
  window.initLineLiffAutoFill = initLineLiffAutoFill;
  window.connectLineAccount = connectLineAccount;
  window.fetchLineIdFromWebhook = fetchLineIdFromWebhook;
  window.filterCategory = filterCategory;
  window.onHeroSearch = onHeroSearch;
  window.updateHeroCardForCategory = updateHeroCardForCategory;
  window.openContactModal = openContactModal;
  window.openMyTicketsModal = openMyTicketsModal;
}
if (typeof module !== 'undefined') {
  module.exports = {
    validateThaiCitizenId,
    formatPhoneInput,
    formatIdCardInput,
    loadSavedHolder,
    clearSavedHolderInfo,
    applyAutoDetectedLineProfile,
    initLineLiffAutoFill
  };
}
