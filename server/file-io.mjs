// What Open and Save As do with a file on the disk, apart from asking where (the app's menu does that,
// electron-main.mjs). A saved file is the file's own JSON, { name, pages, tokens, nodes, threads }, the
// same that the home page's Download and Open file use, so one can be opened by the other.
import fs from "node:fs/promises";
import path from "node:path";

const api = async (base, pathname, options) => {
  const response = await fetch(new URL(pathname, base), options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `The server answered ${response.status}`);
  return data;
};

/** Saves the open file at `filePath`. */
export async function exportFile(base, id, filePath) {
  const { name, pages, tokens, threads, nodes } = await api(base, `api/files/${id}`);
  await fs.writeFile(filePath, JSON.stringify({ name, pages, tokens: tokens ?? [], threads: threads ?? [], nodes }));
  return { name };
}

/** Reads a saved file and makes a new file of it. Returns the new file's id. */
export async function importFile(base, filePath) {
  let data;
  try {
    data = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(error instanceof SyntaxError ? "That is not a JSON file" : `Could not read the file: ${error.message}`);
  }
  if (!Array.isArray(data?.nodes)) throw new Error("That is not a file saved from this editor");
  const patch = { nodes: data.nodes, name: typeof data.name === "string" && data.name.trim() ? data.name : path.basename(filePath, ".json") };
  for (const part of ["pages", "tokens", "threads"]) if (Array.isArray(data[part])) patch[part] = data[part];
  return (await api(base, "api/files", { method: "POST", body: JSON.stringify(patch) })).id;
}
