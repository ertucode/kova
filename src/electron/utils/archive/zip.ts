import fs from "fs";
import path from "path";
import archiver from "archiver";
import yauzl from "yauzl";
import { pipeline } from "stream/promises";
import AdmZip from "adm-zip";
import { PathHelpers } from "../../../common/PathHelpers.js";
import { Archive } from "./Archive.js";
import { Result } from "../../../common/Result.js";
import { GenericError } from "../../../common/GenericError.js";
import { getSizeForPath } from "../get-directory-size.js";
import { ArchiveTypes } from "../../../common/ArchiveTypes.js";
import { expandHome } from "../expand-home.js";

function openZip(
  zipPath: string,
  options: yauzl.Options,
): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, options, (err, zipfile) => {
      if (err) reject(err);
      else if (zipfile) resolve(zipfile);
      else reject(new Error("Failed to open zip file"));
    });
  });
}

export namespace Zip {
  export function archive(
    opts: Archive.ArchiveOpts,
  ): Promise<Archive.ArchiveResult> {
    return new Promise<Archive.ArchiveResult>(async (resolve) => {
      const { source, destination, progressCallback, abortSignal } = opts;

      const zipPath = PathHelpers.withExtension(destination, ".zip");
      const output = fs.createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      let settled = false;
      let completedSuccessfully = false;

      const cleanupPartialZip = async () => {
        if (completedSuccessfully) return;

        try {
          await fs.promises.unlink(zipPath);
        } catch (err: any) {
          // Ignore missing file or concurrent cleanup
          if (err?.code !== "ENOENT") {
            console.warn("Failed to cleanup partial zip:", err);
          }
        }
      };

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;

        archive.removeAllListeners();
        output.removeAllListeners();

        if (err) {
          // fire-and-forget cleanup
          void cleanupPartialZip();
          resolve(GenericError.Unknown(err));
        } else {
          completedSuccessfully = true;
          resolve(Result.Success(undefined));
        }
      };

      // -----------------
      // SUCCESS
      // -----------------
      output.on("close", () => {
        progressCallback?.(100); // Ensure we reach 100% on completion
        finish();
      });

      // -----------------
      // ERRORS
      // -----------------
      output.on("error", finish);
      archive.on("error", finish);

      archive.on("warning", (err) => {
        if (err.code !== "ENOENT") {
          finish(err);
        }
      });

      const sizes = await Promise.all(
        source.map((path) => getSizeForPath(path)),
      );
      const totalBytes = sizes.reduce((a, b) => a + b, 0);
      // -----------------
      // PROGRESS
      // -----------------
      if (progressCallback) {
        archive.on("progress", ({ fs }) => {
          progressCallback((fs.processedBytes / totalBytes) * 100);
        });
      }

      // -----------------
      // CANCELLATION
      // -----------------
      const cancel = () => {
        const err = new Error("Archive cancelled");

        archive.abort(); // stop compression
        output.destroy(err); // release fd immediately

        finish(err);
      };

      if (abortSignal.aborted) {
        return cancel();
      }
      abortSignal.addEventListener("abort", cancel, { once: true });

      // -----------------
      // PIPE + INPUT
      // -----------------
      archive.pipe(output);

      try {
        // Add all source files/directories to the archive
        for (const sourcePath of source) {
          if (
            fs.existsSync(sourcePath) &&
            fs.statSync(sourcePath).isDirectory()
          ) {
            archive.directory(sourcePath, PathHelpers.name(sourcePath));
          } else {
            archive.file(sourcePath, {
              name: PathHelpers.name(sourcePath),
            });
          }
        }

        archive.finalize();
      } catch (err) {
        finish(err as Error);
      }
    });
  }

  export function unarchive(
    opts: Archive.UnarchiveOpts,
  ): Promise<Archive.UnarchiveResult> {
    return new Promise<Archive.UnarchiveResult>(async (resolve) => {
      if (fs.existsSync(opts.destination)) {
        resolve(GenericError.Message("Destination already exists"));
        return;
      }

      const {
        source, // .zip file
        destination, // folder
        progressCallback,
        abortSignal,
      } = opts;

      let settled = false;
      let completedSuccessfully = false;
      let aborted = false;

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
      // CANCELLATION
      // -----------------
      const cancel = () => {
        if (settled) return;
        aborted = true;
        finish(new Error("Unarchive cancelled"));
      };

      if (abortSignal.aborted) {
        return cancel();
      }
      abortSignal.addEventListener("abort", cancel, { once: true });

      // -----------------
      // EXTRACT using yauzl with streaming
      // -----------------
      try {
        const fullPath = path.resolve(source);
        const fullOutputDir = path.resolve(destination);

        // Use yauzl with decodeStrings: false to get raw buffers,
        // then manually decode as UTF-8 and normalize to NFC.
        // This properly handles Turkish/Unicode characters in filenames.
        const zipfile = await openZip(fullPath, {
          lazyEntries: true,
          decodeStrings: false,
        });

        await new Promise<void>((resolveExtract, rejectExtract) => {
          let entriesRead = 0;

          zipfile.on("error", (err: Error) => {
            aborted = true;
            rejectExtract(err);
          });

          zipfile.on("close", () => {
            if (!aborted) {
              resolveExtract();
            }
          });

          zipfile.on("entry", async (entry: yauzl.Entry) => {
            if (aborted) {
              zipfile.close();
              return;
            }

            entriesRead++;

            // Track progress
            if (progressCallback && zipfile.entryCount > 0) {
              const progress = (entriesRead / zipfile.entryCount) * 100;
              progressCallback(progress);
            }

            // Decode filename: entry.fileName is a Buffer when decodeStrings: false
            // Decode as UTF-8 and normalize to NFC (macOS uses NFD decomposed form)
            const fileName = (entry.fileName as unknown as Buffer)
              .toString("utf8")
              .normalize("NFC");

            // Skip __MACOSX metadata folders
            if (fileName.startsWith("__MACOSX/")) {
              zipfile.readEntry();
              return;
            }

            const destPath = path.join(fullOutputDir, fileName);
            const destDir = path.dirname(destPath);

            try {
              // Create directory structure
              await fs.promises.mkdir(destDir, { recursive: true });

              // Security check: ensure we're not extracting outside destination
              const canonicalDestDir = await fs.promises.realpath(destDir);
              const relativeDestDir = path.relative(
                fullOutputDir,
                canonicalDestDir,
              );

              if (relativeDestDir.split(path.sep).includes("..")) {
                throw new Error(
                  `Out of bound path "${canonicalDestDir}" found while processing file ${fileName}`,
                );
              }

              // Check if entry is a directory
              if (fileName.endsWith("/")) {
                // Directory entry - just create it
                await fs.promises.mkdir(destPath, { recursive: true });
                zipfile.readEntry();
              } else {
                // File entry - extract it with streaming
                zipfile.openReadStream(
                  entry,
                  (err: Error | null, readStream?: NodeJS.ReadableStream) => {
                    if (err) {
                      aborted = true;
                      zipfile.close();
                      rejectExtract(err);
                      return;
                    }

                    if (!readStream) {
                      aborted = true;
                      zipfile.close();
                      rejectExtract(new Error("Failed to open read stream"));
                      return;
                    }

                    const writeStream = fs.createWriteStream(destPath);

                    pipeline(readStream, writeStream)
                      .then(() => {
                        if (!aborted) {
                          zipfile.readEntry();
                        }
                      })
                      .catch((pipeErr: Error) => {
                        aborted = true;
                        zipfile.close();
                        rejectExtract(pipeErr);
                      });
                  },
                );
              }
            } catch (err) {
              aborted = true;
              zipfile.close();
              rejectExtract(err as Error);
            }
          });

          // Start reading entries
          zipfile.readEntry();
        });

        // Ensure we reach 100% on completion
        if (!aborted) {
          progressCallback?.(100);
          finish();
        }
      } catch (err) {
        finish(err as Error);
      }
    });
  }

  export async function readContents(
    archivePath: string,
  ): Promise<ArchiveTypes.ReadContentsResult> {
    try {
      const expandedPath = expandHome(archivePath);
      const zip = new AdmZip(expandedPath);
      const entries = zip.getEntries();

      const result: ArchiveTypes.ArchiveEntry[] = entries.map((entry) => ({
        name: entry.entryName,
        isDirectory: entry.isDirectory,
        size: entry.header.size,
        compressedSize: entry.header.compressedSize,
        comment: entry.comment,
      }));

      return Result.Success(result);
    } catch (error) {
      if (error instanceof Error) {
        return GenericError.Message(error.message);
      }
      return GenericError.Unknown(error);
    }
  }
}
