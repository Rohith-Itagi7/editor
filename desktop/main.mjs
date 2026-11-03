// The Electron app: a window around the editor and a Mac-style menu. It starts the editor's own server
// (server/server.mjs) with the files in the app's data folder, and shows its pages.
//
// Menu items that edit show their shortcuts but do not register them (`registerAccelerator: false`), so the page's
// own key handling keeps working. Cut, Copy and Paste run the browser's native commands, which the page hears as
// clipboard events; Undo, Redo and the rest are sent to the editor's own commands, because the browser's undo
// only knows about text fields.
import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import os from "node:os";
import path from "node:path";
import { startServer } from "../server/server.mjs";
import { exportFile, importFile } from "../server/file-io.mjs";
import { AGENTS, NAME, connectAgent } from "./agents.mjs";

const PORT = 4191;
const isMac = process.platform === "darwin";
const FILE_TYPES = [{ name: "Editor files", extensions: ["json"] }];

let root; // http://127.0.0.1:<port>/, once the server is up
const urlOf = (pathname) => new URL(pathname, root).href;

// ---------- Windows ----------
const allWindows = () => BrowserWindow.getAllWindows();
const activeWindow = () => BrowserWindow.getFocusedWindow() ?? allWindows()[0];
const openFileId = (window) => window?.webContents.getURL().match(/\/file\/([\w-]+)/)?.[1];

function openWindow(pathname = "files") {
  const window = new BrowserWindow({ width: 1440, height: 900, backgroundColor: "#1e1e1e", webPreferences: { contextIsolation: true } });
  window.loadURL(urlOf(pathname));
  // A link to another site opens in the browser, never inside the editor.
  window.webContents.setWindowOpenHandler(({ url }) => (shell.openExternal(url), { action: "deny" }));
  return window;
}

const show = (pathname) => (activeWindow() ?? openWindow()).loadURL(urlOf(pathname));
/** Runs one of the editor's commands (client/tools/commands.js) in the window in front. */
const command = (name) => activeWindow()?.webContents.executeJavaScript(`window.editor?.run(${JSON.stringify(name)})`);
/** Runs a native editing command (cut, copy, paste) in the window in front. */
const nativeEdit = (name) => () => activeWindow()?.webContents[name]();

// ---------- Talking to the server and the user ----------
async function request(pathname, options) {
  const response = await fetch(urlOf(pathname), options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `The server answered ${response.status}`);
  return data;
}

const complain = (title, error) => dialog.showMessageBox({ type: "error", message: title, detail: error.message });

// ---------- File menu ----------
async function newFile() {
  try {
    const { id } = await request("api/files", { method: "POST" });
    show(`file/${id}`);
  } catch (error) {
    complain("Could not make a new file", error);
  }
}

// A JSON file saved from the editor becomes a new file, as it does on the home page.
async function openFromDisk() {
  const { canceled, filePaths } = await dialog.showOpenDialog({ filters: FILE_TYPES, properties: ["openFile"] });
  if (canceled) return;
  try {
    show(`file/${await importFile(root, filePaths[0])}`);
  } catch (error) {
    complain("Could not open the file", error);
  }
}

// The file as JSON, which Open and the home page read back.
async function saveToDisk() {
  const id = openFileId(activeWindow());
  if (!id) return complain("Open a file first", new Error("Save As saves the file in the open window."));
  try {
    const { name } = await request(`api/files/${id}`);
    const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: `${name}.json`, filters: FILE_TYPES });
    if (!canceled && filePath) await exportFile(root, id, filePath);
  } catch (error) {
    complain("Could not save the file", error);
  }
}

// An agent is connected only after asking, one at a time, because this writes into a file that is the agent's own.
async function connectToAgent(id) {
  const { label, file } = AGENTS[id];
  const configPath = file(os.homedir());
  const { response } = await dialog.showMessageBox({
    type: "question", buttons: ["Connect", "Cancel"], defaultId: 0, cancelId: 1,
    message: `Let ${label} work in the Editor?`,
    detail: `This adds one entry, "${NAME}", to ${configPath.replace(os.homedir(), "~")} and keeps a copy of the file as it is now. Nothing else in it changes. ${label} then reads and edits the file open in the Editor, as you would; restart it to see the Editor's tools.`,
  });
  if (response !== 0) return;
  // The app runs the relay itself, as plain Node, so the machine needs no Node of its own.
  const result = await connectAgent(id, { url: urlOf("mcp"), run: { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1" } } });
  if (result.ok) {
    await dialog.showMessageBox({ type: "info", message: result.changed ? `${label} is connected` : `${label} was already connected`, detail: "Restart it to see the Editor's tools. The Editor has to be open for them to work." });
  } else {
    const detail = result.reason === "invalid-config-file" ? `${result.path} could not be read (${result.message}), so it was left as it is.` : result.message;
    await dialog.showMessageBox({ type: "error", message: `Could not connect ${label}`, detail });
  }
}

// ---------- Menus ----------
const separator = { type: "separator" };
/** An item that shows a shortcut without taking it from the page. */
const shown = (label, accelerator, click) => ({ label, accelerator, registerAccelerator: false, click });

const appMenu = () => ({
  label: app.name,
  submenu: [{ role: "about" }, separator, { role: "services" }, separator, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, separator, { role: "quit" }],
});

const fileMenu = () => ({
  label: "File",
  submenu: [
    { label: "New File", accelerator: "CmdOrCtrl+N", click: newFile },
    { label: "Open…", accelerator: "CmdOrCtrl+O", click: openFromDisk },
    { label: "Save As…", accelerator: "CmdOrCtrl+Shift+S", click: saveToDisk },
    shown("All Files", "CmdOrCtrl+Shift+D", () => activeWindow()?.loadURL(urlOf("files"))),
    separator,
    { label: "Connect Agents", submenu: Object.entries(AGENTS).map(([id, { label }]) => ({ label: `${label}…`, click: () => connectToAgent(id) })) },
    separator,
    { label: "New Window", accelerator: "CmdOrCtrl+Shift+N", click: () => openWindow() },
    { role: "close" },
    ...(isMac ? [] : [separator, { role: "quit" }]),
  ],
});

const editMenu = () => ({
  label: "Edit",
  submenu: [
    shown("Undo", "CmdOrCtrl+Z", () => command("undo")),
    shown("Redo", "CmdOrCtrl+Shift+Z", () => command("redo")),
    separator,
    shown("Cut", "CmdOrCtrl+X", nativeEdit("cut")),
    shown("Copy", "CmdOrCtrl+C", nativeEdit("copy")),
    shown("Paste", "CmdOrCtrl+V", nativeEdit("paste")),
    shown("Paste on Top", "CmdOrCtrl+Shift+V", () => command("pasteOnTop")),
    shown("Paste to Replace", "CmdOrCtrl+Shift+R", () => command("pasteToReplace")),
    separator,
    shown("Duplicate", "CmdOrCtrl+D", () => command("duplicate")),
    shown("Delete", "Backspace", () => command("delete")),
    shown("Select All", "CmdOrCtrl+A", () => command("selectAll")),
    separator,
    shown("Place Image…", "CmdOrCtrl+Shift+K", () => command("placeImage")),
  ],
});

const viewMenu = () => ({
  label: "View",
  submenu: [
    shown("Zoom In", "CmdOrCtrl+=", () => command("zoomIn")),
    shown("Zoom Out", "CmdOrCtrl+-", () => command("zoomOut")),
    shown("Zoom to 100%", "0", () => command("zoomTo100")),
    shown("Zoom to Fit", "Shift+1", () => command("zoomToFit")),
    shown("Zoom to Selection", "Shift+2", () => command("zoomToSelection")),
    separator,
    { role: "reload" },
    { role: "toggleDevTools" },
    { role: "togglefullscreen" },
  ],
});

const buildMenu = () => Menu.setApplicationMenu(Menu.buildFromTemplate([
  ...(isMac ? [appMenu()] : []), fileMenu(), editMenu(), viewMenu(), { role: "windowMenu" },
]));

// ---------- Start and stop ----------
app.whenReady().then(async () => {
  const dataDir = path.join(app.getPath("userData"), "files");
  // A fixed port keeps the window's own storage (panel sizes) from one launch to the next. If another copy of
  // the editor holds it, any free port will do.
  ({ url: root } = await startServer({ port: PORT, dataDir }).catch((error) => {
    if (error.code !== "EADDRINUSE") throw error;
    return startServer({ port: 0, dataDir });
  }));
  buildMenu();
  openWindow();
  app.on("activate", () => { if (!allWindows().length) openWindow(); });
});

app.on("window-all-closed", () => { if (!isMac) app.quit(); });
