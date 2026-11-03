# Editor

A design editor in the browser and as a Mac app: a canvas of real HTML elements, a design panel, pages,
theme tokens, comments, live sync between people, and agents (Claude Code, Codex, any MCP client) that
work in the file you have open. You can paste HTML or import a web page, and play a frame as its own page.

![Five agents build one page at the same time in the editor](https://raw.githubusercontent.com/michael-jordan-coder/editor/media/agent-team.gif)

One request, five agents: the first plans the page and splits it, then all five build their parts in the open file at the same
time, each with its own pointer. About a minute and a half, shown here at up to 8x. [Full video](https://github.com/michael-jordan-coder/editor/blob/media/agent-team.mp4).

## Run

```bash
node serve.mjs          # http://127.0.0.1:4192/, files in ./.data
npm start               # the same, in an Electron window (port 4191, files in the app's data folder)
npm run package         # the app for this machine, in out/Editor-<platform>-<arch>/, unsigned
npm run package:all     # Mac (Apple silicon, Intel), Windows and Linux (x64, Arm); or :mac, :mac-intel, :win, :win-arm64, :linux, :linux-arm64
npm test                # the server, the store, sync, sign-in, saved files
```

It needs the internet once per page load, for the fonts from Google Fonts. Settings come from
the environment: `EDITOR_AUTH=1` turns sign-in on, `EDITOR_DATA` moves the data folder,
`ANTHROPIC_API_KEY` lets the agent panel work.
`node serve.mjs` reads them from `.env.local` next to it (kept out of git), one `NAME=value` a line, as well as from the environment.

## What it does

- **Files and pages.** `/files` lists the files (New file, Open file, Download, Delete). A file has
  pages ("Page N", Rename, Delete, PageUp and PageDown), a name you change from its header,
  and saves 500ms after the last edit.
- **Copy, cut and paste** of elements, plus Paste on top (⇧⌘V) and Paste to
  replace (⇧⌘R). Pasting HTML code, an SVG, image files, or text makes frames, images or text.
- **Images.** Place image (⇧⌘K), or paste or drop files. They are stored on the server.
- **Pen** (P) and vector networks: lines of vertices and edges that branch and close into
  regions. Enter on a vector edits it: move vertices and tangents, double-click an edge to add a vertex,
  double-click a vertex for smooth or sharp, Backspace to delete, and the Pen on a vertex carries on from it.
- **Comments** (C or Y): pins, threads, replies, @mentions, attached files, Mark as read, Copy link,
  Delete comment; Shift C hides them.
- **Import URL** and **Play**, in the canvas menu (right click): a web page laid out and flattened into
  elements; the selected frame run as its own page in a sandbox.
- **Theme tab.** The tokens (eleven kinds) as one block of real CSS, `@theme { --color-brand: #16a36a; }`,
  that you edit as text; they are CSS variables (`var(--color-brand)`), bind to a color from its picker,
  and copy out as `@theme` or `:root`.
- **Share** (the button, or ⌘L): who can open the file, and a link, `/f/:id`, that opens it read-only.
- **Sign-in**, when the server is started with it: accounts, files that belong to their maker.
- **Live sync.** Everyone with a file open sees edits as they happen, and each other's cursors,
  selections and initials. A shared file's visitor follows live.
- **Electron**, for Mac, Windows and Linux. A Mac menu: New File, Open, Save As (the file's JSON), Connect Agents, Edit, View, Window.

Accounts and credits are the server's own, and a mention is a message in the page. Sync settles two people
editing the same element at once by letting the last one win. The agent's model is the first one the server's
environment lists (`ANTHROPIC_MODELS`).

## The server

`server/server.mjs` keeps each file as JSON, and says who may open it.
It answers only to `127.0.0.1`, `localhost` and `[::1]`: it can fetch any address for Import URL.
Putting it on a network needs `EDITOR_AUTH=1` and `startServer({ allowedHosts })` for the new host name.

| Route | What |
| --- | --- |
| `GET /api/files`, `POST /api/files` | List the files; make one ("Untitled", "Untitled 2", ...) |
| `GET`/`PUT`/`DELETE /api/files/:id` | A file: `{ id, name, access, pages, tokens, threads, nodes }` |
| `POST /api/files/:id/assets`, `.../attachments` | An image, or for a comment also PDF, text, CSV or ZIP (the raw body); answers its URL |
| `POST /api/agent` | One turn of the agent panel's conversation, `{ messages }`; answers the model's `{ content, stop_reason }` |
| `GET /api/shared/:id` | The file for a visitor: 200 when `access` is `link`, else 403 |
| `GET /api/proxy?url=` | A web page for Import URL, scripts stripped |
| `/api/auth/me`, `signup`, `signin`, `signout` | Accounts, when sign-in is on |
| `WS /sync/:id` | Live sync of an open file (`server/sync.mjs`) |
| `POST /mcp` | Agents over MCP (Streamable HTTP), see below |
| `/files`, `/file/:id`, `/f/:id` | The home page, the editor, and the read-only editor |

## Agents (MCP)

An agent can work in the file you have open. The server speaks MCP at `/mcp` (Streamable HTTP, one
session per agent); the tools are `get_basic_info`,
`get_jsx`, `write_html`, `update_styles`, `get_screenshot`, `export`, comments, tokens…, and each one runs in the
page that has the file open, on its own store, so an agent's edit is one undo step, is saved, and reaches
everyone else with the file open as it happens. Layers an agent is working on are outlined with its name.

- **Connect.** In the Electron app: File ▸ Connect Agents ▸ Claude Code… or Codex…. Each asks first, adds one
  entry named `editor` to the agent's own config (`~/.claude.json`, `~/.codex/config.toml`), keeps a copy as
  `<file>.editor-backup`, and touches nothing else. The entry runs a relay (`server/mcp/relay.mjs`, copied to
  `~/.editor/bin`) that carries stdio to `/mcp`; it says "The Editor app is not running" if it is not, and
  opens a new session if the app was restarted. Restart the agent after connecting.
- **Which page.** A call goes to the page you touched last; `open_file` shows another file in the window you are in.
- **Safety.** `/mcp` refuses anything with an `Origin` header or a foreign `Host`, so a web page cannot reach it.
  With sign-in on, agents need `EDITOR_MCP_TOKEN` (a bearer token) and only see files open in an editor.
- **Port.** The dev server is on 4192, not 4190: fetch treats 4190 as a blocked port, so an agent's HTTP client refuses it.
- **Limits.** Export is raster (a PNG, JPEG or WebP; the PDF holds pictures); `get_fill_image` reads CSS
  background images; fonts are checked by measuring, not by a font service.

## Files

CLAUDE.md has the folder layout, the import rules a test enforces, and where a new kind, section, tool or route goes.

| Path | What |
| --- | --- |
| `client/` | The page: `main.js` opens the file, saves it and mounts every view |
| `client/core/` | Document store (undo, redo, pages, tokens, threads), tokens, style values, vector geometry, the section registry |
| `client/canvas/`, `client/kinds/` | Pan and zoom, selection, handles, snapping; vectors as a node kind |
| `client/features/` | Clipboard, images, HTML and URL import, Play, export and PDF |
| `client/panels/` | Layers, pages, theme, comments, share, sidebars, and `inspector/` (the design panel) |
| `client/tools/`, `client/collab/` | Toolbar, hotkeys and the Pen; live sync and the agent's tool calls |
| `client/ui/` | Controls, icons, cursors, toasts, the styles |
| `server/` | The server, live sync rooms, sign-in, credits, the agent's model calls, Open and Save As's file work |
| `server/mcp/` | The MCP server, its tool list, and the stdio relay agents launch |
| `shared/ops.js` | The edit format both sides run |
| `desktop/` | The Electron window and menu, and the writers of an agent's MCP config |
| `tests/` | `node --test`: the server, the store, sync, sign-in, saved files, MCP, and the import rules |

## License

MIT, see [LICENSE](LICENSE).
