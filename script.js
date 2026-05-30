// ===== Year =====
document.getElementById('year').textContent = new Date().getFullYear();

// ===== Custom Cursor =====
const cursor = document.getElementById('cursor');
const follower = document.getElementById('cursor-follower');
let mouseX = 0, mouseY = 0;
let followerX = 0, followerY = 0;

window.addEventListener('mousemove', (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
  cursor.style.left = mouseX + 'px';
  cursor.style.top = mouseY + 'px';
});

function animateFollower() {
  followerX += (mouseX - followerX) * 0.15;
  followerY += (mouseY - followerY) * 0.15;
  follower.style.left = followerX + 'px';
  follower.style.top = followerY + 'px';
  requestAnimationFrame(animateFollower);
}
animateFollower();

const hoverables = document.querySelectorAll('a, button, .project-card');
hoverables.forEach((el) => {
  el.addEventListener('mouseenter', () => {
    cursor.classList.add('hover');
    follower.classList.add('hover');
  });
  el.addEventListener('mouseleave', () => {
    cursor.classList.remove('hover');
    follower.classList.remove('hover');
  });
});

// ===== Nav scroll behavior =====
const nav = document.querySelector('.nav');
let lastScroll = 0;
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  if (y > 30) nav.classList.add('scrolled');
  else nav.classList.remove('scrolled');
  lastScroll = y;
}, { passive: true });

// ===== Mobile menu =====
const toggle = document.getElementById('menu-toggle');
const links = document.querySelector('.nav-links');
toggle.addEventListener('click', () => {
  toggle.classList.toggle('open');
  links.classList.toggle('open');
});
links.querySelectorAll('a').forEach((a) =>
  a.addEventListener('click', () => {
    toggle.classList.remove('open');
    links.classList.remove('open');
  })
);

// ===== Reveal on scroll =====
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12, rootMargin: '0px 0px -60px 0px' }
);

document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));

// ===== Parallax blobs (gentle) =====
const blobs = document.querySelectorAll('.blob');
window.addEventListener('mousemove', (e) => {
  const x = (e.clientX / window.innerWidth - 0.5) * 30;
  const y = (e.clientY / window.innerHeight - 0.5) * 30;
  blobs.forEach((blob, i) => {
    const depth = (i + 1) * 0.5;
    blob.style.transform = `translate(${x * depth}px, ${y * depth}px)`;
  });
});

// ===== Project hover tint =====
document.querySelectorAll('.project-card').forEach((card) => {
  const color = card.dataset.color;
  if (!color) return;
  card.addEventListener('mouseenter', () => {
    card.style.setProperty('background', `linear-gradient(90deg, ${color}0a, transparent)`);
  });
  card.addEventListener('mouseleave', () => {
    card.style.background = '';
  });
});

// ===== Weather + Holiday Widget =====
(async () => {
  const widget   = document.getElementById('weather-widget');
  const holiday  = document.getElementById('ww-holiday');
  if (!widget) return;

  const CACHE_KEY = 'sf-wx-cache';
  const CACHE_TTL = 30 * 60 * 1000; // 30 min

  // WMO weather code → emoji + label
  function wxInfo(code) {
    if (code === 0)              return { icon: '☀️', desc: 'Clear sky' };
    if (code <= 2)               return { icon: '🌤️', desc: 'Partly cloudy' };
    if (code === 3)              return { icon: '☁️', desc: 'Overcast' };
    if (code <= 48)              return { icon: '🌫️', desc: 'Foggy' };
    if (code <= 57)              return { icon: '🌦️', desc: 'Drizzle' };
    if (code <= 67)              return { icon: '🌧️', desc: 'Rain' };
    if (code <= 77)              return { icon: '❄️',  desc: 'Snow' };
    if (code <= 82)              return { icon: '🌦️', desc: 'Showers' };
    if (code <= 86)              return { icon: '🌨️', desc: 'Snow showers' };
    if (code >= 95)              return { icon: '⛈️', desc: 'Thunderstorm' };
    return { icon: '🌡️', desc: 'Mixed' };
  }

  function render(d) {
    document.getElementById('ww-icon').textContent = d.icon;
    document.getElementById('ww-temp').textContent = `${d.temp}°C`;
    document.getElementById('ww-desc').textContent = d.desc;
    document.getElementById('ww-city').textContent = d.city;
    if (d.holiday) {
      document.getElementById('ww-hname').textContent = d.holiday;
      holiday.hidden = false;
    }
    widget.hidden = false;
  }

  // Check session cache first
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw) {
      const c = JSON.parse(raw);
      if (Date.now() - c.ts < CACHE_TTL) { render(c); return; }
    }
  } catch (_) {}

  try {
    // 1. Get rough location via IP (no permission needed)
    let lat = 13.7563, lon = 100.5018, city = 'Bangkok', country = 'TH';
    try {
      const loc = await fetch('https://ipapi.co/json/').then(r => r.json());
      if (loc.latitude) {
        lat     = loc.latitude;
        lon     = loc.longitude;
        city    = loc.city || city;
        country = loc.country_code || country;
      }
    } catch (_) { /* keep Bangkok defaults */ }

    // 2. Weather from Open-Meteo (completely free, no API key)
    const wx = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weathercode&timezone=auto`
    ).then(r => r.json());
    const temp = Math.round(wx.current.temperature_2m);
    const { icon, desc } = wxInfo(wx.current.weathercode);

    // 3. Public holidays for today
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const year  = today.slice(0, 4);
    let holidayName = null;
    try {
      const hols = await fetch(
        `https://date.nager.at/api/v3/publicholidays/${year}/${country}`
      ).then(r => r.json());
      const found = Array.isArray(hols) && hols.find(h => h.date === today);
      if (found) holidayName = found.localName || found.name;
    } catch (_) {}

    const data = { icon, temp, desc, city, holiday: holidayName, ts: Date.now() };
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (_) {}
    render(data);

  } catch (_) {
    // silently skip widget if all APIs fail
  }
})();
