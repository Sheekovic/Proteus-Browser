// Proteus website: motion. The pages work without this file; it only adds movement.
'use strict';
(() => {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The tide bar follows the scroll position.
  const tide = document.createElement('div');
  tide.className = 'tide';
  document.body.prepend(tide);
  const setTide = () => {
    const room = document.documentElement.scrollHeight - innerHeight;
    tide.style.setProperty('--tide', room > 0 ? String(Math.min(1, scrollY / room)) : '0');
  };
  addEventListener('scroll', setTide, { passive: true });
  addEventListener('resize', setTide);
  setTide();

  // Sections and cards surface as they come into view, a little after one another.
  const targets = document.querySelectorAll(
      'section.block h2, section.block p.lead, .cards .card, .steps .card, .two > *, .callout');
  if (!still && 'IntersectionObserver' in window) {
    const seen = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');
        seen.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -8% 0px' });
    const perParent = new Map();
    for (const target of targets) {
      const parent = target.parentElement;
      const index = perParent.get(parent) || 0;
      perParent.set(parent, index + 1);
      target.style.setProperty('--delay', `${Math.min(index, 7) * 70}ms`);
      target.classList.add('reveal');
      seen.observe(target);
    }
  }

  // The word in the headline changes shape, as Proteus does.
  const shift = document.querySelector('.shift');
  if (shift && !still) {
    const words = shift.dataset.words.split('|');
    let at = 0;
    setInterval(() => {
      if (document.hidden) return;
      shift.classList.add('out');
      setTimeout(() => {
        at = (at + 1) % words.length;
        shift.textContent = words[at];
        shift.classList.remove('out');
      }, 360);
    }, 2600);
  }

  // The link of the section being read carries the wave.
  const links = [...document.querySelectorAll('.top nav a[href^="#"]')];
  if (links.length && 'IntersectionObserver' in window) {
    const watch = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const link = links.find((a) => a.getAttribute('href') === '#' + entry.target.id);
        if (link) link.classList.toggle('here', entry.isIntersecting);
      }
    }, { rootMargin: '-45% 0px -45% 0px' });
    for (const link of links) {
      const section = document.querySelector(link.getAttribute('href'));
      if (section) watch.observe(section);
    }
  }
})();
