/**
 * Interactive Venue Seating Map & Real-time Seat Picker with Live Hold Engine.
 * Supports Stage display, multi-zone interactive grid, seat hold (10-minute lock) and max seat restrictions.
 */
(function () {
  const MAX_SEATS = 4;
  const HOLD_DURATION_MS = 600000; // 10 minutes

  function getSessionId() {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        let sid = window.sessionStorage.getItem('tt_seat_session');
        if (!sid) {
          sid = 'sess_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
          window.sessionStorage.setItem('tt_seat_session', sid);
        }
        return sid;
      }
    } catch {}
    return 'sess_fallback_1';
  }

  // Realistic Impact Arena / Stadium layout seats definition
  const SEATS_DATA = [
    // VIP Standing Pit (Front of Stage)
    ...Array.from({ length: 12 }, (_, i) => {
      const num = String(i + 1).padStart(2, '0');
      const id = `VIP-${num}`;
      return {
        id,
        label: num,
        zone: 'VIP Standing',
        zoneCode: 'VIP',
        price: 6500,
        occupied: ['VIP-03', 'VIP-04', 'VIP-09'].includes(id),
        heldByOther: false
      };
    }),
    // Zone A (Floor Seated Rows A1 & A2)
    ...Array.from({ length: 16 }, (_, i) => {
      const num = String(i + 1).padStart(2, '0');
      const id = `A-${num}`;
      return {
        id,
        label: `A${num}`,
        zone: 'Zone A (บัตรนั่ง)',
        zoneCode: 'A',
        price: 4500,
        occupied: ['A-01', 'A-02', 'A-07', 'A-08'].includes(id),
        heldByOther: false
      };
    }),
    // Zone B (Lower Tier Rows B1 & B2)
    ...Array.from({ length: 16 }, (_, i) => {
      const num = String(i + 1).padStart(2, '0');
      const id = `B-${num}`;
      return {
        id,
        label: `B${num}`,
        zone: 'Zone B (บัตรนั่ง)',
        zoneCode: 'B',
        price: 3200,
        occupied: ['B-04', 'B-05', 'B-11'].includes(id),
        heldByOther: false
      };
    }),
    // Zone C (Upper Tier Rows C1 & C2)
    ...Array.from({ length: 20 }, (_, i) => {
      const num = String(i + 1).padStart(2, '0');
      const id = `C-${num}`;
      return {
        id,
        label: `C${num}`,
        zone: 'Zone C (ชั้นบน)',
        zoneCode: 'C',
        price: 1800,
        occupied: ['C-02', 'C-08', 'C-09', 'C-15', 'C-16'].includes(id),
        heldByOther: false
      };
    })
  ];

  let selectedSeats = [];
  let changeListeners = [];
  let holdDeadline = 0;
  let holdTimerId = null;

  function notifyChange() {
    changeListeners.forEach((fn) => fn(selectedSeats));
  }

  function getAvailableSeatsForZone(zoneName) {
    const clean = String(zoneName || '').toLowerCase();
    return SEATS_DATA.filter((s) => {
      const match =
        s.zone === zoneName ||
        (clean.includes('vip') && s.zoneCode === 'VIP') ||
        (clean.includes('zone a') && s.zoneCode === 'A') ||
        (clean.includes('zone b') && s.zoneCode === 'B') ||
        (clean.includes('zone c') && s.zoneCode === 'C') ||
        (clean.includes('โต๊ะ a') && s.zoneCode === 'A') ||
        (clean.includes('โต๊ะ b') && s.zoneCode === 'B') ||
        (clean.includes('โต๊ะ c') && s.zoneCode === 'C') ||
        (clean.includes('โต๊ะ vip') && s.zoneCode === 'VIP');
      return match && !s.occupied && !s.heldByOther;
    });
  }

  function updateTablePrices(prices) {
    if (!prices) return;
    for (const seat of SEATS_DATA) {
      if (seat.zoneCode === 'VIP' && prices.vip != null) seat.price = Number(prices.vip);
      else if (seat.zoneCode === 'A' && prices.a != null) seat.price = Number(prices.a);
      else if (seat.zoneCode === 'B' && prices.b != null) seat.price = Number(prices.b);
      else if (seat.zoneCode === 'C' && prices.c != null) seat.price = Number(prices.c);
    }
    render();
  }

  function updateCountdownDisplay() {
    const el = document.getElementById('seatHoldCountdownText');
    if (!el) return;
    const remaining = Math.max(0, Math.round((holdDeadline - Date.now()) / 1000));
    const m = String(Math.floor(remaining / 60)).padStart(2, '0');
    const s = String(remaining % 60).padStart(2, '0');
    el.textContent = `${m}:${s}`;
    if (remaining === 0) {
      clearInterval(holdTimerId);
      holdTimerId = null;
      if (selectedSeats.length > 0) {
        clear();
        if (window.UI) window.UI.toast('หมดเวลาล็อกที่นั่ง ระบบได้ปล่อยที่นั่งคืนสู่ระบบแล้ว', 'error');
      }
    }
  }

  function startHoldCountdown(expiresAt) {
    clearInterval(holdTimerId);
    holdDeadline = expiresAt || (Date.now() + HOLD_DURATION_MS);
    updateCountdownDisplay();
    holdTimerId = setInterval(updateCountdownDisplay, 1000);
  }

  let sseSource = null;
  let sseConnected = false;

  function applyServerSeatPayload(data) {
    if (!data || !data.seats) return;
    for (const seat of SEATS_DATA) {
      const info = data.seats[seat.id];
      if (info) {
        seat.occupied = info.status === 'occupied';
        seat.heldByOther = info.status === 'held_by_other';
      }
    }
    if (data.myHoldExpiresAt && data.remainingSeconds > 0) {
      startHoldCountdown(data.myHoldExpiresAt);
    } else if (data.reason === 'expired_cleanup' && selectedSeats.length > 0 && !data.myHoldExpiresAt) {
      selectedSeats = [];
      clearInterval(holdTimerId);
      holdTimerId = null;
      notifyChange();
      if (window.UI) window.UI.toast('หมดเวลาล็อกที่นั่ง ระบบได้ปลดล็อกที่นั่งคืนสู่กองกลางแล้ว', 'error');
    }
    render();
  }

  function connectRealtimeStream() {
    if (typeof EventSource !== 'function' || sseSource) return;
    try {
      const sid = getSessionId();
      sseSource = new EventSource(`/api/seats/stream?sessionId=${encodeURIComponent(sid)}`);
      sseSource.addEventListener('seat_sync', (ev) => {
        sseConnected = true;
        try {
          const payload = JSON.parse(ev.data);
          applyServerSeatPayload(payload);
        } catch {}
      });
      sseSource.onerror = () => {
        sseConnected = false;
      };
    } catch {}
  }

  async function syncStatuses() {
    connectRealtimeStream();
    if (typeof fetch !== 'function') return;
    try {
      const sid = getSessionId();
      const res = await fetch(`/api/seats/status?sessionId=${encodeURIComponent(sid)}`, { cache: 'no-store' });
      const data = await res.json();
      if (data && data.ok && data.seats) {
        applyServerSeatPayload(data);
      }
    } catch {}
  }

  async function requestServerHold(seatIds) {
    if (typeof fetch !== 'function' || !seatIds.length) return { ok: true };
    try {
      const res = await fetch('/api/seats/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seats: seatIds,
          sessionId: getSessionId(),
          durationMs: HOLD_DURATION_MS
        })
      });
      return await res.json();
    } catch {
      return { ok: true };
    }
  }

  async function requestServerRelease(seatIds) {
    if (typeof fetch !== 'function') return;
    try {
      await fetch('/api/seats/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seats: seatIds,
          sessionId: getSessionId()
        })
      });
    } catch {}
  }

  function autoSelectForZone(zoneName, count) {
    const available = getAvailableSeatsForZone(zoneName);
    selectedSeats = available.slice(0, Math.min(count, available.length));
    if (selectedSeats.length > 0) {
      startHoldCountdown(Date.now() + HOLD_DURATION_MS);
      requestServerHold(selectedSeats.map((s) => s.id));
    } else {
      clearInterval(holdTimerId);
      holdTimerId = null;
    }
    render();
    notifyChange();
    return selectedSeats;
  }

  function toggleSeat(seatId) {
    const seat = SEATS_DATA.find((s) => s.id === seatId);
    if (!seat || seat.occupied) return false;
    if (seat.heldByOther) {
      if (window.UI) window.UI.toast(`ที่นั่ง ${seatId} กำลังมีผู้ใช้อื่นเลือกอยู่ (ล็อก 10 นาที)`, 'error');
      return false;
    }

    const existingIdx = selectedSeats.findIndex((s) => s.id === seatId);
    if (existingIdx > -1) {
      selectedSeats.splice(existingIdx, 1);
      if (window.SoundEffects) window.SoundEffects.playSeatDeselect();
      if (selectedSeats.length === 0) {
        clearInterval(holdTimerId);
        holdTimerId = null;
        requestServerRelease([seatId]);
      } else {
        requestServerHold(selectedSeats.map((s) => s.id));
      }
    } else {
      if (selectedSeats.length >= MAX_SEATS) {
        if (window.UI) window.UI.toast(`เลือกที่นั่งได้สูงสุด ${MAX_SEATS} ที่นั่งต่อการสั่งซื้อ`, 'error');
        return false;
      }
      selectedSeats.push(seat);
      if (window.SoundEffects) window.SoundEffects.playSeatSelect();
      startHoldCountdown(Date.now() + HOLD_DURATION_MS);

      // Async backend hold reservation
      requestServerHold(selectedSeats.map((s) => s.id)).then((res) => {
        if (res && res.ok === false) {
          // Conflict
          const idx = selectedSeats.findIndex((s) => s.id === seatId);
          if (idx > -1) selectedSeats.splice(idx, 1);
          if (window.UI) window.UI.toast(res.message || 'ที่นั่งนี้ถูกเลือกแล้วโดยผู้อื่น', 'error');
          syncStatuses();
          render();
          notifyChange();
        } else if (res && res.expiresAt) {
          startHoldCountdown(res.expiresAt);
        }
      });
    }

    render();
    notifyChange();
    return true;
  }

  function clear() {
    const prevIds = selectedSeats.map((s) => s.id);
    selectedSeats = [];
    clearInterval(holdTimerId);
    holdTimerId = null;
    if (prevIds.length > 0) {
      requestServerRelease(prevIds);
    }
    render();
    notifyChange();
  }

  function render(containerId = 'seatMapContainer') {
    const el = document.getElementById(containerId);
    if (!el) return;
    connectRealtimeStream();

    const selectedIds = new Set(selectedSeats.map((s) => s.id));

    const renderSeatBtn = (s) => {
      const isSelected = selectedIds.has(s.id);
      const isHeldOther = !isSelected && s.heldByOther;
      const cls = ['seat-btn'];

      if (s.occupied) cls.push('seat-occupied');
      else if (isHeldOther) cls.push('seat-held-other');
      else if (isSelected) cls.push('seat-selected');
      else cls.push(`seat-zone-${s.zoneCode.toLowerCase()}`);

      const title = s.occupied
        ? `โต๊ะ ${s.id}: จองแล้ว (Sold out)`
        : isHeldOther
        ? `โต๊ะ ${s.id}: กำลังมีผู้ใช้อื่นเลือกอยู่ (Hold 10 นาที)`
        : isSelected
        ? `โต๊ะ ${s.id}: เลือกแล้ว (${s.price.toLocaleString()} THB)`
        : `โต๊ะ ${s.id}: ${s.zone} (${s.price.toLocaleString()} THB)`;

      const disabledAttr = s.occupied || isHeldOther ? 'disabled aria-disabled="true"' : '';

      return `
        <button type="button" 
          class="${cls.join(' ')}" 
          data-seat-id="${s.id}"
          title="${title}"
          ${disabledAttr}
          aria-label="${title}"
          aria-pressed="${isSelected}">
          ${isHeldOther ? '🔒' : s.label}
        </button>
      `;
    };

    const vipSeats = SEATS_DATA.filter((s) => s.zoneCode === 'VIP');
    const aSeats = SEATS_DATA.filter((s) => s.zoneCode === 'A');
    const bSeats = SEATS_DATA.filter((s) => s.zoneCode === 'B');
    const cSeats = SEATS_DATA.filter((s) => s.zoneCode === 'C');

    const pVip = vipSeats[0] ? vipSeats[0].price : 6500;
    const pA = aSeats[0] ? aSeats[0].price : 4500;
    const pB = bSeats[0] ? bSeats[0].price : 3200;
    const pC = cSeats[0] ? cSeats[0].price : 1800;

    el.innerHTML = `
      <div class="seat-map-wrapper">
        ${
          selectedSeats.length > 0
            ? `
          <div class="seat-hold-live-ticker" id="seatHoldLiveTicker">
            <span class="seat-hold-ticker-badge">🔒 ล็อกโต๊ะแล้ว</span>
            <div class="seat-hold-ticker-msg">
              ระบบกำลังล็อกโต๊ะสำหรับคุณ ป้องกันผู้อื่นแย่งซื้อ: 
              <strong id="seatHoldCountdownText" class="seat-hold-timer-text">10:00</strong> นาที
            </div>
          </div>
        `
            : ''
        }

        <!-- Stage Visual -->
        <div class="stage-display">
          <div class="stage-lights"></div>
          <div class="stage-title">STAGE · เวทีการแสดง</div>
        </div>

        <!-- Legend + Real-time SSE Sync Indicator -->
        <div class="seat-legend">
          <div class="legend-item"><span class="legend-dot dot-available"></span>ว่าง (คลิกเลือกโต๊ะได้)</div>
          <div class="legend-item"><span class="legend-dot dot-selected"></span>โต๊ะที่คุณเลือก</div>
          <div class="legend-item"><span class="legend-dot" style="background:#F5A623;"></span>กำลังถูกล็อกโดยผู้อื่น</div>
          <div class="legend-item"><span class="legend-dot dot-occupied"></span>จองแล้ว</div>
          <div class="legend-item" id="seatRealtimeBadge" style="color:var(--color-accent); font-weight:600;">
            🟢 ซิงก์ผังโต๊ะเรียลไทม์ (Live SSE)
          </div>
        </div>

        <!-- Tables Layout by Zone -->
        <div class="seating-grid-container">
          <!-- VIP Tables -->
          <div class="seat-zone-block">
            <div class="zone-header-label">
              <span class="badge-primary">👑 โต๊ะ VIP</span> โต๊ะหน้าเวที (${pVip.toLocaleString('th-TH')} THB/โต๊ะ)
            </div>
            <div class="seat-row-grid seat-grid-vip">
              ${vipSeats.map(renderSeatBtn).join('')}
            </div>
          </div>

          <!-- Zone A Tables -->
          <div class="seat-zone-block">
            <div class="zone-header-label">
              <span class="badge-accent">🥇 โต๊ะโซน A</span> โต๊ะแถวหน้า (${pA.toLocaleString('th-TH')} THB/โต๊ะ)
            </div>
            <div class="seat-row-grid seat-grid-a">
              ${aSeats.map(renderSeatBtn).join('')}
            </div>
          </div>

          <!-- Zone B Tables -->
          <div class="seat-zone-block">
            <div class="zone-header-label">
              <span class="badge-accent" style="background:#0284c7;">🥈 โต๊ะโซน B</span> โต๊ะแถวกลาง (${pB.toLocaleString('th-TH')} THB/โต๊ะ)
            </div>
            <div class="seat-row-grid seat-grid-b">
              ${bSeats.map(renderSeatBtn).join('')}
            </div>
          </div>

          <!-- Zone C Tables -->
          <div class="seat-zone-block">
            <div class="zone-header-label">
              <span class="badge-accent" style="background:#0f766e;">🥉 โต๊ะโซน C</span> โต๊ะชั้นบน/ริม (${pC.toLocaleString('th-TH')} THB/โต๊ะ)
            </div>
            <div class="seat-row-grid seat-grid-c">
              ${cSeats.map(renderSeatBtn).join('')}
            </div>
          </div>
        </div>

        <!-- Selected Tables Display Bar -->
        <div class="selected-seats-bar">
          <div class="selected-seats-summary">
            <span class="text-muted" style="font-size:12px;">โต๊ะที่เลือก (${selectedSeats.length}/${MAX_SEATS}):</span>
            <div class="selected-seats-tags">
              ${
                selectedSeats.length
                  ? selectedSeats.map((s) => `<span class="seat-tag">โต๊ะ ${s.id}</span>`).join('')
                  : '<span class="text-muted" style="font-style:italic;">ยังไม่ได้เลือกโต๊ะ (คลิกโต๊ะบนผังด้านบน)</span>'
              }
            </div>
          </div>
        </div>
      </div>
    `;

    updateCountdownDisplay();

    // Bind clicks
    el.querySelectorAll('button[data-seat-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const id = btn.dataset.seatId;
        toggleSeat(id);
      });
    });
  }

  window.SeatMap = {
    render,
    toggleSeat,
    clear,
    autoSelectForZone,
    updateTablePrices,
    syncStatuses,
    getSessionId,
    getSelectedSeats: () => [...selectedSeats],
    getSelectedSeatCodes: () => selectedSeats.map((s) => s.id),
    onChange: (fn) => changeListeners.push(fn),
    MAX_SEATS
  };
})();
