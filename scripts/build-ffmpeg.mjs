// scripts/build-ffmpeg.mjs
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

// Using FFmpeg static builds from https://evermeet.cx/ffmpeg/
// These are static builds specifically for macOS
const FFMPEG_URL = "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip";

console.log("→ Downloading ffmpeg...");
const tmpFile = path.join(os.tmpdir(), "ffmpeg.zip");
await download(FFMPEG_URL, tmpFile);

console.log("→ Extracting...");
await exec(`unzip -o ${tmpFile} -d ${OUT}`);

// Make sure the binary is executable
await exec(`chmod +x ${path.join(OUT, "ffmpeg")}`);

console.log("✔ ffmpeg installed into vendor-bin/ffmpeg");
