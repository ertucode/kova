import path from "path";
import { app } from "electron";

// In development: use vendor-bin in project root
// In production: extraResources are placed relative to the app bundle
//   - macOS: Contents/Resources/vendor-bin
//   - Linux/Windows: resources/vendor-bin
const base =
  process.env.NODE_ENV === "development"
    ? path.join(process.cwd(), "vendor-bin")
    : process.platform === "darwin"
      ? path.join(path.dirname(app.getAppPath()), "vendor-bin")
      : path.join(process.resourcesPath, "vendor-bin");

export const rgPath = path.join(base, "rg");
export const fzyPath = path.join(base, "fzy", "fzy");
export const fdPath = path.join(base, "fd");
export const ffmpegPath = path.join(base, "ffmpeg");
export const sevenZPath = path.join(base, "7zz");
