// The Theme tab of the left panel: the file's tokens as one block of real CSS that can be read, edited and pasted
// into a project. When the text is left (its `change` event) it is read back and written to the store as one undo
// step. Text that is not valid CSS stays as typed, with the reason under it, and changes nothing.
//
// Tokens are CSS variables of the canvas (canvas.js). A token is identified by its variable name, so editing a value
// in the text keeps the token, while editing a name is a delete plus an add; the elements that used the old name keep
// its value (store.js).
import { cssName, tokensToCss, parseTokensCss } from "../core/tokens.js";
import { toast } from "../ui/toast.js";

const THEME_TAB = 1; // Design is the first tab, Theme the second (⌥1 and ⌥2 click them)

export function mountTheme(left, store) {
  const tabs = [...left.querySelectorAll(".tabs [role=tab]")];

  const panel = Object.assign(document.createElement("section"), { className: "theme", hidden: true });
  left.querySelector(".tabs").after(panel);
  panel.innerHTML = `
    <div class="theme-actions">
      <button type="button" class="theme-copy" data-format="tailwind">Copy as @theme</button>
      <button type="button" class="theme-copy" data-format="css">Copy as :root</button>
    </div>
    <textarea class="theme-code" spellcheck="false" wrap="off" aria-label="Theme tokens as CSS" aria-describedby="theme-error"></textarea>
    <p class="theme-error" id="theme-error" role="alert" hidden></p>`;
  const code = panel.querySelector(".theme-code");
  const problem = panel.querySelector(".theme-error");
  code.readOnly = store.readOnly;

  // The text shows what the store holds.
  function showTokens() {
    const css = tokensToCss(store.tokens());
    if (code.value !== css) code.value = css;
    problem.hidden = true;
  }

  /** What the text asks for, compared with the store: tokens to delete, to change, and to add. */
  function planChanges(wanted) {
    const wantedByName = new Map(wanted.map((token) => [cssName(token), token]));
    const existing = store.tokens();
    const known = new Set(existing.map(cssName));
    return {
      remove: existing.filter((token) => !wantedByName.has(cssName(token))),
      update: existing.filter((token) => wantedByName.has(cssName(token)) && wantedByName.get(cssName(token)).value !== token.value)
        .map((token) => ({ id: token.id, value: wantedByName.get(cssName(token)).value })),
      add: [...wantedByName].filter(([name]) => !known.has(name)).map(([, token]) => token),
    };
  }

  function commitText() {
    const parsed = parseTokensCss(code.value);
    problem.hidden = !parsed.error;
    if (parsed.error) {
      problem.textContent = parsed.error;
      return;
    }
    const { remove, update, add } = planChanges(parsed.tokens);
    if (remove.length || update.length || add.length) {
      store.transact("Edit theme", () => {
        if (remove.length) store.deleteTokens(remove.map((token) => token.id));
        for (const { id, value } of update) store.updateToken(id, { value });
        for (const { type, name, value } of add) store.updateToken(store.createToken(type), { name, value });
      });
    }
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
}
