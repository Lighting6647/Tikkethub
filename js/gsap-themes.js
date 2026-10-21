/**
 * GSAP Motion Engine & Design System Studio
 * Supports 3 Production Styles:
 * 1. 'classic' -> 🎬 Crimson Arena Stage (Dark arena with spotlight sweep & dynamic tilt)
 * 2. 'cyber'   -> ⚡ Cyber Equalizer & Neon Stage (Festival Obsidian/Emerald with live 24-bar audio equalizer)
 * 3. 'vip'     -> ✨ Editorial Gold & Velvet Hall (Symphony VIP hall with champagne gold & floating orbs)
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'thaiticket.gsapTheme.v1';
  let currentTheme = 'classic';
  let ambientTimeline = null;
  let equalizerTimeline = null;
  let orbsTimeline = null;

  function getGsap() {
    return window.gsap || null;
  }

  function initThemes() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && ['classic', 'cyber', 'vip'].includes(saved)) {
        currentTheme = saved;
      }
    } catch {
      currentTheme = 'classic';
    }
    applyTheme(currentTheme, false);
    setupStudioUi();
  }

  function applyTheme(themeKey, animate = true) {
    currentTheme = themeKey;
    try {
      localStorage.setItem(STORAGE_KEY, themeKey);
    } catch {}

    const body = document.body;
    body.classList.remove('theme-classic', 'theme-cyber', 'theme-vip');
    body.classList.add(`theme-${themeKey}`);

    document.querySelectorAll('[data-theme-btn]').forEach((btn) => {
      const isActive = btn.dataset.themeBtn === themeKey;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });

    // Cleanup previous theme ambient loops
    if (ambientTimeline) {
      ambientTimeline.kill();
      ambientTimeline = null;
    }
    if (equalizerTimeline) {
      equalizerTimeline.kill();
      equalizerTimeline = null;
    }
    if (orbsTimeline) {
      orbsTimeline.kill();
      orbsTimeline = null;
    }

    const gsap = getGsap();
    if (!gsap) return;

    if (themeKey === 'cyber') {
      setupCyberEqualizer();
    } else if (themeKey === 'vip') {
      setupVipOrbs();
    } else {
      setupClassicSpotlight();
    }

    if (animate) {
      playEntranceAnimation();
    }
    setupTiltCards();
  }

  // 1. Classic Crimson Arena Spotlight Animation
  function setupClassicSpotlight() {
    const gsap = getGsap();
    if (!gsap) return;
    const heroPoster = document.querySelector('.hero-poster');
    if (!heroPoster) return;

    ambientTimeline = gsap.timeline({ repeat: -1, yoyo: true });
    ambientTimeline.to(heroPoster, {
      boxShadow: '0 20px 45px rgba(180, 0, 0, 0.45)',
      duration: 2.2,
      ease: 'sine.inOut'
    });
  }

  // 2. Cyber Equalizer Animation
  function setupCyberEqualizer() {
    const gsap = getGsap();
    if (!gsap) return;

    let eqContainer = document.getElementById('cyberLiveEqualizer');
    if (!eqContainer) {
      const hero = document.querySelector('.hero .container');
      if (hero) {
        eqContainer = document.createElement('div');
        eqContainer.id = 'cyberLiveEqualizer';
        eqContainer.className = 'cyber-equalizer-bar';
        for (let i = 0; i < 24; i++) {
          const bar = document.createElement('span');
          bar.className = 'cyber-eq-col';
          eqContainer.appendChild(bar);
        }
        hero.appendChild(eqContainer);
      }
    }

    if (!eqContainer) return;
    const cols = eqContainer.querySelectorAll('.cyber-eq-col');
    if (!cols.length) return;

    equalizerTimeline = gsap.timeline({ repeat: -1 });
    cols.forEach((col, idx) => {
      equalizerTimeline.to(
        col,
        {
          scaleY: () => 0.2 + Math.random() * 0.8,
          duration: 0.25 + (idx % 3) * 0.1,
          repeat: -1,
          yoyo: true,
          ease: 'power1.inOut'
        },
        idx * 0.04
      );
    });
  }

  // 3. VIP Gold Floating Orbs
  function setupVipOrbs() {
    const gsap = getGsap();
    if (!gsap) return;

    let orbsWrap = document.getElementById('vipFloatingOrbs');
    if (!orbsWrap) {
      const hero = document.querySelector('.hero');
      if (hero) {
        orbsWrap = document.createElement('div');
        orbsWrap.id = 'vipFloatingOrbs';
        orbsWrap.className = 'vip-orbs-container';
        for (let i = 0; i < 6; i++) {
          const orb = document.createElement('div');
          orb.className = 'vip-orb';
          orbsWrap.appendChild(orb);
        }
        hero.appendChild(orbsWrap);
      }
    }

    if (!orbsWrap) return;
    const orbs = orbsWrap.querySelectorAll('.vip-orb');
    orbsTimeline = gsap.timeline({ repeat: -1, yoyo: true });
    orbs.forEach((orb, i) => {
      gsap.set(orb, {
        x: (i * 180) % 700,
        y: 20 + (i * 30),
        scale: 0.8 + (i % 3) * 0.3,
        opacity: 0.35 + (i % 2) * 0.25
      });
      orbsTimeline.to(
        orb,
        {
          y: '+=40',
          x: '+=30',
          duration: 3 + i * 0.6,
          ease: 'sine.inOut'
        },
        i * 0.3
      );
    });
  }

  // Interactive 3D Tilt for Event Cards
  function setupTiltCards() {
    const cards = document.querySelectorAll('.event-card');
    cards.forEach((card) => {
      if (card.dataset.tiltBound) return;
      card.dataset.tiltBound = 'true';

      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = ((y - centerY) / centerY) * -6;
        const rotateY = ((x - centerX) / centerX) * 6;

        card.style.transform = `perspective(800px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateY(-4px)`;
      });

      card.addEventListener('mouseleave', () => {
        card.style.transform = '';
      });
    });
  }

  // Entrance Stagger Animation
  function playEntranceAnimation() {
    const gsap = getGsap();
    if (!gsap) return;

    const heroContent = document.querySelector('.hero-content');
    const heroPoster = document.querySelector('.hero-poster');
    const cards = document.querySelectorAll('.event-card');

    const tl = gsap.timeline();
    if (heroContent) {
      tl.fromTo(
        heroContent,
        { opacity: 0, y: 24 },
        { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }
      );
    }
    if (heroPoster) {
      tl.fromTo(
        heroPoster,
        { opacity: 0, scale: 0.94 },
        { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(1.4)' },
        '-=0.4'
      );
    }
    if (cards.length) {
      tl.fromTo(
        cards,
        { opacity: 0, y: 30 },
        { opacity: 1, y: 0, duration: 0.45, stagger: 0.08, ease: 'power2.out' },
        '-=0.2'
      );
    }
  }

  function setupStudioUi() {
    document.querySelectorAll('[data-theme-btn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.themeBtn;
        if (target && target !== currentTheme) {
          applyTheme(target, true);
        }
      });
    });

    const replayBtn = document.getElementById('themeReplayBtn');
    if (replayBtn) {
      replayBtn.addEventListener('click', () => {
        playEntranceAnimation();
      });
    }
  }

  // Export to window for dynamic calls
  window.GSAPThemeStudio = {
    applyTheme,
    playEntranceAnimation,
    setupTiltCards,
    getCurrentTheme: () => currentTheme
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initThemes);
  } else {
    initThemes();
  }
})();
