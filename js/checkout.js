/**
 * Checkout flow: PromptPay QR -> attach slip -> submit to server (checks duplicate slip) -> show ticket status.
 */
(function () {
  const cfg = window.APP_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  let order = null;
  let slipFile = null;
  let slipUrl = null;
  let timerId = null;
  let deadline = 0;
  let activePromptPayId = cfg.PROMPTPAY_ID || '0954654698';
  let activeMerchantName = cfg.MERCHANT_NAME || 'STAGE PASS';
  let activeBankAccount = '';
  let activeBankName = '';

  function setStep(step) {
    document.querySelectorAll('#paymentModal [data-step]').forEach((el) => {
      el.hidden = el.dataset.step !== step;
    });
    const modal = $('paymentModal');
    if (modal) modal.dataset.locked = step === 'verifying' ? 'true' : 'false';
  }

  function formatPromptPayId(id) {
    const d = String(id || '').replace(/\D/g, '');
    if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    if (d.length === 13) return `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}`;
    return d || id;
  }

  async function syncPromptPayConfig() {
    // 1. Check local cache first for instant update
    try {
      const raw = localStorage.getItem('stagepass_admin_settings');
      if (raw) {
        const local = JSON.parse(raw);
        if (local.promptpayId) activePromptPayId = local.promptpayId;
        if (local.merchantName) activeMerchantName = local.merchantName;
        if (local.bankAccount) activeBankAccount = local.bankAccount;
        if (local.bankName) activeBankName = local.bankName;
      }
    } catch (_) {}

    // 2. Fetch public payment config from server
    try {
      const res = await fetch('/api/payment-config');
      if (res.ok) {
        const data = await res.json();
        if (data && data.ok) {
          if (data.promptpayId || data.promptpay_id) {
            activePromptPayId = data.promptpayId || data.promptpay_id;
          }
          if (data.merchantName || data.merchant_name) {
            activeMerchantName = data.merchantName || data.merchant_name;
          }
          if (data.bankAccount || data.bank_account) {
            activeBankAccount = data.bankAccount || data.bank_account;
          }
          if (data.bankName || data.bank_name) {
            activeBankName = data.bankName || data.bank_name;
          }
        }
      }
    } catch {
      /* use fallback config */
    }

    const ppEl = $('payTargetDisplay') || $('payPromptpayId');
    if (ppEl) ppEl.textContent = formatPromptPayId(activePromptPayId);

    const merchEl = $('payMerchant');
    if (merchEl) merchEl.textContent = activeMerchantName;

    const bankRow = $('payBankRow');
    if (bankRow) {
      if (activeBankAccount) {
        bankRow.style.display = 'flex';
        if ($('payBankName')) $('payBankName').textContent = activeBankName ? `${activeBankName} :` : 'เลขที่บัญชี :';
        if ($('payBankAccount')) $('payBankAccount').textContent = activeBankAccount;
      } else {
        bankRow.style.display = 'none';
      }
    }
    if (order) {
      renderQr();
    }
  }

  function renderQr() {
    if (!order) return;
    const qrEl = $('payQrCanvas') || $('payQr');
    if (!qrEl) return;
    try {
      const totalAmount = order.total || order.unitPrice || 0;
      const payload = window.PromptPay ? window.PromptPay.buildPayload(activePromptPayId, totalAmount) : '';
      if (typeof qrcode !== 'undefined' && payload) {
        try {
          const qr = qrcode(0, 'M');
          qr.addData(payload);
          qr.make();
          // Generate SVG with explicit dimensions and scalable attributes
          qrEl.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 0, alt: 'PromptPay QR' });
          const svg = qrEl.querySelector('svg');
          if (svg) {
            svg.setAttribute('width', '220');
            svg.setAttribute('height', '220');
            svg.style.width = '220px';
            svg.style.height = '220px';
            svg.style.maxWidth = '100%';
            svg.style.maxHeight = '100%';
            svg.style.display = 'block';
            svg.style.margin = '0 auto';
          }
        } catch {
          // Fallback to data URI img tag
          try {
            const qr = qrcode(0, 'M');
            qr.addData(payload);
            qr.make();
            qrEl.innerHTML = qr.createImgTag(5, 0);
            const img = qrEl.querySelector('img');
            if (img) {
              img.style.width = '220px';
              img.style.height = '220px';
              img.style.display = 'block';
              img.style.margin = '0 auto';
            }
          } catch {
            qrEl.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=0&data=${encodeURIComponent(payload)}" alt="PromptPay QR" style="width:220px;height:220px;display:block;margin:0 auto;">`;
          }
        }
      } else {
        qrEl.innerHTML = `<p style="padding:20px; color:#333; font-size:12px;">พร้อมเพย์: ${formatPromptPayId(activePromptPayId)}<br>ยอดชำระ: ${totalAmount.toLocaleString('th-TH')} THB</p>`;
      }
    } catch (err) {
      qrEl.innerHTML = `<p class="qr-error" style="color:var(--fire); font-size:12px; padding:10px;">สร้าง QR ไม่สำเร็จ: ${window.UI ? window.UI.escapeHtml(err.message) : err.message}</p>`;
    }
  }

  function tick() {
    const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    const m = String(Math.floor(left / 60)).padStart(2, '0');
    const s = String(left % 60).padStart(2, '0');
    
    const cdEl = $('payTimerLabel') || $('payCountdown');
    if (cdEl) {
      if (cdEl.id === 'payTimerLabel') {
        cdEl.textContent = `หมดอายุใน ${m}:${s} นาที`;
      } else {
        cdEl.textContent = `${m}:${s}`;
      }
    }
    const wrap = $('payCountdownWrap');
    if (wrap) wrap.classList.toggle('is-urgent', left <= 60);
    if (left === 0) expire();
  }

  function startTimer() {
    clearInterval(timerId);
    const timeout = cfg.PAYMENT_TIMEOUT_SECONDS || 900;
    deadline = Date.now() + timeout * 1000;
    const exp = $('payExpired');
    if (exp) exp.hidden = true;
    const qrBox = $('payQrBox') || document.querySelector('.pay-qr-box');
    if (qrBox) qrBox.classList.remove('is-expired');
    tick();
    timerId = setInterval(tick, 1000);
  }

  function expire() {
    clearInterval(timerId);
    const qrBox = $('payQrBox') || document.querySelector('.pay-qr-box');
    if (qrBox) qrBox.classList.add('is-expired');
    const exp = $('payExpired');
    if (exp) exp.hidden = false;
    updateConfirmState();
  }

  function isExpired() {
    return Date.now() >= deadline;
  }

  function clearSlip() {
    slipFile = null;
    if (slipUrl) URL.revokeObjectURL(slipUrl);
    slipUrl = null;
    const input = $('slipFileInput') || $('slipInput');
    if (input) input.value = '';
    const prev = $('slipPreviewWrap') || $('slipPreview');
    if (prev) prev.hidden = true;
    const prompt = $('slipDropPrompt');
    if (prompt) prompt.hidden = false;
    const dz = $('slipDropzone');
    if (dz) dz.hidden = false;
    const err = $('slipError');
    if (err) err.textContent = '';
    updateConfirmState();
  }

  function validateSlip(file) {
    const allowed = cfg.SLIP_ALLOWED_TYPES || ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowed.includes(file.type)) return 'รองรับเฉพาะไฟล์ภาพ JPG, PNG หรือ WEBP';
    const maxBytes = cfg.SLIP_MAX_BYTES || 5 * 1024 * 1024;
    if (file.size > maxBytes) return 'ไฟล์ใหญ่เกิน 5 MB กรุณาเลือกไฟล์ใหม่';
    if (file.size < 1024) return 'ไฟล์เล็กผิดปกติ กรุณาตรวจสอบสลิปอีกครั้ง';
    return null;
  }

  function acceptSlip(file) {
    const err = validateSlip(file);
    if (err) {
      const errEl = $('slipError');
      if (errEl) errEl.textContent = err;
      const input = $('slipFileInput') || $('slipInput');
      if (input) input.value = '';
      return;
    }
    clearSlip();
    slipFile = file;
    slipUrl = URL.createObjectURL(file);
    const thumb = $('slipPreviewImg') || $('slipThumb');
    if (thumb) thumb.src = slipUrl;
    const nameEl = $('slipName');
    if (nameEl) nameEl.textContent = file.name;
    const sizeEl = $('slipSize');
    if (sizeEl) sizeEl.textContent = `${(file.size / 1024).toFixed(0)} KB`;
    
    const prev = $('slipPreviewWrap') || $('slipPreview');
    if (prev) prev.hidden = false;
    const prompt = $('slipDropPrompt');
    if (prompt) prompt.hidden = true;

    updateConfirmState();
    if (window.UI && window.UI.toast) window.UI.toast('แนบสลิปเรียบร้อยแล้ว');
  }

  function updateConfirmState() {
    const ready = !!slipFile && !isExpired();
    const btn = $('payConfirmBtn');
    if (btn) btn.disabled = !ready;
    const hint = $('payConfirmHint');
    if (hint) {
      hint.textContent = isExpired()
        ? 'QR หมดอายุ กรุณาสร้าง QR ใหม่'
        : slipFile
          ? 'พร้อมส่งสลิปให้แอดมินตรวจสอบ'
          : 'แนบสลิปเพื่อยืนยันการชำระเงิน';
    }
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์สลิปได้'));
      reader.readAsDataURL(file);
    });
  }

  function compressImage(file, maxDimension = 1280, quality = 0.85) {
    return new Promise((resolve) => {
      if (file.size < 400 * 1024) {
        fileToDataUrl(file).then(resolve).catch(() => resolve(''));
        return;
      }
      const img = new Image();
      const reader = new FileReader();
      reader.onload = (e) => {
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', quality);
          resolve(compressed);
        };
        img.onerror = () => {
          fileToDataUrl(file).then(resolve).catch(() => resolve(''));
        };
        img.src = e.target.result;
      };
      reader.onerror = () => {
        fileToDataUrl(file).then(resolve).catch(() => resolve(''));
      };
      reader.readAsDataURL(file);
    });
  }

  async function confirmPayment() {
    if (!slipFile || isExpired()) return;
    clearInterval(timerId);
    setStep('verifying');

    let saved = null;
    try {
      const slipData = await compressImage(slipFile);
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: order.title,
          date: order.date,
          venue: order.venue,
          zone: order.zone,
          qty: order.qty,
          unitPrice: order.unitPrice,
          total: order.total,
          promoCode: order.promoCode || '',
          discountAmount: order.discountAmount || 0,
          seats: order.seats || [],
          holderName: order.holderName || 'ผู้จองบัตร',
          holderPhone: order.holderPhone || '081-xxx-xxxx',
          holderIdCard: order.holderIdCard || '',
          lineUserId: order.lineUserId || '',
          slipName: slipFile.name,
          slipMime: slipFile.type || 'image/png',
          slipData
        })
      });
      const data = await res.json();
      if (!res.ok || data.ok === false || !data.order) {
        setStep('pay');
        startTimer();
        const errEl = $('slipError');
        if (errEl) errEl.textContent = data.error || 'ส่งสลิปไม่สำเร็จ';
        if (window.UI) window.UI.toast(data.error || 'ส่งสลิปไม่สำเร็จ', 'error');
        return;
      }
      if (window.TicketStore) saved = window.TicketStore.add(data.order);
    } catch (e) {
      /* Fallback to client-side store only when backend is unreachable */
    }

    if (!saved) {
      if (window.TicketStore) {
        saved = window.TicketStore.add({
          ref: window.TicketStore.generateRef(),
          title: order.title,
          date: order.date,
          venue: order.venue,
          zone: order.zone,
          qty: order.qty,
          total: order.total,
          seats: order.seats || [],
          holderName: order.holderName || '',
          holderPhone: order.holderPhone || '',
          holderIdCard: order.holderIdCard || '',
          lineUserId: order.lineUserId || '',
          slipName: slipFile.name,
          issuedAt: Date.now()
        });
      }
    }

    if (window.UI) window.UI.close('paymentModal');
    if (window.TicketViewer && saved) window.TicketViewer.show(saved);
  }

  function cancel() {
    clearInterval(timerId);
    clearSlip();
    if (window.UI) window.UI.close('paymentModal');
  }

  function start(o) {
    order = o;
    const titleEl = $('payTitle') || $('payEventTitle');
    if (titleEl) titleEl.textContent = o.title;

    const metaEl = $('payEventMeta');
    if (metaEl) metaEl.textContent = `${o.venue} · ${o.date}`;

    const zoneEl = $('payZone');
    if (zoneEl) zoneEl.textContent = o.zone;

    const promoNote = o.promoCode && o.discountAmount > 0 ? ` (โค้ด ${o.promoCode} ลด -${o.discountAmount.toLocaleString('th-TH')} THB)` : '';
    const qtyEl = $('payQty');
    if (qtyEl) qtyEl.textContent = `${o.qty} ใบ × ${o.unitPrice.toLocaleString('th-TH')} THB${promoNote}`;

    const seatsEl = $('paySeats');
    const seatsRow = $('paySeatsRow');
    if (o.seats && o.seats.length) {
      if (seatsEl) seatsEl.textContent = o.seats.join(', ');
      if (seatsRow) seatsRow.hidden = false;
    } else {
      if (seatsRow) seatsRow.hidden = true;
    }

    const holderEl = $('payHolder');
    if (holderEl) holderEl.textContent = `${o.holderName} (${o.holderPhone})`;

    const idEl = $('payIdCard');
    if (idEl) {
      const id = String(o.holderIdCard || '').trim();
      const idDigits = id.replace(/\D/g, '');
      const masked = idDigits.length === 13
        ? `${idDigits.slice(0, 1)}-${idDigits.slice(1, 5)}-xxxxx-xx-${idDigits.slice(12)}`
        : (id.length >= 7 ? `${id.slice(0, 2)}***${id.slice(-3)}` : (id || '-'));
      idEl.textContent = masked;
    }

    const holdBanner = $('payHoldBanner');
    if (holdBanner) {
      const seatsStr = o.seats && o.seats.length ? o.seats.join(', ') : o.zone;
      holdBanner.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="seat-hold-badge">🔒 ล็อกที่นั่ง</span>
          <span>ระบบล็อกที่นั่ง <strong>${window.UI ? window.UI.escapeHtml(seatsStr) : seatsStr}</strong> ไว้ให้คุณ 15:00 นาที</span>
        </div>
      `;
    }

    const amountEl = $('payTotal') || $('payAmount');
    if (amountEl) amountEl.textContent = window.UI ? `${window.UI.baht(o.total)} THB` : `${o.total.toLocaleString('th-TH')} THB`;

    const merchEl = $('payMerchant');
    if (merchEl) merchEl.textContent = activeMerchantName;

    const ppEl = $('payTargetDisplay') || $('payPromptpayId');
    if (ppEl) ppEl.textContent = formatPromptPayId(activePromptPayId);

    const refEl = $('payRefDisplay');
    if (refEl) refEl.textContent = `TT-${Math.floor(1000 + Math.random() * 9000)}`;

    renderQr();
    syncPromptPayConfig();
    startTimer();
    clearSlip();
    setStep('pay');
    if (window.UI) window.UI.open('paymentModal');
  }

  async function downloadQrImage() {
    const qrEl = $('payQrCanvas') || $('payQr');
    if (!qrEl) return false;
    const svg = qrEl.querySelector('svg');
    const img = qrEl.querySelector('img');
    if (!svg && !img) return false;

    if (typeof document === 'undefined' || !document.createElement) return false;

    // High-resolution canvas for crystal clear bank scanner compatibility
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 720;
    const ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) return false;

    // 1. White background card
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Navy Blue PromptPay Brand Header
    ctx.fillStyle = '#0E3D6B';
    ctx.fillRect(0, 0, canvas.width, 80);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 26px "Chakra Petch", -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PROMPTPAY QR PAYMENT', canvas.width / 2, 50);

    // 3. Amount & Target details
    const totalAmount = order ? (order.total || order.unitPrice || 0) : 0;
    const ppTarget = formatPromptPayId(activePromptPayId);
    const refCode = $('payRefDisplay') ? $('payRefDisplay').textContent : 'TT-0000';

    ctx.fillStyle = '#E11D48';
    ctx.font = 'bold 32px "Chakra Petch", -apple-system, sans-serif';
    ctx.fillText(`${totalAmount.toLocaleString('th-TH')} THB`, canvas.width / 2, 135);

    ctx.fillStyle = '#4B5563';
    ctx.font = '500 17px -apple-system, sans-serif';
    ctx.fillText(`โอนเข้าบัญชี: ${ppTarget}`, canvas.width / 2, 170);

    // 4. Center QR Code drawing (380 x 380)
    const qrSize = 380;
    const qrX = (canvas.width - qrSize) / 2;
    const qrY = 195;

    let drawn = false;
    if (svg) {
      try {
        const xml = new XMLSerializer().serializeToString(svg);
        const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        const tempImg = new Image();
        await new Promise((resolve) => {
          tempImg.onload = () => {
            ctx.drawImage(tempImg, qrX, qrY, qrSize, qrSize);
            URL.revokeObjectURL(url);
            drawn = true;
            resolve();
          };
          tempImg.onerror = resolve;
          tempImg.src = url;
        });
      } catch {}
    } else if (img) {
      if (img.complete && img.naturalWidth) {
        try {
          ctx.drawImage(img, qrX, qrY, qrSize, qrSize);
          drawn = true;
        } catch {}
      } else {
        await new Promise((resolve) => {
          const tempImg = new Image();
          tempImg.crossOrigin = 'anonymous';
          tempImg.onload = () => {
            try {
              ctx.drawImage(tempImg, qrX, qrY, qrSize, qrSize);
              drawn = true;
            } catch {}
            resolve();
          };
          tempImg.onerror = resolve;
          tempImg.src = img.src;
        });
      }
    }

    if (!drawn) {
      ctx.fillStyle = '#111827';
      ctx.fillRect(qrX + 30, qrY + 30, qrSize - 60, qrSize - 60);
    }

    // 5. Footer details
    ctx.fillStyle = '#9CA3AF';
    ctx.font = '14px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`รหัสคำสั่งซื้อ: ${refCode} · STAGE PASS`, canvas.width / 2, 630);

    ctx.fillStyle = '#4B5563';
    ctx.font = 'bold 15px -apple-system, sans-serif';
    ctx.fillText('เปิดแอปธนาคารแล้วเลือก "สแกนจากรูปภาพ" เพื่อชำระเงิน', canvas.width / 2, 665);

    // 6. Download Trigger via Blob or DataURL
    return new Promise((resolve) => {
      const filename = `PromptPay-QR-${refCode}.png`;
      if (canvas.toBlob) {
        canvas.toBlob((blob) => {
          if (!blob) {
            resolve(false);
            return;
          }
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            if (a.parentNode) a.parentNode.removeChild(a);
            URL.revokeObjectURL(blobUrl);
            resolve(true);
          }, 400);
        }, 'image/png');
      } else {
        const dataUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          if (a.parentNode) a.parentNode.removeChild(a);
          resolve(true);
        }, 400);
      }
    });
  }

  function setupQrLongPress() {
    const wrap = $('payQrWrap');
    if (!wrap) return;

    const overlay = $('qrHoldOverlay');
    const ringBar = $('qrHoldRingBar');
    const icon = $('qrHoldIcon');
    const label = $('qrHoldLabel');
    const manualBtn = $('btnSaveQrManual');

    const CIRCUMFERENCE = 138.2; // 2 * PI * 22
    const HOLD_MS = 2000; // 2-second hold requested by user

    let holdTimer = null;
    let holdStart = 0;
    let animId = null;
    let isHolding = false;
    let touchStartX = 0;
    let touchStartY = 0;

    function resetOverlay() {
      isHolding = false;
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      if (animId && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(animId);
        animId = null;
      }
      if (overlay) overlay.hidden = true;
      if (ringBar) {
        ringBar.classList.remove('is-success');
        ringBar.style.strokeDashoffset = String(CIRCUMFERENCE);
      }
      if (icon) {
        icon.textContent = '📥';
        icon.style.transform = 'none';
      }
      if (label) label.textContent = 'กำลังบันทึกภาพ...';
    }

    function updateProgress() {
      if (!isHolding) return;
      const elapsed = Date.now() - holdStart;
      const progress = Math.min(1, elapsed / HOLD_MS);
      const offset = CIRCUMFERENCE * (1 - progress);
      if (ringBar) ringBar.style.strokeDashoffset = String(offset);

      const remainSec = Math.max(0, ((HOLD_MS - elapsed) / 1000)).toFixed(1);
      if (label && progress < 1) {
        label.textContent = `กดค้างอีก ${remainSec} วิ...`;
      }

      if (progress < 1 && typeof requestAnimationFrame === 'function') {
        animId = requestAnimationFrame(updateProgress);
      }
    }

    async function onHoldSuccess() {
      isHolding = false;
      if (animId && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(animId);
        animId = null;
      }

      // Success vibration pattern
      try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([60, 40, 80]);
      } catch {}

      if (ringBar) {
        ringBar.classList.add('is-success');
        ringBar.style.strokeDashoffset = '0';
      }
      if (icon) {
        icon.textContent = '✓';
        icon.style.transform = 'scale(1.2)';
      }
      if (label) label.textContent = 'บันทึกรูปภาพสำเร็จ!';

      // Download QR Code Image
      await downloadQrImage();

      if (window.UI && window.UI.toast) {
        window.UI.toast('บันทึกรูป QR Code ลงอุปกรณ์เรียบร้อยแล้ว (เปิดสแกนในแอปธนาคารได้ทันที)', 'success');
      }

      // Hide overlay after brief success confirmation
      setTimeout(() => {
        resetOverlay();
      }, 1000);
    }

    function startHold(e) {
      if (isHolding) return;
      // Don't trigger if clicked on child buttons
      if (e.target && e.target.closest && e.target.closest('.btn-qr-save-pill')) return;

      isHolding = true;
      holdStart = Date.now();

      if (e.touches && e.touches[0]) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }

      try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(25);
      } catch {}

      if (overlay) overlay.hidden = false;
      if (ringBar) {
        ringBar.classList.remove('is-success');
        ringBar.style.strokeDashoffset = String(CIRCUMFERENCE);
      }
      if (icon) icon.textContent = '📥';
      if (label) label.textContent = 'กดค้าง 2 วิ เพื่อบันทึกภาพ...';

      holdTimer = setTimeout(onHoldSuccess, HOLD_MS);
      if (typeof requestAnimationFrame === 'function') {
        animId = requestAnimationFrame(updateProgress);
      }
    }

    function cancelHold() {
      if (!isHolding) return;
      resetOverlay();
    }

    function onTouchMove(e) {
      if (!isHolding) return;
      if (e.touches && e.touches[0]) {
        const dx = Math.abs(e.touches[0].clientX - touchStartX);
        const dy = Math.abs(e.touches[0].clientY - touchStartY);
        if (dx > 12 || dy > 12) {
          cancelHold();
        }
      }
    }

    // Touch events for Mobile (iPhone / Android)
    wrap.addEventListener('touchstart', startHold, { passive: true });
    wrap.addEventListener('touchend', cancelHold, { passive: true });
    wrap.addEventListener('touchcancel', cancelHold, { passive: true });
    wrap.addEventListener('touchmove', onTouchMove, { passive: true });

    // Mouse events for Desktop
    wrap.addEventListener('mousedown', startHold);
    wrap.addEventListener('mouseup', cancelHold);
    wrap.addEventListener('mouseleave', cancelHold);

    // Manual Save Button
    if (manualBtn) {
      manualBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30);
        } catch {}
        manualBtn.disabled = true;
        const origText = manualBtn.innerHTML;
        manualBtn.innerHTML = '<span>⏳ กำลังบันทึก...</span>';
        await downloadQrImage();
        if (window.UI && window.UI.toast) {
          window.UI.toast('บันทึกรูป QR Code ลงอุปกรณ์เรียบร้อยแล้ว', 'success');
        }
        setTimeout(() => {
          manualBtn.innerHTML = '<span>✓ บันทึกแล้ว</span>';
          setTimeout(() => {
            manualBtn.innerHTML = origText;
            manualBtn.disabled = false;
          }, 1500);
        }, 500);
      });
    }
  }

  function bind() {
    syncPromptPayConfig();
    setupQrLongPress();
    if ($('copyPromptpayBtn')) {
      $('copyPromptpayBtn').addEventListener('click', async () => {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(activePromptPayId);
          }
        } catch {
          /* ignore */
        }
        if (window.UI) window.UI.toast(`คัดลอกหมายเลขพร้อมเพย์ ${formatPromptPayId(activePromptPayId)} แล้ว`);
      });
    }
    if ($('copyBankBtn')) {
      $('copyBankBtn').addEventListener('click', async () => {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(activeBankAccount);
          }
        } catch {
          /* ignore */
        }
        if (window.UI) window.UI.toast(`คัดลอกเลขที่บัญชี ${activeBankAccount} เรียบร้อย`);
      });
    }
    const input = $('slipFileInput') || $('slipInput');
    if (input) {
      input.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) acceptSlip(f);
      });
    }
    const dz = $('slipDropzone');
    if (dz) {
      ['dragenter', 'dragover'].forEach((ev) =>
        dz.addEventListener(ev, (e) => {
          e.preventDefault();
          dz.classList.add('is-dragging');
        })
      );
      ['dragleave', 'drop'].forEach((ev) =>
        dz.addEventListener(ev, (e) => {
          e.preventDefault();
          dz.classList.remove('is-dragging');
        })
      );
      dz.addEventListener('drop', (e) => {
        e.preventDefault();
        const f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) acceptSlip(f);
      });
      dz.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'slipRemove') return;
        if (input) input.click();
      });
    }
    if ($('slipRemove')) $('slipRemove').addEventListener('click', clearSlip);
    if ($('payConfirmBtn')) $('payConfirmBtn').addEventListener('click', confirmPayment);
    if ($('payRenewBtn')) {
      $('payRenewBtn').addEventListener('click', () => {
        syncPromptPayConfig();
        startTimer();
        updateConfirmState();
      });
    }
    if ($('payCancelBtn')) $('payCancelBtn').addEventListener('click', cancel);
    if ($('payCloseBtn')) $('payCloseBtn').addEventListener('click', cancel);
  }

  document.addEventListener('DOMContentLoaded', bind);
  window.Checkout = { start, downloadQrImage };
})();
