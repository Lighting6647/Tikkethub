/** Shared UI helpers: modal stack, toast queue, formatting. */
(function () {
  const stack = [];
  let toastTimer = null;

  function focusables(el) {
    return el.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])');
  }

  function open(id) {
    const el = document.getElementById(id);
    if (!el || el.classList.contains('active')) return;
    stack.push({ id, returnFocus: document.activeElement });
    el.classList.add('active');
    document.body.style.overflow = 'hidden';
    const first = focusables(el)[0];
    if (first) setTimeout(() => first.focus(), 30);
  }

  function close(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('active');
    const idx = stack.findIndex((s) => s.id === id);
    if (idx > -1) {
      const [entry] = stack.splice(idx, 1);
      if (entry.returnFocus && entry.returnFocus.focus) entry.returnFocus.focus();
    }
    if (!stack.length) document.body.style.overflow = '';
  }

  function toast(msg, type) {
    const el = document.getElementById('toast');
    document.getElementById('toastMsg').textContent = msg;
    el.classList.toggle('toast-error', type === 'error');
    el.classList.remove('show');
    void el.offsetWidth; // restart animation
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
  }

  const baht = (n) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !stack.length) return;
    const top = document.getElementById(stack[stack.length - 1].id);
    if (top && top.dataset.locked !== 'true') close(top.id);
  });

  // Click on backdrop closes dismissable modals
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.classList && t.classList.contains('modal-backdrop') && t.dataset.dismissable === 'true' && t.dataset.locked !== 'true') {
      close(t.id);
    }
  });

  window.UI = { open, close, toast, baht, escapeHtml };
})();
