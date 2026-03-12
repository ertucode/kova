import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { PathHelpers } from "../../../common/PathHelpers.js";
import { Archive } from "./Archive.js";
import { Result } from "../../../common/Result.js";
import { GenericError } from "../../../common/GenericError.js";
import { ArchiveTypes } from "../../../common/ArchiveTypes.js";
import { expandHome } from "../expand-home.js";

type CompressionType = "none" | "gzip" | "bzip2" | "xz";

interface TarOptions extends Archive.ArchiveOpts {
  compressionType: CompressionType;
  extension: string;
}

interface UntarOptions extends Archive.UnarchiveOpts {
  compressionType: CompressionType;
}

function getCompressionFlag(type: CompressionType): string {
  switch (type) {
    case "gzip":
      return "z";
    case "bzip2":
      return "j";
    case "xz":
      return "J";
    case "none":
    default:
      return "";
  }
}

function readContentsWithTar(
  archivePath: string,
  compressionType: CompressionType,
): Promise<ArchiveTypes.ReadContentsResult> {
  return new Promise<ArchiveTypes.ReadContentsResult>((resolve) => {
    try {
      const expandedPath = expandHome(archivePath);
      const compressionFlag = getCompressionFlag(compressionType);

      // tar -t[z|j|J]vf archive.tar[.gz|.bz2|.xz]
      // -t = list contents
      // -v = verbose (shows permissions and size info)
      const args = [`-t${compressionFlag}vf`, expandedPath];

      const tarProcess = spawn("tar", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";
      let errorOutput = "";

      tarProcess.stdout?.on("data", (data) => {
        output += data.toString();
      });

      tarProcess.stderr?.on("data", (data) => {
        errorOutput += data.toString();
      });

      tarProcess.on("close", (code) => {
        if (code !== 0) {
          resolve(
            GenericError.Message(
              `tar list process exited with code ${code}: ${errorOutput}`,
            ),
          );
          return;
        }

        try {
          const entries: ArchiveTypes.ArchiveEntry[] = [];
          const lines = output.split("\n");

          for (const line of lines) {
            if (!line.trim()) continue;

            // Parse tar -tv output format:
            // drwxr-xr-x  0 user group       0 Dec 27 12:34 directory/
            // -rw-r--r--  0 user group    1234 Dec 27 12:34 file.txt
            const match = line.match(
              /^([drwx-]+)\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\d+\s+[\d:]+\s+(.+)$/,
            );

            if (match) {
              const [, permissions, sizeStr, name] = match;
              const isDirectory = permissions.startsWith("d");
              const size = parseInt(sizeStr, 10);

              entries.push({
                name,
                isDirectory,
                size,
              });
            }
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

      tarProcess.on("error", (err) => {
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

function archiveWithTar(opts: TarOptions): Promise<Archive.ArchiveResult> {
  return new Promise<Archive.ArchiveResult>((resolve) => {
    const {
      source,
      destination,
      progressCallback,
      abortSignal,
      compressionType,
      extension,
    } = opts;

    const tarPath = destination.endsWith(extension)
      ? destination
      : destination + extension;

    let settled = false;
    let completedSuccessfully = false;

    const cleanupPartialTar = async () => {
      if (completedSuccessfully) return;

      try {
        await fs.promises.unlink(tarPath);
      } catch (err: any) {
        if (err?.code !== "ENOENT") {
          console.warn("Failed to cleanup partial tar:", err);
        }
      }
    };

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;

      if (err) {
        void cleanupPartialTar();
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
      if (tarProcess && !tarProcess.killed) {
        tarProcess.kill("SIGTERM");
      }
      finish(err);
    };

    if (abortSignal.aborted) {
      return cancel();
    }
    abortSignal.addEventListener("abort", cancel, { once: true });

    // -----------------
    // BUILD COMMAND
    // -----------------
    const compressionFlag = getCompressionFlag(compressionType);

    // Build tar command: tar -c[z|j|J]f output.tar[.gz|.bz2|.xz] -C parent source1 source2 ...
    const args = [`-c${compressionFlag}f`, tarPath];

    let workingDir: string | undefined;

    try {
      // Add all source files/directories
      for (const sourcePath of source) {
        const stats = fs.statSync(sourcePath);

        if (stats.isDirectory()) {
          // For directories, change to parent and archive the dir name
          const parentDir = PathHelpers.parent(sourcePath).path;
          const dirName = PathHelpers.name(sourcePath);

          // Set working directory from first item (all items should be in same dir ideally)
          if (!workingDir) {
            workingDir = parentDir;
            args.push("-C", parentDir);
          }
          args.push(dirName);
        } else {
          // For files, change to parent and archive the file name
          const parentDir = PathHelpers.parent(sourcePath).path;
          const fileName = PathHelpers.name(sourcePath);

          // Set working directory from first item (all items should be in same dir ideally)
          if (!workingDir) {
            workingDir = parentDir;
            args.push("-C", parentDir);
          }
          args.push(fileName);
        }
      }
    } catch (err) {
      return finish(err as Error);
    }

    // -----------------
    // SPAWN PROCESS
    // -----------------
    const tarProcess = spawn("tar", args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: workingDir,
    });

    // -----------------
    // PROGRESS (basic - tar doesn't have built-in progress)
    // -----------------
    if (progressCallback) {
      // For tar, we'll do a simple file size monitoring
      let totalSize = 0;
      try {
        const getSize = (p: string): number => {
          const stat = fs.statSync(p);
          if (stat.isDirectory()) {
            let size = 0;
            const items = fs.readdirSync(p);
            for (const item of items) {
              size += getSize(`${p}/${item}`);
            }
            return size;
          }
          return stat.size;
        };
        // Calculate total size of all source files/directories
        for (const sourcePath of source) {
          totalSize += getSize(sourcePath);
        }
      } catch {
        // Ignore size calculation errors
      }

      // Monitor output file size
      if (totalSize > 0) {
        const progressInterval = setInterval(() => {
          try {
            const currentSize = fs.statSync(tarPath).size;
            const progress = Math.min((currentSize / totalSize) * 100, 99);
            progressCallback(progress);
          } catch {
            // File might not exist yet
          }
        }, 100);

        tarProcess.on("close", () => {
          clearInterval(progressInterval);
          if (completedSuccessfully) {
            progressCallback(100);
          }
        });
      }
    }

    // -----------------
    // ERRORS
    // -----------------
    let errorOutput = "";
    tarProcess.stderr?.on("data", (data) => {
      errorOutput += data.toString();
    });

    // -----------------
    // COMPLETION
    // -----------------
    tarProcess.on("close", (code) => {
      if (code === 0) {
        finish();
      } else {
        finish(
          new Error(`tar process exited with code ${code}: ${errorOutput}`),
        );
      }
    });

    tarProcess.on("error", (err) => {
      finish(err);
    });
  });
}

function unarchiveWithTar(
  opts: UntarOptions,
): Promise<Archive.UnarchiveResult> {
  return new Promise<Archive.UnarchiveResult>(async (resolve) => {
    const {
      source,
      destination,
      progressCallback,
      abortSignal,
      compressionType,
      extractWithoutPaths = false,
    } = opts;

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
      if (tarProcess && !tarProcess.killed) {
        tarProcess.kill("SIGTERM");
      }
      finish(err);
    };

    if (abortSignal.aborted) {
      return cancel();
    }
    abortSignal.addEventListener("abort", cancel, { once: true });

    // -----------------
    // BUILD COMMAND
    // -----------------
    const compressionFlag = getCompressionFlag(compressionType);

    // Build tar command: tar -x[z|j|J]f archive.tar[.gz|.bz2|.xz] -C destination
    // Note: extractWithoutPaths doesn't affect tar extraction - the caller
    // (start-archive-task.ts) handles moving files from temp folder if needed
    const args = [`-x${compressionFlag}f`, source, "-C", destination];

    // -----------------
    // SPAWN PROCESS
    // -----------------
    const tarProcess = spawn("tar", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    // -----------------
    // PROGRESS (basic - monitor extracted files)
    // -----------------
    if (progressCallback) {
      const sourceSize = fs.statSync(source).size;
      let bytesRead = 0;

      const readStream = fs.createReadStream(source);
      readStream.on("data", (chunk) => {
        bytesRead += chunk.length;
        if (sourceSize > 0) {
          progressCallback(Math.min((bytesRead / sourceSize) * 100, 99));
        }
      });

      tarProcess.on("close", () => {
        readStream.destroy();
        if (completedSuccessfully) {
          progressCallback(100);
        }
      });
    }

    // -----------------
    // ERRORS
    // -----------------
    let errorOutput = "";
    tarProcess.stderr?.on("data", (data) => {
      errorOutput += data.toString();
    });

    // -----------------
    // COMPLETION
    // -----------------
    tarProcess.on("close", (code) => {
      if (code === 0) {
        finish();
      } else {
        finish(
          new Error(`tar process exited with code ${code}: ${errorOutput}`),
        );
      }
    });

    tarProcess.on("error", (err) => {
      finish(err);
    });
  });
}

// Export namespaces for each format
export namespace Tar {
  export function archive(
    opts: Archive.ArchiveOpts,
  ): Promise<Archive.ArchiveResult> {
    return archiveWithTar({
      ...opts,
      compressionType: "none",
      extension: ".tar",
    });
  }

  export function unarchive(
    opts: Archive.UnarchiveOpts,
  ): Promise<Archive.UnarchiveResult> {
    return unarchiveWithTar({ ...opts, compressionType: "none" });
  }

  export function readContents(
    archivePath: string,
  ): Promise<ArchiveTypes.ReadContentsResult> {
    return readContentsWithTar(archivePath, "none");
  }
}

export namespace TarGz {
  export function archive(
    opts: Archive.ArchiveOpts,
  ): Promise<Archive.ArchiveResult> {
    return archiveWithTar({
      ...opts,
      compressionType: "gzip",
      extension: ".tar.gz",
    });
  }

  export function unarchive(
    opts: Archive.UnarchiveOpts,
  ): Promise<Archive.UnarchiveResult> {
    return unarchiveWithTar({ ...opts, compressionType: "gzip" });
  }

  export function readContents(
    archivePath: string,
  ): Promise<ArchiveTypes.ReadContentsResult> {
    return readContentsWithTar(archivePath, "gzip");
  }
}

export namespace Tgz {
  export function archive(
    opts: Archive.ArchiveOpts,
  ): Promise<Archive.ArchiveResult> {
    return archiveWithTar({
      ...opts,
      compressionType: "gzip",
      extension: ".tgz",
    });
  }

  export function unarchive(
    opts: Archive.UnarchiveOpts,
  ): Promise<Archive.UnarchiveResult> {
    return unarchiveWithTar({ ...opts, compressionType: "gzip" });
  }

  export function readContents(
    archivePath: string,
  ): Promise<ArchiveTypes.ReadContentsResult> {
    return readContentsWithTar(archivePath, "gzip");
  }
}

export namespace TarBz2 {
  export function archive(
    opts: Archive.ArchiveOpts,
  ): Promise<Archive.ArchiveResult> {
    return archiveWithTar({
      ...opts,
      compressionType: "bzip2",
      extension: ".tar.bz2",
    });
  }

  export function unarchive(
    opts: Archive.UnarchiveOpts,
  ): Promise<Archive.UnarchiveResult> {
    return unarchiveWithTar({ ...opts, compressionType: "bzip2" });
  }

  export function readContents(
    archivePath: string,
  ): Promise<ArchiveTypes.ReadContentsResult> {
    return readContentsWithTar(archivePath, "bzip2");
  }
}

export namespace Tbz2 {
  export function archive(
    opts: Archive.ArchiveOpts,
  ): Promise<Archive.ArchiveResult> {
    return archiveWithTar({
      ...opts,
      compressionType: "bzip2",
      extension: ".tbz2",
    });
  }

  export function unarchive(
    opts: Archive.UnarchiveOpts,
  ): Promise<Archive.UnarchiveResult> {
    return unarchiveWithTar({ ...opts, compressionType: "bzip2" });
  }

  export function readContents(
    archivePath: string,
  ): Promise<ArchiveTypes.ReadContentsResult> {
    return readContentsWithTar(archivePath, "bzip2");
  }
}

export namespace TarXz {
  export function archive(
    opts: Archive.ArchiveOpts,
  ): Promise<Archive.ArchiveResult> {
    return archiveWithTar({
      ...opts,
      compressionType: "xz",
      extension: ".tar.xz",
    });
  }

  export function unarchive(
    opts: Archive.UnarchiveOpts,
  ): Promise<Archive.UnarchiveResult> {
    return unarchiveWithTar({ ...opts, compressionType: "xz" });
  }

  export function readContents(
    archivePath: string,
  ): Promise<ArchiveTypes.ReadContentsResult> {
    return readContentsWithTar(archivePath, "xz");
  }
}

export namespace Txz {
  export function archive(
    opts: Archive.ArchiveOpts,
  ): Promise<Archive.ArchiveResult> {
    return archiveWithTar({
      ...opts,
      compressionType: "xz",
      extension: ".txz",
    });
  }

  export function unarchive(
    opts: Archive.UnarchiveOpts,
  ): Promise<Archive.UnarchiveResult> {
    return unarchiveWithTar({ ...opts, compressionType: "xz" });
  }

  export function readContents(
    archivePath: string,
  ): Promise<ArchiveTypes.ReadContentsResult> {
    return readContentsWithTar(archivePath, "xz");
  }
}
