# Design: Vercel Blob Remote Storage

**Date:** 2026-04-10
**Status:** Approved
**Goal:** Replace localStorage with Vercel Blob so multiple team members can share the same roadmap data. Refresh to see others' changes.

## Context

The EVYD Product Roadmap is a pure-frontend vanilla JS app deployed as a static site on Vercel (via GitHub). Data currently lives in `localStorage`, making multi-user collaboration impossible. The team needs shared storage without changing the existing architecture significantly.

## Decisions

| Question | Answer |
|----------|--------|
| Storage backend | Vercel Blob (via `@vercel/blob` SDK) |
| Concurrency model | Optimistic locking (version check) — few editors, unlikely same-second conflicts |
| Authentication | None — internal team, URL not shared externally |
| localStorage fallback | Removed for data storage. Kept for UI preferences only (collapsed state, label width) |
| Backup mechanism | CSV import/export retained |

## Architecture

```
Browser  ──fetch──▶  /api/data  (Vercel Serverless Function)  ──SDK──▶  Vercel Blob Storage
```

### New Files

| File | Purpose |
|------|---------|
| `api/data.js` | Serverless function: GET reads blob, PUT writes blob with version check |
| `package.json` | Declares `@vercel/blob` dependency |
| `vercel.json` | Route config ensuring static files + API coexist |

### API Endpoints

#### `GET /api/data`
- Reads `roadmap-data.json` from Vercel Blob
- Returns the full `appData` JSON object
- If blob doesn't exist, returns `{ version: 0, items: [], moduleOrder: [], pillarOrder: [], projectOrder: [] }`

#### `PUT /api/data`
- Receives full `appData` JSON in request body
- **Optimistic lock**: reads current blob's `version`, compares with request's `version`
  - If `request.version < remote.version` → return `409 Conflict` with `{ error: 'conflict', remoteVersion }`
  - Otherwise → write to blob, return `200 { ok: true, version }`
- Increments `version` and sets `lastModified` server-side

### app.js Changes

1. **`loadData()`** → `async`, fetches `GET /api/data`
2. **`saveData()`** → `async`, sends `PUT /api/data`, handles 409 with user prompt ("Data updated by someone else, refresh?")
3. **Remove** `localStorage.getItem(STORAGE_KEY)` / `localStorage.setItem(STORAGE_KEY)` calls
4. **Keep** `localStorage` for `COLLAPSED_KEY` and `LABEL_WIDTH_KEY` (pure local UI preferences)
5. **All callers of `saveData()`** → add `await` (drag end, form submit, rename, delete, import CSV, etc.)
6. **`init()`** → `async`, `await loadData()` before first `render()`

### What Doesn't Change

- `index.html` — no changes
- `styles.css` — no changes
- CSV import/export — fully retained
- All rendering, drag, filter, tooltip logic — unchanged
- `collapsedModules` + `--label-width` — stay in localStorage

## Vercel Environment Setup

One environment variable required in Vercel project settings:
- `BLOB_READ_WRITE_TOKEN` — obtained from Vercel Dashboard → Storage → Create Blob Store

## Error Handling

| Scenario | Behavior |
|----------|----------|
| API unreachable (network error) | `alert()` with error message, data not saved |
| 409 Conflict on save | Prompt user: "Data was updated by someone else. Refresh to see latest?" If yes, reload page |
| Blob not found on GET | Return empty dataset, app shows empty state |

## Documentation Updates

Update these files to reflect the new architecture:
- `README.md` — add Vercel Blob setup instructions, environment variable
- `CLAUDE.md` — document API route, async loadData/saveData
- `使用手册.md` — explain multi-user usage, refresh to sync
