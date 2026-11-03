// The GitHub repo a file is connected to: reading it through the server (/api/github, server/github.mjs), its CSS
// variables as the file's tokens, and the request that asks an agent for its Components page.
import { applyTokens } from "../core/tokens.js";
import { extractDeclarations, mapToTheme, pickTokenFiles } from "../core/repo-tokens.js";

/** The repo's file list (no `path`), or one of its text files. Throws with the server's reason. */
export async function repoFetch(repo, path) {
  const query = `repo=${encodeURIComponent(repo)}${path !== undefined ? `&path=${encodeURIComponent(path)}` : ""}`;
  const response = await fetch(`/api/github?${query}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `The server answered ${response.status}`);
  return data;
}

/**
 * The repo's theme into the file's tokens, as one undo step that adds and updates but removes nothing.
 * Answers { files, added, updated, dropped } for a toast.
 */
export async function importRepoTokens(store, repo) {
  const { files } = await repoFetch(repo);
  const picked = pickTokenFiles(files);
  const declarations = [];
  for (const path of picked) declarations.push(...extractDeclarations((await repoFetch(repo, path)).text));
  const { tokens, dropped } = mapToTheme(declarations);
  const { add, update } = applyTokens(store, tokens, { label: `Import tokens from ${repo}`, replace: false });
  return { files: picked, added: add.length, updated: update.length, dropped };
}

// The components worth a reference, the primitives first; the agents split them between them.
export const COMPONENTS = ["Button", "Input", "Badge", "Card", "Checkbox", "Switch", "Select", "Tabs", "Alert", "Avatar", "Dialog", "Table"];

/** The page the components go on: the one named "Components", made if it is not there. Answers its id. */
export function componentsPage(store) {
  const found = store.pages().find((p) => p.label === "Components");
  if (found) return found.id;
  let id;
  store.transact("Add page", () => {
    id = store.addPage({ activate: false });
    store.renamePage(id, "Components");
  });
  return id;
}

/** What one agent is asked for: its share of the repo's components as HTML, each on an artboard of the Components page. */
export const componentsPrompt = (repo, pageId, names, x) => `This file is connected to the GitHub repo ${repo}. Other agents are building the rest of its components at the same time; yours are: ${names.join(", ")}. Build each as plain HTML the file can duplicate from, on the page with ID ${pageId} ("Components"); never touch other pages or other agents' artboards.
1. get_basic_info once. list_repo_files with "" and find the UI component folder (src/components/ui, components/ui, src/components, packages/*/src).
2. read_repo_file each of your components (skip a file over 40 KB; stories, tests and index files are not components). One the repo does not have, you skip and say so.
3. One component per reply, so the user watches them appear: create_artboard on that page named exactly like the component, styles width 960px, height 400px, left ${x}px, top by its place in your list (0px, 600px, 1200px, ...), background var(--color-background) if the file has that token else #ffffff, padding 32px, flex column, gap 24px; then ONE write_html (insert-children): one row per variant and per size/state (default, disabled), plain HTML with inline styles, a 12px caption above each; then height "fit-content" with update_styles. Where the code uses a Tailwind class or variable that matches a file token (bg-primary → var(--color-primary), rounded-md → var(--radius-md), text-sm → var(--text-sm)) use the token; literal values only where there is none. Real labels, no logic, no scripts.
4. finish_working_on_nodes. Say in a sentence which components you made and which you skipped.`;
