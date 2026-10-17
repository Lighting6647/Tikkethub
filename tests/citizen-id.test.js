const test = require('node:test');
const assert = require('node:assert/strict');
const { validateThaiCitizenId, formatPhoneInput, formatIdCardInput } = require('../js/app.js');
const { buildGuestListCsv } = require('../server.js');

test('validateThaiCitizenId verifies official DOPA 13-digit checksum', () => {
  // Valid Thai Citizen IDs
  assert.equal(validateThaiCitizenId('1-1004-12345-67-3'), true, 'Valid checksum 3');
  assert.equal(validateThaiCitizenId('1100412345673'), true, 'Valid raw 13 digits');

  // Another valid Thai ID: 3100600123451
  // 3*13 + 1*12 + 0 + 0 + 6*9 + 0 + 0 + 1*6 + 2*5 + 3*4 + 4*3 + 5*2
  // = 39 + 12 + 54 + 6 + 10 + 12 + 12 + 10 = 155.
  // 155 % 11 = 1. (11 - 1) % 10 = 0. So 3100600123450
  assert.equal(validateThaiCitizenId('3-1006-00123-45-0'), true, 'Valid checksum 0');

  // Invalid Thai Citizen IDs
  assert.equal(validateThaiCitizenId('1-1004-12345-67-8'), false, 'Invalid checksum digit 8 instead of 3');
  assert.equal(validateThaiCitizenId('1234567890123'), false, 'Random invalid 13 digits');
  assert.equal(validateThaiCitizenId('0123456789012'), false, 'Starts with 0 is invalid');
  assert.equal(validateThaiCitizenId('12345'), false, 'Too short');
  assert.equal(validateThaiCitizenId(''), false, 'Empty string');
  assert.equal(validateThaiCitizenId(null), false, 'Null check');

  // Foreign Passports (Alphanumeric 7-15 chars)
  assert.equal(validateThaiCitizenId('AA1234567'), true, 'Valid passport');
  assert.equal(validateThaiCitizenId('P987654321'), true, 'Valid passport');
  assert.equal(validateThaiCitizenId('A123'), false, 'Passport too short');
});

test('formatPhoneInput formats Thai mobile numbers with hyphens', () => {
  assert.equal(formatPhoneInput('0954654698'), '095-465-4698');
  assert.equal(formatPhoneInput('0812345678'), '081-234-5678');
  assert.equal(formatPhoneInput('081234567'), '081-234-567');
  assert.equal(formatPhoneInput('095-465-4698'), '095-465-4698');
  assert.equal(formatPhoneInput(''), '');
});

test('formatIdCardInput formats Thai ID with 5-block mask and handles passports', () => {
  assert.equal(formatIdCardInput('1100412345673'), '1-1004-12345-67-3');
  assert.equal(formatIdCardInput('1-1004-12345-67-3'), '1-1004-12345-67-3');
  assert.equal(formatIdCardInput('ab1234567'), 'AB1234567');
});

test('buildGuestListCsv exports UTF-8 BOM CSV with ID Card, Phone, Seats and Check-in columns', () => {
  const sampleOrders = [
    {
      ref: 'TTA1B2-C3D4',
      title: 'ECHOES OF ASIA WORLD TOUR 2026',
      date: '14 พ.ย. 2026',
      zone: 'VIP Standing',
      seats: ['VIP-01', 'VIP-02'],
      qty: 2,
      holderName: 'สมชาย รักดนตรี',
      holderIdCard: '1-1004-12345-67-3',
      holderPhone: '095-465-4698',
      lineUserId: 'U1234567890abcdef1234567890abcdef',
      status: 'approved',
      checkedInAt: 1731580000000,
      issuedAt: 1731500000000
    }
  ];

  const csv = buildGuestListCsv(sampleOrders);
  assert.ok(csv.startsWith('\uFEFF'), 'CSV must include UTF-8 BOM for Thai Excel compatibility');
  assert.ok(csv.includes('เลขบัตรประชาชน / Passport'), 'Includes ID card header');
  assert.ok(csv.includes('เบอร์โทรศัพท์ติดต่อ'), 'Includes phone header');
  assert.ok(csv.includes('เลขที่นั่ง (Seat Codes)'), 'Includes seat codes header');
  assert.ok(csv.includes('1-1004-12345-67-3'), 'Contains citizen ID');
  assert.ok(csv.includes('095-465-4698'), 'Contains formatted phone');
  assert.ok(csv.includes('VIP-01, VIP-02'), 'Contains seat codes');
  assert.ok(csv.includes('อนุมัติแล้ว (สิทธิ์เข้างานสมบูรณ์)'), 'Contains approved status text');
  assert.ok(csv.includes('เข้างานแล้ว'), 'Contains check-in status');
});
