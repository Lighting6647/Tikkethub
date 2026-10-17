/**
 * Draws an e-ticket onto a canvas so the customer can save it as a PNG.
 * Includes holder name, phone number, zone, quantity, approval status, and gate QR code.
 */
(function () {
  const W = 1080;
  const H = 1840;
  const FONT = '"Noto Sans Thai", "Segoe UI", sans-serif';
  const C = {
    primary: '#B40000',
    accent: '#229BFF',
    pending: '#F5A623',
    surface: '#333333',
    elevated: '#434343',
    text: '#FFFFFF',
    muted: '#999999',
    border: 'rgba(204,204,204,0.25)'
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrapLines(ctx, text, maxWidth) {
    const str = String(text || '');
    const tokens = /\s/.test(str) ? str.split(/(\s+)/) : Array.from(str);
    const lines = [];
    let line = '';
    tokens.forEach((tok) => {
      const test = line + tok;
      if (ctx.measureText(test).width > maxWidth && line.trim()) {
        lines.push(line.trim());
        line = tok.trimStart();
      } else {
        line = test;
      }
    });
    if (line.trim()) lines.push(line.trim());
    return lines;
  }

  function drawQr(ctx, text, x, y, size) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const cell = size / count;
    ctx.fillStyle = '#000000';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect(
            Math.floor(x + c * cell),
            Math.floor(y + r * cell),
            Math.ceil(cell),
            Math.ceil(cell)
          );
        }
      }
    }
  }

  function field(ctx, label, value, x, y, color, maxWidth = 420) {
    ctx.fillStyle = C.muted;
    ctx.font = `400 26px ${FONT}`;
    ctx.fillText(label, x, y);
    ctx.fillStyle = color || C.text;
    ctx.font = `700 36px ${FONT}`;
    const line = wrapLines(ctx, String(value || '-'), maxWidth)[0] || '-';
    ctx.fillText(line, x, y + 48);
  }

  async function ensureFonts() {
    if (!document.fonts) return;
    try {
      await Promise.all([
        document.fonts.load(`700 40px "Noto Sans Thai"`),
        document.fonts.load(`400 28px "Noto Sans Thai"`)
      ]);
    } catch {
      /* fall back to system font */
    }
  }

  async function render(ticket) {
    await ensureFonts();
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, W, H);

    const pad = 60;
    const bx = pad;
    const bw = W - pad * 2;
    roundRect(ctx, bx, pad, bw, H - pad * 2, 36);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = C.elevated;
    ctx.fillRect(bx, pad, bw, H - pad * 2);

    // Header gradient (#333 -> #000) with primary bar
    const headerH = 500;
    const grad = ctx.createLinearGradient(bx, pad, bx + bw, pad + headerH);
    grad.addColorStop(0, C.surface);
    grad.addColorStop(1, '#000000');
    ctx.fillStyle = grad;
    ctx.fillRect(bx, pad, bw, headerH);
    ctx.fillStyle = C.primary;
    ctx.fillRect(bx, pad, bw, 12);
    ctx.restore();

    const ix = bx + 64;
    const iw = bw - 128;

    // Brand
    roundRect(ctx, ix, pad + 60, 104, 48, 8);
    ctx.fillStyle = C.primary;
    ctx.fill();
    ctx.fillStyle = C.text;
    ctx.font = `700 26px ${FONT}`;
    ctx.fillText('THAI', ix + 20, pad + 94);
    ctx.font = `700 34px ${FONT}`;
    ctx.fillText('TICKET', ix + 124, pad + 96);

    ctx.fillStyle = C.accent;
    ctx.font = `600 28px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText('E-TICKET', ix + iw, pad + 96);
    ctx.textAlign = 'left';

    // Event title
    ctx.fillStyle = C.text;
    let titleSize = 56;
    ctx.font = `700 ${titleSize}px ${FONT}`;
    let titleLines = wrapLines(ctx, ticket.title, iw);
    if (titleLines.length > 2) {
      titleSize = 42;
      ctx.font = `700 ${titleSize}px ${FONT}`;
      titleLines = wrapLines(ctx, ticket.title, iw).slice(0, 3);
    }
    const lineH = Math.round(titleSize * 1.3);
    let ty = pad + 200;
    titleLines.forEach((l) => {
      ctx.fillText(l, ix, ty);
      ty += lineH;
    });

    ctx.font = `400 30px ${FONT}`;
    ctx.fillStyle = '#CCCCCC';
    ctx.fillText(ticket.date, ix, ty + 8);
    ctx.fillStyle = C.muted;
    wrapLines(ctx, ticket.venue, iw)
      .slice(0, 2)
      .forEach((l, i) => ctx.fillText(l, ix, ty + 52 + i * 42));

    // Perforation
    const perfY = pad + headerH;
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(bx, perfY, 32, 0, Math.PI * 2);
    ctx.arc(bx + bw, perfY, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = C.border;
    ctx.setLineDash([16, 14]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(bx + 48, perfY);
    ctx.lineTo(bx + bw - 48, perfY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Details grid (Row 1: Holder Name & Phone, Row 2: ID Card & Zone, Row 3: Qty & Total / Status)
    const dy = perfY + 68;
    const col2 = ix + iw / 2 + 16;
    const isApproved = ticket.status === 'approved' || !ticket.status;
    const rawId = String(ticket.holderIdCard || '').trim();
    const idDigits = rawId.replace(/\D/g, '');
    const maskedId = idDigits.length === 13
      ? `${idDigits.slice(0, 1)}-${idDigits.slice(1, 5)}-xxxxx-xx-${idDigits.slice(12)}`
      : (rawId.length >= 7 ? `${rawId.slice(0, 2)}***${rawId.slice(-3)}` : (rawId || '-'));

    field(ctx, 'ผู้ถือบัตร', ticket.holderName || 'ผู้ถือบัตรทั่วไป', ix, dy);
    field(ctx, 'เบอร์โทรศัพท์', ticket.holderPhone || '-', col2, dy);

    field(ctx, 'เลขบัตร ปชช. / Passport', maskedId, ix, dy + 115);
    field(ctx, 'โซนที่นั่ง', ticket.zone, col2, dy + 115);

    field(ctx, 'จำนวน / ยอดชำระ', `${ticket.qty} ใบ · ${Number(ticket.total).toLocaleString('th-TH')} THB`, ix, dy + 230);
    field(
      ctx,
      'สถานะบัตร',
      isApproved ? 'อนุมัติแล้ว' : 'รอตรวจสอบสลิป',
      col2,
      dy + 230,
      isApproved ? C.accent : C.pending
    );

    // QR code (encodes booking reference + holder for gate scanning)
    const qrSize = 380;
    const qrBox = qrSize + 52;
    const qx = (W - qrBox) / 2;
    const qy = dy + 340;
    roundRect(ctx, qx, qy, qrBox, qrBox, 24);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    drawQr(
      ctx,
      `THAITICKET|${ticket.ref}|${ticket.zone}|${ticket.qty}|${ticket.holderPhone || ''}|${rawId}`,
      qx + 26,
      qy + 26,
      qrSize
    );

    ctx.textAlign = 'center';
    ctx.fillStyle = C.muted;
    ctx.font = `400 26px ${FONT}`;
    ctx.fillText('หมายเลขการจอง', W / 2, qy + qrBox + 54);
    ctx.fillStyle = C.text;
    ctx.font = `700 48px ${FONT}`;
    ctx.fillText(ticket.ref, W / 2, qy + qrBox + 110);

    ctx.fillStyle = C.muted;
    ctx.font = `400 24px ${FONT}`;
    ctx.fillText('แสดง QR Code นี้ที่จุดตรวจบัตรหน้างาน · ห้ามเผยแพร่ภาพบัตร', W / 2, H - pad - 40);
    ctx.textAlign = 'left';

    return canvas;
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('ไม่สามารถสร้างไฟล์ภาพได้'))), 'image/png');
    });
  }

  window.TicketRenderer = { render, canvasToBlob };
})();
