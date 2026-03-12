import fs from "fs";
import { spawn } from "child_process";
import { PathHelpers } from "../../../common/PathHelpers.js";
import { Archive } from "./Archive.js";
import { Result } from "../../../common/Result.js";
import { GenericError } from "../../../common/GenericError.js";
import { ArchiveTypes } from "../../../common/ArchiveTypes.js";

export namespace Gzip {
  export function archive(
    opts: Archive.ArchiveOpts,
  ): Promise<Archive.ArchiveResult> {
    return new Promise<Archive.ArchiveResult>((resolve) => {
      const { source, destination, progressCallback, abortSignal } = opts;

      const gzPath = destination.endsWith(".gz")
        ? destination
        : destination + ".gz";

      let settled = false;
      let completedSuccessfully = false;

      const cleanupPartialGz = async () => {
        if (completedSuccessfully) return;

        try {
          await fs.promises.unlink(gzPath);
        } catch (err: any) {
          if (err?.code !== "ENOENT") {
            console.warn("Failed to cleanup partial gz:", err);
          }
        }
      };

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;

        if (err) {
          void cleanupPartialGz();
          resolve(GenericError.Unknown(err));
        } else {
          completedSuccessfully = true;
          resolve(Result.Success(undefined));
        }
      };

      // GZIP can only compress single files
      if (source.length !== 1) {
        return finish(
          new Error(
            "GZIP can only compress a single file. Use TAR.GZ for multiple files or directories.",
          ),
        );
      }

      const sourceFile = source[0];

      try {
        const stats = fs.statSync(sourceFile);
        if (stats.isDirectory()) {
          return finish(
            new Error(
              "GZIP can only compress single files, not directories. Use TAR.GZ for directories.",
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
        if (gzipProcess && !gzipProcess.killed) {
          gzipProcess.kill("SIGTERM");
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
      // gzip -c source > destination.gz
      const args = ["-c", sourceFile];

      const gzipProcess = spawn("gzip", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Create output stream
      const outputStream = fs.createWriteStream(gzPath);

      outputStream.on("error", (err) => {
        gzipProcess.kill("SIGTERM");
        finish(err);
      });

      // Pipe gzip output to file
      gzipProcess.stdout?.pipe(outputStream);

      // -----------------
      // PROGRESS
      // -----------------
      if (progressCallback) {
        const totalSize = fs.statSync(sourceFile).size;
        let processedBytes = 0;

        gzipProcess.stdout?.on("data", (chunk) => {
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
      gzipProcess.stderr?.on("data", (data) => {
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

      gzipProcess.on("close", (code) => {
        if (code === 0) {
          outputStream.end();
        } else {
          outputStream.destroy();
          finish(
            new Error(`gzip process exited with code ${code}: ${errorOutput}`),
          );
        }
      });

      gzipProcess.on("error", (err) => {
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
        source, // .gz file
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
        if (gunzipProcess && !gunzipProcess.killed) {
          gunzipProcess.kill("SIGTERM");
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
      // gunzip -c source.gz > destination
      const args = ["-c", source];

      const gunzipProcess = spawn("gunzip", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Create output stream
      const outputStream = fs.createWriteStream(destination);

      outputStream.on("error", (err) => {
        gunzipProcess.kill("SIGTERM");
        finish(err);
      });

      // Pipe gunzip output to file
      gunzipProcess.stdout?.pipe(outputStream);

      // -----------------
      // PROGRESS
      // -----------------
      if (progressCallback) {
        const totalSize = fs.statSync(source).size;
        let processedBytes = 0;

        gunzipProcess.stdout?.on("data", (chunk) => {
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
      gunzipProcess.stderr?.on("data", (data) => {
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

      gunzipProcess.on("close", (code) => {
        if (code === 0) {
          outputStream.end();
        } else {
          outputStream.destroy();
          finish(
            new Error(
              `gunzip process exited with code ${code}: ${errorOutput}`,
            ),
          );
        }
      });

      gunzipProcess.on("error", (err) => {
        outputStream.destroy();
        finish(err);
      });
    });
  }

  export async function readContents(
    archivePath: string,
  ): Promise<ArchiveTypes.ReadContentsResult> {
    return GenericError.Message(
      "GZIP is a single-file compression format and does not support listing contents. Only container formats like ZIP, 7z, and TAR variants support this operation.",
    );
  }
}
