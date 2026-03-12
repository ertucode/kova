import fs from "fs";
import { spawn } from "child_process";
import path from "path";
import { PathHelpers } from "../../../common/PathHelpers.js";
import { Archive } from "./Archive.js";
import { Result } from "../../../common/Result.js";
import { GenericError } from "../../../common/GenericError.js";
import { sevenZPath } from "../get-vendor-path.js";
import { ArchiveTypes } from "../../../common/ArchiveTypes.js";
import { expandHome } from "../expand-home.js";

export namespace SevenZip {
  export function archive(
    opts: Archive.ArchiveOpts,
  ): Promise<Archive.ArchiveResult> {
    return new Promise<Archive.ArchiveResult>((resolve) => {
      const { source, destination, progressCallback, abortSignal } = opts;

      const sevenZipPath = PathHelpers.withExtension(destination, ".7z");
      const sevenZBinary = sevenZPath;

      let settled = false;
      let completedSuccessfully = false;

      const cleanupPartial7z = async () => {
        if (completedSuccessfully) return;

        try {
          await fs.promises.unlink(sevenZipPath);
        } catch (err: any) {
          // Ignore missing file or concurrent cleanup
          if (err?.code !== "ENOENT") {
            console.warn("Failed to cleanup partial 7z:", err);
          }
        }
      };

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;

        if (err) {
          // fire-and-forget cleanup
          void cleanupPartial7z();
          resolve(GenericError.Unknown(err));
        } else {
          completedSuccessfully = true;
          resolve(Result.Success(undefined));
        }
      };

      // -----------------
      // CANCELLATION
      // -----------------
      const cancel = () => {
        const err = new Error("Archive cancelled");
        if (sevenZProcess && !sevenZProcess.killed) {
          sevenZProcess.kill("SIGTERM");
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
      // 7z a -t7z -mx=9 <output.7z> <source1> <source2> ...
      // -bsp1 = show progress percentage
      const args = ["a", "-t7z", "-mx=9", sevenZipPath];

      // Add all source files/directories
      try {
        for (const sourcePath of source) {
          if (fs.existsSync(sourcePath) && fs.statSync(sourcePath).isDirectory()) {
            // For directories, add all contents
            args.push(path.join(sourcePath, "*"));
          } else {
            // For files, add the file directly
            args.push(sourcePath);
          }
        }
      } catch (err) {
        return finish(err as Error);
      }

      // Add progress output
      args.push("-bsp1");

      const sevenZProcess = spawn(sevenZBinary, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let lastProgress = 0;

      // -----------------
      // PROGRESS
      // -----------------
      if (progressCallback) {
        sevenZProcess.stdout?.on("data", (data) => {
          const output = data.toString();
          // 7z outputs progress as "  1%" or " 50%" etc
          const match = output.match(/(\d+)%/);
          if (match) {
            const progress = parseInt(match[1], 10);
            if (progress > lastProgress) {
              lastProgress = progress;
              progressCallback(progress);
            }
          }
        });
      }

      // -----------------
      // ERRORS
      // -----------------
      let errorOutput = "";
      sevenZProcess.stderr?.on("data", (data) => {
        errorOutput += data.toString();
      });

      // -----------------
      // COMPLETION
      // -----------------
      sevenZProcess.on("close", (code) => {
        if (code === 0) {
          progressCallback?.(100); // Ensure we reach 100% on completion
          finish();
        } else {
          finish(
            new Error(`7z process exited with code ${code}: ${errorOutput}`),
          );
        }
      });

      sevenZProcess.on("error", (err) => {
        finish(err);
      });
    });
  }

  export function unarchive(
    opts: Archive.UnarchiveOpts,
  ): Promise<Archive.UnarchiveResult> {
    return new Promise<Archive.UnarchiveResult>((resolve) => {
      const {
        source, // .7z file
        destination, // folder
        progressCallback,
        abortSignal,
        extractWithoutPaths = false,
      } = opts;

      const sevenZBinary = sevenZPath;

      let settled = false;
      let completedSuccessfully = false;

      const cleanupPartialExtract = async () => {
        if (completedSuccessfully) return;

        try {
          await fs.promises.rm(destination, {
            recursive: true,
            force: true,
          });
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
      // ENSURE DESTINATION EXISTS
      // -----------------
      try {
        fs.mkdirSync(destination, { recursive: true });
      } catch (err) {
        return finish(err as Error);
      }

      // -----------------
      // CANCELLATION
      // -----------------
      const cancel = () => {
        const err = new Error("Unarchive cancelled");
        if (sevenZProcess && !sevenZProcess.killed) {
          sevenZProcess.kill("SIGTERM");
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
      // 7z x -o<destination> <source.7z> (extract with full paths)
      // 7z e -o<destination> <source.7z> (extract without paths)
      // -bsp1 = show progress percentage
      const command = extractWithoutPaths ? "e" : "x";
      const args = [command, `-o${destination}`, source, "-bsp1", "-y"];

      const sevenZProcess = spawn(sevenZBinary, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let lastProgress = 0;

      // -----------------
      // PROGRESS
      // -----------------
      if (progressCallback) {
        sevenZProcess.stdout?.on("data", (data) => {
          const output = data.toString();
          // 7z outputs progress as "  1%" or " 50%" etc
          const match = output.match(/(\d+)%/);
          if (match) {
            const progress = parseInt(match[1], 10);
            if (progress > lastProgress) {
              lastProgress = progress;
              progressCallback(progress);
            }
          }
        });
      }

      // -----------------
      // ERRORS
      // -----------------
      let errorOutput = "";
      sevenZProcess.stderr?.on("data", (data) => {
        errorOutput += data.toString();
      });

      // -----------------
      // COMPLETION
      // -----------------
      sevenZProcess.on("close", (code) => {
        if (code === 0) {
          progressCallback?.(100); // Ensure we reach 100% on completion
          finish();
        } else {
          finish(
            new Error(`7z process exited with code ${code}: ${errorOutput}`),
          );
        }
      });

      sevenZProcess.on("error", (err) => {
        finish(err);
      });
    });
  }

  export async function readContents(
    archivePath: string,
  ): Promise<ArchiveTypes.ReadContentsResult> {
    return new Promise<ArchiveTypes.ReadContentsResult>((resolve) => {
      try {
        const expandedPath = expandHome(archivePath);
        const sevenZBinary = sevenZPath;

        // 7z l -slt <archive.7z>
        // -slt = technical listing (provides detailed info)
        const args = ["l", "-slt", expandedPath];

        const sevenZProcess = spawn(sevenZBinary, args, {
          stdio: ["ignore", "pipe", "pipe"],
        });

        let output = "";
        let errorOutput = "";

        sevenZProcess.stdout?.on("data", (data) => {
          output += data.toString();
        });

        sevenZProcess.stderr?.on("data", (data) => {
          errorOutput += data.toString();
        });

        sevenZProcess.on("close", (code) => {
          if (code !== 0) {
            resolve(
              GenericError.Message(
                `7z list process exited with code ${code}: ${errorOutput}`,
              ),
            );
            return;
          }

          try {
            const entries: ArchiveTypes.ArchiveEntry[] = [];
            const lines = output.split("\n");
            let currentEntry: Partial<ArchiveTypes.ArchiveEntry> = {};

            for (const line of lines) {
              const trimmedLine = line.trim();

              if (trimmedLine.startsWith("Path = ")) {
                // Start of a new entry
                if (currentEntry.name) {
                  // Save previous entry
                  entries.push({
                    name: currentEntry.name,
                    isDirectory: currentEntry.isDirectory ?? false,
                    size: currentEntry.size ?? 0,
                    compressedSize: currentEntry.compressedSize,
                  });
                }
                currentEntry = {
                  name: trimmedLine.substring("Path = ".length),
                };
              } else if (trimmedLine.startsWith("Size = ")) {
                currentEntry.size = parseInt(
                  trimmedLine.substring("Size = ".length),
                  10,
                );
              } else if (trimmedLine.startsWith("Packed Size = ")) {
                currentEntry.compressedSize = parseInt(
                  trimmedLine.substring("Packed Size = ".length),
                  10,
                );
              } else if (trimmedLine.startsWith("Folder = ")) {
                const isFolder = trimmedLine.substring("Folder = ".length);
                currentEntry.isDirectory = isFolder === "+" || isFolder === "yes";
              } else if (trimmedLine.startsWith("Attributes = ")) {
                // Also check attributes for directory marker
                const attrs = trimmedLine.substring("Attributes = ".length);
                if (attrs.includes("D")) {
                  currentEntry.isDirectory = true;
                }
              }
            }

            // Don't forget the last entry
            if (currentEntry.name) {
              entries.push({
                name: currentEntry.name,
                isDirectory: currentEntry.isDirectory ?? false,
                size: currentEntry.size ?? 0,
                compressedSize: currentEntry.compressedSize,
              });
            }

            resolve(Result.Success(entries));
          } catch (error) {
            if (error instanceof Error) {
              resolve(GenericError.Message(error.message));
            } else {
              resolve(GenericError.Unknown(error));
            }
          }
        });

        sevenZProcess.on("error", (err) => {
          resolve(GenericError.Unknown(err));
        });
      } catch (error) {
        if (error instanceof Error) {
          resolve(GenericError.Message(error.message));
        } else {
          resolve(GenericError.Unknown(error));
        }
      }
    });
  }
}
