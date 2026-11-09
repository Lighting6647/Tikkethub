/**
 * 1-Click LINE Rich Menu Deployer CLI
 * Usage:
 *   node scripts/deploy-rich-menu.js [templateKey]
 *   Templates: large_6grid (default), small_3grid, small_2grid, small_1banner
 */
const db = require('../backend/db');
const { deployRichMenuToLine, listRichMenuTemplates } = require('../backend/line');

async function main() {
  const templateKey = process.argv[2] || 'large_6grid';
  const baseUrl = process.env.PUBLIC_BASE_URL || 'https://tikkethub.vercel.app';
  const token =
    process.env.LINE_CHANNEL_ACCESS_TOKEN ||
    db.getSetting('line_channel_access_token', '');

  console.log('======================================================');
  console.log('🚀 STAGE PASS · LINE Rich Menu 1-Click Deployer');
  console.log('======================================================');
  console.log(`📌 Template : ${templateKey}`);
  console.log(`🌐 Base URL : ${baseUrl}`);
  console.log(`🔑 Token    : ${token ? 'Configured (' + token.slice(0, 6) + '...)' : 'Simulation Mode (No Token)'}`);

  const result = await deployRichMenuToLine({
    templateKey,
    channelAccessToken: token,
    baseUrl
  });

  if (!result.ok) {
    console.error('❌ Deploy Failed:', result.error);
    process.exit(1);
  }

  db.setSetting('active_rich_menu_template', result.templateKey);
  db.setSetting('active_rich_menu_id', result.richMenuId || '');

  console.log('✅', result.message);
  console.log(`📦 Rich Menu ID : ${result.richMenuId}`);
  console.log(`🖼️ Image Size   : ${result.imageSizeKB} KB (LINE Limit: 1024 KB)`);
  console.log(`🎯 Tap Areas    : ${result.payload.areas.length} interactive buttons`);
  console.log('------------------------------------------------------');
  console.log('Available templates:', listRichMenuTemplates(baseUrl).map((t) => t.key).join(', '));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
