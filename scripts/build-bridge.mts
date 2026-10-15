/**
 * Builds Hookline Bridge into one program for the computer it runs on:
 * bundles the bridge and everything it needs into a single script, then
 * bakes that into a copy of Node as a single executable application.
 * The GitHub workflow runs this on Windows, macOS and Linux to make each
 * download.
 *
 *   pnpm bridge:build
 */
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
// postject has no types; its inject is all we use
// @ts-expect-error untyped package
import { inject } from "postject";

const out = "dist-bridge";
const plat = process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux";
const exe = `${out}/hookline-bridge-${plat}-${process.arch}${plat === "win" ? ".exe" : ""}`;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: ["bridge/main.mts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: `${out}/bridge.cjs`,
  // ws can use these native speedups if they're there; it works without
  external: ["bufferutil", "utf-8-validate"],
  logLevel: "warning",
});

writeFileSync(`${out}/sea-config.json`, JSON.stringify({ main: `${out}/bridge.cjs`, output: `${out}/bridge.blob`, disableExperimentalSEAWarning: true }));
execFileSync(process.execPath, ["--experimental-sea-config", `${out}/sea-config.json`], { stdio: "inherit" });

copyFileSync(process.execPath, exe);
chmodSync(exe, 0o755);
if (plat === "mac") execFileSync("codesign", ["--remove-signature", exe]);
await inject(exe, "NODE_SEA_BLOB", readFileSync(`${out}/bridge.blob`), {
  sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ...(plat === "mac" ? { machoSegmentName: "NODE_SEA" } : {}),
});
// macOS won't run an unsigned program at all; an ad-hoc signature lets it, once it's allowed in Privacy & Security
if (plat === "mac") execFileSync("codesign", ["--sign", "-", exe]);
console.log(`Built ${exe}`);

// a browser drops a program's "can run" permission when it downloads it, so the Mac
// and Linux downloads are archives, which keep it
const name = exe.slice(out.length + 1);
if (plat === "mac") execFileSync("ditto", ["-c", "-k", "--keepParent", exe, `${exe}.zip`]);
if (plat === "linux") execFileSync("tar", ["-czf", `${exe}.tar.gz`, "-C", out, name]);
if (plat !== "win") console.log(`Packed ${exe}${plat === "mac" ? ".zip" : ".tar.gz"}`);
