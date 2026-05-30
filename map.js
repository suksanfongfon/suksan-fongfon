/* ============================================
   World Map Presentation Tool
   D3.js + TopoJSON
   ============================================ */

const WORLD_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
const STORAGE_KEY = 'world-map-state-v1';

// ---- State ----
const state = {
  // { [countryId]: { name, color, label, ringEnabled, labelOffset: {dx, dy} } }
  countries: {},
  selectedId: null,
  currentColor: '#a855f7',
  ringEnabled: true,
};

// ---- Elements ----
const svgEl = d3.select('#map');
const toolbar = document.getElementById('toolbar');
const selectedLabel = document.getElementById('selected-country');
const labelInput = document.getElementById('label-input');
const colorGrid = document.getElementById('color-grid');
const customColor = document.getElementById('custom-color');
const ringToggle = document.getElementById('ring-toggle');
const clearSelectedBtn = document.getElementById('clear-selected');
const clearAllBtn = document.getElementById('clear-all');
const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomResetBtn = document.getElementById('zoom-reset');
const presentBtn = document.getElementById('present-toggle');
const exitPresentBtn = document.getElementById('exit-present');
const exportBtn = document.getElementById('export-png');
const hintEl = document.getElementById('hint');
const labelEditor = document.getElementById('label-editor');
const labelEditorInput = document.getElementById('label-editor-input');
const app = document.getElementById('app');

// ---- Projection & zoom ----
let width = 0, height = 0;
const projection = d3.geoNaturalEarth1();
const path = d3.geoPath(projection);
let gRoot, gCountries, gOverlays;
let countriesData = [];
let countryById = new Map();

const zoom = d3.zoom()
  .scaleExtent([0.6, 12])
  .on('zoom', (event) => {
    gRoot.attr('transform', event.transform);
    gRoot.style('stroke-width', (0.5 / event.transform.k) + 'px');
  });

// ---- Load ----
async function init() {
  loadState();
  await renderMap();
  bindUI();
  applyColorActive();
  ringToggle.checked = state.ringEnabled;
  hideHintSoon();
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    Object.assign(state, parsed);
    state.selectedId = null; // never restore selection
  } catch (e) { /* ignore */ }
}

function saveState() {
  const toSave = {
    countries: state.countries,
    currentColor: state.currentColor,
    ringEnabled: state.ringEnabled,
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave)); } catch (e) {}
}

async function renderMap() {
  const rect = document.querySelector('.map-area').getBoundingClientRect();
  width = rect.width;
  height = rect.height;

  svgEl.attr('viewBox', `0 0 ${width} ${height}`);

  projection.fitSize([width, height], { type: 'Sphere' });

  const world = await d3.json(WORLD_URL);
  const features = topojson.feature(world, world.objects.countries).features;
  countriesData = features;
  features.forEach(f => countryById.set(f.id, f));

  gRoot = svgEl.append('g').attr('class', 'g-root');
  gCountries = gRoot.append('g').attr('class', 'g-countries');
  gOverlays = gRoot.append('g').attr('class', 'g-overlays');

  gCountries.selectAll('path')
    .data(features)
    .enter().append('path')
    .attr('class', 'country')
    .attr('d', path)
    .attr('data-id', d => d.id)
    .on('click', onCountryClick)
    .append('title')
    .text(d => d.properties.name);

  svgEl.call(zoom);

  // Apply persisted countries
  Object.entries(state.countries).forEach(([id, info]) => {
    paintCountry(id, info.color);
  });
  redrawOverlays();
}

function bindUI() {
  // color swatches
  colorGrid.querySelectorAll('.color-swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.currentColor = btn.dataset.color;
      customColor.value = btn.dataset.color;
      applyColorActive();
      if (state.selectedId) {
        updateCountry(state.selectedId, { color: state.currentColor });
      }
    });
  });

  customColor.addEventListener('input', (e) => {
    state.currentColor = e.target.value;
    applyColorActive();
    if (state.selectedId) {
      updateCountry(state.selectedId, { color: state.currentColor });
    }
  });

  labelInput.addEventListener('input', (e) => {
    if (!state.selectedId) return;
    updateCountry(state.selectedId, { label: e.target.value });
  });

  ringToggle.addEventListener('change', (e) => {
    state.ringEnabled = e.target.checked;
    if (state.selectedId) {
      updateCountry(state.selectedId, { ringEnabled: e.target.checked });
    } else {
      // apply to all
      Object.keys(state.countries).forEach(id => {
        state.countries[id].ringEnabled = e.target.checked;
      });
      saveState();
      redrawOverlays();
    }
  });

  clearSelectedBtn.addEventListener('click', () => {
    if (!state.selectedId) return;
    removeCountry(state.selectedId);
    selectCountry(null);
  });

  clearAllBtn.addEventListener('click', () => {
    if (!Object.keys(state.countries).length) return;
    if (!confirm('Clear all marked countries?')) return;
    state.countries = {};
    selectCountry(null);
    saveState();
    gCountries.selectAll('path').style('fill', null);
    redrawOverlays();
  });

  zoomInBtn.addEventListener('click', () => svgEl.transition().duration(300).call(zoom.scaleBy, 1.4));
  zoomOutBtn.addEventListener('click', () => svgEl.transition().duration(300).call(zoom.scaleBy, 1 / 1.4));
  zoomResetBtn.addEventListener('click', () => svgEl.transition().duration(400).call(zoom.transform, d3.zoomIdentity));

  presentBtn.addEventListener('click', () => togglePresent(true));
  exitPresentBtn.addEventListener('click', () => togglePresent(false));

  exportBtn.addEventListener('click', exportPNG);

  // Resize
  window.addEventListener('resize', debounce(handleResize, 250));

  // Escape exits present mode
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!labelEditor.hidden) closeLabelEditor(false);
      else if (app.classList.contains('present')) togglePresent(false);
      else selectCountry(null);
    }
  });
}

function applyColorActive() {
  colorGrid.querySelectorAll('.color-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.color.toLowerCase() === state.currentColor.toLowerCase());
  });
}

// ---- Country interactions ----
function onCountryClick(event, d) {
  event.stopPropagation();
  const id = d.id;
  const existing = state.countries[id];

  if (existing && state.selectedId === id) {
    // second click on already selected — deselect (keeps marking)
    selectCountry(null);
    return;
  }

  if (!existing) {
    state.countries[id] = {
      name: d.properties.name,
      color: state.currentColor,
      label: '',
      ringEnabled: state.ringEnabled,
      labelOffset: { dx: 0, dy: -28 },
    };
    paintCountry(id, state.currentColor);
  }

  selectCountry(id);
  redrawOverlays();
  saveState();
}

function selectCountry(id) {
  state.selectedId = id;

  // visual selected stroke
  gCountries.selectAll('path').classed('selected', false);
  if (id) {
    gCountries.select(`path[data-id="${id}"]`).classed('selected', true);
  }

  if (!id) {
    selectedLabel.textContent = '— none —';
    labelInput.value = '';
    labelInput.disabled = true;
    return;
  }

  const c = state.countries[id];
  selectedLabel.textContent = c.name;
  labelInput.value = c.label || '';
  labelInput.disabled = false;
  // sync UI controls to this country
  state.currentColor = c.color;
  customColor.value = c.color;
  applyColorActive();
  ringToggle.checked = c.ringEnabled !== false;
}

function updateCountry(id, partial) {
  const c = state.countries[id];
  if (!c) return;
  Object.assign(c, partial);
  if (partial.color) paintCountry(id, partial.color);
  redrawOverlays();
  saveState();
}

function removeCountry(id) {
  delete state.countries[id];
  gCountries.select(`path[data-id="${id}"]`).style('fill', null).classed('selected', false);
  redrawOverlays();
  saveState();
}

function paintCountry(id, color) {
  gCountries.select(`path[data-id="${id}"]`).style('fill', color);
}

// ---- Overlays: rings + labels ----
function redrawOverlays() {
  gOverlays.selectAll('*').remove();
  Object.entries(state.countries).forEach(([id, info]) => {
    const feature = countryById.get(Number(id)) || countryById.get(id);
    if (!feature) return;
    const [cx, cy] = path.centroid(feature);
    if (Number.isNaN(cx) || Number.isNaN(cy)) return;

    const group = gOverlays.append('g').attr('class', 'overlay-group');

    // Ring pulse
    if (info.ringEnabled !== false) {
      group.append('circle')
        .attr('class', 'ring')
        .attr('cx', cx).attr('cy', cy).attr('r', 4)
        .attr('stroke', info.color);
      group.append('circle')
        .attr('class', 'ring')
        .attr('cx', cx).attr('cy', cy).attr('r', 4)
        .attr('stroke', info.color)
        .style('animation-delay', '0.9s');
      group.append('circle')
        .attr('class', 'ring-dot')
        .attr('cx', cx).attr('cy', cy).attr('r', 3)
        .attr('fill', info.color);
    }

    // Label
    if (info.label && info.label.trim()) {
      drawLabel(group, id, info, cx, cy);
    }
  });
}

function drawLabel(group, id, info, cx, cy) {
  const offset = info.labelOffset || { dx: 0, dy: -28 };
  const lx = cx + offset.dx;
  const ly = cy + offset.dy;
  const text = info.label;

  // Leader line
  group.append('line')
    .attr('class', 'leader-line')
    .attr('x1', cx).attr('y1', cy)
    .attr('x2', lx).attr('y2', ly);

  const labelG = group.append('g').attr('class', 'label-group');

  // Measure approximate width
  const padX = 10, padY = 6;
  const charW = 7.2;
  const approxW = Math.max(40, text.length * charW + padX * 2);
  const approxH = 22;

  labelG.append('rect')
    .attr('class', 'label-bg')
    .attr('x', lx - approxW / 2)
    .attr('y', ly - approxH / 2)
    .attr('width', approxW)
    .attr('height', approxH)
    .attr('rx', 6);

  labelG.append('text')
    .attr('class', 'label-text')
    .attr('x', lx)
    .attr('y', ly + 4)
    .attr('text-anchor', 'middle')
    .text(text);

  // Drag to move
  let dragStart = null;
  labelG.call(d3.drag()
    .on('start', (event) => {
      dragStart = { x: event.x, y: event.y, dx: offset.dx, dy: offset.dy };
    })
    .on('drag', (event) => {
      const newDx = dragStart.dx + (event.x - dragStart.x);
      const newDy = dragStart.dy + (event.y - dragStart.y);
      state.countries[id].labelOffset = { dx: newDx, dy: newDy };
      redrawOverlays();
    })
    .on('end', () => { saveState(); })
  );

  // Double click → edit inline
  labelG.on('dblclick', (event) => {
    event.stopPropagation();
    openLabelEditor(id, event);
  });
}

// ---- Inline label editor ----
function openLabelEditor(id, event) {
  const info = state.countries[id];
  labelEditor.style.left = event.clientX + 'px';
  labelEditor.style.top = event.clientY + 'px';
  labelEditor.hidden = false;
  labelEditorInput.value = info.label || '';
  labelEditorInput.focus();
  labelEditorInput.select();

  const finish = (commit) => closeLabelEditor(commit, id);

  function onKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { finish(false); }
  }
  function onBlur() { finish(true); }
  labelEditorInput.addEventListener('keydown', onKey);
  labelEditorInput.addEventListener('blur', onBlur);

  closeLabelEditor.cleanup = () => {
    labelEditorInput.removeEventListener('keydown', onKey);
    labelEditorInput.removeEventListener('blur', onBlur);
  };
}

function closeLabelEditor(commit, id) {
  if (commit && id && state.countries[id]) {
    state.countries[id].label = labelEditorInput.value;
    if (state.selectedId === id) labelInput.value = labelEditorInput.value;
    saveState();
    redrawOverlays();
  }
  if (closeLabelEditor.cleanup) closeLabelEditor.cleanup();
  labelEditor.hidden = true;
}

// ---- Presentation mode ----
function togglePresent(on) {
  app.classList.toggle('present', on);
  selectCountry(null);
}

// ---- Export PNG ----
function exportPNG() {
  selectCountry(null);
  // Snapshot current SVG
  const svgNode = svgEl.node();
  const clone = svgNode.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // Add background
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', '#0a0a0f');
  clone.insertBefore(bg, clone.firstChild);

  // Inline minimal styles needed
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `
    .country { fill: #2a2a36; stroke: #0a0a0f; stroke-width: 0.5; }
    .country.selected { stroke: rgba(255,255,255,0.4); }
    .ring { fill: none; opacity: 0.85; stroke-width: 1.5; }
    .ring-dot { }
    .label-bg { fill: rgba(20,20,28,0.92); stroke: rgba(255,255,255,0.18); }
    .label-text { fill: #f5f5f7; font-family: 'Space Grotesk', sans-serif; font-size: 13px; font-weight: 600; }
    .leader-line { stroke: rgba(255,255,255,0.4); stroke-width: 1; stroke-dasharray: 2 3; }
  `;
  clone.insertBefore(style, clone.firstChild);

  const xml = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `world-map-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  };
  img.src = url;
}

// ---- Resize ----
function handleResize() {
  const rect = document.querySelector('.map-area').getBoundingClientRect();
  width = rect.width;
  height = rect.height;
  svgEl.attr('viewBox', `0 0 ${width} ${height}`);
  projection.fitSize([width, height], { type: 'Sphere' });
  gCountries.selectAll('path').attr('d', path);
  redrawOverlays();
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function hideHintSoon() {
  setTimeout(() => hintEl && hintEl.classList.add('fade'), 3000);
  setTimeout(() => hintEl && hintEl.remove(), 4000);
}

// ---- Boot ----
hintEl.textContent = 'Loading map…';
init().then(() => {
  hintEl.textContent = 'Click a country to mark · Drag labels to move · Double-click label to edit';
});
