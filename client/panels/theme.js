// The Theme tab of the left panel: the file's tokens as one block of real CSS that can be read, edited and pasted
// into a project. When the text is left (its `change` event) it is read back and written to the store as one undo
// step. Text that is not valid CSS stays as typed, with the reason under it, and changes nothing. Above it, the
// GitHub repo the file is connected to: Connect keeps it with the file, Import brings its tokens into the theme and
// asks an agent for its components (main.js wires both).
//
// Tokens are CSS variables of the canvas (canvas.js). A token is identified by its variable name, so editing a value
// in the text keeps the token, while editing a name is a delete plus an add; the elements that used the old name keep
// its value (store.js).
import { applyTokens, tokensToCss, parseTokensCss } from "../core/tokens.js";
import { toast } from "../ui/toast.js";

const THEME_TAB = 1; // Design is the first tab, Theme the second (⌥1 and ⌥2 click them)

/** A pasted GitHub address as "owner/name" or "owner/name@branch"; other text as it is. */
const repoOf = (text) => {
  const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?(?:\/tree\/([\w./-]+))?\/?$/.exec(text.trim());
  return url ? `${url[1]}${url[2] ? `@${url[2]}` : ""}` : text.trim();
};

export function mountTheme(left, store, { repo = null, setRepo, importRepo } = {}) {
  const tabs = [...left.querySelectorAll(".tabs [role=tab]")];

  const panel = Object.assign(document.createElement("section"), { className: "theme", hidden: true });
  left.querySelector(".tabs").after(panel);
  panel.innerHTML = `
    <form class="theme-repo">
      <input class="theme-repo-name" placeholder="owner/repo" aria-label="GitHub repo" autocomplete="off" spellcheck="false">
      <button type="submit" class="theme-connect">Connect</button>
      <button type="button" class="theme-import" title="The repo's tokens into this theme, and its components onto a Components page">Import</button>
    </form>
    <div class="theme-actions">
      <button type="button" class="theme-copy" data-format="tailwind">Copy as @theme</button>
      <button type="button" class="theme-copy" data-format="css">Copy as :root</button>
    </div>
    <textarea class="theme-code" spellcheck="false" wrap="off" aria-label="Theme tokens as CSS" aria-describedby="theme-error"></textarea>
    <p class="theme-error" id="theme-error" role="alert" hidden></p>`;
  const code = panel.querySelector(".theme-code");
  const problem = panel.querySelector(".theme-error");
  code.readOnly = store.readOnly;

  // ---------- The connected repo ----------
  // The field is the one place on the page that holds the repo; the server keeps it with the file, like its name.
  const repoForm = panel.querySelector(".theme-repo");
  const field = repoForm.querySelector(".theme-repo-name");
  const connect = repoForm.querySelector(".theme-connect");
  const importButton = repoForm.querySelector(".theme-import");
  field.readOnly = store.readOnly || !setRepo;
  connect.hidden = store.readOnly || !setRepo;

  function showRepo(value) {
    if (document.activeElement !== field || value === field.value) field.value = value ?? "";
    importButton.hidden = store.readOnly || !importRepo || !field.value;
  }
  showRepo(repo);

  repoForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const previous = repo;
    repo = repoOf(field.value) || null;
    field.value = repo ?? "";
    field.blur();
    try {
      await setRepo(repo);
      showRepo(repo);
      if (repo) toast(`Connected to ${repo}`);
    } catch (error) {
      repo = previous;
      showRepo(repo);
      toast(error.message || "Could not connect the repo");
    }
  });
  field.addEventListener("input", () => { importButton.hidden = true; });
  field.addEventListener("keydown", (event) => event.stopPropagation());

  importButton.addEventListener("click", async () => {
    importButton.disabled = true;
    importButton.textContent = "Importing…";
    try {
      await importRepo(field.value);
    } catch (error) {
      toast(error.message || "Could not import from the repo");
    } finally {
      importButton.disabled = false;
      importButton.textContent = "Import";
    }
  });

  // The text shows what the store holds.
  function showTokens() {
    const css = tokensToCss(store.tokens());
    if (code.value !== css) code.value = css;
    problem.hidden = true;
  }

  function commitText() {
    const parsed = parseTokensCss(code.value);
    problem.hidden = !parsed.error;
    if (parsed.error) {
      problem.textContent = parsed.error;
      return;
    }
    applyTokens(store, parsed.tokens);
    showTokens();
  }

  code.addEventListener("change", commitText);
  // Typing here is typing, not a shortcut for the canvas.
  code.addEventListener("keydown", (event) => event.stopPropagation());

  panel.addEventListener("click", (event) => {
    const button = event.target.closest(".theme-copy");
    if (!button) return;
    navigator.clipboard.writeText(tokensToCss(store.tokens(), button.dataset.format))
      .then(() => toast("Theme copied to clipboard"), () => toast("Could not copy the theme"));
  });

  // Design shows the pages and layers, Theme shows the tokens.
  function selectTab(index) {
    const onTheme = index === THEME_TAB;
    tabs.forEach((button, i) => button.setAttribute("aria-selected", String(i === index)));
    left.toggleAttribute("data-theme", onTheme);
    panel.hidden = !onTheme;
    store.setUI({ tab: onTheme ? "theme" : "design" });
    if (onTheme) showTokens();
  }
  tabs.forEach((button, i) => button.addEventListener("click", () => selectTab(i)));

  store.subscribe((reason) => {
    if (panel.hidden || reason === "ui" || reason === "selection") return;
    // An edit from outside the text (undo, an agent, another person) repaints it, unless the person is typing in it
    // or it is waiting to be fixed.
    if (document.activeElement !== code && problem.hidden) showTokens();
  });

  return { repo: () => field.value || null, showRepo };
}
