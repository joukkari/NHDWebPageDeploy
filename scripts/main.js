// Noir Hound Digital - main client script
// - Theme toggle (respect system preference)
// - (Replaced) Interactive logo shadow removed; handled now by Three.js scene
// - Typewriter effect
// - Simple carousel
// - Section routing

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

// YEAR
$('#year').textContent = new Date().getFullYear();

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
    games: $('#gamesSection'),
    about: $('#aboutSection'),
  };
  function show(section){
    Object.values(sections).forEach(el => el.classList.add('hidden'));
    if (sections[section]) sections[section].classList.remove('hidden');
    if (section === 'games' || section === 'about') {
      sections[section].scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
    // Trigger typewriter when About section is shown
    if (section === 'about') {
      startTypewriter();
    }
    // Trigger typewriter for game descriptions when Games section is shown
    if (section === 'games') {
      console.log('Games section shown, triggering typewriters');
      setTimeout(() => startGameTypewriters(), 50);
    }
  }
  $$(".menu-link").forEach(el => {
    el.addEventListener('click', (e) => {
      const link = e.currentTarget.getAttribute('data-link');
      if (link === 'games' || link === 'about') {
        e.preventDefault();
        show(link);
      }
      if (link === 'home') {
        e.preventDefault();
        show('home');
      }
    });
  });
  // Expose show function for typewriter integration
  window.showSection = show;
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
  let index = 0;
  function update(){
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
  }
  prev.addEventListener('click', () => { index = (index - 1 + items.length) % items.length; update(); });
  next.addEventListener('click', () => { index = (index + 1) % items.length; update(); });
  // Don't call update() on page load - let Games section trigger the first animation
})();
