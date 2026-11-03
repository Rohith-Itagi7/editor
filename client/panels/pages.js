// The Pages list in the left panel: a row per page with a check on the open
// one, + to add (named "Page N", opened at once), and a menu with Rename page and Delete page.
import { PANEL_ICONS } from "../ui/icons/panel.js";

export function mountPages(left, store) {
  const list = left.querySelector(".page-list");
  const add = left.querySelector('.group-head [aria-label="Add page"]');
  const menu = Object.assign(document.createElement("div"), { className: "menu", hidden: true });
  document.body.append(menu);
  let renaming = null;

  const icon = (name) => `<span data-icon="${name}">${PANEL_ICONS[name] ?? ""}</span>`;
  const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");

  function render() {
    list.innerHTML = store.pages().map((page) => {
      const label = renaming === page.id ? `<input class="page-name" value="${escape(page.label).replace(/"/g, "&quot;")}" aria-label="Page name">` : escape(page.label);
      const on = page.id === store.activePage();
      return `<div class="page-row${on ? " on" : ""}" data-id="${page.id}">${icon("page")}${label}${on ? `<span class="check">${PANEL_ICONS.check ?? ""}</span>` : ""}</div>`;
    }).join("");
    const input = list.querySelector(".page-name");
    if (!input) return;
    input.focus();
    input.select();
    const finish = (commit) => {
      if (renaming == null) return;
      const id = renaming;
      renaming = null;
      if (commit && input.value.trim()) store.transact("Rename page", () => store.renamePage(id, input.value));
      else render();
    };
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") finish(true);
      if (event.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  }

  list.addEventListener("click", (event) => {
    const row = event.target.closest(".page-row");
    if (row && !event.target.closest("input")) store.setPage(row.dataset.id);
  });
  list.addEventListener("contextmenu", (event) => {
    const row = event.target.closest(".page-row");
    if (!row) return;
    event.preventDefault();
    const only = store.pages().length === 1;
    menu.innerHTML = `<button data-cmd="rename">Rename page</button><button data-cmd="delete" ${only || store.readOnly ? "disabled" : ""}>Delete page</button>`;
    menu.dataset.id = row.dataset.id;
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;
    menu.hidden = false;
    menu.querySelector('[data-cmd="rename"]').disabled = store.readOnly;
  });
  menu.addEventListener("click", (event) => {
    const command = event.target.closest("button[data-cmd]")?.dataset.cmd;
    const id = menu.dataset.id;
    menu.hidden = true;
    if (command === "rename") { renaming = id; render(); }
    if (command === "delete") store.transact("Delete page", () => store.deletePage(id));
  });
  addEventListener("pointerdown", (event) => { if (!menu.contains(event.target)) menu.hidden = true; });
  add.addEventListener("click", () => store.transact("Add page", () => store.addPage()));

  store.subscribe((reason) => { if (reason !== "ui" && reason !== "selection") render(); });
  render();
}
