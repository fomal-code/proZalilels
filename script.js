/* ============================================
   ZALIELS — script.js
   Nav · Mobile menu · Toast · Contact form
   Shared helpers exposed on window.Zaliels for shop.js
   ============================================ */

(function () {
  'use strict';

  const CFG = window.ZALIELS_CONFIG || {};
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- SCROLL LOCK (shared by mobile menu, quick view, cart) ---- */
  let lockCount = 0;
  function lockScroll() {
    if (lockCount++ === 0) document.body.style.overflow = 'hidden';
  }
  function unlockScroll() {
    if (lockCount > 0 && --lockCount === 0) document.body.style.overflow = '';
  }

  /* ---- TOAST ---- */
  const toast = document.getElementById('toast');
  let toastTimer;

  function showToast(msg) {
    if (!toast) return;
    clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
  }

  /* ---- NAV STATE (single rAF-throttled scroll handler) ---- */
  const nav    = document.getElementById('nav');
  let ticking  = false;

  function onFrame() {
    ticking = false;
    const y = window.scrollY;
    nav.classList.toggle('scrolled', y > 8);
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(onFrame);
    }
  }, { passive: true });
  onFrame();

  /* ---- MOBILE MENU ---- */
  const burger      = document.getElementById('navBurger');
  const mobileMenu  = document.getElementById('mobileMenu');
  const mobileClose = document.getElementById('mobileClose');
  const mobileLinks = document.querySelectorAll('.mobile-link');

  function openMenu() {
    if (mobileMenu.classList.contains('open')) return;
    mobileMenu.classList.add('open');
    mobileMenu.setAttribute('aria-hidden', 'false');
    burger.setAttribute('aria-expanded', 'true');
    lockScroll();
    mobileClose.focus({ preventScroll: true });
  }

  function closeMenu(restoreFocus) {
    if (!mobileMenu.classList.contains('open')) return;
    mobileMenu.classList.remove('open');
    mobileMenu.setAttribute('aria-hidden', 'true');
    burger.setAttribute('aria-expanded', 'false');
    unlockScroll();
    if (restoreFocus) burger.focus({ preventScroll: true });
  }

  burger.addEventListener('click', openMenu);
  mobileClose.addEventListener('click', () => closeMenu(true));
  mobileLinks.forEach(link => link.addEventListener('click', () => closeMenu(false)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu(true);
  });
  // Close the menu if the viewport grows to desktop size
  window.matchMedia('(min-width: 901px)').addEventListener('change', (e) => {
    if (e.matches) closeMenu(false);
  });

  /* ---- SMOOTH NAV LINK SCROLL ---- */
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (!href || href === '#') return;          // placeholder links: ignore safely
      const target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();
      const offset = window.scrollY + target.getBoundingClientRect().top - (target.id === 'hero' ? 0 : 56);
      window.scrollTo({ top: offset, behavior: reduceMotion ? 'auto' : 'smooth' });
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    });
  });

  /* ---- CONTACT FORM ---- */
  const contactForm = document.getElementById('contactForm');
  const formSuccess = document.getElementById('formSuccess');

  if (contactForm) {
    contactForm.addEventListener('submit', function (e) {
      e.preventDefault();

      const name    = document.getElementById('contactName').value.trim();
      const email   = document.getElementById('contactEmail').value.trim();
      const subject = document.getElementById('contactSubject').value;
      const message = document.getElementById('contactMessage').value.trim();

      if (!name || !email || !message) {
        showToast('Please fill in all required fields.');
        return;
      }

      const brand  = CFG.brand || 'Zaliels';
      const waText = `Hello ${brand},\n\nName: ${name}\nEmail: ${email}\nSubject: ${subject || 'General Inquiry'}\n\n${message}`;
      const waNumber = CFG.whatsappNumber || '2348178435066';
      const waUrl = `https://wa.me/${waNumber}?text=${encodeURIComponent(waText)}`;

      contactForm.style.display = 'none';
      formSuccess.classList.add('visible');

      setTimeout(() => window.open(waUrl, '_blank', 'noopener,noreferrer'), 600);
    });
  }

  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const collLabel = document.getElementById('collectionLabel');
  if (collLabel) collLabel.textContent = 'Collection ' + new Date().getFullYear();

  /* ---- FOOTER SOCIAL LINKS (only real, configured links are shown) ---- */
  
const social = document.getElementById('footerSocial');

if (social) {
  social.replaceChildren();

  const links = [
    {
      label: 'Instagram',
      href: 'https://www.instagram.com/zalielscasual/'
    },
    {
      label: 'Pinterest',
      href: 'https://www.pinterest.com/'
    },
    {
      label: 'WhatsApp',
      href: 'https://wa.me/2349138947809'
    }
  ];

  links.forEach(({ label, href }) => {
    const li = document.createElement('li');
    const a = document.createElement('a');

    a.href = href;
    a.textContent = label;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';

    li.appendChild(a);
    social.appendChild(li);
  });
}


  /* ---- SEO META (canonical / social preview) when configured ---- */
  function setMeta(attr, key, value) {
    let el = document.head.querySelector(`meta[${attr}="${key}"]`);
    if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
    el.setAttribute('content', value);
  }
  if (CFG.siteUrl) {
    let link = document.head.querySelector('link[rel="canonical"]');
    if (!link) { link = document.createElement('link'); link.rel = 'canonical'; document.head.appendChild(link); }
    link.href = CFG.siteUrl;
    setMeta('property', 'og:url', CFG.siteUrl);
  }
  if (CFG.ogImage) {
    setMeta('property', 'og:image', CFG.ogImage);
    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:image', CFG.ogImage);
  }

  /* ---- LOOKBOOK HOVER IMAGE SWAP (optional) ---- */
  document.querySelectorAll('.lookbook-item').forEach(item => {
    const img = item.querySelector('img');
    const alt = item.dataset.hover;
    if (!img || !alt) return;

    const original = img.src;

    item.addEventListener('mouseenter', () => { img.src = alt; });
    item.addEventListener('mouseleave', () => { img.src = original; });
  });

  /* ---- SHARED API ---- */
  window.Zaliels = Object.assign(window.Zaliels || {}, { showToast, lockScroll, unlockScroll });

})();
