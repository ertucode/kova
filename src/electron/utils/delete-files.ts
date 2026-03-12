import fs from "fs/promises";
import { shell } from "electron";
import { expandHome } from "./expand-home.js";
import { GenericError, GenericResult } from "../../common/GenericError.js";
import { Result } from "../../common/Result.js";
import { TaskManager } from "../TaskManager.js";
import { Tasks } from "../../common/Tasks.js";

export async function deleteFiles(request: {
  filePaths: string[];
  clientMetadata: Tasks.ClientMetadata;
}): Promise<GenericResult<void>> {
  const { filePaths, clientMetadata } = request;
  const taskId = TaskManager.create({
    type: "delete",
    metadata: { files: filePaths },
    progress: 0,
    clientMetadata,
  });
  try {
    let totalDeleted = 0;
    // Delete all files/directories
    await Promise.all(
      filePaths.map(async (filePath) => {
        const fullPath = expandHome(filePath);

        // Check if it's a file or directory
        const stats = await fs.stat(fullPath);

        if (stats.isDirectory()) {
          // Delete directory recursively
          await fs.rm(fullPath, { recursive: true, force: true });
        } else {
          // Delete file
          await fs.unlink(fullPath);
        }
        totalDeleted++;
        TaskManager.progress(taskId, (totalDeleted / filePaths.length) * 100);
      }),
    );

    const result = Result.Success(undefined);
    TaskManager.result(taskId, result);
    return result;
  } catch (error) {
    const result =
      error instanceof Error
        ? GenericError.Message(error.message)
        : GenericError.Unknown(error);
    TaskManager.result(taskId, result);
    return result;
  }
}

/**
 * Safely delete files by moving them to the system trash.
 * Users can restore files from Finder (macOS) / Recycle Bin (Windows) / Trash (Linux).
 */
export async function deleteFilesSafe(request: {
  filePaths: string[];
  clientMetadata: Tasks.ClientMetadata;
}): Promise<GenericResult<void>> {
  const { filePaths, clientMetadata } = request;
  const taskId = TaskManager.create({
    type: "delete",
    metadata: { files: filePaths },
    progress: 0,
    clientMetadata,
  });

  try {
    let totalDeleted = 0;

    // Move all files/directories to system trash
    await Promise.all(
      filePaths.map(async (filePath) => {
        const fullPath = expandHome(filePath);
        await shell.trashItem(fullPath);
        totalDeleted++;
        TaskManager.progress(taskId, (totalDeleted / filePaths.length) * 100);
      }),
    );

    const result = Result.Success(undefined);
    TaskManager.result(taskId, result);
    return result;
  } catch (error) {
    const result =
      error instanceof Error
        ? GenericError.Message(error.message)
        : GenericError.Unknown(error);
    TaskManager.result(taskId, result);
    return result;
  }
}
