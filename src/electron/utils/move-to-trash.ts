import electron from "electron";
import { expandHome } from "./expand-home.js";
import { GenericError, GenericResult } from "../../common/GenericError.js";
import { Result } from "../../common/Result.js";

/**
 * Move a file or directory to the system trash
 * @param filePath - Path to file or directory to trash
 * @returns Success if moved to trash, error otherwise
 */
export async function moveToTrash(
  filePath: string,
): Promise<GenericResult<void>> {
  try {
    const fullPath = expandHome(filePath);
    
    // Use Electron's shell.trashItem which works cross-platform
    await electron.shell.trashItem(fullPath);
    
    return Result.Success(undefined);
  } catch (error) {
    if (error instanceof Error) {
      return GenericError.Message(error.message);
    }
    return GenericError.Unknown(error);
  }
}
