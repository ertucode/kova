import fs from "fs/promises";
import { expandHome } from "./expand-home.js";
import { GenericError, GenericResult } from "../../common/GenericError.js";
import { Result } from "../../common/Result.js";

export async function readFileAsBase64(
  filePath: string
): Promise<GenericResult<{ base64: string }>> {
  try {
    const expandedPath = expandHome(filePath);
    const buffer = await fs.readFile(expandedPath);
    const base64 = buffer.toString("base64");
    return Result.Success({ base64 });
  } catch (error) {
    if (error instanceof Error) {
      return GenericError.Message(error.message);
    }
    return GenericError.Unknown(error);
  }
}
