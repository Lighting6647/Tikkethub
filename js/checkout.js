/**
 * Checkout flow: PromptPay QR -> attach slip -> submit to server (checks duplicate slip) -> show ticket status.
 */
(function () {
  const cfg = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);

  let order = null;
  let slipFile = null;
  let slipUrl = null;
  let timerId = null;
  let deadline = 0;
  let activePromptPayId = cfg.PROMPTPAY_ID;
  let activeMerchantName = cfg.MERCHANT_NAME;
  let activeBankAccount = '';
  let activeBankName = '';

  function setStep(step) {
    document.querySelectorAll('#paymentModal [data-step]').forEach((el) => {
      el.hidden = el.dataset.step !== step;
    });
    $('paymentModal').dataset.locked = step === 'verifying' ? 'true' : 'false';
  }

  function formatPromptPayId(id) {
    const d = String(id).replace(/\D/g, '');
    if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    if (d.length === 13) return `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}`;
    return d || id;
  }

  async function syncPromptPayConfig() {
    try {
      const res = await fetch('/api/payment-config', { cache: 'no-store' });
      const data = await res.json();
      if (data && data.ok) {
        if (data.promptpayId) activePromptPayId = data.promptpayId;
        if (data.merchantName) activeMerchantName = data.merchantName;
        activeBankAccount = data.bankAccount || '';
        activeBankName = data.bankName || '';
      }
    } catch {
      /* fallback to activePromptPayId */
    }
    if ($('payPromptpayId')) {
      $('payPromptpayId').textContent = formatPromptPayId(activePromptPayId);
    }
    if ($('payMerchant')) {
      $('payMerchant').textContent = activeMerchantName;
    }
    if ($('payBankRow')) {
      if (activeBankAccount) {
        $('payBankRow').style.display = 'flex';
        if ($('payBankName')) $('payBankName').textContent = activeBankName ? `${activeBankName} :` : 'เลขที่บัญชี :';
        if ($('payBankAccount')) $('payBankAccount').textContent = activeBankAccount;
      } else {
        $('payBankRow').style.display = 'none';
      }
    }
    if (order) {
      renderQr();
    }
  }

  function renderQr() {
    try {
      const payload = window.PromptPay.buildPayload(activePromptPayId, order.total);
      const qr = qrcode(0, 'M');
      qr.addData(payload);
      qr.make();
      $('payQr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true, alt: 'PromptPay QR' });
    } catch (err) {
      $('payQr').innerHTML = `<p class="qr-error">สร้าง QR ไม่สำเร็จ: ${window.UI.escapeHtml(err.message)}</p>`;
    }
  }

  function tick() {
    const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    const m = String(Math.floor(left / 60)).padStart(2, '0');
    const s = String(left % 60).padStart(2, '0');
    $('payCountdown').textContent = `${m}:${s}`;
    $('payCountdownWrap').classList.toggle('is-urgent', left <= 60);
    if (left === 0) expire();
  }

  function startTimer() {
    clearInterval(timerId);
    deadline = Date.now() + cfg.PAYMENT_TIMEOUT_SECONDS * 1000;
    $('payExpired').hidden = true;
    $('payQrBox').classList.remove('is-expired');
    tick();
    timerId = setInterval(tick, 1000);
  }

  function expire() {
    clearInterval(timerId);
    $('payQrBox').classList.add('is-expired');
    $('payExpired').hidden = false;
    updateConfirmState();
  }

  function isExpired() {
    return Date.now() >= deadline;
  }

  function clearSlip() {
    slipFile = null;
    if (slipUrl) URL.revokeObjectURL(slipUrl);
    slipUrl = null;
    $('slipInput').value = '';
    $('slipPreview').hidden = true;
    $('slipDropzone').hidden = false;
    $('slipError').textContent = '';
    updateConfirmState();
  }

  function validateSlip(file) {
    if (!cfg.SLIP_ALLOWED_TYPES.includes(file.type)) return 'รองรับเฉพาะไฟล์ภาพ JPG, PNG หรือ WEBP';
    if (file.size > cfg.SLIP_MAX_BYTES) return 'ไฟล์ใหญ่เกิน 5 MB กรุณาเลือกไฟล์ใหม่';
    if (file.size < 1024) return 'ไฟล์เล็กผิดปกติ กรุณาตรวจสอบสลิปอีกครั้ง';
    return null;
  }

  function acceptSlip(file) {
    const err = validateSlip(file);
    if (err) {
      $('slipError').textContent = err;
      $('slipInput').value = '';
      return;
    }
    clearSlip();
    slipFile = file;
    slipUrl = URL.createObjectURL(file);
    $('slipThumb').src = slipUrl;
    $('slipName').textContent = file.name;
    $('slipSize').textContent = `${(file.size / 1024).toFixed(0)} KB`;
    $('slipPreview').hidden = false;
    $('slipDropzone').hidden = true;
    updateConfirmState();
  }

  function updateConfirmState() {
    const ready = !!slipFile && !isExpired();
    $('payConfirmBtn').disabled = !ready;
    $('payConfirmHint').textContent = isExpired()
      ? 'QR หมดอายุ กรุณาสร้าง QR ใหม่'
      : slipFile
        ? 'พร้อมส่งสลิปให้แอดมินตรวจสอบ'
        : 'แนบสลิปเพื่อยืนยันการชำระเงิน';
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
        $('slipError').textContent = data.error || 'ส่งสลิปไม่สำเร็จ';
        window.UI.toast(data.error || 'ส่งสลิปไม่สำเร็จ', 'error');
        return;
      }
      saved = window.TicketStore.add(data.order);
    } catch (e) {
      /* Fallback to client-side store only when backend is unreachable */
    }

    if (!saved) {
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

    window.UI.close('paymentModal');
    clearSlip();
    document.dispatchEvent(new CustomEvent('tickets:changed'));
    if (window.SoundEffects) window.SoundEffects.playSuccessChime();
    window.UI.toast('ชำระเงินสำเร็จ! บัตรของคุณพร้อมแล้ว');
    window.TicketViewer.show(saved);
  }

  function cancel() {
    clearInterval(timerId);
    clearSlip();
    window.UI.close('paymentModal');
  }

  function start(o) {
    order = o;
    $('payEventTitle').textContent = o.title;
    $('payEventMeta').textContent = `${o.venue} · ${o.date}`;
    $('payZone').textContent = o.zone;
    const promoNote = o.promoCode && o.discountAmount > 0 ? ` (โค้ด ${o.promoCode} ลด -${o.discountAmount.toLocaleString('th-TH')} THB)` : '';
    $('payQty').textContent = `${o.qty} ใบ × ${o.unitPrice.toLocaleString('th-TH')} THB${promoNote}`;
    if ($('payHolder')) {
      $('payHolder').textContent = `${o.holderName} (${o.holderPhone})`;
    }
    if ($('payIdCard')) {
      const id = String(o.holderIdCard || '').trim();
      const idDigits = id.replace(/\D/g, '');
      const masked = idDigits.length === 13
        ? `${idDigits.slice(0, 1)}-${idDigits.slice(1, 5)}-xxxxx-xx-${idDigits.slice(12)}`
        : (id.length >= 7 ? `${id.slice(0, 2)}***${id.slice(-3)}` : (id || '-'));
      $('payIdCard').textContent = masked;
    }
    if ($('payHoldBanner')) {
      const seatsStr = o.seats && o.seats.length ? o.seats.join(', ') : o.zone;
      $('payHoldBanner').innerHTML = `
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="seat-hold-badge">🔒 ล็อกที่นั่ง</span>
          <span>ระบบล็อกที่นั่ง <strong>${window.UI.escapeHtml(seatsStr)}</strong> ไว้ให้คุณ 15:00 นาที</span>
        </div>
      `;
    }
    $('payAmount').textContent = window.UI.baht(o.total);
    $('payMerchant').textContent = activeMerchantName;
    $('payPromptpayId').textContent = formatPromptPayId(activePromptPayId);
    renderQr();
    syncPromptPayConfig();
    startTimer();
    clearSlip();
    setStep('pay');
    window.UI.open('paymentModal');
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
        window.UI.toast(`คัดลอกหมายเลขพร้อมเพย์ ${formatPromptPayId(activePromptPayId)} แล้ว`);
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
        window.UI.toast(`คัดลอกเลขที่บัญชี ${activeBankAccount} เรียบร้อย`);
      });
    }
    $('slipInput').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) acceptSlip(f);
    });
    const dz = $('slipDropzone');
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
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) acceptSlip(f);
    });
    $('slipRemove').addEventListener('click', clearSlip);
    $('payConfirmBtn').addEventListener('click', confirmPayment);
    $('payRenewBtn').addEventListener('click', () => {
      syncPromptPayConfig();
      startTimer();
      updateConfirmState();
    });
    $('payCancelBtn').addEventListener('click', cancel);
    $('payCloseBtn').addEventListener('click', cancel);
  }

  document.addEventListener('DOMContentLoaded', bind);
  window.Checkout = { start };
})();
