/**
 * EVYD Product Roadmap — app.js
 * Pure vanilla JS, no dependencies.
 * Data persists in Vercel Blob (remote). UI preferences in localStorage.
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

const DEV_TYPE_CONFIG = {
  'New Contract': { abbr: 'NC',   bg: '#10B981', fg: '#fff' },
  'R&D':          { abbr: 'R&D',  bg: '#8B5CF6', fg: '#fff' },
  'Maintenance':  { abbr: 'Mnt',  bg: '#F97316', fg: '#fff' },
};

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
// Data stored remotely via /api/data — no localStorage for app data
const API_URL        = '/api/data';
const COLLAPSED_KEY  = 'evyd_roadmap_collapsed';
const LABEL_WIDTH_KEY = 'evyd_roadmap_label_width';

// ============================================================
//  State
// ============================================================

let appData = {
  version: 1,
  lastModified: new Date().toISOString(),
  moduleOrder: [],   // explicit display order of module names
  pillarOrder: [],   // explicit display order of pillar names
  projectOrder: [],  // explicit display order of project names
  items: []
};

let moduleColorMap  = {};   // module name → color object
let pillarColorMap  = {};   // pillar name → color object
let projectColorMap = {};   // project name → color object
let teamColorMap    = {};   // team name → hex color string
let collapsedModules = {};  // module/pillar key → bool
let editingItemId    = null;
let dragState        = null; // null | { type, item, bar, startX, origValue, moved }
let moduleDragState  = null; // null | { moduleName, origIdx, targetIdx }
let tooltipHideTimer = null;
let lastDragMoved    = false; // persists through mouseup→click cycle

// View & filter state
let activeView      = 'value';    // 'value' | 'project'
let filterAuthors   = new Set();  // selected author filter values
let filterTeams     = new Set();  // selected team filter values
let filterDevTypes  = new Set();  // selected dev type filter values

// ============================================================
//  Persistence
// ============================================================

async function loadData() {
  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    appData = await res.json();
    // Ensure every item has an id
    appData.items.forEach(it => { if (!it.id) it.id = generateId(); });
  } catch(e) {
    console.warn('Failed to load remote data, using empty dataset:', e);
    // Keep default appData
  }
  // Back-compat fields
  if (!appData.version)      appData.version      = 0;
  if (!appData.lastModified) appData.lastModified = new Date().toISOString();
  if (!appData.moduleOrder)  appData.moduleOrder  = [];
  if (!appData.pillarOrder)  appData.pillarOrder  = [];
  if (!appData.projectOrder) appData.projectOrder = [];
  // Collapsed state stays in localStorage (UI preference only)
  const c = localStorage.getItem(COLLAPSED_KEY);
  if (c) collapsedModules = JSON.parse(c);
}

async function saveData() {
  appData.version      = (appData.version || 0) + 1;
  appData.lastModified = new Date().toISOString();
  updateVersionIndicator();
  try {
    const res = await fetch(API_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(appData)
    });
    if (res.status === 409) {
      const err = await res.json();
      if (confirm('数据已被他人更新（远程版本 v' + err.remoteVersion + '）。\n是否刷新页面获取最新数据？\n\n点击「取消」可先导出 CSV 备份当前内容。')) {
        location.reload();
      }
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch(e) {
    console.error('Save failed:', e);
    alert('保存失败，请检查网络连接后重试。');
  }
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
function getModules(items) {
  const src = items || appData.items;
  const all = [...new Set(src.map(it => it.module))];
  if (appData.moduleOrder && appData.moduleOrder.length) {
    const ordered = appData.moduleOrder.filter(m => all.includes(m));
    all.forEach(m => { if (!ordered.includes(m)) ordered.push(m); });
    return ordered;
  }
  // Fallback: insertion order from items
  const seen = new Set(), out = [];
  src.forEach(it => { if (!seen.has(it.module)) { seen.add(it.module); out.push(it.module); } });
  return out;
}

/** Return unique pillar names, respecting explicit pillarOrder when set */
function getPillars(items) {
  const src = items || appData.items;
  const all = [...new Set(src.map(it => it.pillar || '未分配'))];
  if (appData.pillarOrder && appData.pillarOrder.length) {
    const ordered = appData.pillarOrder.filter(p => all.includes(p));
    all.forEach(p => { if (!ordered.includes(p)) ordered.push(p); });
    return ordered;
  }
  const seen = new Set(), out = [];
  src.forEach(it => {
    const p = it.pillar || '未分配';
    if (!seen.has(p)) { seen.add(p); out.push(p); }
  });
  return out;
}

/** Return unique project names, respecting explicit projectOrder when set */
function getProjects(items) {
  const src = items || appData.items;
  const all = [...new Set(src.map(it => it.project || '未分配'))];
  if (appData.projectOrder && appData.projectOrder.length) {
    const ordered = appData.projectOrder.filter(p => all.includes(p));
    all.forEach(p => { if (!ordered.includes(p)) ordered.push(p); });
    return ordered;
  }
  const seen = new Set(), out = [];
  src.forEach(it => {
    const p = it.project || '未分配';
    if (!seen.has(p)) { seen.add(p); out.push(p); }
  });
  return out;
}

/** Auto-assign colors per module, pillar, and project (stable within a session) */
function rebuildColorMap() {
  moduleColorMap = {};
  getModules().forEach((m, i) => {
    moduleColorMap[m] = MODULE_COLORS[i % MODULE_COLORS.length];
  });
  pillarColorMap = {};
  getPillars().forEach((p, i) => {
    pillarColorMap[p] = MODULE_COLORS[i % MODULE_COLORS.length];
  });
  projectColorMap = {};
  getProjects().forEach((p, i) => {
    projectColorMap[p] = MODULE_COLORS[i % MODULE_COLORS.length];
  });
  rebuildTeamColorMap();
}

function getModuleColor(moduleName) {
  return moduleColorMap[moduleName] || MODULE_COLORS[0];
}

function getPillarColor(pillarName) {
  return pillarColorMap[pillarName] || MODULE_COLORS[0];
}

function getProjectColor(projectName) {
  return projectColorMap[projectName] || MODULE_COLORS[0];
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

/** Return items filtered by active author/team/devType filters */
function getFilteredItems() {
  return appData.items.filter(item => {
    if (filterAuthors.size > 0) {
      const authors = String(item.author || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);
      if (!authors.some(a => filterAuthors.has(a))) return false;
    }
    if (filterTeams.size > 0) {
      const teams = Array.isArray(item.collaborators) ? item.collaborators : [];
      if (!teams.some(t => filterTeams.has(t))) return false;
    }
    if (filterDevTypes.size > 0) {
      if (!filterDevTypes.has(item.devType || '')) return false;
    }
    return true;
  });
}

/** Rebuild filter panel HTML and update badges/tab states */
function refreshFilterUI() {
  // Collect all unique authors from ALL items (not filtered)
  const allAuthors = new Set();
  appData.items.forEach(it => {
    String(it.author || '').split(/[,;]/).map(s => s.trim()).filter(Boolean).forEach(a => allAuthors.add(a));
  });

  // Collect all unique teams from teamColorMap (built from ALL items)
  const allTeams = new Set(Object.keys(teamColorMap));

  // Rebuild author panel
  const authorPanel = document.getElementById('filter-author-panel');
  if (authorPanel) {
    const sorted = [...allAuthors].sort();
    if (sorted.length === 0) {
      authorPanel.innerHTML = '<div class="filter-empty-hint">暂无数据</div>';
    } else {
      authorPanel.innerHTML =
        sorted.map(a => `<label class="filter-option"><input type="checkbox" value="${esc(a)}"${filterAuthors.has(a) ? ' checked' : ''}>${esc(a)}</label>`).join('') +
        (filterAuthors.size > 0 ? '<div class="filter-panel-actions"><button class="filter-clear" data-target="author">清除筛选</button></div>' : '');
    }
  }

  // Rebuild team panel
  const teamPanel = document.getElementById('filter-team-panel');
  if (teamPanel) {
    const sorted = [...allTeams].sort();
    if (sorted.length === 0) {
      teamPanel.innerHTML = '<div class="filter-empty-hint">暂无数据</div>';
    } else {
      teamPanel.innerHTML =
        sorted.map(t => `<label class="filter-option"><input type="checkbox" value="${esc(t)}"${filterTeams.has(t) ? ' checked' : ''}>${esc(t)}</label>`).join('') +
        (filterTeams.size > 0 ? '<div class="filter-panel-actions"><button class="filter-clear" data-target="team">清除筛选</button></div>' : '');
    }
  }

  // Rebuild dev type panel
  const devTypePanel = document.getElementById('filter-devtype-panel');
  if (devTypePanel) {
    const allDevTypes = [...new Set(appData.items.map(it => it.devType || '').filter(Boolean))].sort();
    if (allDevTypes.length === 0) {
      devTypePanel.innerHTML = '<div class="filter-empty-hint">暂无数据</div>';
    } else {
      devTypePanel.innerHTML =
        allDevTypes.map(d => {
          const cfg = DEV_TYPE_CONFIG[d] || { abbr: d.slice(0,3), bg: '#94A3B8', fg: '#fff' };
          return `<label class="filter-option"><input type="checkbox" value="${esc(d)}"${filterDevTypes.has(d) ? ' checked' : ''}><span class="devtype-badge" style="background:${cfg.bg};color:${cfg.fg}">${cfg.abbr}</span>${esc(d)}</label>`;
        }).join('') +
        (filterDevTypes.size > 0 ? '<div class="filter-panel-actions"><button class="filter-clear" data-target="devtype">清除筛选</button></div>' : '');
    }
  }

  // Update badges and active state
  const authorCount = document.getElementById('filter-author-count');
  const authorBtn   = document.getElementById('filter-author-btn');
  if (authorCount) { authorCount.textContent = filterAuthors.size; authorCount.classList.toggle('hidden', filterAuthors.size === 0); }
  if (authorBtn)   authorBtn.classList.toggle('active', filterAuthors.size > 0);

  const teamCount = document.getElementById('filter-team-count');
  const teamBtn   = document.getElementById('filter-team-btn');
  if (teamCount) { teamCount.textContent = filterTeams.size; teamCount.classList.toggle('hidden', filterTeams.size === 0); }
  if (teamBtn)   teamBtn.classList.toggle('active', filterTeams.size > 0);

  const devTypeCount = document.getElementById('filter-devtype-count');
  const devTypeBtn   = document.getElementById('filter-devtype-btn');
  if (devTypeCount) { devTypeCount.textContent = filterDevTypes.size; devTypeCount.classList.toggle('hidden', filterDevTypes.size === 0); }
  if (devTypeBtn)   devTypeBtn.classList.toggle('active', filterDevTypes.size > 0);

  // Update view tabs
  document.querySelectorAll('.view-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === activeView);
  });
}

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

  const body  = document.getElementById('roadmap-body');
  const empty = document.getElementById('empty-state');

  buildMonthHeader();

  if (appData.items.length === 0) {
    body.innerHTML = '';
    empty.style.display = 'flex';
    refreshFilterUI();
    return;
  }
  empty.style.display = 'none';
  body.innerHTML = '';

  const cornerEl = document.getElementById('corner-text');
  if (cornerEl) cornerEl.textContent = activeView === 'value' ? 'Pillar / 月份' : 'Project / 月份';

  const filtered = getFilteredItems();

  if (activeView === 'value') {
    renderValueView(filtered, body);
  } else {
    renderProjectView(filtered, body);
  }

  renderTodayLines();
  refreshFilterUI();
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

// ============================================================
//  Two-level view rendering
// ============================================================

function renderValueView(filtered, body) {
  getPillars(filtered).forEach(pillarName => {
    const pillarItems = filtered.filter(it => (it.pillar || '未分配') === pillarName);
    renderValuePillar(pillarName, pillarItems, body);
  });
}

function renderValuePillar(pillarName, items, container) {
  const color      = getPillarColor(pillarName);
  const colKey     = '__pillar__' + pillarName;
  const collapsed  = !!collapsedModules[colKey];
  const pillarValue = items.find(it => it.pillarValue)?.pillarValue || '';

  const section = document.createElement('div');
  section.className = 'module-section';
  section.dataset.pillar = pillarName;

  const headerRow = document.createElement('div');
  headerRow.className = 'module-header-row grid-row';
  headerRow.innerHTML = `
    <div class="label-col module-label-cell" style="border-left:4px solid ${color.bg}">
      <span class="module-drag-handle pillar-drag-handle" title="拖拽排序">⠿</span>
      <span class="collapse-icon">${collapsed ? '▶' : '▼'}</span>
      <span class="module-name-text" title="${esc(pillarName)}">${esc(pillarName)}</span>
      <span class="module-badge">${items.length}</span>
      <button class="module-rename-btn" title="重命名 Pillar">✎</button>
    </div>
    <div class="module-header-timeline outer-header-timeline">
      ${Array.from({length:12}, () => `<div class="month-cell"></div>`).join('')}
      ${pillarValue ? `<div class="outer-header-desc"><span title="${esc(pillarValue)}">${esc(pillarValue)}</span></div>` : ''}
    </div>
  `;

  headerRow.querySelector('.label-col').addEventListener('click', () => {
    collapsedModules[colKey] = !collapsed;
    saveCollapsed();
    render();
  });
  headerRow.querySelector('.pillar-drag-handle').addEventListener('mousedown', e => {
    e.stopPropagation();
    startPillarDrag(e, pillarName);
  });
  headerRow.querySelector('.module-rename-btn').addEventListener('click', e => {
    e.stopPropagation();
    startPillarRename(pillarName, headerRow.querySelector('.module-name-text'));
  });

  // Pillar value inline edit — click the description span
  const descSpan = headerRow.querySelector('.outer-header-desc span');
  if (descSpan) {
    descSpan.style.pointerEvents = 'all';
    descSpan.style.cursor = 'text';
    descSpan.addEventListener('click', e => {
      e.stopPropagation();
      startPillarValueEdit(pillarName, pillarValue, descSpan);
    });
  } else {
    // No description yet — clicking timeline area starts edit
    const descOverlay = headerRow.querySelector('.outer-header-desc');
    if (descOverlay) {
      descOverlay.style.pointerEvents = 'all';
      descOverlay.style.cursor = 'text';
      descOverlay.addEventListener('click', e => {
        e.stopPropagation();
        startPillarValueEdit(pillarName, pillarValue, null);
      });
    }
  }

  section.appendChild(headerRow);

  if (!collapsed) {
    getProjects(items).forEach(projectName => {
      const projectItems = items.filter(it => (it.project || '未分配') === projectName);
      const innerKey = '__inner__' + colKey + '::' + projectName;
      section.appendChild(renderInnerGroup(projectName, projectItems, innerKey, color));
    });
  }

  container.appendChild(section);
}

function renderProjectView(filtered, body) {
  getProjects(filtered).forEach(projectName => {
    const projectItems = filtered.filter(it => (it.project || '未分配') === projectName);
    renderProjectOuter(projectName, projectItems, body);
  });
}

function renderProjectOuter(projectName, items, container) {
  const color     = getProjectColor(projectName);
  const colKey    = '__project__' + projectName;
  const collapsed = !!collapsedModules[colKey];

  const section = document.createElement('div');
  section.className = 'module-section';
  section.dataset.project = projectName;

  const headerRow = document.createElement('div');
  headerRow.className = 'module-header-row grid-row';
  headerRow.innerHTML = `
    <div class="label-col module-label-cell" style="border-left:4px solid ${color.bg}">
      <span class="module-drag-handle project-drag-handle" title="拖拽排序">⠿</span>
      <span class="collapse-icon">${collapsed ? '▶' : '▼'}</span>
      <span class="module-name-text" title="${esc(projectName)}">${esc(projectName)}</span>
      <span class="module-badge">${items.length}</span>
      <button class="module-rename-btn" title="重命名 Project">✎</button>
    </div>
    <div class="module-header-timeline">
      ${Array.from({length:12}, () => `<div class="month-cell"></div>`).join('')}
    </div>
  `;

  headerRow.querySelector('.label-col').addEventListener('click', () => {
    collapsedModules[colKey] = !collapsed;
    saveCollapsed();
    render();
  });
  headerRow.querySelector('.project-drag-handle').addEventListener('mousedown', e => {
    e.stopPropagation();
    startProjectDrag(e, projectName);
  });
  headerRow.querySelector('.module-rename-btn').addEventListener('click', e => {
    e.stopPropagation();
    startProjectRename(projectName, headerRow.querySelector('.module-name-text'));
  });

  section.appendChild(headerRow);

  if (!collapsed) {
    getModules(items).forEach(moduleName => {
      const moduleItems = items.filter(it => it.module === moduleName);
      const innerKey = '__inner__' + colKey + '::' + moduleName;
      section.appendChild(renderInnerGroup(moduleName, moduleItems, innerKey, getModuleColor(moduleName)));
    });
  }

  container.appendChild(section);
}

/** Shared inner group renderer (project within pillar, or module within project) */
function renderInnerGroup(name, items, colKey, color) {
  const collapsed = !!collapsedModules[colKey];

  const group = document.createElement('div');
  group.className = 'inner-group';

  const headerRow = document.createElement('div');
  headerRow.className = 'grid-row inner-header-row';
  headerRow.innerHTML = `
    <div class="label-col inner-label-cell" style="border-left:3px solid ${color.bg}">
      <span class="collapse-icon">${collapsed ? '▶' : '▼'}</span>
      <span class="inner-name-text" title="${esc(name)}">${esc(name)}</span>
      <span class="module-badge">${items.length}</span>
    </div>
    <div class="inner-header-timeline">
      ${Array.from({length:12}, () => `<div class="month-cell"></div>`).join('')}
    </div>
  `;

  headerRow.querySelector('.label-col').addEventListener('click', () => {
    collapsedModules[colKey] = !collapsed;
    saveCollapsed();
    render();
  });

  group.appendChild(headerRow);

  if (!collapsed && items.length > 0) {
    const { rows: itemRowMap, rowCount } = packRows(items);
    const areaHeight = rowCount * ROW_HEIGHT + 8;

    const itemsRow = document.createElement('div');
    itemsRow.className = 'items-row grid-row';
    itemsRow.style.height = areaHeight + 'px';

    const curCalMonth = new Date().getMonth() + 1;
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
      layer.appendChild(createBar(item, getModuleColor(item.module), row));
    });

    group.appendChild(itemsRow);
  }

  return group;
}

function startPillarDrag(e, pillarName) {
  e.preventDefault();
  const allPillars = getPillars();
  const origIdx    = allPillars.indexOf(pillarName);
  moduleDragState  = { moduleName: pillarName, origIdx, targetIdx: origIdx };

  document.body.style.cursor = 'grabbing';
  const draggedSection = document.querySelector(`.module-section[data-pillar="${CSS.escape(pillarName)}"]`);
  if (draggedSection) draggedSection.classList.add('module-being-dragged');

  const onMove = me => {
    document.querySelectorAll('.module-section').forEach(s =>
      s.classList.remove('drop-before', 'drop-after'));
    const sections = [...document.querySelectorAll('.module-section')];
    let targetIdx = allPillars.length;
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

  const onUp = async () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
    document.body.style.cursor = '';
    document.querySelectorAll('.module-section').forEach(s =>
      s.classList.remove('drop-before', 'drop-after', 'module-being-dragged'));

    const { targetIdx } = moduleDragState;
    moduleDragState = null;

    if (targetIdx === origIdx || targetIdx === origIdx + 1) return;

    const pillars = [...allPillars];
    pillars.splice(origIdx, 1);
    const insertAt = targetIdx > origIdx ? targetIdx - 1 : targetIdx;
    pillars.splice(insertAt, 0, pillarName);
    appData.pillarOrder = pillars;
    await saveData();
    render();
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);
}

function startPillarRename(oldName, nameSpan) {
  const input = document.createElement('input');
  input.className = 'module-name-input';
  input.value = oldName;
  nameSpan.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = async () => {
    if (done) return;
    done = true;
    const newName = input.value.trim() || oldName;
    if (newName === oldName) { render(); return; }

    const existing = getPillars();
    const willMerge = existing.includes(newName);
    if (willMerge && !confirm(`"${newName}" 已存在，确定将 "${oldName}" 合并进去？`)) {
      render(); return;
    }

    appData.items.forEach(it => {
      if ((it.pillar || '未分配') === oldName) it.pillar = newName === '未分配' ? '' : newName;
    });

    if (!appData.pillarOrder) appData.pillarOrder = [...existing];
    const idx = appData.pillarOrder.indexOf(oldName);
    if (idx !== -1) {
      if (willMerge) appData.pillarOrder.splice(idx, 1);
      else           appData.pillarOrder[idx] = newName;
    }

    await saveData();
    render();
  };

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  input.blur();
    if (e.key === 'Escape') { input.value = oldName; input.blur(); }
  });
  input.addEventListener('blur', finish);
}

function startPillarValueEdit(pillarName, currentValue, spanEl) {
  const input = document.createElement('input');
  input.className = 'pillar-value-input';
  input.value = currentValue;
  input.placeholder = '输入 Pillar 战略价值描述…';

  if (spanEl) {
    spanEl.replaceWith(input);
  } else {
    // No existing span — find the desc overlay and inject input
    const overlay = document.querySelector(`.module-section[data-pillar="${CSS.escape(pillarName)}"] .outer-header-desc`);
    if (overlay) overlay.appendChild(input);
    else { render(); return; }
  }

  input.focus();
  input.select();

  let done = false;
  const finish = async () => {
    if (done) return;
    done = true;
    const newValue = input.value.trim();
    // Update pillarValue on all items belonging to this pillar
    appData.items.forEach(it => {
      if ((it.pillar || '未分配') === pillarName) it.pillarValue = newValue;
    });
    await saveData();
    render();
  };

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  input.blur();
    if (e.key === 'Escape') { done = true; render(); }
  });
  input.addEventListener('blur', finish);
}

function startProjectDrag(e, projectName) {
  e.preventDefault();
  const allProjects = getProjects();
  const origIdx     = allProjects.indexOf(projectName);
  moduleDragState   = { moduleName: projectName, origIdx, targetIdx: origIdx };

  document.body.style.cursor = 'grabbing';
  const draggedSection = document.querySelector(`.module-section[data-project="${CSS.escape(projectName)}"]`);
  if (draggedSection) draggedSection.classList.add('module-being-dragged');

  const onMove = me => {
    document.querySelectorAll('.module-section').forEach(s =>
      s.classList.remove('drop-before', 'drop-after'));
    const sections = [...document.querySelectorAll('.module-section')];
    let targetIdx = allProjects.length;
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

  const onUp = async () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
    document.body.style.cursor = '';
    document.querySelectorAll('.module-section').forEach(s =>
      s.classList.remove('drop-before', 'drop-after', 'module-being-dragged'));

    const { targetIdx } = moduleDragState;
    moduleDragState = null;

    if (targetIdx === origIdx || targetIdx === origIdx + 1) return;
    const newOrder = [...allProjects];
    newOrder.splice(origIdx, 1);
    const insertAt = targetIdx > origIdx ? targetIdx - 1 : targetIdx;
    newOrder.splice(insertAt, 0, projectName);
    appData.projectOrder = newOrder;
    await saveData();
    render();
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);
}

function startProjectRename(oldName, nameSpan) {
  const input = document.createElement('input');
  input.className = 'module-name-input';
  input.value = oldName;
  nameSpan.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = async () => {
    if (done) return;
    done = true;
    const newName = input.value.trim() || oldName;
    if (newName === oldName) { render(); return; }

    const existing = getProjects();
    const willMerge = existing.includes(newName);
    if (willMerge && !confirm(`"${newName}" 已存在，确定将 "${oldName}" 合并进去？`)) {
      render(); return;
    }

    appData.items.forEach(it => {
      if ((it.project || '未分配') === oldName) it.project = newName === '未分配' ? '' : newName;
    });

    if (!appData.projectOrder) appData.projectOrder = [...existing];
    const idx = appData.projectOrder.indexOf(oldName);
    if (idx !== -1) {
      if (willMerge) appData.projectOrder.splice(idx, 1);
      else           appData.projectOrder[idx] = newName;
    }

    await saveData();
    render();
  };

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  input.blur();
    if (e.key === 'Escape') { input.value = oldName; input.blur(); }
  });
  input.addEventListener('blur', finish);
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

function devTypeBadgeHtml(devType) {
  if (!devType) return '';
  const cfg = DEV_TYPE_CONFIG[devType] || { abbr: devType.slice(0, 3), bg: '#94A3B8', fg: '#fff' };
  return `<span class="devtype-badge" style="background:${cfg.bg};color:${cfg.fg}" title="${esc(devType)}">${cfg.abbr}</span>`;
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
        ${devTypeBadgeHtml(item.devType)}
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

  const onUp = async () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
    bar.classList.remove('dragging');
    document.body.style.cursor = '';

    const newStart = parseInt(bar.dataset.pendingStart || origCalMonth);
    if (newStart !== origCalMonth) {
      item.startMonth = newStart;
      await saveData();
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

  const onUp = async () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
    bar.classList.remove('resizing');
    document.body.style.cursor = '';

    const newDur = parseInt(bar.dataset.pendingDur || origDur);
    if (newDur !== origDur) {
      item.duration = newDur;
      await saveData();
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

  const devTypeRow = document.getElementById('tt-devtype-row');
  const devTypeEl  = document.getElementById('tt-devtype');
  if (item.devType && item.devType.trim()) {
    const cfg = DEV_TYPE_CONFIG[item.devType] || { abbr: item.devType.slice(0,3), bg: '#94A3B8', fg: '#fff' };
    devTypeEl.innerHTML = `<span class="devtype-badge" style="background:${cfg.bg};color:${cfg.fg}">${cfg.abbr}</span> ${esc(item.devType)}`;
    devTypeRow.classList.remove('hidden');
  } else {
    devTypeRow.classList.add('hidden');
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
    form.pillar.value        = it.pillar       || '';
    form.project.value       = it.project      || '';
    form.title.value         = it.title;
    form.problem.value       = it.problem      || '';
    form.description.value   = it.description  || '';
    form.outcome.value       = it.outcome      || '';
    form.collaborators.value = Array.isArray(it.collaborators) ? it.collaborators.join(', ') : '';
    form.author.value        = it.author || '';
    form.devType.value       = it.devType || '';
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

// Encode a CSV string as UTF-8 with BOM — compatible with Excel on both Mac and Windows
function csvToBlob(csvText) {
  // UTF-8 BOM = EF BB BF; tells Excel to interpret the file as UTF-8
  const bom = '\uFEFF';
  return new Blob([bom + csvText], { type: 'text/csv;charset=utf-8' });
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
  // Accept new Excel-style column names
  if (!it.title       && it.feature)                it.title       = it.feature;
  if (!it.problem     && it['feature problem'])      it.problem     = it['feature problem'];
  if (!it.description && it['feature description']) it.description = it['feature description'];
  if (!it.outcome     && it['feature outcome'])      it.outcome     = it['feature outcome'];
  // Accept legacy alias column names
  if (!it.module      && it.Module)      it.module      = it.Module;
  if (!it.pillar      && it.Pillar)      it.pillar      = it.Pillar;
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
  if (!it.pillar)      it.pillar      = '';
  if (!it.title)       it.title       = '未命名';
  if (!it.description) it.description = '';
  if (!it.author)      it.author      = '';
  it.pillarValue = (it['pillar values'] || it.pillarValue || '').trim();
  it.devType     = (it['dev type']      || it.devType     || '').trim();
  it.project     = (it.project || '').trim();
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

async function importCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) throw new Error('CSV 无有效数据行');
  appData.items = rows.map(normaliseItem);
  appData.moduleOrder = []; // derive fresh order from import sequence
  await saveData();
  render();
}

async function importCSVAppend(text) {
  const rows = parseCSV(text);
  if (!rows.length) throw new Error('CSV 无有效数据行');
  const newItems = rows.map(normaliseItem);
  appData.items = appData.items.concat(newItems);
  await saveData();
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
  const HEADERS = ['pillar','pillar values','project','module','feature','feature problem','feature description','feature outcome','author','collaborators','startMonth','duration','dev type'];
  const FIELD_MAP = { 'feature': 'title', 'feature problem': 'problem', 'feature description': 'description', 'feature outcome': 'outcome', 'pillar values': 'pillarValue', 'dev type': 'devType' };
  const rows = [
    HEADERS.join(','),
    ...appData.items.map(it => HEADERS.map(h => {
      const key = FIELD_MAP[h] || h;
      const v = key === 'collaborators'
        ? (Array.isArray(it[key]) ? it[key].join(';') : (it[key] || ''))
        : (it[key] ?? '');
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
  const HEADERS = ['pillar','pillar values','project','module','feature','feature problem','feature description','feature outcome','author','collaborators','startMonth','duration','dev type'];
  const items = [
    { pillar: '用户健康体验', 'pillar values': '通过个性化健康管理提升用户留存与参与度', project: '健康工具', module: '健康管理', 'feature': 'Routines 减重计划',  'feature problem': '用户缺乏科学减重方案，依从性低',       'feature description': '设计基于目标体重的阶段性打卡计划，结合 AI 动态调整运动与饮食建议',  'feature outcome': '30天留存提升25%，减重打卡完成率≥70%',  collaborators: '医学团队;内容团队',  author: 'Lynn',     startMonth: 4,  duration: 3, 'dev type': 'R&D' },
    { pillar: '用户健康体验', 'pillar values': '通过个性化健康管理提升用户留存与参与度', project: '健康工具', module: '健康管理', 'feature': '营养餐食推荐引擎',   'feature problem': '通用食谱不满足个体差异',              'feature description': '基于用户健康档案、过敏史和偏好构建个性化食谱推荐模型',              'feature outcome': '个性化推荐满意度≥4.2分',              collaborators: '医学团队;数据团队',  author: 'Ned',      startMonth: 7,  duration: 2, 'dev type': 'R&D' },
    { pillar: '本地化增长',   'pillar values': '建立本地生态护城河，提升文莱市场渗透率',   project: '本地运营', module: '本地活动', 'feature': '文莱 QR Code 寻宝', 'feature problem': '缺乏线下互动，用户活跃度低',          'feature description': '在文莱核心商圈布置实体 QR 码任务点，用户扫码解锁奖励',    'feature outcome': '活动期间 DAU 提升40%',                collaborators: 'Ops Team;市场团队', author: 'Lynn',     startMonth: 5,  duration: 2, 'dev type': 'New Contract' },
    { pillar: '本地化增长',   'pillar values': '建立本地生态护城河，提升文莱市场渗透率',   project: '本地运营', module: '本地活动', 'feature': '线下合作商户接入',   'feature problem': '无本地商户生态，变现路径单一',          'feature description': '搭建商户入驻平台，支持优惠券核销、积分兑换与联合营销活动',        'feature outcome': '接入≥50家商户，GMV+100K/月',          collaborators: 'Ops Team;商务团队', author: 'Ned;Lynn', startMonth: 8,  duration: 3, 'dev type': 'New Contract' },
    { pillar: '平台可靠性',   'pillar values': '保障系统稳定性与安全合规，降低运维风险',   project: '基础升级', module: '基础架构', 'feature': 'API 网关升级',       'feature problem': '旧网关无法支撑高并发，运维成本高',     'feature description': '迁移至云原生 API 网关，接入限流熔断、灰度发布与全链路监控',        'feature outcome': '吞吐量提升3倍，故障率降低70%',         collaborators: '运维团队',           author: 'Lynn',     startMonth: 4,  duration: 2, 'dev type': 'Maintenance' },
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
  const finish = async () => {
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

    await saveData();
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

  const onUp = async () => {
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
    await saveData();
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

async function init() {
  await loadData();
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
  document.getElementById('btn-delete').addEventListener('click', async () => {
    if (!editingItemId) return;
    if (!confirm('确认删除该条目？')) return;
    appData.items = appData.items.filter(i => i.id !== editingItemId);
    await saveData();
    closeModal();
    render();
  });

  // Form submit
  document.getElementById('item-form').addEventListener('submit', async (e) => {
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
      it.pillar         = form.pillar.value.trim();
      it.project        = form.project.value.trim();
      it.title          = form.title.value.trim()        || '未命名';
      it.problem        = form.problem.value.trim();
      it.description    = form.description.value.trim();
      it.outcome        = form.outcome.value.trim();
      it.collaborators  = collaborators;
      it.author         = form.author.value.trim();
      it.devType        = form.devType.value;
      it.startMonth     = startMonth;
      it.duration       = duration;
    } else {
      appData.items.push({
        id:            generateId(),
        module:        form.module.value.trim()      || '未分类',
        pillar:        form.pillar.value.trim(),
        project:       form.project.value.trim(),
        title:         form.title.value.trim()       || '未命名',
        problem:       form.problem.value.trim(),
        description:   form.description.value.trim(),
        outcome:       form.outcome.value.trim(),
        collaborators,
        author:        form.author.value.trim(),
        devType:       form.devType.value,
        pillarValue:   '',
        project:       '',
        startMonth,
        duration
      });
    }

    await saveData();
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

  // ---- View switcher ----
  document.getElementById('view-tabs').addEventListener('click', e => {
    const tab = e.target.closest('.view-tab');
    if (!tab) return;
    activeView = tab.dataset.view;
    render();
  });

  // ---- Filter button toggles ----
  function togglePanel(panelId) {
    const panel = document.getElementById(panelId);
    const isHidden = panel.classList.contains('hidden');
    document.querySelectorAll('.filter-dropdown-panel').forEach(p => p.classList.add('hidden'));
    if (isHidden) panel.classList.remove('hidden');
  }

  document.getElementById('filter-author-btn').addEventListener('click', e => {
    e.stopPropagation();
    togglePanel('filter-author-panel');
  });

  document.getElementById('filter-team-btn').addEventListener('click', e => {
    e.stopPropagation();
    togglePanel('filter-team-panel');
  });

  document.getElementById('filter-devtype-btn').addEventListener('click', e => {
    e.stopPropagation();
    togglePanel('filter-devtype-panel');
  });

  // Close panels when clicking outside
  document.addEventListener('click', () => {
    document.querySelectorAll('.filter-dropdown-panel').forEach(p => p.classList.add('hidden'));
  });

  // Prevent panel clicks from closing the panel (covers all panels including devtype)
  document.querySelectorAll('.filter-dropdown-panel').forEach(p => {
    p.addEventListener('click', e => e.stopPropagation());
  });

  // Filter checkbox changes (delegated — survives innerHTML rebuilds)
  document.getElementById('filter-author-panel').addEventListener('change', e => {
    if (e.target.type === 'checkbox') {
      if (e.target.checked) filterAuthors.add(e.target.value);
      else filterAuthors.delete(e.target.value);
      render();
    }
  });

  document.getElementById('filter-team-panel').addEventListener('change', e => {
    if (e.target.type === 'checkbox') {
      if (e.target.checked) filterTeams.add(e.target.value);
      else filterTeams.delete(e.target.value);
      render();
    }
  });

  // Clear filter buttons (delegated)
  document.getElementById('filter-author-panel').addEventListener('click', e => {
    if (e.target.classList.contains('filter-clear')) {
      filterAuthors.clear();
      render();
    }
  });

  document.getElementById('filter-team-panel').addEventListener('click', e => {
    if (e.target.classList.contains('filter-clear')) {
      filterTeams.clear();
      render();
    }
  });

  document.getElementById('filter-devtype-panel').addEventListener('change', e => {
    if (e.target.type === 'checkbox') {
      if (e.target.checked) filterDevTypes.add(e.target.value);
      else filterDevTypes.delete(e.target.value);
      render();
    }
  });

  document.getElementById('filter-devtype-panel').addEventListener('click', e => {
    if (e.target.classList.contains('filter-clear')) {
      filterDevTypes.clear();
      render();
    }
  });

  // ---- Label column resize ----
  const savedLabelWidth = localStorage.getItem(LABEL_WIDTH_KEY);
  if (savedLabelWidth) {
    document.documentElement.style.setProperty('--label-width', savedLabelWidth + 'px');
  }

  const resizeHandle = document.getElementById('label-col-resize-handle');
  resizeHandle.addEventListener('mousedown', e => {
    e.preventDefault();
    resizeHandle.classList.add('resizing');
    document.body.style.cursor = 'col-resize';

    const startX     = e.clientX;
    const startWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--label-width')) || 160;

    const onMove = me => {
      const newWidth = Math.max(120, Math.min(400, startWidth + (me.clientX - startX)));
      document.documentElement.style.setProperty('--label-width', newWidth + 'px');
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      resizeHandle.classList.remove('resizing');
      document.body.style.cursor = '';
      const finalWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--label-width'));
      localStorage.setItem(LABEL_WIDTH_KEY, finalWidth);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

document.addEventListener('DOMContentLoaded', () => init());
