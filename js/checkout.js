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
  let cachedQrCardDataUrl = '';
  let cachedQrCardBlob = null;
  // Slip pre-check: idle | checking | passed | warn | blocked | unchecked (the server always decides again)
  let slipCheck = { state: 'idle', message: '' };
  let slipCheckToken = 0;
  let jsQrLoader = null;

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
    cachedQrCardDataUrl = '';
    cachedQrCardBlob = null;
    void prepareQrCardCache();
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

  function updateUploadStage(stage, pct, text) {
    const hud = $('slipProgressHud');
    const fill = $('slipProgressBarFill');
    const label = $('slipProgressStageLabel');
    if (hud) hud.hidden = false;
    if (fill) fill.style.width = `${pct}%`;
    if (label) label.textContent = text;

    for (let i = 1; i <= 4; i++) {
      const row = $(`stepRow${i}`);
      if (row) {
        if (i < stage) {
          row.className = 'slip-progress-step-row is-done';
        } else if (i === stage) {
          row.className = 'slip-progress-step-row is-current';
        } else {
          row.className = 'slip-progress-step-row';
        }
      }
    }
  }

  function resetUploadStage() {
    const hud = $('slipProgressHud');
    if (hud) hud.hidden = true;
    const fill = $('slipProgressBarFill');
    if (fill) fill.style.width = '0%';
    const btn = $('payConfirmBtn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'ยืนยันการโอนเงินและรับบัตร →';
    }
  }

  function isExpired() {
    return Date.now() >= deadline;
  }

  function clearSlip() {
    slipFile = null;
    slipCheckToken++;
    slipCheck = { state: 'idle', message: '' };
    if (slipUrl) URL.revokeObjectURL(slipUrl);
    slipUrl = null;
    const input = $('slipFileInput') || $('slipInput');
    if (input) {
      input.value = '';
      input.style.pointerEvents = 'auto';
      input.style.zIndex = '2';
    }
    const prev = $('slipPreviewWrap') || $('slipPreview');
    if (prev) prev.hidden = true;
    const prompt = $('slipDropPrompt');
    if (prompt) prompt.hidden = false;
    const dz = $('slipDropzone');
    if (dz) dz.hidden = false;
    const err = $('slipError');
    if (err) err.textContent = '';
    resetUploadStage();
    updateConfirmState();
  }

  // Some pickers (LINE in-app / Android file managers) give an empty MIME type, and iPhone photos may be HEIC.
  function slipMimeOf(file) {
    const type = String(file.type || '').toLowerCase();
    if (type && type !== 'application/octet-stream') return type;
    const ext = String(file.name || '').split('.').pop().toLowerCase();
    return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' })[ext] || 'image/unknown';
  }

  function needsConversion(file) {
    const type = String(file.type || '').toLowerCase();
    return !type || type === 'application/octet-stream' || type === 'image/heic' || type === 'image/heif';
  }

  function validateSlip(file) {
    const allowed = (cfg.SLIP_ALLOWED_TYPES || ['image/png', 'image/jpeg', 'image/webp']).concat(['image/heic', 'image/heif']);
    const mime = slipMimeOf(file);
    // Unknown-type files are allowed through; compressImage re-encodes them and rejects anything that is not a real image.
    if (mime !== 'image/unknown' && !allowed.includes(mime)) return 'รองรับเฉพาะไฟล์ภาพ JPG, PNG, WEBP หรือ HEIC';
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
    const input = $('slipFileInput') || $('slipInput');
    if (input) {
      input.style.pointerEvents = 'none';
      input.style.zIndex = '-1';
    }

    updateConfirmState();
    void runSlipCheck(file);
  }

  function loadJsQr() {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    if (!jsQrLoader) {
      jsQrLoader = new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = 'js/vendor/jsQR.js';
        s.onload = () => resolve(window.jsQR || null);
        s.onerror = () => {
          jsQrLoader = null;
          resolve(null);
        };
        document.head.appendChild(s);
      });
    }
    return jsQrLoader;
  }

  // true = QR found, false = none found, null = could not look (no jsQR / unreadable image)
  async function slipHasQr(dataUrl) {
    const jsQR = await loadJsQr();
    if (!jsQR) return null;
    const img = await new Promise((resolve) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => resolve(null);
      i.src = dataUrl;
    });
    if (!img || !img.naturalWidth) return null;
    // Slip QR codes are small: try a few sizes before saying there is none.
    for (const target of [1280, 800, 1800]) {
      const scale = Math.min(target / Math.max(img.naturalWidth, img.naturalHeight), 2);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      if (jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height)) return true;
      await new Promise((r) => setTimeout(r, 0));
    }
    return false;
  }

  function setSlipCheck(state, message) {
    slipCheck = { state, message };
    const badge = $('slipStatusBadge');
    if (badge) {
      badge.textContent = {
        checking: '⏳ กำลังตรวจสลิป',
        passed: '🟢 ตรวจสลิปผ่าน',
        warn: '🟠 มีจุดที่ต้องตรวจ',
        blocked: '🔴 ใช้รูปนี้ไม่ได้',
        unchecked: '⚪ ยังไม่ได้ตรวจ'
      }[state] || '';
    }
    const errEl = $('slipError');
    if (errEl) errEl.textContent = state === 'blocked' || state === 'warn' ? message : '';
    updateConfirmState();
  }

  async function runSlipCheck(file) {
    const token = ++slipCheckToken;
    const stale = () => token !== slipCheckToken;
    setSlipCheck('checking', 'กำลังตรวจสลิป...');
    let hasQr = null;
    try {
      const slipData = await compressImage(file);
      if (stale()) return;
      if (!slipData || !slipData.startsWith('data:image/')) {
        setSlipCheck('blocked', 'อ่านไฟล์สลิปไม่ได้ กรุณาแคปหน้าจอสลิปเป็นไฟล์ JPG/PNG แล้วแนบใหม่');
        return;
      }
      hasQr = await slipHasQr(slipData);
      if (stale()) return;
      const errEl = $('slipError');
      if (hasQr === false && errEl) errEl.textContent = 'ไม่พบ QR ในรูปนี้ อาจไม่ใช่สลิปโอนเงิน กำลังตรวจกับระบบตรวจสลิป...';

      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), 15000) : null;
      let data;
      try {
        const res = await fetch('/api/slips/precheck', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slipData, amount: order ? order.total : 0 }),
          signal: ctl ? ctl.signal : undefined
        });
        data = await res.json();
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (stale()) return;
      if (data && data.status === 'passed') {
        setSlipCheck('passed', data.message);
        return;
      }
      if (data && data.status === 'failed') {
        const block = data.code === 'NOT_A_SLIP' || data.code === 'DUPLICATE';
        setSlipCheck(block ? 'blocked' : 'warn', block ? data.message : `${data.message} ถ้ามั่นใจว่าโอนถูกต้อง ส่งให้แอดมินตรวจได้`);
        return;
      }
    } catch (e) {
      /* pre-check unavailable: never blocks the customer, the server checks again */
    }
    if (stale()) return;
    if (hasQr === false) setSlipCheck('warn', 'ไม่พบ QR ในรูปนี้ อาจไม่ใช่สลิปโอนเงิน กรุณาตรวจสอบก่อนส่ง แอดมินจะตรวจอีกครั้ง');
    else setSlipCheck('unchecked', 'ยังไม่ได้ตรวจสลิป ส่งให้แอดมินตรวจได้');
  }

  function updateConfirmState() {
    const ready = !!slipFile && !isExpired() && slipCheck.state !== 'checking' && slipCheck.state !== 'blocked';
    const btn = $('payConfirmBtn');
    if (btn) btn.disabled = !ready;
    const hint = $('payConfirmHint');
    if (hint) {
      hint.textContent = isExpired()
        ? 'QR หมดอายุ กรุณาสร้าง QR ใหม่'
        : slipFile
          ? slipCheck.message || 'พร้อมส่งสลิปให้แอดมินตรวจสอบ'
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
      const mustConvert = needsConversion(file);
      // Raw passthrough is only safe for browser-readable types; HEIC / unknown types must be re-encoded to JPEG.
      const fallback = () => (mustConvert ? resolve('') : fileToDataUrl(file).then(resolve).catch(() => resolve('')));
      if (!mustConvert && file.size < 400 * 1024) {
        fallback();
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
        img.onerror = fallback;
        img.src = e.target.result;
      };
      reader.onerror = fallback;
      reader.readAsDataURL(file);
    });
  }

  async function confirmPayment() {
    if (!slipFile || isExpired() || slipCheck.state === 'checking' || slipCheck.state === 'blocked') return;
    clearInterval(timerId);
    setStep('verifying');

    const confirmBtn = $('payConfirmBtn');
    const confirmLabel = confirmBtn ? confirmBtn.innerHTML : '';
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<span>⏳ กำลังประมวลผลการอัปโหลด...</span>';
    }
    const prevErr = $('slipError');
    if (prevErr) prevErr.textContent = '';

    // Return to the pay step with the slip still attached so the customer can retry.
    const failBack = (message) => {
      setStep('pay');
      startTimer();
      resetUploadStage();
      if (confirmBtn) confirmBtn.innerHTML = confirmLabel;
      updateConfirmState();
      const errEl = $('slipError');
      if (errEl) errEl.textContent = message;
      if (window.UI) window.UI.toast(message, 'error');
    };

    let saved = null;
    try {
      updateUploadStage(1, 25, 'กำลังประมวลผลและบีบอัดรูปภาพสลิป...');
      const slipData = await compressImage(slipFile);
      if (!slipData || !slipData.startsWith('data:image/')) {
        failBack('อ่านไฟล์สลิปไม่ได้ กรุณาแคปหน้าจอสลิปเป็นไฟล์ JPG/PNG แล้วแนบใหม่');
        return;
      }

      updateUploadStage(2, 60, 'กำลังอัปโหลดสลิปไปยังเซิร์ฟเวอร์...');
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
          slipMime: (slipData.match(/^data:([^;,]+)/) || [])[1] || 'image/png',
          slipData
        })
      });

      updateUploadStage(3, 85, 'กำลังตรวจสอบสลิปและยอดเงิน...');
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok || !data || data.ok === false || !data.order) {
        const fallbackMsg = res.status === 413
          ? 'ไฟล์สลิปใหญ่เกินไป กรุณาแคปหน้าจอสลิปแล้วแนบใหม่'
          : `ส่งสลิปไม่สำเร็จ (รหัส ${res.status}) กรุณาลองใหม่อีกครั้ง`;
        failBack((data && data.error) || fallbackMsg);
        return;
      }

      updateUploadStage(4, 100, 'ออกบัตร E-Ticket และบันทึกข้อมูลเรียบร้อย!');
      if (window.TicketStore) saved = window.TicketStore.add(data.order);
      // Brief pause to allow user to view completed stage
      await new Promise((r) => setTimeout(r, 600));
    } catch (e) {
      // Network failure: the slip never reached the server, so do NOT issue a local-only ticket.
      failBack('ส่งสลิปไม่สำเร็จ เครือข่ายขัดข้อง กรุณาตรวจสอบอินเทอร์เน็ตแล้วกดยืนยันอีกครั้ง');
      return;
    }

    if (confirmBtn) confirmBtn.innerHTML = confirmLabel;

    resetUploadStage();
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

  function dataUrlToBlob(dataUrl) {
    try {
      const parts = dataUrl.split(',');
      const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/png';
      const bin = atob(parts[1] || '');
      const len = bin.length;
      const u8 = new Uint8Array(len);
      for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
      return new Blob([u8], { type: mime });
    } catch {
      return null;
    }
  }

  function buildQrCardDataUrl() {
    if (typeof document === 'undefined' || !document.createElement) return '';

    const qrEl = $('payQrCanvas') || $('payQr');
    const qrCanvas = qrEl ? qrEl.querySelector('canvas') : null;
    const img = qrEl ? qrEl.querySelector('img') : null;
    const totalAmount = order ? (order.total || order.unitPrice || 0) : 0;
    const payload = window.PromptPay ? window.PromptPay.buildPayload(activePromptPayId, totalAmount) : '';
    if (typeof qrcode === 'undefined' && !qrCanvas && !img) return '';

    // High-resolution canvas for crystal clear bank scanner compatibility
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 720;
    const ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) return '';

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
    const ppTarget = formatPromptPayId(activePromptPayId);
    const refCode = $('payRefDisplay') ? $('payRefDisplay').textContent : 'TT-0000';

    ctx.fillStyle = '#E11D48';
    ctx.font = 'bold 32px "Chakra Petch", -apple-system, sans-serif';
    ctx.fillText(`${totalAmount.toLocaleString('th-TH')} THB`, canvas.width / 2, 135);

    ctx.fillStyle = '#4B5563';
    ctx.font = '500 17px -apple-system, sans-serif';
    ctx.fillText(`โอนเข้าบัญชี: ${ppTarget}`, canvas.width / 2, 170);

    // 4. Center QR Code drawing (380 x 380) synchronously so user activation stays intact on iOS/LINE
    const qrSize = 380;
    const qrX = (canvas.width - qrSize) / 2;
    const qrY = 195;

    let drawn = false;
    if (typeof qrcode !== 'undefined' && payload) {
      try {
        const qr = qrcode(0, 'M');
        qr.addData(payload);
        qr.make();
        const count = qr.getModuleCount();
        if (count > 0) {
          const cell = qrSize / count;
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(qrX, qrY, qrSize, qrSize);
          ctx.fillStyle = '#000000';
          for (let r = 0; r < count; r++) {
            for (let c = 0; c < count; c++) {
              if (qr.isDark(r, c)) {
                ctx.fillRect(
                  Math.floor(qrX + c * cell),
                  Math.floor(qrY + r * cell),
                  Math.ceil(cell),
                  Math.ceil(cell)
                );
              }
            }
          }
          drawn = true;
        }
      } catch {}
    }

    if (!drawn && qrCanvas) {
      try {
        ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);
        drawn = true;
      } catch {}
    } else if (!drawn && img && img.complete && img.naturalWidth) {
      try {
        ctx.drawImage(img, qrX, qrY, qrSize, qrSize);
        drawn = true;
      } catch {}
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

    try {
      return canvas.toDataURL('image/png');
    } catch {
      return '';
    }
  }

  function prepareQrCardCache() {
    const dataUrl = buildQrCardDataUrl();
    if (dataUrl) {
      cachedQrCardDataUrl = dataUrl;
      cachedQrCardBlob = dataUrlToBlob(dataUrl);
    }
  }

  function currentRefCode() {
    return $('payRefDisplay') ? $('payRefDisplay').textContent.trim() : 'TT-0000';
  }

  function isInAppBrowserUA() {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
    return /Line\/|FBAN|FBAV|Instagram|MicroMessenger/i.test(ua);
  }

  // Absolute URL of a real PNG served by our backend. LINE / in-app browsers can long-press-save
  // a normal image URL, unlike blob:/data: images, download links or navigator.share.
  function serverQrPngUrl(extraParams) {
    const amount = order ? Number(order.total || order.unitPrice || 0) : 0;
    if (!(amount > 0) || typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return '';
    const params = new URLSearchParams({ amount: String(amount), ref: currentRefCode() });
    if (extraParams) Object.keys(extraParams).forEach((k) => params.set(k, extraParams[k]));
    return `${location.origin}/api/promptpay-qr.png?${params.toString()}`;
  }

  function openQrPreviewModal(dataUrl) {
    const imgEl = $('qrSavePreviewImg');
    const pngUrl = serverQrPngUrl();
    if (imgEl) {
      imgEl.onerror = null;
      if (pngUrl) {
        // Fall back to the locally drawn card if the server image cannot load (offline etc.).
        imgEl.onerror = () => {
          imgEl.onerror = null;
          if (dataUrl) imgEl.src = dataUrl;
        };
        imgEl.src = pngUrl;
      } else if (dataUrl) {
        imgEl.src = dataUrl;
      }
    }
    const extBtn = $('qrOpenExternalBtn');
    if (extBtn) {
      // openExternalBrowser=1 makes LINE open the link in Safari / Chrome, where saving an image always works.
      const extUrl = serverQrPngUrl({ openExternalBrowser: '1' });
      extBtn.hidden = !extUrl;
      if (extUrl) extBtn.href = extUrl;
    }
    if (window.UI && window.UI.open) {
      window.UI.open('qrSavePreviewModal');
      return true;
    }
    const modal = $('qrSavePreviewModal');
    if (modal) {
      modal.classList.add('active');
      return true;
    }
    return false;
  }

  /**
   * Save the QR image. Resolves to:
   *  'downloaded' (file download triggered), 'shared' (share sheet completed),
   *  'cancelled' (user closed the share sheet), 'manual' (save modal shown: user must long-press), or false.
   * Only 'downloaded' / 'shared' may be reported to the user as saved.
   */
  async function downloadQrImage() {
    const dataUrl = cachedQrCardDataUrl || buildQrCardDataUrl();
    const blob = dataUrl ? cachedQrCardBlob || dataUrlToBlob(dataUrl) : null;
    const filename = `PromptPay-QR-${currentRefCode()}.png`;

    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
    const isMobile = /iPhone|iPad|iPod|Android/i.test(ua) || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 && window.innerWidth <= 1024);
    const isIOS = /iPhone|iPad|iPod/i.test(ua);

    // 1. LINE / Facebook / IG in-app browsers: download links, blob URLs and file sharing are unreliable,
    //    so go straight to the long-press modal backed by a real PNG URL (+ "open in Safari/Chrome").
    if (isInAppBrowserUA()) {
      return openQrPreviewModal(dataUrl) ? 'manual' : false;
    }

    // 2. Mobile Web Share API (iOS Safari / Android Chrome) -> "Save Image" in the share sheet
    if (isMobile && blob && typeof File !== 'undefined' && navigator.canShare && navigator.share) {
      try {
        const file = new File([blob], filename, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'PromptPay QR Payment' });
          return 'shared';
        }
      } catch (err) {
        if (err && err.name === 'AbortError') return 'cancelled';
      }
    }

    // 3. iOS without usable share: Safari ignores download on data URLs -> long-press modal
    if (isIOS || !dataUrl) {
      return openQrPreviewModal(dataUrl) ? 'manual' : false;
    }

    // 4. Desktop / Android browser download
    try {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 400);
      return 'downloaded';
    } catch {
      return openQrPreviewModal(dataUrl) ? 'manual' : false;
    }
  }

  function reportQrSaveResult(result) {
    if (!window.UI || !window.UI.toast) return;
    if (result === 'downloaded' || result === 'shared') {
      window.UI.toast('บันทึกรูป QR Code แล้ว เปิดแอปธนาคารแล้วเลือกสแกนจากรูปภาพ', 'success');
    } else if (result === 'manual') {
      window.UI.toast('แตะค้างที่รูป QR แล้วเลือก "บันทึกรูปภาพ"');
    } else if (result === false) {
      window.UI.toast('บันทึกรูปอัตโนมัติไม่ได้ กรุณาแคปหน้าจอ QR แทน', 'error');
    }
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
      if (label) label.textContent = 'กำลังเตรียมรูป QR...';

      // Only claim success when a download / share really happened; otherwise the save modal guides the user.
      const result = await downloadQrImage();
      if (label) label.textContent = result === 'downloaded' || result === 'shared' ? 'บันทึกรูปภาพแล้ว' : 'แตะค้างที่รูปเพื่อบันทึก';
      reportQrSaveResult(result);

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
        const result = await downloadQrImage();
        reportQrSaveResult(result);
        const saved = result === 'downloaded' || result === 'shared';
        manualBtn.innerHTML = saved ? '<span>✓ บันทึกแล้ว</span>' : origText;
        setTimeout(() => {
          manualBtn.innerHTML = origText;
          manualBtn.disabled = false;
        }, saved ? 1500 : 300);
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
        if (e.target === input) return;
        if (e.target && (e.target.id === 'slipRemove' || (e.target.closest && e.target.closest('#slipRemove')))) return;
        if (input) input.click();
      });
    }
    if ($('qrSavePreviewCloseBtn')) {
      $('qrSavePreviewCloseBtn').addEventListener('click', () => {
        if (window.UI && window.UI.close) window.UI.close('qrSavePreviewModal');
        else if ($('qrSavePreviewModal')) $('qrSavePreviewModal').classList.remove('active');
      });
    }
    if ($('slipRemove')) {
      $('slipRemove').addEventListener('click', (e) => {
        e.stopPropagation();
        clearSlip();
      });
    }
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
