// The panels around the canvas, sized and shown: the left panel drags
// between 180 and 640px (double-click resets to 240), the page list drags to a height or fits
// its pages, "." or Mod \ hides every panel, and Shift . or Shift \ collapses them so only a
// floating toolbar stays and the right panel appears while something is selected.

const LEFT = { initial: 240, min: 180, max: 640 };
const TOOLBAR = 42;
const RIGHT = 281;
const PAGE_LIST_MIN = 48;
const LAYERS_MIN = 120;

function load(key, fallback, valid) {
  try {
    const value = JSON.parse(localStorage.getItem(`editor/${key}`));
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(`editor/${key}`, JSON.stringify(value));
  } catch {}
}

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const finite = (n) => typeof n === "number" && Number.isFinite(n);

/** Drags with the pointer captured on the handle, */
function drag(handle, event, onMove) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  handle.setPointerCapture(event.pointerId);
  handle.dataset.active = "";
  const move = (e) => onMove(e);
  const end = () => {
    delete handle.dataset.active;
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

export function mountSidebars(editor, store) {
  const state = {
    leftWidth: load("leftPanelWidth", LEFT.initial, (n) => finite(n) && n > 0),
    pageListOpen: load("pageListIsOpen", true, (v) => typeof v === "boolean"),
    pageListHeight: load("pageListHeight", "fit", (v) => v === "fit" || finite(v)),
    collapsed: load("panelsCollapsed", false, (v) => typeof v === "boolean"),
    visible: true,
  };
  state.leftWidth = clamp(state.leftWidth, LEFT.min, LEFT.max);

  const left = editor.querySelector(".side.left");
  const pages = left.querySelector(".pages");
  const pageList = left.querySelector(".page-list");
  const topBar = editor.querySelector(".top-bar");
  const right = editor.querySelector(".side.right");

  // The world stays where it is on screen while panels open and close beside it.
  let canvasLeft = null;
  function layout() {
    const showLeft = state.visible && !state.collapsed;
    const showRight = state.visible && (!state.collapsed || store.selection().length > 0);
    const leftWidth = showLeft ? state.leftWidth : 0;
    const toolbarWidth = showLeft ? TOOLBAR : 0;
    editor.style.setProperty("--left-width", `${leftWidth}px`);
    editor.style.setProperty("--toolbar-width", `${toolbarWidth}px`);
    editor.style.setProperty("--right-width", `${showRight ? RIGHT : 0}px`);
    editor.toggleAttribute("data-ui-hidden", !state.visible);
    editor.toggleAttribute("data-collapsed", state.visible && state.collapsed);
    right.hidden = !showRight;
    // Collapsed with nothing selected, the right panel's top bar floats on its own.
    const floatTop = state.visible && state.collapsed && !showRight;
    if (floatTop && topBar.parentElement === right) editor.append(topBar);
    if (!floatTop && topBar.parentElement !== right) right.prepend(topBar);
    topBar.toggleAttribute("data-floating", floatTop);

    const nextLeft = leftWidth + toolbarWidth;
    if (canvasLeft !== null && nextLeft !== canvasLeft) store.setUI({ panX: store.ui.panX - (nextLeft - canvasLeft) });
    canvasLeft = nextLeft;
  }

  // ---------- Left panel width ----------
  const colHandle = Object.assign(document.createElement("div"), { className: "resize-col" });
  colHandle.append(Object.assign(document.createElement("div"), { className: "resize-bar" }));
  left.after(colHandle);
  function setLeftWidth(width) {
    state.leftWidth = clamp(Math.round(width), LEFT.min, LEFT.max);
    save("leftPanelWidth", state.leftWidth);
    layout();
  }
  colHandle.addEventListener("pointerdown", (event) => {
    const startX = event.clientX;
    const startWidth = state.leftWidth;
    drag(colHandle, event, (e) => setLeftWidth(startWidth + e.clientX - startX));
  });
  colHandle.addEventListener("dblclick", () => setLeftWidth(LEFT.initial));

  // ---------- Page list height ----------
  const rowHandle = Object.assign(document.createElement("div"), { className: "resize-row" });
  rowHandle.append(Object.assign(document.createElement("div"), { className: "resize-line" }), Object.assign(document.createElement("div"), { className: "resize-bar" }));
  pages.after(rowHandle);
  function applyPageList() {
    pages.toggleAttribute("data-closed", !state.pageListOpen);
    rowHandle.toggleAttribute("data-closed", !state.pageListOpen);
    pageList.style.height = state.pageListHeight === "fit" ? "" : `${state.pageListHeight}px`;
    pages.querySelector(".chev")?.classList.toggle("open", state.pageListOpen);
  }
  rowHandle.addEventListener("pointerdown", (event) => {
    if (!state.pageListOpen) return;
    const top = pageList.getBoundingClientRect().top;
    const offset = event.clientY - top - pageList.clientHeight;
    const min = Math.min(PAGE_LIST_MIN, pageList.scrollHeight);
    const max = Math.max(min, left.getBoundingClientRect().bottom - top - LAYERS_MIN);
    drag(rowHandle, event, (e) => {
      state.pageListHeight = clamp(e.clientY - top - offset, min, max);
      save("pageListHeight", state.pageListHeight);
      applyPageList();
    });
  });
  rowHandle.addEventListener("dblclick", () => {
    state.pageListHeight = "fit";
    save("pageListHeight", "fit");
    applyPageList();
  });
  pages.querySelector(".group-head .chev")?.addEventListener("click", () => {
    state.pageListOpen = !state.pageListOpen;
    save("pageListIsOpen", state.pageListOpen);
    applyPageList();
  });

  // ---------- Hide and collapse ----------
  const setVisible = (visible) => {
    state.visible = visible;
    layout();
  };
  const setCollapsed = (collapsed) => {
    state.collapsed = collapsed;
    save("panelsCollapsed", collapsed);
    layout();
  };
  const toggleCollapsed = () => (state.visible ? setCollapsed(!state.collapsed) : setVisible(true));
  editor.querySelectorAll("[data-toggle-panels]").forEach((button) => button.addEventListener("click", toggleCollapsed));

  addEventListener("keydown", (event) => {
    if (event.target.matches?.("input, select, textarea, [contenteditable]")) return;
    const mod = event.metaKey || event.ctrlKey;
    const period = event.code === "Period";
    const backslash = event.code === "Backslash";
    if (event.shiftKey && (period || backslash) && !event.altKey) {
      event.preventDefault();
      toggleCollapsed();
    } else if ((period && !mod && !event.altKey) || (backslash && mod && !event.altKey)) {
      event.preventDefault();
      setVisible(!state.visible);
    } else if (event.altKey && !mod && (event.code === "Digit1" || event.code === "Digit2")) {
      event.preventDefault();
      setVisible(true);
      setCollapsed(false);
      left.querySelector(`.tabs [role=tab]:nth-child(${event.code === "Digit1" ? 1 : 2})`)?.click();
    }
  });

  store.subscribe((reason) => reason === "selection" && state.collapsed && layout());
  applyPageList();
  layout();
}
