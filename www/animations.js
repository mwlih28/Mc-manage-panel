// Scroll/hover animation layer for kretase.com — self-hosted GSAP +
// ScrollTrigger (see assets/vendor/gsap/). Fails silently if either script
// didn't load, and does nothing at all under prefers-reduced-motion, so the
// page is always fully visible and usable without this file.
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (typeof gsap === 'undefined') return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  if (typeof ScrollTrigger !== 'undefined') gsap.registerPlugin(ScrollTrigger);

  var EASE = 'power3.out';
  var isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  onReady(function () {
    /* ---------- Hero entrance ---------- */
    if (document.querySelector('.hero')) {
      var heroTl = gsap.timeline({ defaults: { ease: EASE, duration: 0.9 } });
      heroTl
        .from('.hero-badge', { y: 18, opacity: 0 })
        .from('.hero-title', { y: 28, opacity: 0 }, '-=0.6')
        .from('.hero-sub', { y: 18, opacity: 0 }, '-=0.6')
        .from('.hero-actions', { y: 18, opacity: 0 }, '-=0.55')
        .from('.hero-terminal', { y: 36, opacity: 0, duration: 1 }, '-=0.5');

      gsap.to('.hero-orb.orb-1', { y: 30, x: 12, duration: 8, repeat: -1, yoyo: true, ease: 'sine.inOut' });
      gsap.to('.hero-orb.orb-2', { y: -24, x: -14, duration: 10, repeat: -1, yoyo: true, ease: 'sine.inOut' });
      gsap.to('.hero-orb.orb-3', { y: 22, x: -18, duration: 9, repeat: -1, yoyo: true, ease: 'sine.inOut' });

      if (typeof ScrollTrigger !== 'undefined') {
        gsap.to('.hero-grid', {
          yPercent: 12,
          ease: 'none',
          scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
        });
      }
    }

    if (typeof ScrollTrigger === 'undefined') return;

    /* ---------- Section headers ---------- */
    gsap.utils.toArray('.section-header, .partners-hero .container, .verify-hero .container').forEach(function (el) {
      var targets = el.children && el.children.length ? el.children : el;
      gsap.from(targets, {
        y: 22, opacity: 0, duration: 0.7, ease: EASE, stagger: 0.08,
        scrollTrigger: { trigger: el, start: 'top 85%' },
      });
    });

    /* ---------- Staggered card grids ---------- */
    function revealGroup(selector, vars) {
      gsap.utils.toArray(selector).forEach(function (group) {
        var items = group.children && group.children.length ? Array.from(group.children) : [group];
        gsap.from(items, Object.assign({
          y: 26, opacity: 0, duration: 0.6, ease: EASE, stagger: 0.07,
          scrollTrigger: { trigger: group, start: 'top 88%' },
        }, vars || {}));
      });
    }

    revealGroup('.features-grid');
    revealGroup('.screenshot-grid');
    revealGroup('.games-grid');
    revealGroup('.community-grid');
    revealGroup('.steps-list');
    revealGroup('.what-list');
    revealGroup('.partners-grid');
    revealGroup('.stats-inner', { y: 12, stagger: 0.05, duration: 0.5 });

    /* ---------- Single-block fades ---------- */
    ['.what-text', '.what-visual', '.steps-terminal', '.newsletter-box', '.cta-box',
      '.security-badges', '.compare-table', '.verify-box'].forEach(function (sel) {
      gsap.utils.toArray(sel).forEach(function (el) {
        gsap.from(el, {
          y: 26, opacity: 0, duration: 0.7, ease: EASE,
          scrollTrigger: { trigger: el, start: 'top 88%' },
        });
      });
    });

    /* ---------- Comparison table rows, one at a time ---------- */
    gsap.utils.toArray('.compare-row').forEach(function (row) {
      gsap.from(row, {
        x: -18, opacity: 0, duration: 0.5, ease: EASE,
        scrollTrigger: { trigger: row, start: 'top 92%' },
      });
    });

    /* ---------- 3D tilt on hover (desktop only) ---------- */
    if (!isTouch) {
      function attachTilt(selector, strength) {
        document.querySelectorAll(selector).forEach(function (card) {
          gsap.set(card, { transformPerspective: 700 });
          var rotX = gsap.quickTo(card, 'rotationX', { duration: 0.4, ease: 'power2.out' });
          var rotY = gsap.quickTo(card, 'rotationY', { duration: 0.4, ease: 'power2.out' });
          card.addEventListener('mousemove', function (e) {
            var rect = card.getBoundingClientRect();
            var px = (e.clientX - rect.left) / rect.width - 0.5;
            var py = (e.clientY - rect.top) / rect.height - 0.5;
            rotY(px * strength);
            rotX(-py * strength);
          });
          card.addEventListener('mouseleave', function () { rotX(0); rotY(0); });
        });
      }
      attachTilt('.feat-card', 5);
      attachTilt('.screenshot-card', 4);
      attachTilt('.game-card', 4);
      attachTilt('.community-card', 4);
      attachTilt('.partner-card', 4);

      /* ---------- Magnetic pull on primary buttons ---------- */
      document.querySelectorAll('.hero-actions a, .cta-links a').forEach(function (btn) {
        var moveX = gsap.quickTo(btn, 'x', { duration: 0.3, ease: 'power2.out' });
        var moveY = gsap.quickTo(btn, 'y', { duration: 0.3, ease: 'power2.out' });
        btn.addEventListener('mousemove', function (e) {
          var rect = btn.getBoundingClientRect();
          moveX((e.clientX - rect.left - rect.width / 2) * 0.25);
          moveY((e.clientY - rect.top - rect.height / 2) * 0.25);
        });
        btn.addEventListener('mouseleave', function () { moveX(0); moveY(0); });
      });
    }

    window.addEventListener('load', function () { ScrollTrigger.refresh(); });
  });
})();
