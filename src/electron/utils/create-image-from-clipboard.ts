import fs from "fs/promises";
import path from "path";
import { clipboard, nativeImage } from "electron";
import { expandHome } from "./expand-home.js";
import { GenericError, GenericResult } from "../../common/GenericError.js";
import { Result } from "../../common/Result.js";

export async function createImageFromClipboard(
  parentDir: string,
  name: string,
): Promise<GenericResult<{ path: string }>> {
  try {
    const expandedDir = expandHome(parentDir);

    // Get image from clipboard
    const image = clipboard.readImage();
    
    if (image.isEmpty()) {
      return GenericError.Message("No image in clipboard");
    }

    // Determine format based on file extension
    const ext = path.extname(name).toLowerCase();
    let buffer: Buffer;
    
    if (ext === ".png" || ext === "") {
      buffer = image.toPNG();
      // If no extension, add .png
      if (!ext) {
        name = name + ".png";
      }
    } else if (ext === ".jpg" || ext === ".jpeg") {
      buffer = image.toJPEG(90); // 90% quality
    } else {
      // Default to PNG for other formats
      buffer = image.toPNG();
    }

    const fullPath = path.join(expandedDir, name);

    // Check if file already exists
    try {
      await fs.access(fullPath);
      return GenericError.Message(`File ${name} already exists`);
    } catch {
      // File doesn't exist, which is what we want
    }

    // Write the image file
    await fs.writeFile(fullPath, buffer);

    return Result.Success({ path: fullPath });
  } catch (error) {
    if (error instanceof Error) {
      return GenericError.Message(error.message);
    }
    return GenericError.Unknown(error);
  }
}

export function hasClipboardImage(): boolean {
  try {
    const image = clipboard.readImage();
    return !image.isEmpty();
  } catch {
    return false;
  }
}
