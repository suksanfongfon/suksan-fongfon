/* ============================================================
   World Map Presentation Tool  v4
   D3.js + TopoJSON + gifenc
   ============================================================ */

const WORLD_URL   = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
const STORAGE_KEY = 'world-map-v4';
const THAILAND_ID = 764;

// Short name overrides for display
const SHORT_NAME = {
  'United States of America':       'United States',
  'Russian Federation':             'Russia',
  'Democratic Republic of the Congo':'DR Congo',
  'Central African Republic':       'C. African Rep.',
  'Bosnia and Herzegovina':         'Bosnia',
  'Dominican Republic':             'Dominican Rep.',
  'Papua New Guinea':               'Papua NG',
  'Czech Republic':                 'Czechia',
  'Trinidad and Tobago':            'Trinidad',
  'Equatorial Guinea':              'Eq. Guinea',
  'Solomon Islands':                'Solomon Is.',
};

const EXPORT_PRESETS = {
  slides: { w:1280, h:720  },
  hd:     { w:1920, h:1080 },
  '4k':   { w:3840, h:2160 },
  square: { w:1080, h:1080 },
};

// ---- State ----
const state = {
  countries:       {},
  selectedId:      null,
  hubId:           THAILAND_ID,
  hubName:         'Thailand',
  currentColor:    '#a855f7',
  countryColor:    '#2a2a36',   // base fill for unmarked countries
  ringEnabled:     true,
  ringColorMode:   'lighter',
  arcColorMode:    'lighter',   // 'lighter' | 'match' | 'darker'
  showLines:       true,
  arcSpeed:        1,
  showCountryNames:true,
  bgColor:         '#0a0a0f',
  exportPreset:    'slides',
  exportW:         1280,
  exportH:         720,
};

// ---- DOM ----
const $  = id => document.getElementById(id);
const svgEl         = d3.select('#map');
const app           = $('app');
const selectedEl    = $('selected-country');
const labelInput    = $('label-input');
const colorGrid     = $('color-grid');
const customColor   = $('custom-color');
const ringToggle    = $('ring-toggle');
const linesToggle   = $('lines-toggle');
const hubEl         = $('hub-country');
const setHubBtn     = $('set-hub');
const arcSpeedEl    = $('arc-speed');
const arcSpeedVal   = $('arc-speed-val');
const clearSelBtn   = $('clear-selected');
const clearAllBtn   = $('clear-all');
const namesToggle   = $('names-toggle');
const bgBtns        = document.querySelectorAll('.bg-btn');
const bgColorInput  = $('bg-color');
const hintEl        = $('hint');
const labelEditor   = $('label-editor');
const labelEditorInput = $('label-editor-input');
const searchInput   = $('country-search');
const searchResults = $('search-results');

// ---- Map internals ----
let width = 0, height = 0;
const projection = d3.geoNaturalEarth1();
const geoPath    = d3.geoPath(projection);
let gRoot, gCountries, gNames, gOverlays;
let countriesData  = [];
let countryByNum   = new Map();   // number → feature
let countryByStr   = new Map();   // string → feature
let injectedStyles = [];
let arcCounter     = 0;

const zoom = d3.zoom()
  .scaleExtent([0.5, 15])
  .on('zoom', ev => {
    gRoot.attr('transform', ev.transform);
    gRoot.style('stroke-width', (0.5 / ev.transform.k) + 'px');
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
  customColor.value      = state.currentColor;
  ringToggle.checked     = state.ringEnabled;
  linesToggle.checked    = state.showLines;
  namesToggle.checked    = state.showCountryNames;
  arcSpeedEl.value       = state.arcSpeed;
  arcSpeedVal.textContent= `${state.arcSpeed.toFixed(1)}×`;
  hubEl.textContent      = state.hubName;
  updateBgUI(state.bgColor);
  updateRingModeUI(state.ringColorMode);
  updateArcModeUI(state.arcColorMode);
  updateCountryColorUI(state.countryColor);
  updateExportUI();
  applySwatchActive();
}

// ============================================================
//  PERSISTENCE
// ============================================================
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    Object.assign(state, JSON.parse(raw));
    state.selectedId = null;
  } catch (_) {}
}
function saveState() {
  try {
    const { selectedId, ...s } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
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

  // Fixed background rect (outside panning group)
  svgEl.append('rect')
    .attr('class', 'map-bg-rect')
    .attr('width', '100%').attr('height', '100%')
    .attr('fill', state.bgColor === 'transparent' ? 'transparent' : state.bgColor);

  const world    = await d3.json(WORLD_URL);
  const features = topojson.feature(world, world.objects.countries).features
    .filter(f => f.id !== 10 && f.properties.name !== 'Antarctica');

  countriesData = features;
  features.forEach(f => {
    countryByNum.set(Number(f.id), f);
    countryByStr.set(String(f.id), f);
  });

  gRoot      = svgEl.append('g').attr('class', 'g-root');
  gCountries = gRoot.append('g').attr('class', 'g-countries');
  gNames     = gRoot.append('g').attr('class', 'g-names');
  gOverlays  = gRoot.append('g').attr('class', 'g-overlays');

  // Country paths
  gCountries.selectAll('path')
    .data(features)
    .enter().append('path')
    .attr('class', 'country')
    .attr('d', geoPath)
    .attr('data-id', d => d.id)
    .style('fill', d => state.countries[String(d.id)]?.color || state.countryColor)
    .on('click', onCountryClick)
    .append('title').text(d => d.properties.name);

  // Country name labels
  buildCountryNames();

  svgEl.call(zoom);
  redrawOverlays();

  hintEl.textContent = 'Click country · Search · Drag labels · Double-click label to edit';
}

function buildCountryNames() {
  gNames.selectAll('*').remove();
  if (!state.showCountryNames) return;

  countriesData.forEach(f => {
    if (geoPath.area(f) < 800) return;   // skip tiny
    const [cx, cy] = geoPath.centroid(f);
    if (isNaN(cx) || isNaN(cy)) return;

    const name = SHORT_NAME[f.properties.name] || f.properties.name;
    gNames.append('text')
      .attr('class', 'country-name')
      .attr('x', cx).attr('y', cy)
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .text(name);
  });
}

// ============================================================
//  BIND UI
// ============================================================
function bindUI() {
  // Search
  searchInput.addEventListener('input', debounce(doSearch, 140));
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') { searchResults.hidden = true; searchInput.value = ''; }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap') && !e.target.closest('.search-results'))
      searchResults.hidden = true;
  });

  // Color swatches
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

  // Ring toggles
  ringToggle.addEventListener('change', e => {
    state.ringEnabled = e.target.checked;
    if (state.selectedId) updateCountry(state.selectedId, { ringEnabled: e.target.checked });
    else { Object.values(state.countries).forEach(c => { c.ringEnabled = e.target.checked; }); saveState(); redrawOverlays(); }
  });

  document.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.ringColorMode = btn.dataset.mode;
      updateRingModeUI(state.ringColorMode);
      saveState(); redrawOverlays();
    });
  });

  // Lines + speed + arc color mode
  linesToggle.addEventListener('change', e => { state.showLines = e.target.checked; saveState(); redrawOverlays(); });
  arcSpeedEl.addEventListener('input', e => {
    state.arcSpeed = parseFloat(e.target.value);
    arcSpeedVal.textContent = `${state.arcSpeed.toFixed(1)}×`;
    saveState(); redrawOverlays();
  });
  document.querySelectorAll('.arc-seg').forEach(btn => {
    btn.addEventListener('click', () => {
      state.arcColorMode = btn.dataset.amode;
      updateArcModeUI(state.arcColorMode);
      saveState(); redrawOverlays();
    });
  });

  // Country base color
  document.querySelectorAll('.cc-btn').forEach(btn => {
    btn.addEventListener('click', () => updateCountryColor(btn.dataset.cc));
  });
  const ccInput = document.getElementById('country-color');
  if (ccInput) ccInput.addEventListener('input', e => updateCountryColor(e.target.value));

  // Export size presets
  document.querySelectorAll('.size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.exportPreset = btn.dataset.preset;
      if (btn.dataset.preset !== 'custom') {
        const p = EXPORT_PRESETS[btn.dataset.preset];
        state.exportW = p.w; state.exportH = p.h;
      }
      updateExportUI(); saveState();
    });
  });
  const expW = document.getElementById('exp-w');
  const expH = document.getElementById('exp-h');
  if (expW) expW.addEventListener('input', e => { state.exportW = parseInt(e.target.value)||1280; updateExportUI(); saveState(); });
  if (expH) expH.addEventListener('input', e => { state.exportH = parseInt(e.target.value)||720;  updateExportUI(); saveState(); });

  // Hub
  setHubBtn.addEventListener('click', () => {
    if (!state.selectedId) return;
    const f = getF(state.selectedId);
    if (!f) return;
    state.hubId   = Number(f.id);
    state.hubName = f.properties.name;
    hubEl.textContent = state.hubName;
    saveState(); redrawOverlays();
  });

  // Country names
  namesToggle.addEventListener('change', e => {
    state.showCountryNames = e.target.checked;
    buildCountryNames();
    saveState();
  });

  // Background
  bgBtns.forEach(b => b.addEventListener('click', () => updateBg(b.dataset.bg)));
  bgColorInput.addEventListener('input', e => updateBg(e.target.value));

  // Clear
  clearSelBtn.addEventListener('click', () => { if (!state.selectedId) return; removeCountry(state.selectedId); selectCountry(null); });
  clearAllBtn.addEventListener('click', () => {
    if (!Object.keys(state.countries).length) return;
    if (!confirm('Clear all marked countries?')) return;
    state.countries = {};
    selectCountry(null); saveState();
    gCountries.selectAll('path').style('fill', null).classed('selected', false);
    redrawOverlays();
  });

  // Zoom
  $('zoom-in').addEventListener('click',    () => svgEl.transition().duration(280).call(zoom.scaleBy, 1.4));
  $('zoom-out').addEventListener('click',   () => svgEl.transition().duration(280).call(zoom.scaleBy, 1/1.4));
  $('zoom-reset').addEventListener('click', () => svgEl.transition().duration(380).call(zoom.transform, d3.zoomIdentity));

  // Present
  $('present-toggle').addEventListener('click', () => togglePresent(true));
  $('exit-present').addEventListener('click',   () => togglePresent(false));

  // Export
  $('export-png').addEventListener('click',       exportPNG);
  $('export-animation').addEventListener('click', exportWebM);
  $('export-gif').addEventListener('click',       exportGIF);

  // Resize
  window.addEventListener('resize', debounce(handleResize, 220));

  // Keyboard
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!labelEditor.hidden) closeLabelEditor(false);
      else if (app.classList.contains('present')) togglePresent(false);
      else selectCountry(null);
    }
  });
}

function applySwatchActive() {
  colorGrid.querySelectorAll('.color-swatch').forEach(s =>
    s.classList.toggle('active', s.dataset.color.toLowerCase() === state.currentColor.toLowerCase())
  );
}

function updateRingModeUI(mode) {
  document.querySelectorAll('.seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode)
  );
}

// ============================================================
//  SEARCH
// ============================================================
function doSearch() {
  const q = searchInput.value.trim().toLowerCase();
  searchResults.innerHTML = '';
  if (!q || q.length < 1 || countriesData.length === 0) { searchResults.hidden = true; return; }

  const matches = countriesData
    .filter(f => f.properties.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const ai = a.properties.name.toLowerCase().indexOf(q);
      const bi = b.properties.name.toLowerCase().indexOf(q);
      return ai - bi;
    })
    .slice(0, 9);

  if (!matches.length) { searchResults.hidden = true; return; }

  matches.forEach(f => {
    const id   = String(f.id);
    const info = state.countries[id];
    const btn  = document.createElement('button');
    btn.className = 'search-result-btn';

    // colored dot if already marked
    const dot = document.createElement('span');
    dot.className = 'dot-mark';
    dot.style.background = info ? info.color : 'transparent';
    dot.style.border = info ? 'none' : '1px solid #555';
    btn.appendChild(dot);

    const nameSpan = document.createElement('span');
    nameSpan.textContent = f.properties.name;
    btn.appendChild(nameSpan);

    btn.addEventListener('click', () => {
      zoomToFeature(f);
      // mark if not already
      if (!state.countries[id]) {
        state.countries[id] = {
          name: f.properties.name, color: state.currentColor,
          label: '', ringEnabled: state.ringEnabled,
          labelOffset: { dx: 0, dy: -30 },
        };
        paintCountry(id, state.currentColor);
        redrawOverlays(); saveState();
      }
      selectCountry(id);
      searchInput.value = '';
      searchResults.hidden = true;
    });
    searchResults.appendChild(btn);
  });

  searchResults.hidden = false;
}

function zoomToFeature(f) {
  const bounds = geoPath.bounds(f);
  const [[x0,y0],[x1,y1]] = bounds;
  const dx = x1-x0, dy = y1-y0;
  const cx = (x0+x1)/2, cy = (y0+y1)/2;
  const scale = Math.max(1, Math.min(10, 0.85 / Math.max(dx/width, dy/height)));
  svgEl.transition().duration(700).call(
    zoom.transform,
    d3.zoomIdentity.translate(width/2, height/2).scale(scale).translate(-cx, -cy)
  );
}

// ============================================================
//  COUNTRY INTERACTIONS
// ============================================================
function getF(id) {
  return countryByNum.get(Number(id)) || countryByStr.get(String(id));
}

function onCountryClick(event, d) {
  event.stopPropagation();
  const id = String(d.id);
  if (state.countries[id] && state.selectedId === id) { selectCountry(null); return; }
  if (!state.countries[id]) {
    state.countries[id] = {
      name: d.properties.name, color: state.currentColor,
      label: '', ringEnabled: state.ringEnabled,
      labelOffset: { dx: 0, dy: -30 },
    };
    paintCountry(id, state.currentColor);
  }
  selectCountry(id);
  redrawOverlays(); saveState();
}

function selectCountry(id) {
  state.selectedId = id;
  gCountries.selectAll('path').classed('selected', false);
  if (id) gCountries.select(`path[data-id="${id}"]`).classed('selected', true);
  if (!id) {
    selectedEl.textContent = '— none —';
    labelInput.value = ''; labelInput.disabled = true;
    setHubBtn.disabled = true; return;
  }
  const c = state.countries[id];
  selectedEl.textContent = c.name;
  labelInput.value        = c.label || '';
  labelInput.disabled     = false;
  setHubBtn.disabled      = false;
  state.currentColor      = c.color;
  customColor.value       = c.color;
  applySwatchActive();
  ringToggle.checked = c.ringEnabled !== false;
}

function updateCountry(id, partial) {
  if (!state.countries[id]) return;
  Object.assign(state.countries[id], partial);
  if (partial.color) paintCountry(id, partial.color);
  redrawOverlays(); saveState();
}

function removeCountry(id) {
  delete state.countries[id];
  gCountries.select(`path[data-id="${id}"]`).style('fill', null).classed('selected', false);
  redrawOverlays(); saveState();
}

function paintCountry(id, color) {
  gCountries.select(`path[data-id="${id}"]`).style('fill', color);
}

// ============================================================
//  OVERLAYS
// ============================================================
function redrawOverlays() {
  injectedStyles.forEach(s => s.remove());
  injectedStyles = [];
  gOverlays.selectAll('*').remove();

  const hubF = getF(state.hubId);
  let hx = null, hy = null;
  if (hubF) {
    [hx, hy] = geoPath.centroid(hubF);
    if (isNaN(hx)) { hx = null; hy = null; }
  }

  // Draw arcs first (below rings/labels)
  if (state.showLines && hx !== null) {
    Object.entries(state.countries).forEach(([id, info]) => {
      if (Number(id) === state.hubId) return;
      const f = getF(id);
      if (!f) return;
      const [cx, cy] = geoPath.centroid(f);
      if (isNaN(cx) || isNaN(cy)) return;
      drawArcSVG(hx, hy, cx, cy, info.color);
    });
  }

  // Rings & labels
  Object.entries(state.countries).forEach(([id, info]) => {
    const f = getF(id);
    if (!f) return;
    const [cx, cy] = geoPath.centroid(f);
    if (isNaN(cx) || isNaN(cy)) return;

    const grp = gOverlays.append('g').attr('class', 'overlay-group');
    const rc  = ringColor(info.color);

    if (info.ringEnabled !== false) {
      grp.append('circle').attr('class','ring').attr('cx',cx).attr('cy',cy).attr('r',4).attr('stroke',rc);
      grp.append('circle').attr('class','ring').attr('cx',cx).attr('cy',cy).attr('r',4).attr('stroke',rc).style('animation-delay','0.9s');
      grp.append('circle').attr('class','ring-dot').attr('cx',cx).attr('cy',cy).attr('r',3).attr('fill',rc);
    }

    if (info.label?.trim()) drawLabel(grp, id, info, cx, cy);
  });
}

// ============================================================
//  RING COLOR
// ============================================================
function ringColor(hex) {
  if (state.ringColorMode === 'match') return hex;
  const [h, s, l] = hexToHsl(hex);
  if (state.ringColorMode === 'lighter') return hslToHex(h, Math.max(0, s-15), Math.min(92, l+35));
  return hslToHex(h, Math.min(100, s+10), Math.max(8, l-28)); // darker
}

function hexToHsl(hex) {
  let r=parseInt(hex.slice(1,3),16)/255, g=parseInt(hex.slice(3,5),16)/255, b=parseInt(hex.slice(5,7),16)/255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b); let h=0,s=0,l=(max+min)/2;
  if (max!==min) {
    const d=max-min; s=l>0.5?d/(2-max-min):d/(max+min);
    switch(max) {
      case r: h=((g-b)/d+(g<b?6:0))/6; break;
      case g: h=((b-r)/d+2)/6; break;
      case b: h=((r-g)/d+4)/6; break;
    }
  }
  return [h*360, s*100, l*100];
}

function hslToHex(h,s,l) {
  h/=360; s/=100; l/=100;
  const q=l<0.5?l*(1+s):l+s-l*s, p=2*l-q;
  const hue2rgb=(p,q,t)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};
  const r=hue2rgb(p,q,h+1/3), g=hue2rgb(p,q,h), b=hue2rgb(p,q,h-1/3);
  return '#'+[r,g,b].map(x=>Math.round(x*255).toString(16).padStart(2,'0')).join('');
}

function arcLineColor(fillColor) {
  if (state.arcColorMode === 'match') return fillColor;
  const [h, s, l] = hexToHsl(fillColor);
  if (state.arcColorMode === 'lighter') return hslToHex(h, Math.max(0, s-15), Math.min(92, l+35));
  return hslToHex(h, Math.min(100, s+10), Math.max(8, l-28));
}

// ============================================================
//  ARC LINES
// ============================================================
function arcCP(x1,y1,x2,y2) {
  const len=Math.hypot(x2-x1,y2-y1), lift=Math.min(len*0.38,140);
  return { cpx:(x1+x2)/2, cpy:(y1+y2)/2-lift };
}

function drawArcSVG(x1,y1,x2,y2,color) {
  const ac = arcLineColor(color);
  const {cpx,cpy} = arcCP(x1,y1,x2,y2);
  const d  = `M ${x1} ${y1} Q ${cpx} ${cpy} ${x2} ${y2}`;
  const id = `arc${arcCounter++}`;

  gOverlays.append('path').attr('class','arc-trail')
    .attr('d',d).attr('stroke',ac).attr('fill','none')
    .attr('stroke-width',1.5).attr('stroke-opacity',0.22);

  const beam = gOverlays.append('path').attr('class','arc-beam')
    .attr('id',id).attr('d',d).attr('stroke',ac).attr('fill','none')
    .attr('stroke-width',2.5);

  const L   = beam.node().getTotalLength();
  const seg = Math.min(L*0.28, 80);
  const dur = (1.8/state.arcSpeed + Math.random()*0.25/state.arcSpeed).toFixed(2);

  const style = document.createElement('style');
  style.textContent=`
    #${id}{stroke-dasharray:${seg} ${L};stroke-dashoffset:${L+seg};
           filter:drop-shadow(0 0 5px ${ac});
           animation:bm_${id} ${dur}s linear infinite;}
    @keyframes bm_${id}{0%{stroke-dashoffset:${L+seg};}100%{stroke-dashoffset:${-seg};}}
  `;
  document.head.appendChild(style);
  injectedStyles.push(style);
}

// ============================================================
//  LABELS
// ============================================================
function drawLabel(parent, id, info, cx, cy) {
  const off = info.labelOffset||{dx:0,dy:-30};
  const lx=cx+off.dx, ly=cy+off.dy;

  parent.append('line').attr('class','leader-line')
    .attr('x1',cx).attr('y1',cy).attr('x2',lx).attr('y2',ly);

  const lg = parent.append('g').attr('class','label-group');
  const px=10, py=10, tw=Math.max(36, info.label.length*7.4+px*2), th=py*2;

  lg.append('rect').attr('class','label-bg')
    .attr('x',lx-tw/2).attr('y',ly-py).attr('width',tw).attr('height',th).attr('rx',5);
  lg.append('text').attr('class','label-text')
    .attr('x',lx).attr('y',ly+4).attr('text-anchor','middle').text(info.label);

  let ds=null;
  lg.call(d3.drag()
    .on('start',e=>{ds={x:e.x,y:e.y,dx:off.dx,dy:off.dy};})
    .on('drag', e=>{state.countries[id].labelOffset={dx:ds.dx+(e.x-ds.x),dy:ds.dy+(e.y-ds.y)};redrawOverlays();})
    .on('end',  ()=>saveState())
  );
  lg.on('dblclick',(event)=>{event.stopPropagation();openLabelEditor(id,event);});
}

// ============================================================
//  INLINE EDITOR
// ============================================================
let _edClean=null;
function openLabelEditor(id,event) {
  labelEditor.style.left=event.clientX+'px'; labelEditor.style.top=event.clientY+'px';
  labelEditor.hidden=false;
  labelEditorInput.value=state.countries[id]?.label||'';
  labelEditorInput.focus(); labelEditorInput.select();
  const done=c=>closeLabelEditor(c,id);
  const onKey=e=>{if(e.key==='Enter'){e.preventDefault();done(true);}if(e.key==='Escape')done(false);};
  const onBlur=()=>done(true);
  labelEditorInput.addEventListener('keydown',onKey);
  labelEditorInput.addEventListener('blur',onBlur);
  _edClean=()=>{labelEditorInput.removeEventListener('keydown',onKey);labelEditorInput.removeEventListener('blur',onBlur);};
}
function closeLabelEditor(commit,id) {
  _edClean?.(); _edClean=null;
  if(commit&&id&&state.countries[id]){
    state.countries[id].label=labelEditorInput.value;
    if(state.selectedId===id) labelInput.value=labelEditorInput.value;
    saveState(); redrawOverlays();
  }
  labelEditor.hidden=true;
}

// ============================================================
//  BACKGROUND
// ============================================================
function updateBg(color) {
  state.bgColor=color;
  d3.select('.map-bg-rect').attr('fill',color==='transparent'?'transparent':color);
  document.querySelector('.ambient-bg').style.display = color==='transparent'?'none':'';
  updateBgUI(color); saveState();
}
function updateBgUI(color) {
  bgBtns.forEach(b=>b.classList.toggle('active',b.dataset.bg===color));
  if(color!=='transparent') bgColorInput.value=color;
}

function updateCountryColor(color) {
  state.countryColor = color;
  // Apply to all unmarked country paths
  gCountries.selectAll('path').each(function(d) {
    if (!state.countries[String(d.id)]) d3.select(this).style('fill', color);
  });
  updateCountryColorUI(color);
  saveState();
}
function updateCountryColorUI(color) {
  document.querySelectorAll('.cc-btn').forEach(b => b.classList.toggle('active', b.dataset.cc === color));
  const el = document.getElementById('country-color');
  if (el) el.value = color;
}

function updateArcModeUI(mode) {
  document.querySelectorAll('.arc-seg').forEach(b => b.classList.toggle('active', b.dataset.amode === mode));
}

function updateExportUI() {
  document.querySelectorAll('.size-btn').forEach(b => b.classList.toggle('active', b.dataset.preset === state.exportPreset));
  const customRow = document.getElementById('custom-size-row');
  if (customRow) customRow.hidden = state.exportPreset !== 'custom';
  const hint = document.getElementById('size-hint');
  if (hint) hint.textContent = `Output: ${state.exportW} × ${state.exportH} px`;
  const expW = document.getElementById('exp-w'); if (expW) expW.value = state.exportW;
  const expH = document.getElementById('exp-h'); if (expH) expH.value = state.exportH;
}

// ============================================================
//  PRESENT MODE
// ============================================================
function togglePresent(on) { app.classList.toggle('present',on); if(on) selectCountry(null); }

// ============================================================
//  UNIFIED EXPORT FRAME RENDERER
//  - Creates a projection fitted to exact export dimensions → no letterbox bars
//  - Scales the current zoom transform proportionally
//  - Clips to canvas bounds (fill-mode: map may slightly overflow extremes)
//  - bgOverride: force a bg color (used for GIF which can't do partial alpha)
// ============================================================
function renderExportFrame(ctx, ms, expW, expH, bgOverride) {
  const bg = bgOverride ?? (state.bgColor === 'transparent' ? null : state.bgColor);

  ctx.clearRect(0, 0, expW, expH);
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, expW, expH); }

  // Projection refitted to export canvas → map fills exactly expW × expH
  const expProj  = d3.geoNaturalEarth1().fitSize([expW, expH], { type: 'Sphere' });
  const expPath  = d3.geoPath(expProj, ctx);
  // Scale factor: how much coordinate space grew vs viewport projection
  const sf       = expProj.scale() / projection.scale();

  // Current zoom, translated into export coordinate space
  const tr  = d3.zoomTransform(svgEl.node());
  const etx = tr.x * sf, ety = tr.y * sf, ek = tr.k;

  // Clip to canvas — map fills the frame; zoom-pan might show empty space at edges
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, expW, expH); ctx.clip();
  ctx.translate(etx, ety); ctx.scale(ek, ek);

  // ── Countries ──
  countriesData.forEach(f => {
    ctx.beginPath(); expPath(f);
    ctx.fillStyle = state.countries[String(f.id)]?.color || state.countryColor;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 0.5/ek; ctx.stroke();
  });

  // ── Country names ──
  if (state.showCountryNames) {
    ctx.save();
    ctx.font = `500 ${8/ek}px "Inter",sans-serif`;
    ctx.fillStyle  = 'rgba(255,255,255,0.38)';
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 2.5/ek; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    countriesData.forEach(f => {
      if (geoPath.area(f) < 800) return;   // use viewport projection for area check
      const [cx, cy] = expPath.centroid(f); if (isNaN(cx)) return;
      const name = SHORT_NAME[f.properties.name] || f.properties.name;
      ctx.strokeText(name, cx, cy); ctx.fillText(name, cx, cy);
    });
    ctx.restore();
  }

  // ── Hub centroid ──
  const hubF = getF(state.hubId); let hx = null, hy = null;
  if (hubF) {
    [hx, hy] = expPath.centroid(hubF);
    if (isNaN(hx)) { hx = null; hy = null; }
  }

  // ── Arc lines ──
  if (state.showLines && hx !== null) {
    Object.entries(state.countries).forEach(([id, info], idx) => {
      if (Number(id) === state.hubId) return;
      const f = getF(id); if (!f) return;
      const [cx, cy] = expPath.centroid(f); if (isNaN(cx) || isNaN(cy)) return;
      canvasArc(ctx, hx, hy, cx, cy, info.color, ms, idx);
    });
  }

  // ── Pulse rings ──
  Object.entries(state.countries).forEach(([id, info]) => {
    if (info.ringEnabled === false) return;
    const f = getF(id); if (!f) return;
    const [cx, cy] = expPath.centroid(f); if (isNaN(cx) || isNaN(cy)) return;
    const rc = ringColor(info.color);
    [0, 0.5].forEach(delay => {
      const phase = ((ms/1800) + delay) % 1;
      const r = 4 + phase*20, op = (1-phase)*0.9;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2);
      ctx.strokeStyle = hexRgba(rc, op);
      ctx.lineWidth = (2-phase*1.5)/ek; ctx.stroke();
    });
    ctx.beginPath(); ctx.arc(cx, cy, 3/ek, 0, Math.PI*2);
    ctx.fillStyle = rc; ctx.fill();
  });

  // ── Labels ──
  ctx.font = `600 12px "Space Grotesk","Inter",sans-serif`;
  Object.entries(state.countries).forEach(([id, info]) => {
    if (!info.label?.trim()) return;
    const f = getF(id); if (!f) return;
    const [cx, cy] = expPath.centroid(f); if (isNaN(cx) || isNaN(cy)) return;
    const off = info.labelOffset || {dx:0, dy:-30};
    const lx = cx+off.dx, ly = cy+off.dy;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(lx, ly);
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1/ek;
    ctx.setLineDash([3/ek, 3/ek]); ctx.stroke(); ctx.setLineDash([]);
    const tw = ctx.measureText(info.label).width, px = 10, py = 10;
    ctx.fillStyle = 'rgba(16,16,22,.93)'; ctx.strokeStyle = 'rgba(255,255,255,.15)';
    ctx.lineWidth = 1/ek;
    rrect(ctx, lx-tw/2-px, ly-py, tw+px*2, py*2, 5/ek); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f1f1f3'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(info.label, lx, ly);
  });

  ctx.restore();
}

// ============================================================
//  EXPORT — PNG
// ============================================================
function exportPNG() {
  selectCountry(null);
  const { exportW: W, exportH: H } = state;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  renderExportFrame(ctx, 0, W, H);   // transparent bg → PNG alpha works
  cv.toBlob(b => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = `world-map-${Date.now()}.png`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }, 'image/png');
}

// ============================================================
//  EXPORT — WebM
// ============================================================
async function exportWebM() {
  const btn=$('export-animation');
  if(btn.dataset.rec==='1') return;
  await document.fonts.ready;
  const DURATION=4000, FPS=30;
  const { exportW: W, exportH: H } = state;
  const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
  const ctx=cv.getContext('2d');
  const stream=cv.captureStream(FPS);
  // VP9 supports alpha channel — transparent background works!
  const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(m=>MediaRecorder.isTypeSupported(m));
  if(!mime){alert('WebM not supported in this browser.');return;}
  const rec=new MediaRecorder(stream,{mimeType:mime}); const chunks=[];
  rec.ondataavailable=e=>{if(e.data.size>0)chunks.push(e.data);};
  rec.onstop=()=>{
    const blob=new Blob(chunks,{type:mime}); const a=document.createElement('a');
    a.href=URL.createObjectURL(blob); a.download=`world-map-${Date.now()}.webm`; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),3000);
    btn.textContent='WebM (animation)'; btn.dataset.rec='0';
  };
  btn.dataset.rec='1'; let cd=DURATION/1000;
  btn.textContent=`Recording… ${cd}s`;
  const tick=setInterval(()=>{cd--;if(cd>0)btn.textContent=`Recording… ${cd}s`;},1000);
  rec.start(100); const t0=performance.now();
  function frame(){
    const el=performance.now()-t0;
    if(el>=DURATION){clearInterval(tick);rec.stop();return;}
    renderExportFrame(ctx,el,W,H); // transparent bg preserved in WebM/VP9
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ============================================================
//  EXPORT — GIF  (using gif.js with blob worker)
// ============================================================
async function exportGIF() {
  const btn=$('export-gif');
  if(btn.dataset.rec==='1') return;
  if(typeof GIF==='undefined'){alert('gif.js not loaded — check connection and reload.');return;}
  await document.fonts.ready;

  btn.dataset.rec='1'; btn.textContent='Loading worker…';

  // Fetch worker via blob URL to avoid same-origin restriction
  let workerUrl;
  try {
    const resp = await fetch('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js');
    const text = await resp.text();
    workerUrl = URL.createObjectURL(new Blob([text],{type:'text/javascript'}));
  } catch(e) {
    alert('Could not load GIF worker — check internet connection.');
    btn.dataset.rec='0'; btn.textContent='GIF (animation)'; return;
  }

  const { exportW: W, exportH: H } = state;
  // GIF: 15fps, 2 full ring cycles (1.8s × 2 = 3.6s) → perfect seamless loop
  const FPS=15, FRAME_MS=Math.round(1000/FPS), FRAMES=54;
  // GIF doesn't support partial alpha — force solid bg even if user chose transparent
  const gifBg = state.bgColor === 'transparent' ? '#0a0a0f' : state.bgColor;

  const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
  const ctx=cv.getContext('2d');

  const gif=new GIF({
    workers: 2,
    quality: 1,          // 1 = best color quality (slowest), 10 = worst
    dither: 'FloydSteinberg', // smooth dithering for gradients
    workerScript: workerUrl,
    width: W, height: H,
    repeat: 0,           // loop forever
  });

  // Render all frames
  for(let i=0;i<FRAMES;i++){
    renderExportFrame(ctx, i*FRAME_MS, W, H, gifBg);
    gif.addFrame(ctx, {copy:true, delay:FRAME_MS});
    const pct=Math.round((i+1)/FRAMES*65);
    btn.textContent=`Rendering ${pct}%`;
    if(i%5===4) await new Promise(r=>setTimeout(r,0)); // yield to UI
  }

  gif.on('progress', p => { btn.textContent=`Encoding ${Math.round(65+p*35)}%`; });

  gif.on('finished', blob => {
    URL.revokeObjectURL(workerUrl);
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob); a.download=`world-map-${Date.now()}.gif`; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),3000);
    btn.textContent='GIF (animation)'; btn.dataset.rec='0';
  });

  btn.textContent='Encoding 65%';
  gif.render();
}

function canvasArc(ctx,x1,y1,x2,y2,color,ms,idx){
  const ac=arcLineColor(color);
  const {cpx,cpy}=arcCP(x1,y1,x2,y2);
  // Trail
  ctx.beginPath(); ctx.moveTo(x1,y1); ctx.quadraticCurveTo(cpx,cpy,x2,y2);
  ctx.strokeStyle=hexRgba(ac,.22); ctx.lineWidth=1.5; ctx.setLineDash([]); ctx.stroke();
  // Beam
  const DUR=1800/state.arcSpeed, phase=((ms+(idx*600))%DUR)/DUR, seg=0.25, t1=phase+seg;
  ctx.save(); ctx.strokeStyle=ac; ctx.lineWidth=2.5; ctx.shadowColor=ac; ctx.shadowBlur=10;
  const N=28;
  const drawSeg=(a,b)=>{
    ctx.beginPath();
    for(let i=0;i<=N;i++){
      const t=a+(b-a)*(i/N), p=qbez(x1,y1,cpx,cpy,x2,y2,Math.min(Math.max(t,0),1));
      i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);
    }
    ctx.stroke();
  };
  drawSeg(phase,Math.min(t1,1)); if(t1>1) drawSeg(0,t1-1);
  ctx.restore();
}

// ============================================================
//  UTILITIES
// ============================================================
function qbez(x1,y1,cpx,cpy,x2,y2,t){
  return{x:(1-t)**2*x1+2*(1-t)*t*cpx+t**2*x2, y:(1-t)**2*y1+2*(1-t)*t*cpy+t**2*y2};
}
function hexRgba(hex,a){
  const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}
function rrect(ctx,x,y,w,h,r){
  ctx.beginPath(); ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r);
  ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
  ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r); ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r);
  ctx.closePath();
}
function debounce(fn,ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};}
function handleResize(){
  const rect=document.querySelector('.map-area').getBoundingClientRect();
  width=rect.width; height=rect.height;
  svgEl.attr('viewBox',`0 0 ${width} ${height}`);
  projection.fitSize([width,height],{type:'Sphere'});
  gCountries.selectAll('path').attr('d',geoPath);
  buildCountryNames(); redrawOverlays();
}

// ---- Boot ----
hintEl.textContent='Loading map…';
init();
