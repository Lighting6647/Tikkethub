const test = require('node:test');
const assert = require('node:assert/strict');

// Mock browser environment for unit test
global.window = {};
global.document = {
  getElementById: () => null
};

require('../js/seat-map.js');

test('SeatMap: auto-selects seats within zone capacity and limits', () => {
  const SeatMap = window.SeatMap;
  assert.ok(SeatMap, 'SeatMap is defined');

  SeatMap.clear();
  assert.equal(SeatMap.getSelectedSeats().length, 0);

  const selected = SeatMap.autoSelectForZone('VIP Standing', 2);
  assert.equal(selected.length, 2);
  assert.equal(selected[0].zoneCode, 'VIP');
  assert.equal(selected[1].zoneCode, 'VIP');
  assert.deepEqual(SeatMap.getSelectedSeatCodes(), [selected[0].id, selected[1].id]);
});

test('SeatMap: max 4 seats restriction', () => {
  const SeatMap = window.SeatMap;
  SeatMap.clear();

  // Select 4 seats
  SeatMap.autoSelectForZone('Zone A (บัตรนั่ง)', 4);
  assert.equal(SeatMap.getSelectedSeats().length, 4);

  // Attempt to toggle a 5th seat should return false
  const result = SeatMap.toggleSeat('B-01');
  assert.equal(result, false, 'cannot exceed 4 seats');
  assert.equal(SeatMap.getSelectedSeats().length, 4);
});

test('SeatMap: occupied seats cannot be selected', () => {
  const SeatMap = window.SeatMap;
  SeatMap.clear();

  // VIP-03 is occupied
  const result = SeatMap.toggleSeat('VIP-03');
  assert.equal(result, false, 'occupied seat rejected');
  assert.equal(SeatMap.getSelectedSeats().length, 0);
});
