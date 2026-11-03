// node serve.mjs [port]: the editor at http://127.0.0.1:4192/ (modules need a server, not file://),
// with its files kept in ./.data. See server.mjs for what the server does.
import { startServer } from "./server/server.mjs";

// The keys and settings kept in .env.local (ANTHROPIC_API_KEY, EDITOR_CREDITS ...), not in git; what is already set in the environment wins.
try { process.loadEnvFile(new URL("./.env.local", import.meta.url)); } catch (error) { if (error.code !== "ENOENT") throw error; }

const port = Number(process.argv[2] ?? 4192);
try {
  const { url, dataDir } = await startServer({ port, auth: process.env.EDITOR_AUTH === "1", ...(process.env.EDITOR_DATA ? { dataDir: process.env.EDITOR_DATA } : {}) });
  console.log(`Editor\nOpen ${url}  (Ctrl-C to stop)\nFiles in ${dataDir}${process.env.EDITOR_AUTH === "1" ? "\nSign-in is on" : ""}`);
} catch (error) {
  if (error.code !== "EADDRINUSE") throw error;
  console.log(`Already running: open http://127.0.0.1:${port}/`);
  process.exit(0);
}
