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
