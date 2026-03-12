import { exec } from "child_process";
import { ShellHelpers } from "./ShellHelpers.js";

// find path -type f -print0 | tr -cd '\0' | wc -c
export async function countFilesInPath(path: string) {
  return new Promise<number>((resolve, reject) => {
    exec(
      `find ${ShellHelpers.escape(path)} -type f -print0 | tr -cd '\\0' | wc -c`,
      (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(parseInt(stdout));
        }
      },
    );
  });
}
