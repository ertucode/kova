// scripts/build-fd.mjs
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

const FD_URL =
  "https://github.com/sharkdp/fd/releases/download/v10.2.0/fd-v10.2.0-x86_64-apple-darwin.tar.gz";

console.log("→ Downloading fd...");
const tmpFile = path.join(os.tmpdir(), "fd.tgz");
await download(FD_URL, tmpFile);

console.log("→ Extracting...");
await exec(`tar -xzf ${tmpFile} -C ${OUT}`);

const extractedDir = (await fs.readdir(OUT)).find((d) =>
  d.startsWith("fd-"),
);

await fs.rename(path.join(OUT, extractedDir, "fd"), path.join(OUT, "fd"));

await fs.rm(path.join(OUT, extractedDir), { recursive: true });
console.log("✔ fd installed into vendor-bin/fd");
