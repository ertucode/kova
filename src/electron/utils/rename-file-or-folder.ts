import { rename } from "fs/promises";
import { join, dirname } from "path";
import { expandHome } from "./expand-home.js";
import { GenericError, GenericResult } from "../../common/GenericError.js";
import { Result } from "../../common/Result.js";

export async function renameFileOrFolder(
  fullPath: string,
  newName: string,
): Promise<GenericResult<{ newPath: string }>> {
  try {
    const expandedPath = expandHome(fullPath);
    const dir = dirname(expandedPath);
    const newPath = join(dir, newName);

    // Check if the new path already exists
    try {
      const fs = await import("fs/promises");
      await fs.access(newPath);
      return GenericError.Message(
        `A file or folder named "${newName}" already exists`,
      );
    } catch {
      // File doesn't exist, we can proceed
    }

    await rename(expandedPath, newPath);
    return Result.Success({ newPath });
  } catch (error) {
    console.error("Error renaming file or folder:", error);
    return GenericError.Message(
      error instanceof Error ? error.message : "Failed to rename",
    );
  }
}
