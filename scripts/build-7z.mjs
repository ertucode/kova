// scripts/build-7z.mjs
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

// 7-Zip standalone console version for macOS
const SEVEN_ZIP_URL =
  "https://www.7-zip.org/a/7z2408-mac.tar.xz";

console.log("→ Downloading 7-Zip...");
const tmpFile = path.join(os.tmpdir(), "7z.tar.xz");
await download(SEVEN_ZIP_URL, tmpFile);

console.log("→ Extracting...");
const tmpDir = path.join(os.tmpdir(), "7z-extract");
await fs.mkdir(tmpDir, { recursive: true });
await exec(`tar -xf ${tmpFile} -C ${tmpDir}`);

// The 7zz binary should be in the extracted directory
const sevenZBinary = path.join(tmpDir, "7zz");

// Copy the binary to vendor-bin
await fs.copyFile(sevenZBinary, path.join(OUT, "7zz"));
await fs.chmod(path.join(OUT, "7zz"), 0o755);

// Cleanup
await fs.rm(tmpDir, { recursive: true, force: true });
await fs.unlink(tmpFile).catch(() => {});

console.log("✔ 7-Zip installed into vendor-bin/7zz");
