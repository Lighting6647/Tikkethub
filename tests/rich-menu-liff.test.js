const test = require('node:test');
const assert = require('node:assert/strict');
const {
  listRichMenuTemplates,
  buildRichMenuPayload,
  deployRichMenuToLine,
  buildWebhookReplyMessages
} = require('../backend/line');
const { applyAutoDetectedLineProfile } = require('../js/app');

test('LINE Rich Menu templates list all 4 layouts with valid tap areas', () => {
  const templates = listRichMenuTemplates('https://tikkethub.vercel.app');
  assert.equal(templates.length, 4);
  const keys = templates.map((t) => t.key);
  assert.deepEqual(keys, ['large_6grid', 'small_3grid', 'small_2grid', 'small_1banner']);

  const large = buildRichMenuPayload('large_6grid', 'https://tikkethub.vercel.app');
  assert.equal(large.size.width, 2500);
  assert.equal(large.size.height, 1686);
  assert.equal(large.areas.length, 6);
  assert.equal(large.areas[0].action.type, 'uri');
  assert.equal(large.areas[1].action.type, 'message');
  assert.equal(large.areas[1].action.text, 'บัตร');
});

test('deployRichMenuToLine verifies < 1MB JPEG image exists for all 4 templates', async () => {
  for (const key of ['large_6grid', 'small_3grid', 'small_2grid', 'small_1banner']) {
    const res = await deployRichMenuToLine({
      templateKey: key,
      channelAccessToken: '',
      baseUrl: 'https://tikkethub.vercel.app'
    });
    assert.equal(res.ok, true, `Template ${key} should succeed`);
    assert.equal(res.simulated, true);
    assert.ok(res.imageSizeKB > 0 && res.imageSizeKB < 1024, `Image size ${res.imageSizeKB}KB must be < 1024KB`);
  }
});

test('buildWebhookReplyMessages returns text + 1-click Auto-Fill Flex Message card', () => {
  const sampleId = 'U22e8f8c71ad28f6ae4c3eece3f6c39d4';
  const msgs = buildWebhookReplyMessages(sampleId, {
    baseUrl: 'https://tikkethub.vercel.app',
    displayName: 'คุณไลท์'
  });
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].type, 'text');
  assert.ok(msgs[0].text.includes(sampleId));
  assert.equal(msgs[1].type, 'flex');
  const buttonUri = msgs[1].contents.footer.contents[0].action.uri;
  assert.ok(buttonUri.includes(`lineUserId=${sampleId}`));
  assert.ok(buttonUri.includes(encodeURIComponent('คุณไลท์')));
});

test('applyAutoDetectedLineProfile validates LINE User ID format', () => {
  const validId = 'U22e8f8c71ad28f6ae4c3eece3f6c39d4';
  assert.equal(applyAutoDetectedLineProfile(validId, 'คุณไลท์', 'LINE LIFF'), true);
  assert.equal(applyAutoDetectedLineProfile('invalid-id', 'คุณไลท์', 'LINE LIFF'), false);
  assert.equal(applyAutoDetectedLineProfile('', 'คุณไลท์', 'LINE LIFF'), false);
});
