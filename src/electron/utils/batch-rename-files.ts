import { rename } from "fs/promises";
import { join, dirname } from "path";
import { expandHome } from "./expand-home.js";
import { GenericError, GenericResult } from "../../common/GenericError.js";
import { Result } from "../../common/Result.js";

type RenameItem = {
  fullPath: string;
  newName: string;
};

type RenamedPath = {
  oldPath: string;
  newPath: string;
};

export async function batchRenameFiles(
  items: RenameItem[]
): Promise<GenericResult<{ renamedPaths: RenamedPath[] }>> {
  const renamedPaths: RenamedPath[] = [];
  const errors: string[] = [];

  try {
    // First, validate all items
    const validationErrors: string[] = [];
    const newPaths = new Set<string>();

    for (const item of items) {
      const expandedPath = expandHome(item.fullPath);
      const dir = dirname(expandedPath);
      const newPath = join(dir, item.newName);

      // Check for duplicates in the batch
      if (newPaths.has(newPath)) {
        validationErrors.push(`Duplicate destination path: ${newPath}`);
        continue;
      }
      newPaths.add(newPath);

      // Check if the new path already exists (unless it's the same file)
      if (newPath !== expandedPath) {
        try {
          const fs = await import("fs/promises");
          await fs.access(newPath);
          validationErrors.push(`File already exists: ${item.newName}`);
        } catch {
          // File doesn't exist, we can proceed
        }
      }
    }

    if (validationErrors.length > 0) {
      return GenericError.Message(
        `Validation failed:\n${validationErrors.join("\n")}`
      );
    }

    // Perform all renames
    for (const item of items) {
      try {
        const expandedPath = expandHome(item.fullPath);
        const dir = dirname(expandedPath);
        const newPath = join(dir, item.newName);

        // Skip if source and destination are the same
        if (expandedPath === newPath) {
          continue;
        }

        await rename(expandedPath, newPath);
        renamedPaths.push({ oldPath: expandedPath, newPath });
      } catch (error) {
        errors.push(
          `Failed to rename ${item.fullPath}: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    }

    // If some renames failed, we need to report it
    if (errors.length > 0) {
      return GenericError.Message(
        `Some renames failed:\n${errors.join("\n")}\n\nSuccessfully renamed ${renamedPaths.length} items.`
      );
    }

    return Result.Success({ renamedPaths });
  } catch (error) {
    console.error("Error in batch rename:", error);
    return GenericError.Message(
      error instanceof Error ? error.message : "Failed to batch rename files"
    );
  }
}
