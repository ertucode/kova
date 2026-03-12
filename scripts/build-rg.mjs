// scripts/build-rg.mjs
import { download } from "./utils/download.mjs";
import { exec as _exec } from "child_process";
import { promises as fs } from "fs";
import { promisify } from "util";
import path from "path";
import os from "os";

const exec = promisify(_exec);

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const OUT = path.join(ROOT, "vendor-bin");
await fs.mkdir(OUT, { recursive: true });

const RG_URL =
  "https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-x86_64-apple-darwin.tar.gz";

console.log("→ Downloading ripgrep...");
const tmpFile = path.join(os.tmpdir(), "rg.tgz");
await download(RG_URL, tmpFile);

console.log("→ Extracting...");
await exec(`tar -xzf ${tmpFile} -C ${OUT}`);

const extractedDir = (await fs.readdir(OUT)).find((d) =>
  d.startsWith("ripgrep"),
);

await fs.rename(path.join(OUT, extractedDir, "rg"), path.join(OUT, "rg"));

await fs.rm(path.join(OUT, extractedDir), { recursive: true });
console.log("✔ ripgrep installed into vendor-bin/rg");
