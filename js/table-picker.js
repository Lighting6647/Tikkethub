/**
 * STAGE PASS — Table Picker Grid Component
 * Reverse-Engineered & Enhanced from officialvirgin.com
 * Supports sparse absolute positioning, live status states (available, taken, reserving, selected),
 * mobile gesture handling, and reactive callbacks.
 */
(function (window) {
  'use strict';

  const CELL = 75;
  const OFFSET = 4;

  function render(containerEl, options) {
    if (!containerEl) return null;

    const {
      tables = [],
      objects = [],
      gridWidth = 10,
      gridHeight = 6,
      bookedIds = [],
      reservingIds = [],
      maintenanceIds = [],
      allowedIds = null,
      selectionMode = 'any',
      maxSelect = null,
      initialSelected = [],
      onChange = function () {}
    } = options || {};

    const bookedSet = new Set(bookedIds.map(String));
    const reservingSet = new Set(reservingIds.map(String));
    const maintenanceSet = new Set(maintenanceIds.map(String));
    const allowedSet = allowedIds ? new Set(allowedIds.map(String)) : null;
    const selected = new Set(initialSelected.map(String));

    const canvas = document.createElement('div');
    canvas.className = 'table-picker-canvas';
    canvas.style.width = (gridWidth * CELL) + 'px';
    canvas.style.height = (gridHeight * CELL) + 'px';

    function cellState(id) {
      const key = String(id);
      if (bookedSet.has(key)) return 'is-taken';
      if (reservingSet.has(key)) return 'is-reserving';
      if (maintenanceSet.has(key)) return 'is-maintenance';
      if (allowedSet && !allowedSet.has(key)) return 'is-not-in-set';
      return 'is-available';
    }

    function isSelectable(id) {
      const state = cellState(id);
      return state === 'is-available' || state === 'is-selected';
    }

    function placeItem(el, x, y) {
      el.style.left = ((x - 1) * CELL + OFFSET) + 'px';
      el.style.top = ((y - 1) * CELL + OFFSET) + 'px';
    }

    function emitChange() {
      onChange(Array.from(selected));
    }

    function toggle(id, el) {
      const key = String(id);
      if (!isSelectable(id) && !selected.has(key)) return;

      if (selected.has(key)) {
        selected.delete(key);
        el.classList.remove('is-selected');
        el.classList.add(cellState(id));
      } else {
        if (selectionMode === 'exact' && maxSelect !== null && selected.size >= maxSelect) {
          return;
        }
        selected.add(key);
        el.classList.remove(cellState(id));
        el.classList.add('is-selected');
      }
      emitChange();
    }

    tables.forEach(function (table) {
      const x = parseInt(table.position_x, 10) || 1;
      const y = parseInt(table.position_y, 10) || 1;
      const id = table.id;
      const el = document.createElement('div');
      const selectable = isSelectable(id);
      const state = selected.has(String(id)) ? 'is-selected' : cellState(id);

      el.className = 'table-picker-item ' + state;
      el.dataset.id = id;
      el.dataset.x = x;
      el.dataset.y = y;
      el.dataset.tableNumber = table.table_number || '';
      placeItem(el, x, y);

      const priceVal = parseFloat(table.price);
      el.innerHTML =
        '<span style="font-size:14px; opacity:0.85;">🍽️</span>' +
        '<span>' + (table.table_number || '') + '</span>' +
        '<small>' + (table.seats || 4) + ' ที่</small>' +
        (priceVal > 0
          ? '<small class="tp-price">฿' + Number(priceVal).toLocaleString('th-TH', { maximumFractionDigits: 0 }) + '</small>'
          : '');

      if (selectable) {
        el.addEventListener('click', function () { toggle(id, el); });
      }

      canvas.appendChild(el);
    });

    objects.forEach(function (object) {
      const x = parseInt(object.position_x, 10) || 1;
      const y = parseInt(object.position_y, 10) || 1;
      const el = document.createElement('div');
      el.className = 'table-picker-item object-item';
      el.dataset.id = object.id;
      el.dataset.x = x;
      el.dataset.y = y;
      placeItem(el, x, y);
      el.innerHTML = '<span style="font-size:14px;">' + (object.icon || '🎪') + '</span><small>' + (object.name || '') + '</small>';
      canvas.appendChild(el);
    });

    const wrap = document.createElement('div');
    wrap.className = 'table-picker-wrap';
    wrap.appendChild(canvas);
    containerEl.innerHTML = '';
    containerEl.appendChild(wrap);

    return {
      getSelected: function () { return Array.from(selected); },
      clear: function () {
        selected.clear();
        canvas.querySelectorAll('.table-picker-item.is-selected').forEach(function (el) {
          const id = el.dataset.id;
          el.classList.remove('is-selected');
          el.classList.add(cellState(id));
        });
        emitChange();
      }
    };
  }

  window.TablePicker = { render: render, CELL: CELL, OFFSET: OFFSET };
})(typeof window !== 'undefined' ? window : this);
