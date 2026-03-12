import fs from "fs";
import { spawn } from "child_process";
import { PathHelpers } from "../../../common/PathHelpers.js";
import { Archive } from "./Archive.js";
import { Result } from "../../../common/Result.js";
import { GenericError } from "../../../common/GenericError.js";
import { ArchiveTypes } from "../../../common/ArchiveTypes.js";

export namespace Bzip2 {
  export function archive(
    opts: Archive.ArchiveOpts,
  ): Promise<Archive.ArchiveResult> {
    return new Promise<Archive.ArchiveResult>((resolve) => {
      const { source, destination, progressCallback, abortSignal } = opts;

      const bz2Path = destination.endsWith(".bz2")
        ? destination
        : destination + ".bz2";

      let settled = false;
      let completedSuccessfully = false;

      const cleanupPartialBz2 = async () => {
        if (completedSuccessfully) return;

        try {
          await fs.promises.unlink(bz2Path);
        } catch (err: any) {
          if (err?.code !== "ENOENT") {
            console.warn("Failed to cleanup partial bz2:", err);
          }
        }
      };

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;

        if (err) {
          void cleanupPartialBz2();
          resolve(GenericError.Unknown(err));
        } else {
          completedSuccessfully = true;
          resolve(Result.Success(undefined));
        }
      };

      // BZIP2 can only compress single files
      if (source.length !== 1) {
        return finish(
          new Error(
            "BZIP2 can only compress a single file. Use TAR.BZ2 for multiple files or directories.",
          ),
        );
      }

      const sourceFile = source[0];

      try {
        const stats = fs.statSync(sourceFile);
        if (stats.isDirectory()) {
          return finish(
            new Error(
              "BZIP2 can only compress single files, not directories. Use TAR.BZ2 for directories.",
            ),
          );
        }
      } catch (err) {
        return finish(err as Error);
      }

      // -----------------
      // CANCELLATION
      // -----------------
      const cancel = () => {
        const err = new Error("Archive cancelled");
        if (bzip2Process && !bzip2Process.killed) {
          bzip2Process.kill("SIGTERM");
        }
        finish(err);
      };

      if (abortSignal.aborted) {
        return cancel();
      }
      abortSignal.addEventListener("abort", cancel, { once: true });

      // -----------------
      // SPAWN PROCESS
      // -----------------
      // bzip2 -c source > destination.bz2
      const args = ["-c", sourceFile];

      const bzip2Process = spawn("bzip2", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Create output stream
      const outputStream = fs.createWriteStream(bz2Path);

      outputStream.on("error", (err) => {
        bzip2Process.kill("SIGTERM");
        finish(err);
      });

      // Pipe bzip2 output to file
      bzip2Process.stdout?.pipe(outputStream);

      // -----------------
      // PROGRESS
      // -----------------
      if (progressCallback) {
        const totalSize = fs.statSync(sourceFile).size;
        let processedBytes = 0;

        bzip2Process.stdout?.on("data", (chunk) => {
          processedBytes += chunk.length;
          if (totalSize > 0) {
            progressCallback(Math.min((processedBytes / totalSize) * 100, 99));
          }
        });
      }

      // -----------------
      // ERRORS
      // -----------------
      let errorOutput = "";
      bzip2Process.stderr?.on("data", (data) => {
        errorOutput += data.toString();
      });

      // -----------------
      // COMPLETION
      // -----------------
      outputStream.on("close", () => {
        if (!settled) {
          progressCallback?.(100); // Ensure we reach 100% on completion
          finish();
        }
      });

      bzip2Process.on("close", (code) => {
        if (code === 0) {
          outputStream.end();
        } else {
          outputStream.destroy();
          finish(
            new Error(`bzip2 process exited with code ${code}: ${errorOutput}`),
          );
        }
      });

      bzip2Process.on("error", (err) => {
        outputStream.destroy();
        finish(err);
      });
    });
  }

  export function unarchive(
    opts: Archive.UnarchiveOpts,
  ): Promise<Archive.UnarchiveResult> {
    return new Promise<Archive.UnarchiveResult>((resolve) => {
      const {
        source, // .bz2 file
        destination, // output file (not a directory)
        progressCallback,
        abortSignal,
      } = opts;

      let settled = false;
      let completedSuccessfully = false;

      const cleanupPartialExtract = async () => {
        if (completedSuccessfully) return;

        try {
          await fs.promises.unlink(destination);
        } catch {
          // best-effort cleanup
        }
      };

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;

        if (err) {
          void cleanupPartialExtract();
          resolve(GenericError.Unknown(err));
        } else {
          completedSuccessfully = true;
          resolve(Result.Success(undefined));
        }
      };

      // -----------------
      // ENSURE PARENT DIRECTORY EXISTS
      // -----------------
      try {
        const parentDir = PathHelpers.parent(destination).path;
        fs.mkdirSync(parentDir, { recursive: true });
      } catch (err) {
        return finish(err as Error);
      }

      // -----------------
      // CANCELLATION
      // -----------------
      const cancel = () => {
        const err = new Error("Unarchive cancelled");
        if (bunzip2Process && !bunzip2Process.killed) {
          bunzip2Process.kill("SIGTERM");
        }
        finish(err);
      };

      if (abortSignal.aborted) {
        return cancel();
      }
      abortSignal.addEventListener("abort", cancel, { once: true });

      // -----------------
      // SPAWN PROCESS
      // -----------------
      // bunzip2 -c source.bz2 > destination
      const args = ["-c", source];

      const bunzip2Process = spawn("bunzip2", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Create output stream
      const outputStream = fs.createWriteStream(destination);

      outputStream.on("error", (err) => {
        bunzip2Process.kill("SIGTERM");
        finish(err);
      });

      // Pipe bunzip2 output to file
      bunzip2Process.stdout?.pipe(outputStream);

      // -----------------
      // PROGRESS
      // -----------------
      if (progressCallback) {
        const totalSize = fs.statSync(source).size;
        let processedBytes = 0;

        bunzip2Process.stdout?.on("data", (chunk) => {
          processedBytes += chunk.length;
          if (totalSize > 0) {
            progressCallback(Math.min((processedBytes / totalSize) * 100, 99));
          }
        });
      }

      // -----------------
      // ERRORS
      // -----------------
      let errorOutput = "";
      bunzip2Process.stderr?.on("data", (data) => {
        errorOutput += data.toString();
      });

      // -----------------
      // COMPLETION
      // -----------------
      outputStream.on("close", () => {
        if (!settled) {
          progressCallback?.(100); // Ensure we reach 100% on completion
          finish();
        }
      });

      bunzip2Process.on("close", (code) => {
        if (code === 0) {
          outputStream.end();
        } else {
          outputStream.destroy();
          finish(
            new Error(
              `bunzip2 process exited with code ${code}: ${errorOutput}`,
            ),
          );
        }
      });

      bunzip2Process.on("error", (err) => {
        outputStream.destroy();
        finish(err);
      });
    });
  }

  export async function readContents(
    archivePath: string,
  ): Promise<ArchiveTypes.ReadContentsResult> {
    return GenericError.Message(
      "BZIP2 is a single-file compression format and does not support listing contents. Only container formats like ZIP, 7z, and TAR variants support this operation.",
    );
  }
}
