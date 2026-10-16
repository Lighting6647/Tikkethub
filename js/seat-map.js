/**
 * Interactive Venue Seating Map & Real-time Seat Picker.
 * Supports Stage display, multi-zone interactive grid, seat hold and max seat restrictions.
 */
(function () {
  const MAX_SEATS = 4;

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
        occupied: ['VIP-03', 'VIP-04', 'VIP-09'].includes(id)
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
        occupied: ['A-01', 'A-02', 'A-07', 'A-08'].includes(id)
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
        occupied: ['B-04', 'B-05', 'B-11'].includes(id)
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
        occupied: ['C-02', 'C-08', 'C-09', 'C-15', 'C-16'].includes(id)
      };
    })
  ];

  let selectedSeats = [];
  let changeListeners = [];

  function notifyChange() {
    changeListeners.forEach((fn) => fn(selectedSeats));
  }

  function getAvailableSeatsForZone(zoneName) {
    return SEATS_DATA.filter((s) => s.zone === zoneName && !s.occupied);
  }

  function autoSelectForZone(zoneName, count) {
    const available = getAvailableSeatsForZone(zoneName);
    selectedSeats = available.slice(0, Math.min(count, available.length));
    render();
    notifyChange();
    return selectedSeats;
  }

  function toggleSeat(seatId) {
    const seat = SEATS_DATA.find((s) => s.id === seatId);
    if (!seat || seat.occupied) return false;

    const existingIdx = selectedSeats.findIndex((s) => s.id === seatId);
    if (existingIdx > -1) {
      selectedSeats.splice(existingIdx, 1);
      if (window.SoundEffects) window.SoundEffects.playSeatDeselect();
    } else {
      if (selectedSeats.length >= MAX_SEATS) {
        if (window.UI) window.UI.toast(`เลือกที่นั่งได้สูงสุด ${MAX_SEATS} ที่นั่งต่อการสั่งซื้อ`, 'error');
        return false;
      }
      selectedSeats.push(seat);
      if (window.SoundEffects) window.SoundEffects.playSeatSelect();
    }

    render();
    notifyChange();
    return true;
  }

  function clear() {
    selectedSeats = [];
    render();
    notifyChange();
  }

  function render(containerId = 'seatMapContainer') {
    const el = document.getElementById(containerId);
    if (!el) return;

    const selectedIds = new Set(selectedSeats.map((s) => s.id));

    const renderSeatBtn = (s) => {
      const isSelected = selectedIds.has(s.id);
      const cls = ['seat-btn'];
      if (s.occupied) cls.push('seat-occupied');
      else if (isSelected) cls.push('seat-selected');
      else cls.push(`seat-zone-${s.zoneCode.toLowerCase()}`);

      const title = s.occupied
        ? `${s.id}: จองแล้ว`
        : isSelected
        ? `${s.id}: เลือกแล้ว (${s.price.toLocaleString()} THB)`
        : `${s.id}: ${s.zone} (${s.price.toLocaleString()} THB)`;

      return `
        <button type="button" 
          class="${cls.join(' ')}" 
          data-seat-id="${s.id}"
          title="${title}"
          ${s.occupied ? 'disabled aria-disabled="true"' : ''}
          aria-label="${title}"
          aria-pressed="${isSelected}">
          ${s.label}
        </button>
      `;
    };

    const vipSeats = SEATS_DATA.filter((s) => s.zoneCode === 'VIP');
    const aSeats = SEATS_DATA.filter((s) => s.zoneCode === 'A');
    const bSeats = SEATS_DATA.filter((s) => s.zoneCode === 'B');
    const cSeats = SEATS_DATA.filter((s) => s.zoneCode === 'C');

    el.innerHTML = `
      <div class="seat-map-wrapper">
        <!-- Stage Visual -->
        <div class="stage-display">
          <div class="stage-lights"></div>
          <div class="stage-title">STAGE · เวทีการแสดง</div>
        </div>

        <!-- Legend -->
        <div class="seat-legend">
          <div class="legend-item"><span class="legend-dot dot-available"></span>ว่าง (คลิกเลือกได้)</div>
          <div class="legend-item"><span class="legend-dot dot-selected"></span>ที่นั่งที่คุณเลือก</div>
          <div class="legend-item"><span class="legend-dot dot-occupied"></span>จองแล้ว</div>
        </div>

        <!-- Zones Layout -->
        <div class="seating-grid-container">
          <!-- VIP Pit -->
          <div class="seat-zone-block">
            <div class="zone-header-label">
              <span class="badge-primary">VIP PIT</span> VIP Standing (6,500 THB)
            </div>
            <div class="seat-row-grid seat-grid-vip">
              ${vipSeats.map(renderSeatBtn).join('')}
            </div>
          </div>

          <!-- Zone A -->
          <div class="seat-zone-block">
            <div class="zone-header-label">
              <span class="badge-accent">ZONE A</span> Floor Seated (4,500 THB)
            </div>
            <div class="seat-row-grid seat-grid-a">
              ${aSeats.map(renderSeatBtn).join('')}
            </div>
          </div>

          <!-- Zone B -->
          <div class="seat-zone-block">
            <div class="zone-header-label">
              <span class="badge-accent" style="background:#0284c7;">ZONE B</span> Lower Tier (3,200 THB)
            </div>
            <div class="seat-row-grid seat-grid-b">
              ${bSeats.map(renderSeatBtn).join('')}
            </div>
          </div>

          <!-- Zone C -->
          <div class="seat-zone-block">
            <div class="zone-header-label">
              <span class="badge-accent" style="background:#0f766e;">ZONE C</span> Upper Tier (1,800 THB)
            </div>
            <div class="seat-row-grid seat-grid-c">
              ${cSeats.map(renderSeatBtn).join('')}
            </div>
          </div>
        </div>

        <!-- Selected Seats Display Bar -->
        <div class="selected-seats-bar">
          <div class="selected-seats-summary">
            <span class="text-muted" style="font-size:12px;">ที่นั่งที่เลือก (${selectedSeats.length}/${MAX_SEATS}):</span>
            <div class="selected-seats-tags">
              ${
                selectedSeats.length
                  ? selectedSeats.map((s) => `<span class="seat-tag">${s.id}</span>`).join('')
                  : '<span class="text-muted" style="font-style:italic;">ยังไม่ได้เลือกที่นั่ง (คลิกที่นั่งด้านบน)</span>'
              }
            </div>
          </div>
        </div>
      </div>
    `;

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
    getSelectedSeats: () => [...selectedSeats],
    getSelectedSeatCodes: () => selectedSeats.map((s) => s.id),
    onChange: (fn) => changeListeners.push(fn),
    MAX_SEATS
  };
})();
