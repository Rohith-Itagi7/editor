// Builds the desktop app with @electron/packager, into out/Editor-<platform>-<arch>/. Unsigned.
//   node desktop/package.mjs              this machine's platform and processor
//   node desktop/package.mjs mac          Apple silicon     mac-intel   Intel Macs
//   node desktop/package.mjs win          Windows x64       win-arm64   Windows on Arm
//   node desktop/package.mjs linux        Linux x64         linux-arm64 Linux on Arm
//   node desktop/package.mjs all          every one of them
// Any machine builds any target. A Mac build made elsewhere has no code signature and no asar integrity check.
import { packager } from "@electron/packager";
import path from "node:path";

export const TARGETS = {
  "mac": { platform: "darwin", arch: "arm64" },
  "mac-intel": { platform: "darwin", arch: "x64" },
  "win": { platform: "win32", arch: "x64" },
  "win-arm64": { platform: "win32", arch: "arm64" },
  "linux": { platform: "linux", arch: "x64" },
  "linux-arm64": { platform: "linux", arch: "arm64" },
};

const here = () => Object.keys(TARGETS).find((name) => TARGETS[name].platform === process.platform && TARGETS[name].arch === process.arch);

async function build(name) {
  const target = TARGETS[name];
  if (!target) throw new Error(`No target "${name}"; one of: ${Object.keys(TARGETS).join(", ")}, all`);
  const [out] = await packager({
    dir: path.join(import.meta.dirname, ".."),
    name: "Editor",
    out: "out",
    overwrite: true,
    prune: true,
    ignore: /^\/(out|\.data|\.git|\.env\.local|CLAUDE\.md|tests)($|\/)/,
    ...target,
  });
  console.log(`${name}: ${out}`);
}

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  const asked = process.argv.slice(2);
  const names = asked.includes("all") ? Object.keys(TARGETS) : asked.length ? asked : [here() ?? "mac"];
  for (const name of names) await build(name);
}
