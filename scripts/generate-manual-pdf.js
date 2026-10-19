/**
 * Generates the 1-Page A4 PDF User Manual (user-manual.pdf) from user-manual.html
 * using Playwright-Core (msedge) with full background graphics and Thai font rendering.
 */
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

async function generateManualPdf() {
  const rootDir = path.resolve(__dirname, '..');
  const htmlPath = path.join(rootDir, 'user-manual.html');
  const pdfOutPath = path.join(rootDir, 'user-manual.pdf');
  const thaiPdfOutPath = path.join(rootDir, 'คู่มือการใช้งาน-ThaiTicketHub-1หน้า.pdf');
  const ceoPdfOutPath = path.resolve(rootDir, '..', 'CEO', 'คู่มือการใช้งาน-ThaiTicketHub-1หน้า.pdf');
  const previewPngPath = path.join(rootDir, 'tests', 'screenshots', 'user-manual-1page.png');
  const artifactPngPath =
    'C:\\Users\\Fernclinic\\.gemini\\antigravity\\brain\\ec027f62-cd62-45c7-986a-f0c62569cc28\\user-manual-1page.png';

  fs.mkdirSync(path.dirname(previewPngPath), { recursive: true });

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1024, height: 1448 },
      deviceScaleFactor: 2
    });

    const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');
    await page.goto(fileUrl, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts && document.fonts.ready);

    // Screenshot the A4 sheet element for visual verification
    const sheet = page.locator('#manualPage');
    await sheet.screenshot({ path: previewPngPath });
    try {
      fs.copyFileSync(previewPngPath, artifactPngPath);
    } catch {
      /* ignore */
    }

    // Generate exact 1-page A4 PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: false,
      printBackground: true,
      pageRanges: '1',
      margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' }
    });

    fs.writeFileSync(pdfOutPath, pdfBuffer);
    fs.writeFileSync(thaiPdfOutPath, pdfBuffer);
    try {
      fs.writeFileSync(ceoPdfOutPath, pdfBuffer);
    } catch {
      /* ignore if parent path differs */
    }

    console.log(`Generated 1-Page PDF (${pdfBuffer.length} bytes) -> ${pdfOutPath}`);
  } finally {
    await browser.close();
  }
}

generateManualPdf().catch((err) => {
  console.error('PDF generation failed:', err);
  process.exit(1);
});
