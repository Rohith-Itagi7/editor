// Comments. The Comment tool (C or Y) puts a pin where you click and opens a box: "Leave a comment" for a new
// thread, "Reply" after that, a Send button, Close, and an actions menu (Mark as read or unread, Copy link,
// Delete comment). Shift C hides or shows every pin.
//
// A message can mention people (type @ and pick: they are the people who have the file open or have commented on
// it) and carry files (paste, drop or pick: pictures show as thumbnails, other files as links). There is no email:
// a person mentioned is told with a message when it arrives while they have the file open, and the pin carries a
// mark until they have read the thread.
//
// A thread is { id, page, x, y, messages, readBy } on the file (store.js), saved with it.
import { toast } from "../ui/toast.js";

const IMAGE_FILE = /\.(png|jpg|gif|webp|avif|svg)$/i;
const MENTION_LIMIT = 6;
const MENTION_ROW = 26; // px, for placing the menu above the box

const escapeHtml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const initialOf = (name) => (name?.trim()[0] ?? "?").toUpperCase();
const shortTime = (at) => new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const div = (className, hidden) => Object.assign(document.createElement("div"), { className, ...(hidden ? { hidden: true } : {}) });

// ---------- What a message looks like ----------
function messageHtml(message, me) {
  let text = escapeHtml(message.text);
  for (const person of message.mentions ?? []) {
    const name = `@${escapeHtml(person.name)}`;
    text = text.split(name).join(`<span class="mention${person.id === me.id ? " me" : ""}">${name}</span>`);
  }
  const files = (message.attachments ?? []).map((file) => (IMAGE_FILE.test(file.url)
    ? `<a class="comment-image" href="${escapeHtml(file.url)}" target="_blank" rel="noopener" title="${escapeHtml(file.name)}"><img src="${escapeHtml(file.url)}" alt="${escapeHtml(file.name)}"></a>`
    : `<a class="comment-file" href="${escapeHtml(file.url)}" download="${escapeHtml(file.name)}">${escapeHtml(file.name)}</a>`)).join("");
  return `<div class="comment-message" data-id="${message.id}"><b>${escapeHtml(message.author.name)}</b> <time>${shortTime(message.at)}</time>${text ? `<p>${text}</p>` : ""}${files ? `<div class="comment-files">${files}</div>` : ""}</div>`;
}

const attachedHtml = (files) => files.map((file, i) => `<span class="comment-attached" data-i="${i}">${IMAGE_FILE.test(file.url) ? `<img src="${escapeHtml(file.url)}" alt="">` : ""}${escapeHtml(file.name)}<button type="button" data-do="unattach" aria-label="Remove ${escapeHtml(file.name)}">✕</button></span>`).join("");

function boxHtml({ isThread, messages, attachments, me }) {
  const prompt = messages.length ? "Reply" : "Leave a comment";
  return `
      <header><span>${isThread ? "Comment" : "New comment"}</span>
        <span class="comment-tools">
          ${isThread ? `<button type="button" class="ghost" data-do="menu" aria-label="Comment thread actions">⋯</button>` : ""}
          <button type="button" class="ghost" data-do="close" aria-label="Close comment">✕</button>
        </span></header>
      <div class="comment-messages">${messages.map((m) => messageHtml(m, me)).join("")}</div>
      <form><div class="comment-attachments">${attachedHtml(attachments)}</div>
        <textarea rows="2" placeholder="${prompt}" aria-label="${messages.length ? "Reply" : "Comment"}"></textarea>
        <div class="comment-send-row"><button type="button" class="ghost" data-do="attach" aria-label="Attach a file" title="Attach a file">📎</button><input type="file" multiple hidden>
          <button type="submit" class="comment-send">Send</button></div></form>`;
}

export function mountComments({ store, canvas, fileId, user, people = () => [] }) {
  const layer = div("comments");
  canvas.append(layer);
  const box = div("comment-box", true);
  document.body.append(box);
  const mentionMenu = div("menu mention-menu", true);
  document.body.append(mentionMenu);
  const actionsMenu = div("menu", true);
  document.body.append(actionsMenu);

  // What is open: { thread } for an existing one, { draft: { x, y, page } } before it is sent, else null.
  let open = null;
  let mentions = []; // the people chosen with @ in the message being written
  let attachments = []; // the files added to it
  let candidates = []; // who the mention menu offers
  let picking = 0; // which of them is highlighted

  const toScreen = (x, y) => ({ left: x * store.ui.zoom + store.ui.panX, top: y * store.ui.zoom + store.ui.panY });
  const toWorld = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: Math.round((event.clientX - rect.left - store.ui.panX) / store.ui.zoom), y: Math.round((event.clientY - rect.top - store.ui.panY) / store.ui.zoom) };
  };
  const unread = (thread) => !thread.readBy.includes(user.id);
  const mentionsMe = (thread) => thread.messages.at(-1)?.mentions?.some((p) => p.id === user.id);
  const threadById = (id) => store.threads().find((t) => t.id === id);
  const textarea = () => box.querySelector("textarea");
  const forgetDraft = () => { mentions = []; attachments = []; };

  // ---------- Pins ----------
  function pinFor(thread) {
    const at = toScreen(thread.x, thread.y);
    const mentioned = unread(thread) && mentionsMe(thread);
    const pin = Object.assign(document.createElement("button"), { type: "button", className: "comment-pin" });
    pin.dataset.thread = thread.id;
    pin.toggleAttribute("data-resolved", Boolean(thread.resolved));
    pin.toggleAttribute("data-unread", unread(thread));
    pin.toggleAttribute("data-mentioned", mentioned);
    pin.toggleAttribute("aria-pressed", open?.thread?.id === thread.id);
    pin.setAttribute("aria-label", `Comment by ${thread.messages[0].author.name}${mentioned ? ", mentions you" : ""}`);
    pin.textContent = initialOf(thread.messages[0].author.name);
    Object.assign(pin.style, { left: `${at.left}px`, top: `${at.top}px` });
    pin.addEventListener("click", (event) => { event.stopPropagation(); openThread(thread.id); });
    return pin;
  }

  function renderPins() {
    layer.hidden = Boolean(store.ui.commentsHidden);
    const pins = store.threads().filter((t) => t.page === store.activePage()).map(pinFor);
    if (open?.draft) {
      const at = toScreen(open.draft.x, open.draft.y);
      pins.push(Object.assign(document.createElement("span"), { className: "comment-pin comment-pin-draft", textContent: initialOf(user.name), style: `left:${at.left}px;top:${at.top}px` }));
    }
    layer.replaceChildren(...pins);
  }

  // ---------- The box ----------
  function close() {
    open = null;
    forgetDraft();
    box.hidden = true;
    mentionMenu.hidden = true;
    renderPins();
  }

  function renderBox({ keepDraft = false } = {}) {
    const thread = open?.thread && threadById(open.thread.id);
    if (open?.thread && !thread) return close(); // it was deleted
    const draftText = keepDraft ? textarea()?.value ?? "" : "";
    box.innerHTML = boxHtml({ isThread: Boolean(thread), messages: thread?.messages ?? [], attachments, me: user });
    textarea().value = draftText;
    box.querySelector(".comment-messages").scrollTop = 1e6;

    const at = toScreen(open.thread?.x ?? open.draft.x, open.thread?.y ?? open.draft.y);
    const rect = canvas.getBoundingClientRect();
    box.style.left = `${Math.min(innerWidth - 300, rect.left + at.left + 20)}px`;
    box.style.top = `${Math.max(8, Math.min(innerHeight - 300, rect.top + at.top - 8))}px`;
    box.hidden = false;
    textarea().focus();
  }

  /** Draws the box again after the files changed, keeping what is typed. */
  function renderBoxKeepingText() {
    const typed = textarea()?.value ?? "";
    renderBox({ keepDraft: true });
    textarea().value = typed;
  }

  function openThread(id) {
    const thread = threadById(id);
    if (!thread) return;
    if (thread.page !== store.activePage()) store.setPage(thread.page);
    open = { thread };
    forgetDraft();
    store.markRead(id, user.id, true);
    renderPins();
    renderBox();
  }

  function send() {
    const text = textarea().value;
    if (!text.trim() && !attachments.length) return;
    // Only the people whose @name is still in the text are mentioned.
    const extra = { mentions: mentions.filter((p) => text.includes(`@${p.name}`)), attachments };
    const failed = () => toast("Could not send the comment. Please try again.");
    if (open.draft) {
      const id = store.addThread({ ...open.draft, text, author: user, ...extra });
      if (!id) return failed();
      open = { thread: threadById(id) };
    } else if (!store.reply(open.thread.id, text, user, extra)) {
      return failed();
    }
    forgetDraft();
    renderPins();
    renderBox();
  }

  // ---------- Mentions: @ and a name ----------
  function updateMentionMenu(field) {
    const typed = field.value.slice(0, field.selectionStart);
    const match = /(?:^|\s)@([^\s@]*)$/.exec(typed);
    if (!match) { mentionMenu.hidden = true; return; }
    const known = new Map();
    const everyone = [...people(), ...store.threads().flatMap((t) => t.messages.map((m) => m.author))];
    for (const person of everyone) if (person.id !== user.id && !known.has(person.id)) known.set(person.id, { id: person.id, name: person.name });
    candidates = [...known.values()].filter((p) => p.name.toLowerCase().startsWith(match[1].toLowerCase())).slice(0, MENTION_LIMIT);
    picking = 0;
    if (!candidates.length) { mentionMenu.hidden = true; return; }
    paintMentionMenu(field);
  }

  function paintMentionMenu(field) {
    mentionMenu.innerHTML = candidates.map((p, i) => `<button type="button" data-i="${i}" ${i === picking ? 'aria-selected="true"' : ""}>@${escapeHtml(p.name)}</button>`).join("");
    const rect = field.getBoundingClientRect();
    Object.assign(mentionMenu.style, { left: `${rect.left}px`, top: `${rect.top - candidates.length * MENTION_ROW - 12}px`, minWidth: "160px" });
    mentionMenu.hidden = false;
  }

  function chooseMention(index) {
    const field = textarea();
    const person = candidates[index];
    if (!person) return;
    const caret = field.selectionStart;
    const before = field.value.slice(0, caret).replace(/@[^\s@]*$/, `@${person.name} `);
    field.value = before + field.value.slice(caret);
    field.setSelectionRange(before.length, before.length);
    if (!mentions.some((p) => p.id === person.id)) mentions.push(person);
    mentionMenu.hidden = true;
    field.focus();
  }

  mentionMenu.addEventListener("mousedown", (event) => {
    event.preventDefault(); // the text field keeps focus
    const index = event.target.closest("button")?.dataset.i;
    if (index !== undefined) chooseMention(Number(index));
  });

  // ---------- Files: paste, drop, pick ----------
  async function attach(files) {
    for (const file of files) {
      try {
        const response = await fetch(`/api/files/${fileId}/attachments`, { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error ?? `Upload failed (${response.status})`);
        attachments.push({ url: data.url, name: file.name || "pasted image" });
      } catch (error) {
        console.error(error);
        toast(`Could not attach ${file.name}: ${error.message}`);
      }
    }
    renderBoxKeepingText();
  }

  box.addEventListener("paste", (event) => {
    const files = [...event.clipboardData.files];
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    attach(files);
  });
  box.addEventListener("dragover", (event) => { if (event.dataTransfer?.types.includes("Files")) event.preventDefault(); });
  box.addEventListener("drop", (event) => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    attach(event.dataTransfer.files);
  });
  box.addEventListener("change", (event) => {
    if (!event.target.matches('input[type="file"]')) return;
    attach([...event.target.files]);
    event.target.value = "";
  });

  // ---------- Using the box ----------
  // The tool: a click on the canvas starts a comment there; a click on a pin opens it.
  canvas.addEventListener("pointerdown", (event) => {
    if (store.ui.tool !== "Comment" || event.target.closest(".comment-pin")) return;
    event.stopPropagation();
    event.preventDefault();
    if (store.readOnly) return toast("Comments need a file of your own");
    store.setUI({ commentsHidden: false });
    forgetDraft();
    open = { draft: { ...toWorld(event), page: store.activePage() } };
    renderPins();
    renderBox();
  }, true);

  box.addEventListener("submit", (event) => { event.preventDefault(); send(); });
  box.addEventListener("input", (event) => { if (event.target.matches("textarea")) updateMentionMenu(event.target); });
  box.addEventListener("keydown", (event) => {
    event.stopPropagation(); // typing here is typing, not a shortcut for the canvas
    const inText = event.target.matches("textarea");
    if (!mentionMenu.hidden && inText) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        picking = (picking + (event.key === "ArrowDown" ? 1 : -1) + candidates.length) % candidates.length;
        return paintMentionMenu(event.target);
      }
      if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); return chooseMention(picking); }
      if (event.key === "Escape") { mentionMenu.hidden = true; return; }
    }
    if (event.key === "Enter" && !event.shiftKey && inText) { event.preventDefault(); send(); }
    if (event.key === "Escape") close();
  });
  box.addEventListener("click", (event) => {
    const action = event.target.closest("[data-do]")?.dataset.do;
    if (action === "close") close();
    if (action === "menu") showActions(event.target.getBoundingClientRect());
    if (action === "attach") box.querySelector('input[type="file"]').click();
    if (action === "unattach") {
      attachments.splice(Number(event.target.closest("[data-i]").dataset.i), 1);
      renderBoxKeepingText();
    }
  });

  // ---------- The actions menu ----------
  function showActions(rect) {
    const thread = threadById(open.thread.id);
    actionsMenu.innerHTML = `<button data-cmd="read">${unread(thread) ? "Mark as read" : "Mark as unread"}</button><button data-cmd="link">Copy link</button><button data-cmd="delete" ${store.readOnly ? "disabled" : ""}>Delete comment</button>`;
    Object.assign(actionsMenu.style, { left: `${rect.left}px`, top: `${rect.bottom + 4}px` });
    actionsMenu.hidden = false;
  }

  actionsMenu.addEventListener("click", async (event) => {
    const command = event.target.closest("button")?.dataset.cmd;
    actionsMenu.hidden = true;
    const thread = open?.thread && threadById(open.thread.id);
    if (!thread) return;
    if (command === "read") store.markRead(thread.id, user.id, unread(thread));
    if (command === "link") {
      try {
        await navigator.clipboard.writeText(`${location.origin}${store.readOnly ? "/f/" : "/file/"}${fileId}#comment=${thread.id}`);
        toast("Link copied to clipboard");
      } catch {
        toast("Could not copy the link");
      }
    }
    // Deleting removes the last message, and with the only one, the whole thread.
    if (command === "delete") store.deleteMessage(thread.id, thread.messages.at(-1).id);
  });

  addEventListener("pointerdown", (event) => {
    if (!actionsMenu.contains(event.target)) actionsMenu.hidden = true;
    if (!mentionMenu.contains(event.target)) mentionMenu.hidden = true;
    if (open && !box.contains(event.target) && !event.target.closest(".comment-pin") && store.ui.tool !== "Comment") close();
  });

  // ---------- Hearing about changes ----------
  // A message that mentions you, arriving while the file is open, is announced once.
  const seen = new Set(store.threads().flatMap((t) => t.messages.map((m) => m.id)));
  function announceMentions() {
    for (const thread of store.threads()) {
      for (const message of thread.messages) {
        if (seen.has(message.id)) continue;
        seen.add(message.id);
        if (message.author.id !== user.id && message.mentions?.some((p) => p.id === user.id)) toast(`${message.author.name} mentioned you in a comment`);
      }
    }
  }

  store.subscribe((reason) => {
    if (reason === "threads") announceMentions();
    if (reason === "ui" || reason === "page" || reason === "threads" || reason === "document") renderPins();
    if (reason === "threads" && open?.thread && !box.contains(document.activeElement)) renderBox({ keepDraft: true });
    if (reason === "page" && open) close();
  });
  renderPins();

  // A link ending in #comment=<id> opens that thread.
  const linked = location.hash.match(/^#comment=([\w-]+)/)?.[1];
  if (linked) requestAnimationFrame(() => openThread(linked));
}
