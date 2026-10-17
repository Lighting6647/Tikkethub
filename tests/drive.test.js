const test = require('node:test');
const assert = require('node:assert/strict');
const drive = require('../backend/drive');
const db = require('../backend/db');

test('Google Drive: handles unconfigured credentials gracefully', async () => {
  db.setSetting('google_drive_folder_id', '');
  db.setSetting('google_service_account_email', '');
  db.setSetting('google_service_account_private_key', '');

  const result = await drive.uploadSlipToDrive({
    buffer: Buffer.from('fake-slip-image-bytes'),
    mimeType: 'image/png',
    fileName: 'test_slip.png',
    ref: 'TEST-UNCONFIG'
  });

  assert.equal(result.ok, false);
  assert.equal(result.configured, false);
  assert.match(result.message, /Google Drive ยังไม่ได้กำหนดค่า/);
});

test('Google Drive: test connection validates missing fields', async () => {
  const result = await drive.testDriveConnection({
    folderId: '',
    clientEmail: '',
    privateKey: ''
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /กรุณากรอกข้อมูล/);
});
