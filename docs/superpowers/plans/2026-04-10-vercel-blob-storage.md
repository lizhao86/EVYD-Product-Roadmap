# Vercel Blob Remote Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace localStorage data persistence with Vercel Blob remote storage so multiple team members share one roadmap dataset.

**Architecture:** Add a Vercel Serverless Function (`api/data.js`) that reads/writes a JSON blob via `@vercel/blob`. Frontend `loadData()`/`saveData()` become async fetch calls with optimistic locking (version check). localStorage retained only for UI preferences (collapsed state, label width).

**Tech Stack:** Vanilla JS (no changes), Vercel Serverless Functions (Node.js), `@vercel/blob` SDK

---

### Task 1: Create package.json and vercel.json

**Files:**
- Create: `package.json`
- Create: `vercel.json`

- [ ] **Step 1: Create package.json**

```json
{
  "private": true,
  "dependencies": {
    "@vercel/blob": "^0.27.0"
  }
}
```

- [ ] **Step 2: Create vercel.json**

```json
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" }
  ],
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "no-store" }
      ]
    }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json vercel.json
git commit -m "chore: add package.json and vercel.json for Vercel Blob"
```

---

### Task 2: Create API serverless function

**Files:**
- Create: `api/data.js`

- [ ] **Step 1: Create api/data.js**

```js
import { put, list } from '@vercel/blob';

const BLOB_FILENAME = 'roadmap-data.json';

const EMPTY_DATA = {
  version: 0,
  lastModified: new Date().toISOString(),
  moduleOrder: [],
  pillarOrder: [],
  projectOrder: [],
  items: []
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function readBlob() {
  const { blobs } = await list({ prefix: BLOB_FILENAME });
  if (blobs.length === 0) return { ...EMPTY_DATA };
  const resp = await fetch(blobs[0].url);
  return resp.json();
}

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
      .setHeader('Access-Control-Allow-Headers', 'Content-Type')
      .end();
  }

  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  try {
    if (req.method === 'GET') {
      const data = await readBlob();
      return res.status(200).json(data);
    }

    if (req.method === 'PUT') {
      const incoming = req.body;
      if (!incoming || typeof incoming.version !== 'number') {
        return res.status(400).json({ error: 'invalid payload' });
      }

      // Optimistic lock: check remote version
      const remote = await readBlob();
      if (incoming.version <= remote.version) {
        return res.status(409).json({
          error: 'conflict',
          remoteVersion: remote.version,
          message: '数据已被他人更新，请刷新页面获取最新版本。'
        });
      }

      // Write new version
      incoming.lastModified = new Date().toISOString();
      await put(BLOB_FILENAME, JSON.stringify(incoming), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
      });

      return res.status(200).json({ ok: true, version: incoming.version });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add api/data.js
git commit -m "feat: add /api/data serverless function for Vercel Blob storage"
```

---

### Task 3: Convert loadData/saveData to async remote calls

**Files:**
- Modify: `app.js:60-63` (remove STORAGE_KEY constant)
- Modify: `app.js:100-128` (rewrite loadData, saveData, remove localStorage data persistence)
- Modify: `app.js:1523-1526` (make init async)
- Modify: `app.js:1769` (make DOMContentLoaded handler async)

- [ ] **Step 1: Remove STORAGE_KEY constant**

In `app.js`, line 62, change:

```js
const STORAGE_KEY    = 'evyd_roadmap_data';
```

to:

```js
// Data stored remotely via /api/data — no localStorage for app data
const API_URL        = '/api/data';
```

- [ ] **Step 2: Rewrite loadData to async fetch**

Replace the entire `loadData()` function (lines 100-117) with:

```js
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
```

- [ ] **Step 3: Rewrite saveData to async PUT with conflict handling**

Replace the entire `saveData()` function (lines 119-124) with:

```js
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
```

- [ ] **Step 4: Add await to all saveData() call sites**

There are 13 call sites. Each `saveData()` needs `await saveData()`, and the containing function needs `async`. The affected functions and their call sites:

| Line | Function | Change |
|------|----------|--------|
| 677 | `startPillarDrag` → `onUp` closure | add `async` to `onUp`, add `await` |
| 717 | `startPillarRename` → `finish` closure | add `async` to `finish`, add `await` |
| 755 | `startPillarValueEdit` → `finish` closure | add `async` to `finish`, add `await` |
| 809 | `startProjectDrag` → `onUp` closure | add `async` to `onUp`, add `await` |
| 849 | `startProjectRename` → `finish` closure | add `async` to `finish`, add `await` |
| 989 | `startDragMove` → `onUp` closure | add `async` to `onUp`, add `await` |
| 1033 | `startDragResize` → `onUp` closure | add `async` to `onUp`, add `await` |
| 1312 | `importCSV` | add `async`, add `await` |
| 1321 | `importCSVAppend` | add `async`, add `await` |
| 1425 | `startModuleRename` → `finish` closure | add `async` to `finish`, add `await` |
| 1485 | `startModuleDrag` → `onUp` closure | add `async` to `onUp`, add `await` |
| 1573 | `init` → delete handler closure | add `async` to closure, add `await` |
| 1625 | `init` → form submit closure | add `async` to closure, add `await` |

For each: change `saveData();` to `await saveData();` and add `async` to the enclosing function/closure if not already async.

- [ ] **Step 5: Make init() async**

Change line 1523:
```js
function init() {
```
to:
```js
async function init() {
```

Change lines 1523-1526:
```js
  loadData();
  updateVersionIndicator();
  render();
```
to:
```js
  await loadData();
  updateVersionIndicator();
  render();
```

Change line 1769:
```js
document.addEventListener('DOMContentLoaded', init);
```
to:
```js
document.addEventListener('DOMContentLoaded', () => init());
```

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "feat: replace localStorage with remote Vercel Blob API calls"
```

---

### Task 4: Update documentation files

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `使用手册.md`

- [ ] **Step 1: Update README.md**

Add deployment section and update data storage description. Replace the `## 快速开始` section to include Vercel setup. Add new section about Vercel Blob setup.

- [ ] **Step 2: Update CLAUDE.md**

Update architecture section to reflect API route, async persistence, and remote storage.

- [ ] **Step 3: Update 使用手册.md**

Rewrite section 13 (数据持久化与团队协作) to describe remote storage and multi-user workflow. Update section 1 to mention online URL.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md 使用手册.md
git commit -m "docs: update README, CLAUDE.md, 使用手册 for Vercel Blob remote storage"
```

---

### Task 5: Update index.html cache buster

**Files:**
- Modify: `index.html:295`

- [ ] **Step 1: Bump app.js version query param**

Change:
```html
<script src="app.js?v=15"></script>
```
to:
```html
<script src="app.js?v=16"></script>
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "chore: bump app.js cache buster to v16"
```
