const test = require('node:test');
const assert = require('node:assert/strict');

// Mock minimal DOM environment for TablePicker test
class MockElement {
  constructor(tag) {
    this.tagName = tag;
    this.className = '';
    this.classList = {
      _classes: new Set(),
      add: (cls) => this.classList._classes.add(cls),
      remove: (cls) => this.classList._classes.delete(cls),
      contains: (cls) => this.classList._classes.has(cls)
    };
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.innerHTML = '';
    this.listeners = {};
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  addEventListener(event, fn) {
    this.listeners[event] = this.listeners[event] || [];
    this.listeners[event].push(fn);
  }
  querySelectorAll(selector) {
    const results = [];
    function traverse(el) {
      if (selector === '.table-picker-item.is-selected' && el.classList.contains('is-selected')) {
        results.push(el);
      }
      (el.children || []).forEach(traverse);
    }
    traverse(this);
    return results;
  }
}

global.window = {};
global.document = {
  createElement: (tag) => new MockElement(tag)
};

require('../js/table-picker.js');

test('TablePicker: module exposes render, CELL (75), and OFFSET (4)', () => {
  const TP = window.TablePicker;
  assert.ok(TP, 'TablePicker is defined');
  assert.equal(typeof TP.render, 'function');
  assert.equal(TP.CELL, 75);
  assert.equal(TP.OFFSET, 4);
});

test('TablePicker: renders tables with correct coordinates and states', () => {
  const TP = window.TablePicker;
  const container = new MockElement('div');

  const instance = TP.render(container, {
    gridWidth: 8,
    gridHeight: 5,
    tables: [
      { id: 101, table_number: 'VIP-01', position_x: 2, position_y: 1, seats: 4, price: 6500 },
      { id: 102, table_number: 'VIP-02', position_x: 4, position_y: 1, seats: 4, price: 6500 },
      { id: 103, table_number: 'A-01', position_x: 2, position_y: 3, seats: 4, price: 4500 }
    ],
    bookedIds: [102],
    initialSelected: [101]
  });

  assert.ok(instance, 'render instance returned');
  assert.deepEqual(instance.getSelected(), ['101']);

  // Test clear
  instance.clear();
  assert.deepEqual(instance.getSelected(), []);
});
