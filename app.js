/**
 * EVYD Product Roadmap — app.js
 * Pure vanilla JS, no dependencies.
 * Data persists in localStorage.
 */

// ============================================================
//  Constants
// ============================================================

const MONTHS_EN  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_ZH  = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

// Fiscal year starts in April (month 4).
// toFiscalCol converts a calendar month (1–12) to a 0-indexed column (Apr=0 … Mar=11).
const FISCAL_START = 4;
function toFiscalCol(calMonth) {
  return (calMonth - FISCAL_START + 12) % 12;
}
function fromFiscalCol(col) {
  return ((col + FISCAL_START - 1) % 12) + 1;
}
// Returns the calendar year in which the current fiscal year starts (e.g. Apr 2026 → 2026)
function getFYYear() {
  const now = new Date();
  return now.getMonth() + 1 >= FISCAL_START ? now.getFullYear() : now.getFullYear() - 1;
}

const MODULE_COLORS = [
  { bg: '#3B82F6', dark: '#1D4ED8', light: '#DBEAFE' },  // blue
  { bg: '#06B6D4', dark: '#0E7490', light: '#CFFAFE' },  // cyan
  { bg: '#10B981', dark: '#047857', light: '#D1FAE5' },  // green
  { bg: '#F59E0B', dark: '#B45309', light: '#FEF3C7' },  // amber
  { bg: '#F97316', dark: '#C2410C', light: '#FFEDD5' },  // orange
  { bg: '#EF4444', dark: '#B91C1C', light: '#FEE2E2' },  // red
  { bg: '#8B5CF6', dark: '#6D28D9', light: '#EDE9FE' },  // purple
  { bg: '#EC4899', dark: '#BE185D', light: '#FCE7F3' },  // pink
];

// Team colors — distinct from module palette for quick visual differentiation
const TEAM_COLORS = [
  '#F97316', // orange
  '#8B5CF6', // violet
  '#14B8A6', // teal
  '#EC4899', // pink
  '#84CC16', // lime
  '#F59E0B', // amber
  '#6366F1', // indigo
  '#EF4444', // red
  '#06B6D4', // cyan
  '#A855F7', // purple
];

const ROW_HEIGHT     = 64;   // px per packed row (tall enough for 2-line bars)
const BAR_PADDING    = 6;    // px gap above/below bar in its row slot
const STORAGE_KEY    = 'evyd_roadmap_data';
const COLLAPSED_KEY  = 'evyd_roadmap_collapsed';

// ============================================================
//  State
// ============================================================

let appData = {
  version: 1,
  lastModified: new Date().toISOString(),
  moduleOrder: [],   // explicit display order of module names
  items: []
};

let moduleColorMap  = {};   // module name → color object
let teamColorMap    = {};   // team name → hex color string
let collapsedModules = {};  // module name → bool
let editingItemId    = null;
let dragState        = null; // null | { type, item, bar, startX, origValue, moved }
let moduleDragState  = null; // null | { moduleName, origIdx, targetIdx }
let tooltipHideTimer = null;
let lastDragMoved    = false; // persists through mouseup→click cycle

// ============================================================
//  Persistence
// ============================================================

function loadData() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) {
      appData = JSON.parse(s);
      // Ensure every item has an id (handles data that bypassed importJSON)
      appData.items.forEach(it => { if (!it.id) it.id = generateId(); });
    }
    // Back-compat: old data without version / moduleOrder fields
    if (!appData.version)      appData.version      = 1;
    if (!appData.lastModified) appData.lastModified = new Date().toISOString();
    if (!appData.moduleOrder)  appData.moduleOrder  = [];
    const c = localStorage.getItem(COLLAPSED_KEY);
    if (c) collapsedModules = JSON.parse(c);
  } catch(e) { /* ignore */ }
}

function saveData() {
  appData.version      = (appData.version || 0) + 1;
  appData.lastModified = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
  updateVersionIndicator();
}

function saveCollapsed() {
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsedModules));
}

// ============================================================
//  Data helpers
// ============================================================

function generateId() {
  return 'i_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

/** Return unique module names, respecting explicit moduleOrder when set */
function getModules() {
  const all = [...new Set(appData.items.map(it => it.module))];
  if (appData.moduleOrder && appData.moduleOrder.length) {
    const ordered = appData.moduleOrder.filter(m => all.includes(m));
    all.forEach(m => { if (!ordered.includes(m)) ordered.push(m); });
    return ordered;
  }
  // Fallback: insertion order from items
  const seen = new Set(), out = [];
  appData.items.forEach(it => { if (!seen.has(it.module)) { seen.add(it.module); out.push(it.module); } });
  return out;
}

/** Auto-assign colors per module (stable within a session) */
function rebuildColorMap() {
  moduleColorMap = {};
  getModules().forEach((m, i) => {
    moduleColorMap[m] = MODULE_COLORS[i % MODULE_COLORS.length];
  });
  rebuildTeamColorMap();
}

function getModuleColor(moduleName) {
  return moduleColorMap[moduleName] || MODULE_COLORS[0];
}

/**
 * Collect every unique team name across all items, sort alphabetically for
 * stable color assignment, then map each name to a TEAM_COLORS entry.
 */
function rebuildTeamColorMap() {
  const allTeams = new Set();
  appData.items.forEach(item => {
    if (Array.isArray(item.collaborators)) {
      item.collaborators.forEach(t => { if (t) allTeams.add(t.trim()); });
    }
  });
  const sorted = [...allTeams].sort();
  teamColorMap = {};
  sorted.forEach((team, i) => {
    teamColorMap[team] = TEAM_COLORS[i % TEAM_COLORS.length];
  });
}

function getTeamColor(teamName) {
  return teamColorMap[teamName] || TEAM_COLORS[0];
}

/** Returns the display initial(s) for a team name (first char, uppercased). */
function teamInitial(name) {
  return name.trim().charAt(0).toUpperCase();
}

/**
 * Pack items into rows (greedy interval scheduling).
 * Returns { rows: { [id]: rowIndex }, rowCount: number }
 */
function packRows(items) {
  // Sort and compare using fiscal columns so Apr-starting items appear first
  const sorted = [...items].sort((a, b) => toFiscalCol(a.startMonth) - toFiscalCol(b.startMonth));
  const rowEnds = []; // fiscal end-col (inclusive) of last item per row
  const result  = {};

  sorted.forEach(item => {
    const startCol = toFiscalCol(item.startMonth);
    const endCol   = startCol + item.duration - 1;
    let r = rowEnds.findIndex(e => e < startCol);
    if (r === -1) r = rowEnds.length;
    rowEnds[r] = endCol;
    result[item.id] = r;
  });

  return { rows: result, rowCount: Math.max(rowEnds.length, 1) };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ============================================================
//  Column width helper
// ============================================================

function getColumnWidth() {
  const tw = document.querySelector('.items-timeline');
  if (tw) return tw.getBoundingClientRect().width / 12;
  const mh = document.getElementById('months-header');
  if (mh) return mh.getBoundingClientRect().width / 12;
  return 80;
}

// ============================================================
//  Render
// ============================================================

function render() {
  rebuildColorMap();

  const body    = document.getElementById('roadmap-body');
  const empty   = document.getElementById('empty-state');
  const modules = getModules();

  // Rebuild month header (current-month highlight)
  buildMonthHeader();

  if (modules.length === 0) {
    body.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';
  body.innerHTML = '';

  modules.forEach(moduleName => renderModule(moduleName, body));
  renderTodayLines();
}

function buildMonthHeader() {
  const now      = new Date();
  const curYear  = now.getFullYear();
  const curCalMonth = now.getMonth() + 1; // 1-indexed

  const header = document.getElementById('months-header');
  // Generate 12 columns starting from FISCAL_START (April)
  header.innerHTML = Array.from({length: 12}, (_, i) => {
    const calMonth = ((FISCAL_START - 1 + i) % 12) + 1; // 1-indexed
    // Highlight current month considering fiscal year wraps into next calendar year
    // Fiscal year wraps: months Jan–Mar belong to the next calendar year
    const displayYear = calMonth < FISCAL_START ? curYear + 1 : curYear;
    const isCur = (displayYear === curYear && calMonth === curCalMonth);
    return `<div class="month-header-cell${isCur ? ' current-month' : ''}">${MONTHS_EN[calMonth - 1]}</div>`;
  }).join('');
}

function renderModule(moduleName, container) {
  const items    = appData.items.filter(it => it.module === moduleName);
  const color    = getModuleColor(moduleName);
  const collapsed = !!collapsedModules[moduleName];

  const section = document.createElement('div');
  section.className = 'module-section';
  section.dataset.module = moduleName;

  // ---- Module header row ----
  const headerRow = document.createElement('div');
  headerRow.className = 'module-header-row grid-row';

  headerRow.innerHTML = `
    <div class="label-col module-label-cell" style="border-left:3px solid ${color.bg}">
      <span class="module-drag-handle" title="拖拽排序">⠿</span>
      <span class="collapse-icon">${collapsed ? '▶' : '▼'}</span>
      <span class="module-name-text" title="${esc(moduleName)}">${esc(moduleName)}</span>
      <span class="module-badge">${items.length}</span>
      <button class="module-rename-btn" title="重命名分类">✎</button>
    </div>
    <div class="module-header-timeline">
      ${Array.from({length:12}, (_,i) => `<div class="month-cell"></div>`).join('')}
    </div>
  `;

  const labelCell = headerRow.querySelector('.label-col');
  labelCell.addEventListener('click', () => {
    collapsedModules[moduleName] = !collapsed;
    saveCollapsed();
    render();
  });

  headerRow.querySelector('.module-drag-handle').addEventListener('mousedown', e => {
    e.stopPropagation();
    startModuleDrag(e, moduleName);
  });

  headerRow.querySelector('.module-rename-btn').addEventListener('click', e => {
    e.stopPropagation();
    startModuleRename(moduleName, headerRow.querySelector('.module-name-text'));
  });

  section.appendChild(headerRow);

  // ---- Items area ----
  if (!collapsed) {
    const { rows: itemRowMap, rowCount } = packRows(items);
    const areaHeight = rowCount * ROW_HEIGHT + 8;

    const itemsRow = document.createElement('div');
    itemsRow.className = 'items-row grid-row';
    itemsRow.style.height = areaHeight + 'px';

    // Alt column tinting — fiscal col i → calendar month via fromFiscalCol
    const curCalMonth = new Date().getMonth() + 1; // 1-indexed
    const altCells = Array.from({length:12}, (_,i) => {
      const classes = ['month-cell'];
      if (i % 2 === 1) classes.push('alt');
      if (fromFiscalCol(i) === curCalMonth) classes.push('current-month-col');
      return `<div class="${classes.join(' ')}"></div>`;
    }).join('');

    itemsRow.innerHTML = `
      <div class="label-col items-label-col"></div>
      <div class="items-timeline">
        <div class="month-cells-bg">${altCells}</div>
        <div class="items-layer"></div>
      </div>
    `;

    const layer = itemsRow.querySelector('.items-layer');

    items.forEach(item => {
      const row = itemRowMap[item.id] ?? 0;
      layer.appendChild(createBar(item, color, row));
    });

    section.appendChild(itemsRow);
  }

  container.appendChild(section);
}

function renderTodayLines() {
  const now = new Date();

  const calMonth  = now.getMonth() + 1;        // 1-indexed calendar month
  const day       = now.getDate();
  const daysInMo  = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const fiscalCol = toFiscalCol(calMonth);
  const pct       = ((fiscalCol + (day - 1) / daysInMo) / 12 * 100).toFixed(4) + '%';

  document.querySelectorAll('.items-timeline').forEach(el => {
    const line = Object.assign(document.createElement('div'), { className: 'today-line' });
    line.style.left = pct;
    el.appendChild(line);
  });

  document.querySelectorAll('.module-header-timeline').forEach(el => {
    const line = Object.assign(document.createElement('div'), { className: 'today-line today-line-header' });
    line.style.left = pct;
    el.appendChild(line);
  });
}

// ============================================================
//  Bar creation
// ============================================================

function createBar(item, color, row) {
  const bar = document.createElement('div');
  bar.className = 'item-bar';
  bar.dataset.id = item.id;

  const leftPct  = (toFiscalCol(item.startMonth) / 12 * 100).toFixed(4) + '%';
  const widthPct = (item.duration / 12 * 100).toFixed(4) + '%';
  const topPx    = row * ROW_HEIGHT + BAR_PADDING + 'px';

  bar.style.cssText = `left:${leftPct};width:${widthPct};top:${topPx};background:${color.bg};z-index:${row + 1};`;

  // Build team avatar chips (max 3 visible + overflow counter)
  const collabs  = Array.isArray(item.collaborators) ? item.collaborators.filter(Boolean) : [];
  const maxChips = 3;
  const chipsInner = collabs.slice(0, maxChips).map(t =>
    `<span class="team-chip" style="background:${getTeamColor(t)}" title="${esc(t)}">${teamInitial(t)}</span>`
  ).join('') + (collabs.length > maxChips ? `<span class="team-chip-more">+${collabs.length - maxChips}</span>` : '');
  const teamAvatarsHtml = collabs.length > 0
    ? `<div class="bar-team-avatars">${chipsInner}</div>` : '';

  bar.innerHTML = `
    <div class="bar-content">
      <span class="bar-title">${esc(item.title)}</span>
      <div class="bar-meta-row">
        ${teamAvatarsHtml}
        <span class="bar-duration">${item.duration}m</span>
      </div>
    </div>
    <div class="bar-resize-handle" title="拖拽调整时长"></div>
  `;

  // ---- Tooltip ----
  bar.addEventListener('mouseenter', (e) => showTooltip(item, e.clientX, e.clientY));
  bar.addEventListener('mousemove',  (e) => positionTooltip(e.clientX, e.clientY));
  bar.addEventListener('mouseleave', () => scheduleHideTooltip());

  // ---- Click to edit (only if not dragged) ----
  // Note: by the time 'click' fires, mouseup has already set dragState=null,
  // so we use a separate lastDragMoved flag that survives the mouseup→click cycle.
  bar.addEventListener('click', () => {
    if (lastDragMoved) { lastDragMoved = false; return; }
    openModal(item.id);
  });

  // ---- Drag to move ----
  bar.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('bar-resize-handle')) return;
    e.preventDefault();
    hideTooltip();
    startDragMove(e, item, bar);
  });

  // ---- Drag to resize ----
  bar.querySelector('.bar-resize-handle').addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideTooltip();
    startDragResize(e, item, bar);
  });

  return bar;
}

// ============================================================
//  Drag — move
// ============================================================

function startDragMove(e, item, bar) {
  const colW        = getColumnWidth();
  const startX      = e.clientX;
  const origCalMonth  = item.startMonth;
  const origFiscalCol = toFiscalCol(origCalMonth);

  dragState = { type: 'move', item, bar, startX, origValue: origCalMonth, moved: false };
  bar.classList.add('dragging');
  document.body.style.cursor = 'grabbing';

  const onMove = (me) => {
    const dm = Math.round((me.clientX - startX) / colW);
    if (dm !== 0) { dragState.moved = true; lastDragMoved = true; }
    // Clamp in fiscal-col space so items can cross the calendar year boundary freely
    const newFiscalCol = clamp(origFiscalCol + dm, 0, 12 - item.duration);
    const newStart     = fromFiscalCol(newFiscalCol);
    bar.style.left = (newFiscalCol / 12 * 100).toFixed(4) + '%';
    bar.dataset.pendingStart = newStart;
  };

  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
    bar.classList.remove('dragging');
    document.body.style.cursor = '';

    const newStart = parseInt(bar.dataset.pendingStart || origCalMonth);
    if (newStart !== origCalMonth) {
      item.startMonth = newStart;
      saveData();
      render();
    }
    dragState = null;
    // lastDragMoved intentionally NOT cleared here — click handler clears it
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);
}

// ============================================================
//  Drag — resize
// ============================================================

function startDragResize(e, item, bar) {
  const colW     = getColumnWidth();
  const startX   = e.clientX;
  const origDur  = item.duration;

  dragState = { type: 'resize', item, bar, startX, origValue: origDur, moved: false };
  bar.classList.add('resizing');
  document.body.style.cursor = 'ew-resize';

  const onMove = (me) => {
    const dm = Math.round((me.clientX - startX) / colW);
    if (dm !== 0) { dragState.moved = true; lastDragMoved = true; }
    const newDur = clamp(origDur + dm, 1, 12 - toFiscalCol(item.startMonth));
    bar.style.width = (newDur / 12 * 100).toFixed(4) + '%';
    // Update duration badge
    const badge = bar.querySelector('.bar-duration');
    if (badge) badge.textContent = newDur + 'm';
    bar.dataset.pendingDur = newDur;
  };

  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
    bar.classList.remove('resizing');
    document.body.style.cursor = '';

    const newDur = parseInt(bar.dataset.pendingDur || origDur);
    if (newDur !== origDur) {
      item.duration = newDur;
      saveData();
      render();
    }
    dragState = null;
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);
}

// ============================================================
//  Tooltip
// ============================================================

function showTooltip(item, x, y) {
  clearTimeout(tooltipHideTimer);
  const tt = document.getElementById('item-tooltip');
  document.getElementById('tt-module').textContent   = item.module;
  document.getElementById('tt-duration').textContent = `${MONTHS_ZH[item.startMonth-1]} — ${item.duration}个月`;
  document.getElementById('tt-title').textContent    = item.title;

  const prob = document.getElementById('tt-problem');
  const probWrap = document.getElementById('tt-problem-wrap');
  if (item.problem && item.problem.trim()) {
    prob.textContent = item.problem;
    probWrap.style.display = '';
  } else {
    probWrap.style.display = 'none';
  }

  const desc = document.getElementById('tt-description');
  const descWrap = document.getElementById('tt-description-wrap');
  if (item.description && item.description.trim()) {
    desc.textContent = item.description;
    descWrap.style.display = '';
  } else {
    descWrap.style.display = 'none';
  }

  const out = document.getElementById('tt-outcome');
  const outWrap = document.getElementById('tt-outcome-wrap');
  if (item.outcome && item.outcome.trim()) {
    out.textContent = item.outcome;
    outWrap.style.display = '';
  } else {
    outWrap.style.display = 'none';
  }

  const authorRow = document.getElementById('tt-author-row');
  const authorEl  = document.getElementById('tt-author');
  if (item.author && item.author.trim()) {
    authorEl.textContent = item.author;
    authorRow.classList.remove('hidden');
  } else {
    authorRow.classList.add('hidden');
  }

  const collabWrap  = document.getElementById('tt-collab-wrap');
  const collabChips = document.getElementById('tt-collab-chips');
  const collabs = Array.isArray(item.collaborators) ? item.collaborators.filter(Boolean) : [];
  if (collabs.length > 0) {
    collabChips.innerHTML = collabs.map(t => {
      const c = getTeamColor(t);
      return `<span class="tt-collab-chip" style="background:${c}22;color:${c};border-color:${c}55">${esc(t)}</span>`;
    }).join('');
    collabWrap.style.display = '';
  } else {
    collabWrap.style.display = 'none';
  }

  tt.classList.remove('hidden');
  positionTooltip(x, y);
}

function positionTooltip(x, y) {
  const tt = document.getElementById('item-tooltip');
  const pad = 14;
  const w   = tt.offsetWidth  || 280;
  const h   = tt.offsetHeight || 120;
  const vw  = window.innerWidth;
  const vh  = window.innerHeight;

  let left = x + pad;
  let top  = y - h / 2;
  if (left + w > vw - 8)  left = x - w - pad;
  if (top < 8)             top  = 8;
  if (top + h > vh - 8)   top  = vh - h - 8;

  tt.style.left = left + 'px';
  tt.style.top  = top  + 'px';
}

function scheduleHideTooltip() {
  tooltipHideTimer = setTimeout(hideTooltip, 120);
}

function hideTooltip() {
  clearTimeout(tooltipHideTimer);
  document.getElementById('item-tooltip').classList.add('hidden');
}

// ============================================================
//  Modal
// ============================================================

function openModal(itemId = null) {
  const overlay  = document.getElementById('modal-overlay');
  const form     = document.getElementById('item-form');
  const title    = document.getElementById('modal-title');
  const deleteBtn = document.getElementById('btn-delete');

  editingItemId = itemId;

  if (itemId) {
    const it = appData.items.find(i => i.id === itemId);
    if (!it) return;
    title.textContent        = '编辑条目';
    form.module.value        = it.module;
    form.title.value         = it.title;
    form.problem.value       = it.problem      || '';
    form.description.value   = it.description  || '';
    form.outcome.value       = it.outcome      || '';
    form.collaborators.value = Array.isArray(it.collaborators) ? it.collaborators.join(', ') : '';
    form.author.value        = it.author || '';
    form.startMonth.value    = it.startMonth;
    form.duration.value      = it.duration;
    deleteBtn.classList.remove('hidden');
  } else {
    title.textContent = '添加条目';
    form.reset();
    form.startMonth.value = Math.max(1, new Date().getMonth() + 1);
    form.duration.value   = 1;
    deleteBtn.classList.add('hidden');
  }

  updatePreviewBar();
  overlay.classList.remove('hidden');
  setTimeout(() => form.module.focus(), 60);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  editingItemId = null;
}

// ---- Preview bar in modal ----
function updatePreviewBar() {
  const form     = document.getElementById('item-form');
  const bar      = document.getElementById('preview-bar');
  const s        = clamp(parseInt(form.startMonth.value) || 1, 1, 12);
  const d        = clamp(parseInt(form.duration.value)   || 1, 1, 12 - toFiscalCol(s));
  const modName  = form.module.value.trim();
  const color    = modName ? (moduleColorMap[modName] || MODULE_COLORS[0]) : MODULE_COLORS[0];

  bar.style.left       = (toFiscalCol(s) / 12 * 100).toFixed(2) + '%';
  bar.style.width      = (d / 12 * 100).toFixed(2) + '%';
  bar.style.background = color.bg;
  bar.style.opacity    = '0.85';
}

// ============================================================
//  CSV helpers
// ============================================================

// Parse a single CSV line, handling quoted fields and escaped quotes
function parseCSVRow(line) {
  const result = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      result.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

// Parse full CSV text → array of objects keyed by header row
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
  const lines = text.split(/\r?\n/);
  const nonEmpty = lines.filter(l => l.trim());
  if (nonEmpty.length < 2) throw new Error('CSV 格式无效：至少需要表头行和一行数据');
  const headers = parseCSVRow(nonEmpty[0]).map(h => h.trim());
  return nonEmpty.slice(1).map(line => {
    const vals = parseCSVRow(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim(); });
    return obj;
  }).filter(obj => Object.values(obj).some(v => v)); // skip blank rows
}

// Encode a CSV string as UTF-16 LE with BOM — works with all Excel/WPS versions on Windows
function csvToBlob(csvText) {
  // UTF-16 LE BOM = FF FE; each JS char becomes 2 bytes (little-endian)
  const buf  = new ArrayBuffer(2 + csvText.length * 2);
  const view = new DataView(buf);
  view.setUint8(0, 0xFF);
  view.setUint8(1, 0xFE);
  for (let i = 0; i < csvText.length; i++) {
    view.setUint16(2 + i * 2, csvText.charCodeAt(i), true);
  }
  return new Blob([buf], { type: 'text/csv;charset=utf-16le' });
}

// Wrap a value for CSV export — quotes if it contains comma, quote, or newline
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

// ============================================================
//  Import / Export
// ============================================================

// Normalise a raw row object (from CSV or JSON alias keys) into a clean item
function normaliseItem(it) {
  // Accept common alias column names
  if (!it.module      && it.Module)      it.module      = it.Module;
  if (!it.title       && it.Function)    it.title       = it.Function;
  if (!it.problem     && it.Problem)     it.problem     = it.Problem;
  if (!it.description && it.Description) it.description = it.Description;
  if (!it.outcome     && it.Value)       it.outcome     = it.Value;
  if (!it.author      && it.Author)      it.author      = it.Author;
  if (!it.collaborators && it.Resource !== undefined) {
    const raw = String(it.Resource || '').trim();
    it.collaborators = (raw && raw !== '-') ? raw : '';
  }

  if (!it.id)          it.id          = generateId();
  if (!it.module)      it.module      = '未分类';
  if (!it.title)       it.title       = '未命名';
  if (!it.description) it.description = '';
  if (!it.author)      it.author      = '';
  it.startMonth = clamp(parseInt(it.startMonth) || FISCAL_START, 1, 12);
  it.duration   = clamp(parseInt(it.duration)   || 3,            1, 12 - toFiscalCol(it.startMonth));

  // Normalise collaborators → string[];  supports ";", "," separators, ignores "-"
  if (Array.isArray(it.collaborators)) {
    // already an array (e.g. from old JSON data)
  } else {
    const raw = String(it.collaborators || '').trim();
    it.collaborators = (raw && raw !== '-')
      ? raw.split(/[;,]/).map(s => s.trim()).filter(Boolean)
      : [];
  }
  return it;
}

function importCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) throw new Error('CSV 无有效数据行');
  appData.items = rows.map(normaliseItem);
  appData.moduleOrder = []; // derive fresh order from import sequence
  saveData();
  render();
}

function importCSVAppend(text) {
  const rows = parseCSV(text);
  if (!rows.length) throw new Error('CSV 无有效数据行');
  const newItems = rows.map(normaliseItem);
  appData.items = appData.items.concat(newItems);
  saveData();
  render();
}

// Decode a File/Blob respecting UTF-16 LE and UTF-8 BOM
function readCSVFile(file, callback) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    const buf   = ev.target.result;
    const bytes = new Uint8Array(buf);
    let text;
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
      text = new TextDecoder('utf-16le').decode(new Uint8Array(buf, 2));
    } else if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      text = new TextDecoder('utf-8').decode(new Uint8Array(buf, 3));
    } else {
      text = new TextDecoder('utf-8').decode(buf);
    }
    callback(text);
  };
  reader.readAsArrayBuffer(file);
}

function exportCSV() {
  const HEADERS = ['author','module','problem','title','description','outcome','collaborators','startMonth','duration'];
  const rows = [
    HEADERS.join(','),
    ...appData.items.map(it => HEADERS.map(h => {
      const v = h === 'collaborators'
        ? (Array.isArray(it[h]) ? it[h].join(';') : (it[h] || ''))
        : (it[h] ?? '');
      return csvCell(v);
    }).join(','))
  ];
  const blob = csvToBlob(rows.join('\r\n'));
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url,
    download: `roadmap_FY${getFYYear() + 1}_v${appData.version}.csv`
  });
  a.click();
  URL.revokeObjectURL(url);
}

function downloadSample() {
  const HEADERS = ['author','module','problem','title','description','outcome','collaborators','startMonth','duration'];
  const items = [
    { module: '健康管理',  title: 'Routines 减重计划',  problem: '用户缺乏科学减重方案，依从性低',       description: '设计基于目标体重的阶段性打卡计划，结合 AI 动态调整运动与饮食建议',  outcome: '30天留存提升25%，减重打卡完成率≥70%',  collaborators: '医学团队;内容团队',  author: 'Lynn',     startMonth: 4,  duration: 3 },
    { module: '健康管理',  title: '营养餐食推荐引擎',   problem: '通用食谱不满足个体差异',              description: '基于用户健康档案、过敏史和偏好构建个性化食谱推荐模型',              outcome: '个性化推荐满意度≥4.2分',              collaborators: '医学团队;数据团队',  author: 'Ned',      startMonth: 7,  duration: 2 },
    { module: '本地活动',  title: '文莱 QR Code 寻宝', problem: '缺乏线下互动，用户活跃度低',           description: '在文莱核心商圈布置实体 QR 码任务点，用户扫码解锁奖励与健康内容',    outcome: '活动期间 DAU 提升40%',                collaborators: 'Ops Team;市场团队', author: 'Lynn',     startMonth: 5,  duration: 2 },
    { module: '本地活动',  title: '线下合作商户接入',   problem: '无本地商户生态，变现路径单一',          description: '搭建商户入驻平台，支持优惠券核销、积分兑换与联合营销活动管理',        outcome: '接入≥50家商户，GMV+100K/月',          collaborators: 'Ops Team;商务团队', author: 'Ned;Lynn', startMonth: 8,  duration: 3 },
    { module: '用户增长',  title: '注册转化漏斗优化',   problem: '注册流程繁琐，中途流失率达40%',        description: '精简注册步骤至3步以内，引入手机号一键授权与渐进式资料完善机制',        outcome: '注册转化率提升20%',                   collaborators: '',                  author: 'Lynn',     startMonth: 4,  duration: 2 },
    { module: '用户增长',  title: '推荐裂变系统',       problem: '缺乏病毒传播机制',                   description: '设计邀请有礼玩法，新用户完成首次健康打卡后双方均获得会员权益',        outcome: '月新增用户提升15%',                   collaborators: '市场团队',           author: 'Ned',      startMonth: 7,  duration: 3 },
    { module: '基础架构',  title: 'API 网关升级',       problem: '旧网关无法支撑高并发，运维成本高',     description: '迁移至云原生 API 网关，接入限流熔断、灰度发布与全链路监控能力',        outcome: '吞吐量提升3倍，故障率降低70%',         collaborators: '运维团队',           author: 'Lynn',     startMonth: 4,  duration: 2 },
    { module: '基础架构',  title: '多租户权限体系',     problem: '权限管理混乱，安全合规风险高',         description: '重构 RBAC 权限模型，支持角色继承与接口级授权，满足 PDPA 审计要求',  outcome: '权限粒度细化至接口级，满足 PDPA 合规', collaborators: '法务团队;安全团队',  author: 'Ned',      startMonth: 9,  duration: 4 },
  ];
  const rows = [
    HEADERS.join(','),
    ...items.map(it => HEADERS.map(h => csvCell(it[h] ?? '')).join(','))
  ];
  const blob = csvToBlob(rows.join('\r\n'));
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url,
    download: `roadmap_sample_${new Date().getFullYear()}.csv`
  });
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
//  Module rename
// ============================================================

function startModuleRename(oldName, nameSpan) {
  const input = document.createElement('input');
  input.className = 'module-name-input';
  input.value = oldName;
  nameSpan.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    const newName = input.value.trim() || oldName;
    if (newName === oldName) { render(); return; }

    const existing = getModules();
    const willMerge = existing.includes(newName);
    if (willMerge && !confirm(`"${newName}" 已存在，确定将 "${oldName}" 合并进去？`)) {
      render(); return;
    }

    appData.items.forEach(it => { if (it.module === oldName) it.module = newName; });

    // Sync moduleOrder
    if (!appData.moduleOrder) appData.moduleOrder = [...existing];
    const idx = appData.moduleOrder.indexOf(oldName);
    if (idx !== -1) {
      if (willMerge) appData.moduleOrder.splice(idx, 1);
      else           appData.moduleOrder[idx] = newName;
    }

    saveData();
    render();
  };

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  input.blur();
    if (e.key === 'Escape') { input.value = oldName; input.blur(); }
  });
  input.addEventListener('blur', finish);
}

// ============================================================
//  Module drag reorder
// ============================================================

function startModuleDrag(e, moduleName) {
  e.preventDefault();
  const allMods = getModules();
  const origIdx = allMods.indexOf(moduleName);
  moduleDragState = { moduleName, origIdx, targetIdx: origIdx };

  document.body.style.cursor = 'grabbing';
  const draggedSection = document.querySelector(`.module-section[data-module="${CSS.escape(moduleName)}"]`);
  if (draggedSection) draggedSection.classList.add('module-being-dragged');

  const onMove = me => {
    document.querySelectorAll('.module-section').forEach(s =>
      s.classList.remove('drop-before', 'drop-after'));
    const sections = [...document.querySelectorAll('.module-section')];
    let targetIdx = allMods.length;
    for (let i = 0; i < sections.length; i++) {
      const rect = sections[i].getBoundingClientRect();
      if (me.clientY < rect.top + rect.height / 2) {
        sections[i].classList.add('drop-before');
        targetIdx = i;
        break;
      }
      if (i === sections.length - 1) sections[i].classList.add('drop-after');
    }
    moduleDragState.targetIdx = targetIdx;
  };

  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
    document.body.style.cursor = '';
    document.querySelectorAll('.module-section').forEach(s =>
      s.classList.remove('drop-before', 'drop-after', 'module-being-dragged'));

    const { targetIdx } = moduleDragState;
    moduleDragState = null;

    // No-op if dropped on itself or immediately after itself
    if (targetIdx === origIdx || targetIdx === origIdx + 1) return;

    const mods = [...allMods];
    mods.splice(origIdx, 1);
    const insertAt = targetIdx > origIdx ? targetIdx - 1 : targetIdx;
    mods.splice(insertAt, 0, moduleName);
    appData.moduleOrder = mods;
    saveData();
    render();
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);
}

// ============================================================
//  Version indicator
// ============================================================

function updateVersionIndicator() {
  const el = document.getElementById('version-indicator');
  if (!el) return;
  const v  = appData.version || 1;
  const ts = appData.lastModified
    ? new Date(appData.lastModified).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
    : '';
  el.textContent = ts ? `v${v} · ${ts}` : `v${v}`;
}

// ============================================================
//  Escape HTML
// ============================================================

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
//  Init
// ============================================================

function init() {
  loadData();
  updateVersionIndicator();
  render();

  // Toolbar buttons
  document.getElementById('btn-add').addEventListener('click',             () => openModal());
  document.getElementById('btn-import').addEventListener('click',          () => document.getElementById('file-input').click());
  document.getElementById('btn-import-append').addEventListener('click',   () => document.getElementById('file-input-append').click());
  document.getElementById('btn-export').addEventListener('click',          exportCSV);
  document.getElementById('btn-download-sample').addEventListener('click', downloadSample);

  // Empty state buttons
  document.getElementById('btn-import-empty').addEventListener('click',    () => document.getElementById('file-input').click());
  document.getElementById('btn-add-empty').addEventListener('click',       () => openModal());

  // File input — full overwrite
  document.getElementById('file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    readCSVFile(file, (text) => {
      try { importCSV(text); }
      catch(err) { alert('加载失败：' + err.message + '\n\n请确保文件为 CSV 格式，可下载「示例」参考结构。'); }
    });
    e.target.value = '';
  });

  // File input — incremental append
  document.getElementById('file-input-append').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    readCSVFile(file, (text) => {
      try { importCSVAppend(text); }
      catch(err) { alert('增量导入失败：' + err.message); }
    });
    e.target.value = '';
  });

  // Modal close
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('btn-cancel').addEventListener('click',      closeModal);

  // Modal delete
  document.getElementById('btn-delete').addEventListener('click', () => {
    if (!editingItemId) return;
    if (!confirm('确认删除该条目？')) return;
    appData.items = appData.items.filter(i => i.id !== editingItemId);
    saveData();
    closeModal();
    render();
  });

  // Form submit
  document.getElementById('item-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form       = e.target;
    const startMonth = clamp(parseInt(form.startMonth.value) || 1, 1, 12);
    const duration   = clamp(parseInt(form.duration.value)   || 1, 1, 12 - toFiscalCol(startMonth));

    // Parse collaborators from comma-separated input
    const collaboratorsRaw = form.collaborators.value.trim();
    const collaborators = collaboratorsRaw
      ? collaboratorsRaw.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    if (editingItemId) {
      const it          = appData.items.find(i => i.id === editingItemId);
      it.module         = form.module.value.trim()       || '未分类';
      it.title          = form.title.value.trim()        || '未命名';
      it.problem        = form.problem.value.trim();
      it.description    = form.description.value.trim();
      it.outcome        = form.outcome.value.trim();
      it.collaborators  = collaborators;
      it.author         = form.author.value.trim();
      it.startMonth     = startMonth;
      it.duration       = duration;
    } else {
      appData.items.push({
        id:            generateId(),
        module:        form.module.value.trim()      || '未分类',
        title:         form.title.value.trim()       || '未命名',
        problem:       form.problem.value.trim(),
        description:   form.description.value.trim(),
        outcome:       form.outcome.value.trim(),
        collaborators,
        author:        form.author.value.trim(),
        startMonth,
        duration
      });
    }

    saveData();
    closeModal();
    render();
  });

  // Live preview in modal
  ['startMonth', 'duration', 'module'].forEach(name => {
    document.getElementById('item-form')[name].addEventListener('input', updatePreviewBar);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
      e.preventDefault();
      openModal();
    }
  });

  // Hide tooltip when scrolling
  document.querySelector('.roadmap-wrapper').addEventListener('scroll', hideTooltip, { passive: true });
}

document.addEventListener('DOMContentLoaded', init);
