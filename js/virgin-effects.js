/**
 * VIRGIN OFFICIAL - Interactive Effects & UI Engine
 * Preloader, Cursor Ring, Drawer, Sticky Header, Toast System
 */
(function() {
  window.VIRGIN = window.VIRGIN || {};

  window.onHeroSearch = function(val) {
    if (typeof searchQuery !== 'undefined') {
      searchQuery = val || '';
      if (typeof renderEvents === 'function') renderEvents();
    }
  };

  // Toast System with Fire / Lucide icons
  VIRGIN.toast = function(msg, isSuccess = true) {
    let wrap = document.getElementById('toasts');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'toasts';
      wrap.className = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    const t = document.createElement('div');
    t.className = `toast ${isSuccess ? 'toast--success' : ''}`;
    const icon = isSuccess ? '🔥' : '⚠️';
    t.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
    wrap.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateY(15px)';
      t.style.transition = 'all 0.3s ease';
      setTimeout(() => t.remove(), 300);
    }, 3200);
  };

  // Cursor Ring & Dot
  function initCursor() {
    const dot = document.querySelector('.cursor-dot');
    const ring = document.querySelector('.cursor-ring');
    if (!dot || !ring) return;

    let mouseX = 0, mouseY = 0;
    let ringX = 0, ringY = 0;

    window.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      dot.style.transform = `translate3d(${mouseX}px, ${mouseY}px, 0)`;
    }, { passive: true });

    function renderRing() {
      ringX += (mouseX - ringX) * 0.18;
      ringY += (mouseY - ringY) * 0.18;
      ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0)`;
      requestAnimationFrame(renderRing);
    }
    requestAnimationFrame(renderRing);

    document.querySelectorAll('a, button, input, .event-card, .how-card, .artist-card').forEach((el) => {
      el.addEventListener('mouseenter', () => document.body.classList.add('cursor-hover'));
      el.addEventListener('mouseleave', () => document.body.classList.remove('cursor-hover'));
    });
  }

  // Preloader Counter
  function initPreloader() {
    const preloader = document.getElementById('preloader');
    if (!preloader) return;

    const countEl = document.getElementById('preloaderPercent');
    const barEl = document.getElementById('preloaderBar');
    let percent = 0;

    const timer = setInterval(() => {
      percent += Math.floor(Math.random() * 12) + 8;
      if (percent >= 100) {
        percent = 100;
        clearInterval(timer);
        if (countEl) countEl.textContent = '100';
        if (barEl) barEl.style.width = '100%';
        setTimeout(() => {
          preloader.classList.add('fade-out');
          setTimeout(() => preloader.remove(), 400);
        }, 300);
      } else {
        if (countEl) countEl.textContent = percent;
        if (barEl) barEl.style.width = `${percent}%`;
      }
    }, 45);
  }

  // Header Scroll & Drawer Controls
  function initNavigation() {
    const header = document.getElementById('siteHeader');
    window.addEventListener('scroll', () => {
      if (header) {
        header.classList.toggle('is-scrolled', window.scrollY > 30);
      }
    }, { passive: true });

    // Drawer Open/Close
    const drawer = document.getElementById('drawer');
    const openBtns = document.querySelectorAll('[data-drawer-open]');
    const closeBtns = document.querySelectorAll('[data-drawer-close]');

    openBtns.forEach((b) => b.addEventListener('click', () => {
      if (drawer) drawer.classList.add('is-open');
    }));

    closeBtns.forEach((b) => b.addEventListener('click', () => {
      if (drawer) drawer.classList.remove('is-open');
    }));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer && drawer.classList.contains('is-open')) {
        drawer.classList.remove('is-open');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initPreloader();
    initCursor();
    initNavigation();
  });
})();
