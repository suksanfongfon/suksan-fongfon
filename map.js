/* ============================================================
   World Map Presentation Tool  v3
   D3.js + TopoJSON
   ============================================================ */

const WORLD_URL   = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
const STORAGE_KEY = 'world-map-state-v3';
const THAILAND_ID = 764;   // ISO 3166-1 numeric

// ---- State ----
const state = {
  countries:    {},     // { [id:string]: { name, color, label, ringEnabled, labelOffset } }
  selectedId:   null,
  hubId:        THAILAND_ID,
  hubName:      'Thailand',
  currentColor: '#a855f7',
  ringEnabled:  true,
  showLines:    true,
  bgColor:      '#0a0a0f',
};

// ---- DOM refs ----
const svgEl         = d3.select('#map');
const app           = document.getElementById('app');
const selectedEl    = document.getElementById('selected-country');
const labelInput    = document.getElementById('label-input');
const colorGrid     = document.getElementById('color-grid');
const customColor   = document.getElementById('custom-color');
const ringToggle    = document.getElementById('ring-toggle');
const linesToggle   = document.getElementById('lines-toggle');
const hubEl         = document.getElementById('hub-country');
const setHubBtn     = document.getElementById('set-hub');
const clearSelBtn   = document.getElementById('clear-selected');
const clearAllBtn   = document.getElementById('clear-all');
const zoomInBtn     = document.getElementById('zoom-in');
const zoomOutBtn    = document.getElementById('zoom-out');
const zoomResetBtn  = document.getElementById('zoom-reset');
const presentBtn    = document.getElementById('present-toggle');
const exitPresentBtn= document.getElementById('exit-present');
const exportPngBtn  = document.getElementById('export-png');
const exportAniBtn  = document.getElementById('export-animation');
const bgBtns        = document.querySelectorAll('.bg-btn');
const bgColorInput  = document.getElementById('bg-color');
const hintEl        = document.getElementById('hint');
const labelEditor   = document.getElementById('label-editor');
const labelEditorInput = document.getElementById('label-editor-input');

// ---- Map internals ----
let width = 0, height = 0;
const projection = d3.geoNaturalEarth1();
const path       = d3.geoPath(projection);
let gRoot, gCountries, gOverlays;
let countriesData = [];
let countryById   = new Map();    // both string & number keys → feature
let injectedStyles= [];            // dynamic <style> tags for arc anims
let arcCounter    = 0;

const zoom = d3.zoom()
  .scaleExtent([0.5, 14])
  .on('zoom', (event) => {
    gRoot.attr('transform', event.transform);
    // keep stroke thin at high zoom
    gRoot.style('stroke-width', (0.5 / event.transform.k) + 'px');
  });

// ============================================================
//  INIT
// ============================================================
async function init() {
  loadState();
  syncUI();
  await renderMap();
  bindUI();
  setTimeout(() => hintEl?.classList.add('fade'),  3500);
  setTimeout(() => hintEl?.remove(),               4500);
}

function syncUI() {
  customColor.value  = state.currentColor;
  ringToggle.checked = state.ringEnabled;
  linesToggle.checked = state.showLines;
  hubEl.textContent  = state.hubName;
  updateBgUI(state.bgColor);
}

// ============================================================
//  PERSISTENCE
// ============================================================
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    Object.assign(state, JSON.parse(raw));
    state.selectedId = null;  // never restore selection
  } catch (_) {}
}

function saveState() {
  try {
    const { selectedId, ...save } = state;  // don't persist transient selection
    localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
  } catch (_) {}
}

// ============================================================
//  RENDER MAP
// ============================================================
async function renderMap() {
  const rect = document.querySelector('.map-area').getBoundingClientRect();
  width  = rect.width;
  height = rect.height;
  svgEl.attr('viewBox', `0 0 ${width} ${height}`);
  projection.fitSize([width, height], { type: 'Sphere' });

  // Background rect (stays fixed, outside gRoot so it ignores pan/zoom)
  svgEl.append('rect')
    .attr('class', 'map-bg-rect')
    .attr('width', '100%').attr('height', '100%')
    .attr('fill', state.bgColor === 'transparent' ? 'transparent' : state.bgColor);

  const world    = await d3.json(WORLD_URL);
  const features = topojson.feature(world, world.objects.countries).features
    .filter(f => f.id !== 10 && f.properties.name !== 'Antarctica');   // remove Antarctica

  countriesData = features;
  features.forEach(f => {
    // register by both number and string for easy lookup
    countryById.set(f.id,         f);
    countryById.set(Number(f.id), f);
    countryById.set(String(f.id), f);
  });

  gRoot      = svgEl.append('g').attr('class', 'g-root');
  gCountries = gRoot.append('g').attr('class', 'g-countries');
  gOverlays  = gRoot.append('g').attr('class', 'g-overlays');

  gCountries.selectAll('path')
    .data(features)
    .enter().append('path')
    .attr('class', 'country')
    .attr('d', path)
    .attr('data-id', d => d.id)
    .on('click', onCountryClick)
    .append('title').text(d => d.properties.name);

  svgEl.call(zoom);

  // Re-apply persisted country colors
  Object.entries(state.countries).forEach(([id, info]) => paintCountry(id, info.color));
  redrawOverlays();

  hintEl.textContent = 'Click country · Drag labels · Double-click label to edit';
}

// ============================================================
//  BIND UI
// ============================================================
function bindUI() {
  // Fill color swatches
  colorGrid.querySelectorAll('.color-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      state.currentColor = btn.dataset.color;
      customColor.value  = btn.dataset.color;
      applySwatchActive();
      if (state.selectedId) updateCountry(state.selectedId, { color: state.currentColor });
    });
  });

  customColor.addEventListener('input', e => {
    state.currentColor = e.target.value;
    applySwatchActive();
    if (state.selectedId) updateCountry(state.selectedId, { color: state.currentColor });
  });

  // Label
  labelInput.addEventListener('input', e => {
    if (state.selectedId) updateCountry(state.selectedId, { label: e.target.value });
  });

  // Ring toggle (applies to selected, or all if none selected)
  ringToggle.addEventListener('change', e => {
    state.ringEnabled = e.target.checked;
    if (state.selectedId) {
      updateCountry(state.selectedId, { ringEnabled: e.target.checked });
    } else {
      Object.values(state.countries).forEach(c => { c.ringEnabled = e.target.checked; });
      saveState(); redrawOverlays();
    }
  });

  // Lines toggle
  linesToggle.addEventListener('change', e => {
    state.showLines = e.target.checked;
    saveState(); redrawOverlays();
  });

  // Set hub
  setHubBtn.addEventListener('click', () => {
    if (!state.selectedId) return;
    const f = getFeature(state.selectedId);
    if (!f) return;
    state.hubId   = Number(f.id);
    state.hubName = f.properties.name;
    hubEl.textContent = state.hubName;
    saveState(); redrawOverlays();
  });

  // Clear
  clearSelBtn.addEventListener('click', () => {
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
    gCountries.selectAll('path').style('fill', null).classed('selected', false);
    redrawOverlays();
  });

  // Zoom
  zoomInBtn.addEventListener('click',    () => svgEl.transition().duration(300).call(zoom.scaleBy, 1.4));
  zoomOutBtn.addEventListener('click',   () => svgEl.transition().duration(300).call(zoom.scaleBy, 1/1.4));
  zoomResetBtn.addEventListener('click', () => svgEl.transition().duration(400).call(zoom.transform, d3.zoomIdentity));

  // Present
  presentBtn.addEventListener('click',     () => togglePresent(true));
  exitPresentBtn.addEventListener('click', () => togglePresent(false));

  // Export
  exportPngBtn.addEventListener('click', exportPNG);
  exportAniBtn.addEventListener('click', exportAnimation);

  // Background
  bgBtns.forEach(btn => btn.addEventListener('click', () => updateBg(btn.dataset.bg)));
  bgColorInput.addEventListener('input', e => updateBg(e.target.value));

  // Resize
  window.addEventListener('resize', debounce(handleResize, 250));

  // Keyboard
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!labelEditor.hidden)           closeLabelEditor(false);
      else if (app.classList.contains('present')) togglePresent(false);
      else                               selectCountry(null);
    }
  });
}

function applySwatchActive() {
  colorGrid.querySelectorAll('.color-swatch').forEach(s =>
    s.classList.toggle('active', s.dataset.color.toLowerCase() === state.currentColor.toLowerCase())
  );
}

function getFeature(id) {
  return countryById.get(Number(id)) || countryById.get(String(id)) || countryById.get(id);
}

// ============================================================
//  COUNTRY INTERACTIONS
// ============================================================
function onCountryClick(event, d) {
  event.stopPropagation();
  const id = String(d.id);

  // Second click on already-selected → deselect (keep marking)
  if (state.countries[id] && state.selectedId === id) {
    selectCountry(null);
    return;
  }

  if (!state.countries[id]) {
    state.countries[id] = {
      name: d.properties.name,
      color: state.currentColor,
      label: '',
      ringEnabled: state.ringEnabled,
      labelOffset: { dx: 0, dy: -30 },
    };
    paintCountry(id, state.currentColor);
  }

  selectCountry(id);
  redrawOverlays();
  saveState();
}

function selectCountry(id) {
  state.selectedId = id;
  gCountries.selectAll('path').classed('selected', false);
  if (id) gCountries.select(`path[data-id="${id}"]`).classed('selected', true);

  if (!id) {
    selectedEl.textContent = '— none —';
    labelInput.value = ''; labelInput.disabled = true;
    setHubBtn.disabled = true;
    return;
  }

  const c = state.countries[id];
  selectedEl.textContent  = c.name;
  labelInput.value        = c.label || '';
  labelInput.disabled     = false;
  setHubBtn.disabled      = false;
  state.currentColor      = c.color;
  customColor.value       = c.color;
  applySwatchActive();
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

// ============================================================
//  OVERLAYS — rings, arcs, labels
// ============================================================
function redrawOverlays() {
  // Remove previous arc CSS animations
  injectedStyles.forEach(s => s.remove());
  injectedStyles = [];
  gOverlays.selectAll('*').remove();

  // Hub centroid
  const hubFeature  = getFeature(state.hubId);
  let   hubCx = null, hubCy = null;
  if (hubFeature) {
    [hubCx, hubCy] = path.centroid(hubFeature);
    if (isNaN(hubCx) || isNaN(hubCy)) { hubCx = null; hubCy = null; }
  }

  // Draw arcs first so they render below rings/labels
  if (state.showLines && hubCx !== null) {
    Object.entries(state.countries).forEach(([id, info]) => {
      if (Number(id) === state.hubId) return;  // skip hub itself
      const f = getFeature(id);
      if (!f) return;
      const [cx, cy] = path.centroid(f);
      if (isNaN(cx) || isNaN(cy)) return;
      drawArcSVG(hubCx, hubCy, cx, cy, info.color);
    });
  }

  // Rings + labels
  Object.entries(state.countries).forEach(([id, info]) => {
    const f = getFeature(id);
    if (!f) return;
    const [cx, cy] = path.centroid(f);
    if (isNaN(cx) || isNaN(cy)) return;

    const grp = gOverlays.append('g').attr('class', 'overlay-group');

    if (info.ringEnabled !== false) {
      grp.append('circle').attr('class','ring').attr('cx',cx).attr('cy',cy).attr('r',4).attr('stroke',info.color);
      grp.append('circle').attr('class','ring').attr('cx',cx).attr('cy',cy).attr('r',4).attr('stroke',info.color)
         .style('animation-delay','0.9s');
      grp.append('circle').attr('class','ring-dot').attr('cx',cx).attr('cy',cy).attr('r',3).attr('fill',info.color);
    }

    if (info.label?.trim()) drawLabel(grp, id, info, cx, cy);
  });
}

// ============================================================
//  ARC LINES
// ============================================================
function arcCP(x1, y1, x2, y2) {
  // Quadratic bezier control point: lift midpoint upward
  const len  = Math.hypot(x2 - x1, y2 - y1);
  const lift = Math.min(len * 0.38, 140);
  return { cpx: (x1 + x2) / 2, cpy: (y1 + y2) / 2 - lift };
}

function arcPathD(x1, y1, x2, y2) {
  const { cpx, cpy } = arcCP(x1, y1, x2, y2);
  return `M ${x1} ${y1} Q ${cpx} ${cpy} ${x2} ${y2}`;
}

function drawArcSVG(x1, y1, x2, y2, color) {
  const d  = arcPathD(x1, y1, x2, y2);
  const id = `arc-${arcCounter++}`;

  // Faint trail
  gOverlays.append('path')
    .attr('class', 'arc-trail')
    .attr('d', d)
    .attr('stroke', color)
    .attr('fill', 'none')
    .attr('stroke-width', 1.5)
    .attr('stroke-opacity', 0.18);

  // Glowing beam
  const beam = gOverlays.append('path')
    .attr('class', 'arc-beam')
    .attr('id', id)
    .attr('d', d)
    .attr('stroke', color)
    .attr('fill', 'none')
    .attr('stroke-width', 2.5);

  const node = beam.node();
  const L    = node.getTotalLength();
  const seg  = Math.min(L * 0.28, 80);
  const dur  = (1.8 + Math.random() * 0.5).toFixed(2);

  const style = document.createElement('style');
  style.textContent = `
    #${id} {
      stroke-dasharray: ${seg} ${L};
      stroke-dashoffset: ${L + seg};
      filter: drop-shadow(0 0 5px ${color});
      animation: beamAnim_${id} ${dur}s linear infinite;
    }
    @keyframes beamAnim_${id} {
      0%   { stroke-dashoffset: ${L + seg}; }
      100% { stroke-dashoffset: ${-seg}; }
    }
  `;
  document.head.appendChild(style);
  injectedStyles.push(style);
}

// ============================================================
//  LABELS
// ============================================================
function drawLabel(parent, id, info, cx, cy) {
  const off = info.labelOffset || { dx: 0, dy: -30 };
  const lx = cx + off.dx;
  const ly = cy + off.dy;

  parent.append('line').attr('class','leader-line')
    .attr('x1',cx).attr('y1',cy).attr('x2',lx).attr('y2',ly);

  const lg = parent.append('g').attr('class','label-group');
  const pad = 10, ph = 11;
  const w   = Math.max(40, info.label.length * 7.5 + pad * 2);
  const h   = ph * 2;

  lg.append('rect').attr('class','label-bg')
    .attr('x', lx-w/2).attr('y', ly-ph).attr('width',w).attr('height',h).attr('rx',6);
  lg.append('text').attr('class','label-text')
    .attr('x',lx).attr('y',ly+4).attr('text-anchor','middle').text(info.label);

  // Drag to reposition
  let ds = null;
  lg.call(d3.drag()
    .on('start', e => { ds = { x: e.x, y: e.y, dx: off.dx, dy: off.dy }; })
    .on('drag',  e => {
      state.countries[id].labelOffset = { dx: ds.dx+(e.x-ds.x), dy: ds.dy+(e.y-ds.y) };
      redrawOverlays();
    })
    .on('end', () => saveState())
  );

  // Double-click → inline edit
  lg.on('dblclick', (event) => { event.stopPropagation(); openLabelEditor(id, event); });
}

// ============================================================
//  INLINE LABEL EDITOR
// ============================================================
let _cleanup = null;

function openLabelEditor(id, event) {
  labelEditor.style.left = event.clientX + 'px';
  labelEditor.style.top  = event.clientY + 'px';
  labelEditor.hidden = false;
  labelEditorInput.value = state.countries[id]?.label || '';
  labelEditorInput.focus(); labelEditorInput.select();

  const done = (commit) => closeLabelEditor(commit, id);
  const onKey  = e => { if (e.key==='Enter'){e.preventDefault();done(true);} if(e.key==='Escape')done(false); };
  const onBlur = () => done(true);
  labelEditorInput.addEventListener('keydown', onKey);
  labelEditorInput.addEventListener('blur',    onBlur);
  _cleanup = () => { labelEditorInput.removeEventListener('keydown',onKey); labelEditorInput.removeEventListener('blur',onBlur); };
}

function closeLabelEditor(commit, id) {
  _cleanup?.(); _cleanup = null;
  if (commit && id && state.countries[id]) {
    state.countries[id].label = labelEditorInput.value;
    if (state.selectedId === id) labelInput.value = labelEditorInput.value;
    saveState(); redrawOverlays();
  }
  labelEditor.hidden = true;
}

// ============================================================
//  BACKGROUND
// ============================================================
function updateBg(color) {
  state.bgColor = color;
  const fill = color === 'transparent' ? 'transparent' : color;
  d3.select('.map-bg-rect').attr('fill', fill);
  // also hide/show the ambient CSS blobs
  const ambient = document.querySelector('.ambient-bg');
  ambient.style.display = color === 'transparent' ? 'none' : '';
  updateBgUI(color);
  saveState();
}

function updateBgUI(color) {
  bgBtns.forEach(b => b.classList.toggle('active', b.dataset.bg === color));
  if (color !== 'transparent') bgColorInput.value = color;
}

// ============================================================
//  PRESENT MODE
// ============================================================
function togglePresent(on) {
  app.classList.toggle('present', on);
  if (on) selectCountry(null);
}

// ============================================================
//  EXPORT — PNG (static)
// ============================================================
function exportPNG() {
  selectCountry(null);
  const node  = svgEl.node().cloneNode(true);
  node.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  // Inline minimal styles
  const style = document.createElementNS('http://www.w3.org/2000/svg','style');
  style.textContent = `
    .country{stroke:#0a0a0f;stroke-width:0.5;}
    .ring{fill:none;opacity:0.9;stroke-width:1.5;}
    .label-bg{fill:rgba(20,20,28,.92);stroke:rgba(255,255,255,.18);}
    .label-text{fill:#f5f5f7;font-family:sans-serif;font-size:13px;font-weight:600;}
    .leader-line{stroke:rgba(255,255,255,.4);stroke-width:1;stroke-dasharray:2 3;}
    .arc-beam{stroke-dashoffset:0;}
  `;
  node.insertBefore(style, node.firstChild);

  const xml  = new XMLSerializer().serializeToString(node);
  const blob = new Blob([xml], { type:'image/svg+xml;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const img  = new Image();
  img.onload = () => {
    const sc = 2;
    const cv = document.createElement('canvas');
    cv.width = width*sc; cv.height = height*sc;
    const ctx = cv.getContext('2d');
    if (state.bgColor !== 'transparent') { ctx.fillStyle = state.bgColor; ctx.fillRect(0,0,cv.width,cv.height); }
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    URL.revokeObjectURL(url);
    cv.toBlob(b => { const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=`world-map-${Date.now()}.png`; a.click(); }, 'image/png');
  };
  img.src = url;
}

// ============================================================
//  EXPORT — ANIMATION (WebM via MediaRecorder + Canvas)
// ============================================================
async function exportAnimation() {
  if (exportAniBtn.dataset.recording === 'true') return;
  await document.fonts.ready;

  const RECORD_MS = 4000;
  const FPS = 30;
  const sc  = 2;

  const cv = document.createElement('canvas');
  cv.width = width * sc; cv.height = height * sc;
  const ctx = cv.getContext('2d');

  const stream = cv.captureStream(FPS);
  const mime   = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm']
    .find(m => MediaRecorder.isTypeSupported(m));
  if (!mime) { alert('Your browser does not support WebM recording.'); return; }

  const recorder = new MediaRecorder(stream, { mimeType: mime });
  const chunks   = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mime });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `world-map-animation-${Date.now()}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    exportAniBtn.textContent       = 'Export Animation (.webm)';
    exportAniBtn.dataset.recording = 'false';
  };

  exportAniBtn.dataset.recording = 'true';
  let countdown = RECORD_MS / 1000;
  exportAniBtn.textContent = `Recording… ${countdown}s`;
  const tick = setInterval(() => { countdown--; if (countdown > 0) exportAniBtn.textContent = `Recording… ${countdown}s`; }, 1000);

  recorder.start(100);
  const t0 = performance.now();

  function frame() {
    const elapsed = performance.now() - t0;
    if (elapsed >= RECORD_MS) { clearInterval(tick); recorder.stop(); return; }
    canvasFrame(ctx, elapsed, sc);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ---- Canvas frame renderer ----
function canvasFrame(ctx, ms, sc) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  if (state.bgColor && state.bgColor !== 'transparent') {
    ctx.fillStyle = state.bgColor;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  ctx.save();
  ctx.scale(sc, sc);

  const tr = d3.zoomTransform(svgEl.node());
  ctx.translate(tr.x, tr.y);
  ctx.scale(tr.k, tr.k);

  // Countries
  const gp = d3.geoPath(projection, ctx);
  countriesData.forEach(f => {
    ctx.beginPath(); gp(f);
    const info = state.countries[String(f.id)];
    ctx.fillStyle   = info ? info.color : '#2a2a36';
    ctx.fill();
    ctx.strokeStyle = '#0a0a0f';
    ctx.lineWidth   = 0.5 / tr.k;
    ctx.stroke();
  });

  // Hub centroid
  const hubF  = getFeature(state.hubId);
  let hx = null, hy = null;
  if (hubF) { [hx, hy] = path.centroid(hubF); if (isNaN(hx)) { hx=null; hy=null; } }

  // Arcs
  if (state.showLines && hx !== null) {
    Object.entries(state.countries).forEach(([id, info], idx) => {
      if (Number(id) === state.hubId) return;
      const f = getFeature(id);
      if (!f) return;
      const [cx, cy] = path.centroid(f);
      if (isNaN(cx)||isNaN(cy)) return;
      canvasArc(ctx, hx, hy, cx, cy, info.color, ms, idx);
    });
  }

  // Rings
  Object.entries(state.countries).forEach(([id, info]) => {
    if (info.ringEnabled === false) return;
    const f = getFeature(id);
    if (!f) return;
    const [cx, cy] = path.centroid(f);
    if (isNaN(cx)||isNaN(cy)) return;

    [0, 0.5].forEach(delay => {
      const phase = ((ms / 1800) + delay) % 1;
      const r     = 4 + phase * 22;
      const op    = (1 - phase) * 0.9;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2);
      ctx.strokeStyle = hexRgba(info.color, op);
      ctx.lineWidth   = (2 - phase*1.5) / tr.k;
      ctx.stroke();
    });

    ctx.beginPath(); ctx.arc(cx, cy, 3/tr.k, 0, Math.PI*2);
    ctx.fillStyle = info.color; ctx.fill();
  });

  // Labels
  Object.entries(state.countries).forEach(([id, info]) => {
    if (!info.label?.trim()) return;
    const f = getFeature(id);
    if (!f) return;
    const [cx, cy] = path.centroid(f);
    if (isNaN(cx)||isNaN(cy)) return;
    const off = info.labelOffset || { dx:0, dy:-30 };
    const lx = cx+off.dx, ly = cy+off.dy;

    // Leader line
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(lx,ly);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth   = 1/tr.k;
    ctx.setLineDash([2/tr.k, 3/tr.k]); ctx.stroke(); ctx.setLineDash([]);

    // Bg
    ctx.font = `600 13px "Space Grotesk","Inter",sans-serif`;
    const tw=ctx.measureText(info.label).width, px=10, py=11;
    ctx.fillStyle='rgba(20,20,28,0.92)'; ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.lineWidth=1/tr.k;
    rrect(ctx, lx-tw/2-px, ly-py, tw+px*2, py*2, 6/tr.k); ctx.fill(); ctx.stroke();

    ctx.fillStyle='#f5f5f7'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(info.label, lx, ly);
  });

  ctx.restore();
}

function canvasArc(ctx, x1, y1, x2, y2, color, ms, idx) {
  const { cpx, cpy } = arcCP(x1, y1, x2, y2);

  // Trail
  ctx.beginPath(); ctx.moveTo(x1,y1); ctx.quadraticCurveTo(cpx,cpy,x2,y2);
  ctx.strokeStyle = hexRgba(color, 0.18); ctx.lineWidth=1.5; ctx.setLineDash([]); ctx.stroke();

  // Beam
  const DUR  = 1800;
  const off  = (idx * 600) % DUR;
  const phase= ((ms + off) % DUR) / DUR;
  const seg  = 0.25;
  const t0   = phase, t1 = phase + seg;

  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 2.5;
  ctx.shadowColor = color; ctx.shadowBlur = 10;

  const N = 28;
  function drawSegment(a, b) {
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const tt = a + (b - a) * (i / N);
      const { px: bx, py: by } = qbez(x1,y1,cpx,cpy,x2,y2, Math.min(Math.max(tt,0),1));
      i === 0 ? ctx.moveTo(bx,by) : ctx.lineTo(bx,by);
    }
    ctx.stroke();
  }

  drawSegment(t0, Math.min(t1, 1));
  if (t1 > 1) drawSegment(0, t1 - 1);   // wrap-around

  ctx.restore();
}

// ============================================================
//  UTILITIES
// ============================================================
function qbez(x1,y1,cpx,cpy,x2,y2,t) {
  return {
    px: (1-t)**2*x1 + 2*(1-t)*t*cpx + t**2*x2,
    py: (1-t)**2*y1 + 2*(1-t)*t*cpy + t**2*y2,
  };
}

function hexRgba(hex, alpha) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y); ctx.arcTo(x+w,y,x+w,y+r,r);
  ctx.lineTo(x+w, y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
  ctx.lineTo(x+r, y+h); ctx.arcTo(x,y+h,x,y+h-r,r);
  ctx.lineTo(x, y+r); ctx.arcTo(x,y,x+r,y,r);
  ctx.closePath();
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(()=>fn(...args),ms); };
}

function handleResize() {
  const rect = document.querySelector('.map-area').getBoundingClientRect();
  width=rect.width; height=rect.height;
  svgEl.attr('viewBox',`0 0 ${width} ${height}`);
  projection.fitSize([width,height],{type:'Sphere'});
  gCountries.selectAll('path').attr('d',path);
  redrawOverlays();
}

// ---- Boot ----
hintEl.textContent = 'Loading map…';
init();
