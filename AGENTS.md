# PP2 Island Planner — Agent Instructions

## Cursor Cloud specific instructions

### Overview
Zero-dependency, vanilla HTML/CSS/JS island planner for Paragon Pioneers 2. No build step, no npm, no bundler. All state is client-side (`localStorage`). See `CONTEXT.md` for full architecture.

### Running the app
Serve static files with any HTTP server:
```
npx serve -l 3000 /workspace
```
Then open `http://localhost:3000/` in Chrome. The app also works via `file://` protocol.

### Running tests
```
node --test tests/parse-pp2-save.test.mjs tests/parse-production-accuracy.test.mjs
```
Requires Node.js v22+ (uses `node:test` built-in runner).

### Linting
No linter is configured in this repository.

### Key caveats
- **Script load order matters.** The 11 JS files loaded in `index.html` depend on globals from earlier scripts (`data.js → buildings.js → island.js → … → saveload.js`). There is no module system.
- **`data.js` is auto-generated** (~3,500 lines). Do not edit manually; regenerate from game data if the game updates.
- **Save parser scripts** (`scripts/*.mjs`) use ES module syntax and share logic via `save-production-core.mjs`. The browser-side equivalent lives in `save-analysis.js`.
- **No package.json exists.** `npx serve` is the quickest way to serve locally; no `npm install` is needed.
- **Save file tile utilization** is not stored explicitly in save files. To determine which tiles a building uses, compute from `entity.xy` + footprint (from `buildings.js`) + `Grid[]` terrain. `AmountRemainder` in `gatherer` components is a fractional production accumulator, not tile counts.
