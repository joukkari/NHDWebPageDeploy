// Noir Hound Digital - main client script
// - Theme toggle (respect system preference)
// - (Replaced) Interactive logo shadow removed; handled now by Three.js scene
// - Typewriter effect
// - Simple carousel
// - Section routing

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const validSections = new Set(['home', 'games', 'about', 'press']);

function slugify(value){
  return (value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseHashRoute(hash = window.location.hash){
  const raw = (hash || '').replace(/^#/, '').replace(/^\/+|\/+$/g, '');
  if (!raw) return { section: 'home', gameSlug: null };

  const [rawSection, rawGameSlug] = raw.split('/');
  const section = validSections.has(rawSection) ? rawSection : 'home';
  const gameSlug = rawGameSlug ? decodeURIComponent(rawGameSlug) : null;
  return { section, gameSlug };
}

function buildHashRoute(section, gameSlug){
  if (!validSections.has(section)) return '';
  if (section === 'games' && gameSlug) {
    return `#games/${encodeURIComponent(gameSlug)}`;
  }
  return `#${section}`;
}

function syncHashRoute(section, gameSlug, { replace = false } = {}){
  const nextHash = buildHashRoute(section, gameSlug);
  if (!nextHash || window.location.hash === nextHash) return;

  if (replace) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${nextHash}`);
    return;
  }

  window.location.hash = nextHash;
}

// TOP SOCIALS RESPONSIVE SCALE (only top-right row)
(function topSocialScaleInit(){
  const topSocials = $('.social-links--top');
  if (!topSocials) return;

  function applyTopSocialScale(){
    const width = window.innerWidth || document.documentElement.clientWidth || 0;
    const minWidth = 400;
    const maxWidth = 720;
    let scale = 1;

    if (width <= minWidth) {
      scale = 0.5;
    } else if (width < maxWidth) {
      scale = 0.5 + ((width - minWidth) * 0.5) / (maxWidth - minWidth);
    }

    topSocials.style.transform = `scale(${scale})`;
  }

  applyTopSocialScale();
  window.addEventListener('resize', applyTopSocialScale, { passive: true });
})();

// YEAR
$('#year').textContent = new Date().getFullYear();

// COLOR INTENSITY TOGGLE
(function colorIntensityInit(){
  const btn = $('#colorIntensityToggle');
  const label = $('#colorIntensityLabel');
  const root = document.documentElement;
  
  // Color sets
  const intensities = {
    '100%': {
      dark: { bg: '#0b0b0b', bg2: '#111111', bg3: '#171717', fg: '#efefef', muted: '#a5a5a5', border: '#2a2a2a', accent: '#e5e5e5' },
      light: { bg: '#f7f7f7', bg2: '#ffffff', bg3: '#f1f1f1', fg: '#101010', muted: '#4a4a4a', border: '#d7d7d7', accent: '#222222' }
    },
    '90%': {
      dark: { bg: '#1a1a1a', bg2: '#1f1f1f', bg3: '#252525', fg: '#e0e0e0', muted: '#b0b0b0', border: '#3a3a3a', accent: '#d5d5d5' },
      light: { bg: '#f0f0f0', bg2: '#fafafa', bg3: '#e8e8e8', fg: '#1a1a1a', muted: '#5a5a5a', border: '#c0c0c0', accent: '#333333' }
    }
  };
  
  let currentIntensity = '100%';
  
  function applyIntensity(intensity){
    currentIntensity = intensity;
    label.textContent = intensity;
    const theme = root.getAttribute('data-theme') || 'light';
    const colors = intensities[intensity][theme];
    
    root.style.setProperty('--bg', colors.bg);
    root.style.setProperty('--bg-2', colors.bg2);
    root.style.setProperty('--bg-3', colors.bg3);
    root.style.setProperty('--fg', colors.fg);
    root.style.setProperty('--muted', colors.muted);
    root.style.setProperty('--border', colors.border);
    root.style.setProperty('--accent', colors.accent);
  }
  
  btn.addEventListener('click', () => {
    const next = currentIntensity === '100%' ? '90%' : '100%';
    applyIntensity(next);
  });
  
  // Also reapply on theme change
  window.addEventListener('themeChanged', () => {
    applyIntensity(currentIntensity);
  });
})();

// THEME
(function themeInit(){
  const btn = $('#themeToggle');
  const root = document.documentElement;
  
  function swapTeamMembers() {
    const aboutLayout = $('.about-layout');
    if (!aboutLayout) return;
    
    const figures = aboutLayout.querySelectorAll('figure');
    if (figures.length !== 2) return;
    
    // Swap the figure elements in the DOM
    const parent = figures[0].parentNode;
    const firstFigure = figures[0];
    const secondFigure = figures[1];
    
    // Insert second before first, then first after second (effectively swapping)
    parent.insertBefore(secondFigure, firstFigure);
  }
  
  function setTheme(next){
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch(e) {}
    swapTeamMembers();
    window.dispatchEvent(new Event('themeChanged'));
  }
  // Initialize with stored or default (ignore system media here)
  const current = root.getAttribute('data-theme') || 'light';
  setTheme(current);
  btn.addEventListener('click', () => {
    const now = root.getAttribute('data-theme');
    setTheme(now === 'dark' ? 'light' : 'dark');
  });
  // React to system changes if user hasn't explicitly chosen
  try {
    const stored = localStorage.getItem('theme');
    if (!stored && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', (e) => setTheme(e.matches ? 'dark' : 'light'));
    }
  } catch(e) {}
})();

// ROUTING between sections
(function routing(){
  const sections = {
    home: $('#homeSection'),
    games: $('#gamesSection'),
    about: $('#aboutSection'),
    press: $('#pressSection'),
  };

  function show(section, options = {}){
    const {
      gameSlug = null,
      syncHash = true,
      replaceHash = false,
    } = options;
    const nextSection = validSections.has(section) ? section : 'home';

    Object.values(sections).forEach(el => el.classList.add('hidden'));
    sections[nextSection].classList.remove('hidden');

    if (nextSection === 'games' && window.noirCarousel) {
      window.noirCarousel.setBySlug(gameSlug, { syncHash: false });
    }

    if (syncHash) {
      const activeGameSlug = nextSection === 'games' && window.noirCarousel
        ? window.noirCarousel.getCurrentSlug()
        : null;
      syncHashRoute(nextSection, activeGameSlug, { replace: replaceHash });
    }

    sections[nextSection].scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });

    if (nextSection === 'home') {
      startHomeTypewriter();
    }

    if (nextSection === 'about') {
      startTypewriter();
    }

    if (nextSection === 'games') {
      console.log('Games section shown, triggering typewriters');
      setTimeout(() => startGameTypewriters(), 50);
    }
  }

  function applyHashRoute(){
    const { section, gameSlug } = parseHashRoute();
    show(section, { gameSlug, syncHash: false });
  }

  $$(".menu-link").forEach(el => {
    el.addEventListener('click', (e) => {
      const link = e.currentTarget.getAttribute('data-link');
      e.preventDefault();

      if (link === 'games') {
        const currentSlug = window.noirCarousel ? window.noirCarousel.getCurrentSlug() : null;
        show('games', { gameSlug: currentSlug });
        return;
      }

      if (link === 'about' || link === 'home' || link === 'press') {
        show(link);
      }
    });
  });

  window.addEventListener('hashchange', applyHashRoute);

  // Expose show function for other modules
  window.showSection = show;

  setTimeout(() => {
    if (window.location.hash) {
      applyHashRoute();
      return;
    }

    show('home', { syncHash: false });
  }, 100);
})();

// TYPEWRITER
function prefersReducedMotion(){
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let typewriterStarted = false;
const typewrittenElements = new Set();

function animateTypewriter(el) {
  console.log('animateTypewriter called for:', el);
  console.log('Already animated?', typewrittenElements.has(el));
  if (!el || typewrittenElements.has(el)) return;
  typewrittenElements.add(el);
  
  const text = el.getAttribute('data-text') || '';
  console.log('Text to animate:', text);
  if (prefersReducedMotion()) {
    el.innerHTML = text.replace(/\n/g, '<br>');
    return;
  }
  
  // Clear existing content and add caret
  el.textContent = '';
  el.classList.add('typewriter-caret');
  let i = 0;
  const minPerFrame = 1, maxPerFrame = 3;
  
  function step(){
    const jump = Math.floor(Math.random() * (maxPerFrame - minPerFrame + 1)) + minPerFrame;
    i = Math.min(text.length, i + jump);
    // Preserve line breaks: convert \n to <br> tags
    const displayText = text.slice(0, i).replace(/\n/g, '<br>');
    el.innerHTML = displayText;
    
    if (i < text.length) {
      requestAnimationFrame(step);
    } else {
      setTimeout(() => el.classList.remove('typewriter-caret'), 600);
    }
  }
  requestAnimationFrame(step);
}

function startTypewriter(){
  if (typewriterStarted) return;
  typewriterStarted = true;
  const el = $('#aboutIntro');
  if (el) animateTypewriter(el);
}

let homeTypewriterStarted = false;
function startHomeTypewriter(){
  if (homeTypewriterStarted) return;
  homeTypewriterStarted = true;
  const el = $('#homeIntro');
  if (el) animateTypewriter(el);
}

function startGameTypewriters(){
  console.log('startGameTypewriters called');
  // Only animate the currently visible carousel item
  const carouselItems = $$('.carousel-item');
  const track = $('.carousel-inner');
  if (!track) return;
  
  // Find which carousel item is currently visible
  const transform = track.style.transform || 'translateX(0%)';
  const match = transform.match(/translateX\((-?\d+)%\)/);
  const currentIndex = match ? Math.abs(parseInt(match[1]) / 100) : 0;
  
  console.log('Current carousel index:', currentIndex);
  
  if (carouselItems[currentIndex]) {
    const element = carouselItems[currentIndex].querySelector('.typewriter-text');
    if (element) {
      console.log('Animating visible element:', element, 'data-text:', element.getAttribute('data-text'));
      animateTypewriter(element);
    }
  }
}

// (Logo shadow feature removed in favor of Three.js implementation in logoScene.js)

// SIMPLE CAROUSEL
(function carousel(){
  const track = $('.carousel-inner');
  if (!track) return;
  const items = $$('.carousel-item');
  const prev = $('.carousel-prev');
  const next = $('.carousel-next');
  const gameSlugs = items.map((item, itemIndex) => {
    const fallbackSlug = slugify(item.querySelector('h3')?.textContent || `game-${itemIndex + 1}`);
    const slug = item.dataset.gameSlug || fallbackSlug;
    item.dataset.gameSlug = slug;
    return slug;
  });
  let index = 0;

  function update(options = {}){
    const { syncHash = false } = options;
    const x = -index * 100;
    track.style.transform = `translateX(${x}%)`;

    // Trigger typewriter for the newly visible item
    const currentItem = items[index];
    if (currentItem) {
      const textElement = currentItem.querySelector('.typewriter-text');
      if (textElement && !typewrittenElements.has(textElement)) {
        setTimeout(() => animateTypewriter(textElement), 100);
      }
    }

    if (syncHash) {
      syncHashRoute('games', gameSlugs[index]);
    }
  }

  function setIndex(nextIndex, options = {}){
    index = (nextIndex + items.length) % items.length;
    update(options);
  }

  function setBySlug(slug, options = {}){
    const nextIndex = slug ? gameSlugs.indexOf(slug) : -1;
    setIndex(nextIndex >= 0 ? nextIndex : 0, options);
  }

  function getCurrentSlug(){
    return gameSlugs[index] || null;
  }

  prev.addEventListener('click', () => { setIndex(index - 1, { syncHash: true }); });
  next.addEventListener('click', () => { setIndex(index + 1, { syncHash: true }); });

  window.noirCarousel = {
    getCurrentSlug,
    setBySlug,
  };

  // Don't call update() on page load - let Games section trigger the first animation
})();

