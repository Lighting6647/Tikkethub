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
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.promptpay_id) {
        activePromptPayId = data.promptpay_id;
        activeMerchantName = data.merchant_name || 'STAGE PASS';
      }
      if (data && data.bank_account) {
        activeBankAccount = data.bank_account;
        activeBankName = data.bank_name || '';
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
        const qr = qrcode(0, 'M');
        qr.addData(payload);
        qr.make();
        qrEl.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true, alt: 'PromptPay QR' });
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

  function bind() {
    syncPromptPayConfig();
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
  window.Checkout = { start };
})();
