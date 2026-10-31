/**
 * ==========================================================================
 * GSAP MOTION & LIQUID GLASS ENGINE
 * Stage Pass Ultra-Luxury Interactive Studio
 * ==========================================================================
 */

(function () {
  'use strict';

  function getGsap() {
    return window.gsap || null;
  }

  // 1. Ambient Liquid Blobs Floating Animation
  function initLiquidBlobs() {
    const gsap = getGsap();
    if (!gsap) return;

    const b1 = document.querySelector('.liquid-blob-1');
    const b2 = document.querySelector('.liquid-blob-2');
    const b3 = document.querySelector('.liquid-blob-3');

    if (b1) {
      gsap.to(b1, {
        x: '+=80',
        y: '+=60',
        scale: 1.15,
        duration: 8,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut'
      });
    }

    if (b2) {
      gsap.to(b2, {
        x: '-=70',
        y: '+=80',
        scale: 0.9,
        duration: 10,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut'
      });
    }

    if (b3) {
      gsap.to(b3, {
        x: '+=60',
        y: '-=50',
        scale: 1.2,
        duration: 12,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut'
      });
    }
  }

  // 2. Liquid Glass Dynamic Specular Light & 3D Tilt
  function setupLiquidGlassTilt() {
    const gsap = getGsap();
    const cards = document.querySelectorAll('.mockup-card, .event-card, .table-preview-card, .liquid-glass');

    cards.forEach((card) => {
      if (card.dataset.liquidTiltBound) return;
      card.dataset.liquidTiltBound = 'true';

      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Set CSS variables for liquid specular light reflection
        card.style.setProperty('--mouse-x', `${x.toFixed(1)}px`);
        card.style.setProperty('--mouse-y', `${y.toFixed(1)}px`);

        // Calculate 3D tilt angles
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = ((y - centerY) / centerY) * -7;
        const rotateY = ((x - centerX) / centerX) * 7;

        if (gsap) {
          gsap.to(card, {
            rotateX: rotateX,
            rotateY: rotateY,
            transformPerspective: 900,
            duration: 0.2,
            ease: 'power1.out',
            overwrite: 'auto'
          });
        } else {
          card.style.transform = `perspective(900px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg)`;
        }
      });

      card.addEventListener('mouseleave', () => {
        if (gsap) {
          gsap.to(card, {
            rotateX: 0,
            rotateY: 0,
            duration: 0.5,
            ease: 'power2.out',
            overwrite: 'auto'
          });
        } else {
          card.style.transform = '';
        }
      });
    });
  }

  // 3. Hero Staggered Entrance Choreography
  function playEntranceAnimation() {
    const gsap = getGsap();
    if (!gsap) return;

    const headline = document.querySelector('.hero-headline-elevate');
    const searchPill = document.querySelector('.hero-search-pill');
    const pills = document.querySelectorAll('.category-pills .pill-btn');
    const heroCards = document.querySelectorAll('.mockup-cards-row > div');
    const eventCards = document.querySelectorAll('.event-card');

    const tl = gsap.timeline();

    if (headline) {
      tl.fromTo(
        headline,
        { opacity: 0, y: 35, scale: 0.95 },
        { opacity: 1, y: 0, scale: 1, duration: 0.8, ease: 'power3.out' }
      );
    }

    if (searchPill) {
      tl.fromTo(
        searchPill,
        { opacity: 0, y: 24 },
        { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' },
        '-=0.5'
      );
    }

    if (pills && pills.length) {
      tl.fromTo(
        pills,
        { opacity: 0, y: 16, scale: 0.9 },
        { opacity: 1, y: 0, scale: 1, duration: 0.4, stagger: 0.05, ease: 'back.out(1.5)' },
        '-=0.4'
      );
    }

    if (heroCards && heroCards.length) {
      tl.fromTo(
        heroCards,
        { opacity: 0, y: 40, rotateX: 6 },
        { opacity: 1, y: 0, rotateX: 0, duration: 0.7, stagger: 0.15, ease: 'power3.out' },
        '-=0.3'
      );
    }

    if (eventCards && eventCards.length) {
      tl.fromTo(
        eventCards,
        { opacity: 0, y: 30 },
        { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: 'power2.out' },
        '-=0.2'
      );
    }
  }

  // 4. Liquid Magnetic Button Pull Micro-Interaction
  function setupMagneticButtons() {
    const gsap = getGsap();
    if (!gsap) return;

    const magneticTargets = document.querySelectorAll('.nav-cta-btn, .btn-fire, .pill-btn');

    magneticTargets.forEach((btn) => {
      if (btn.dataset.magneticBound) return;
      btn.dataset.magneticBound = 'true';

      btn.addEventListener('mousemove', (e) => {
        const rect = btn.getBoundingClientRect();
        const relX = e.clientX - (rect.left + rect.width / 2);
        const relY = e.clientY - (rect.top + rect.height / 2);

        gsap.to(btn, {
          x: relX * 0.28,
          y: relY * 0.28,
          duration: 0.25,
          ease: 'power1.out',
          overwrite: 'auto'
        });
      });

      btn.addEventListener('mouseleave', () => {
        gsap.to(btn, {
          x: 0,
          y: 0,
          duration: 0.45,
          ease: 'elastic.out(1, 0.4)',
          overwrite: 'auto'
        });
      });
    });
  }

  // 5. Tactile Liquid Droplet Click Ripple
  function setupLiquidRipple() {
    const gsap = getGsap();
    document.addEventListener('click', (e) => {
      const target = e.target.closest('.nav-cta-btn, .btn-fire, .btn-primary, .pill-btn, .mockup-card');
      if (!target) return;

      const rect = target.getBoundingClientRect();
      const ripple = document.createElement('span');
      ripple.className = 'liquid-ripple';

      const size = Math.max(rect.width, rect.height) * 2;
      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
      ripple.style.top = `${e.clientY - rect.top - size / 2}px`;

      target.appendChild(ripple);

      if (gsap) {
        gsap.fromTo(
          ripple,
          { scale: 0, opacity: 0.7 },
          {
            scale: 1,
            opacity: 0,
            duration: 0.6,
            ease: 'power2.out',
            onComplete: () => ripple.remove()
          }
        );
      } else {
        setTimeout(() => ripple.remove(), 600);
      }
    });
  }

  // Master Initializer
  function initEngine() {
    initLiquidBlobs();
    setupLiquidGlassTilt();
    setupMagneticButtons();
    setupLiquidRipple();

    // Trigger hero entrance either on preloader finish or DOM ready
    setTimeout(() => {
      playEntranceAnimation();
    }, 400);
  }

  // Export to window
  window.GSAPLiquidGlass = {
    playEntrance: playEntranceAnimation,
    setupTiltCards: setupLiquidGlassTilt,
    init: initEngine
  };

  // Backwards compatibility with app.js and legacy calls
  window.GSAPThemeStudio = {
    setupTiltCards: setupLiquidGlassTilt,
    playEntranceAnimation: playEntranceAnimation,
    applyTheme: () => {},
    getCurrentTheme: () => 'arena'
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEngine);
  } else {
    initEngine();
  }
})();
