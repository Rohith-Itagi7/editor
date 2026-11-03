# Editor

A design editor: a DOM canvas where every node is a real HTML element, a design panel, pages, tokens,
comments, live sync, and agents that work in the open file over MCP. Plain ES modules with no build step.
`node serve.mjs` serves it at http://127.0.0.1:4192/ (not 4190: fetch refuses that port, and agents use fetch),
`npm start` runs it in Electron, `npm test` runs the tests, `npm run package` builds the app for this machine and `npm run package:all` for Mac, Windows and Linux
(`desktop/package.mjs`).
The README says what it does and lists the routes.

## Layout

```
client/    what the browser loads (served at /client/...); main.js is the only file that imports every layer
  core/      the document and its rules, no drawing: store, tokens, style-values, vector (geometry), sections (registry)
  ui/        controls, toast, icons/, cursors/, shell.css, theme.css: knows nothing of the document
  canvas/    drawing and moving things on the canvas
  features/  what can be done with a document: clipboard, images, import-html/url, play, export, pdf
  kinds/     node kinds that add themselves to the canvas and the panel (vector)
  panels/    sidebars, layers, pages, theme, comments, share, and inspector/ (the design panel's sections)
  tools/     toolbar and hotkeys (commands), the Pen
  collab/    live sync, and agent-calls (the MCP tools, run in the page)
server/    never served to a browser: server, sync, auth, credits, agent, model, file-io, mcp/{server,tools,relay}
shared/    ops.js, the edit format that both the server and the page run (served at /shared/...)
desktop/   Electron: main (window and menu), agents (writes an agent's MCP config)
serve.mjs  the dev entry; tests/ has a file per area
```

`tests/architecture.test.mjs` says which folder may import which (the table `RULES`) and fails on anything
else. Lower layers never import higher ones: ui imports nothing, core imports only shared, the server never
imports the page. A new folder needs a line in `RULES`. The server serves only `client/` and `shared/`
(`PUBLIC` in `server/server.mjs`), so nothing in `server/` or `desktop/` can reach a browser.

## Where things go

- **A node kind** (like vectors): `client/kinds/<kind>.js`. It sets `nodeRenderers.<Kind>` from
  `canvas/canvas.js` and calls `registerSection` from `core/sections.js` for its panel. Put pure geometry or
  math in `core/` so tests can import it without the canvas. `main.js` imports the kind.
- **A design-panel section**: `client/panels/inspector/<name>.js`, which calls `registerSection({ id, title,
  order, appliesTo, render })`; `inspector/index.js` imports it for its side effect.
- **A new thing you can do with a document** (convert, import, export): `client/features/`, with no panel code in it.
- **An MCP tool**: its name, schema and description in `server/mcp/tools.mjs` (`where: "page"` or `"server"`);
  a page tool's handler in `client/collab/agent-calls.js`; a server tool in `serverTool` in `server/mcp/server.mjs`.
  `tests/mcp.test.mjs` pins the list. Handlers edit through the store, so each is one undo step and syncs.
- **A server route**: `server/server.mjs`, with its line in the header comment and the README table.
- **A change to what travels between clients**: `shared/ops.js`, and its test in `tests/sync-ops.test.mjs`.

## Rules that are easy to break

- Every edit goes through `store.transact`, so it is one undo step and `diff` can send it. Read and write the
  document through the store, never the DOM.
- Ids carry the client's tag (`clientTag`), so two people adding at once never collide.
- One place holds each piece of state; things that show it read it, they do not copy it.
- Fonts: Inter, Inter Tight and Noto Sans come from Google Fonts (a link in `client/index.html`); pictures
  take the latin part of each as data (`embeddedFonts` in `features/export.js`). Offline they fall back.
- Agents: the dev server must not be on a port fetch blocks (4190). The relay (`server/mcp/relay.mjs`) is copied
  to `~/.editor/bin` by `desktop/agents.mjs`; the installed name is kept stable for agents already connected.
- `localStorage` keys are `editor/<name>`.
- Never leave test files in `.data`; tests use temporary data folders.

## Testing

`npm test` (`node --test --test-timeout=30000 tests/*.test.mjs`; macOS has no `timeout`). The page itself is
checked in a browser: open `/file/<id>`, check the console, and drive it through MCP with an SDK client against
`/mcp` while the file is open. Electron dialogs can be checked by stubbing them over the main process inspector.
