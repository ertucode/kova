import { execFile } from "child_process";
import { promisify } from "util";
import { ffmpegPath } from "./get-vendor-path.js";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { expandHome } from "./expand-home.js";

const execFileAsync = promisify(execFile);

/**
 * Generates a thumbnail from a video file and returns it as a base64 string
 * @param filePath - Full path to the video file
 * @returns Promise<string> - Base64 encoded image (PNG format)
 */
export async function generateVideoThumbnail(
  filePath: string,
): Promise<string> {
  // Create a temporary file for the thumbnail
  const tempDir = os.tmpdir();
  const tempFile = path.join(
    tempDir,
    `video-thumb-${Date.now()}-${Math.random().toString(36).substring(7)}.png`,
  );

  try {
    // Use ffmpeg to extract a good thumbnail frame
    // -ss 2: seek to 2 seconds to avoid intro black frames
    // -i: input file
    // -vf thumbnail: selects the frame with the most detail/least black
    // -vf scale=320:-1: scale to width 320px, maintain aspect ratio
    // -frames:v 1: extract only 1 frame
    // -vsync vfr: variable frame rate to work with thumbnail filter
    // -f image2: force image format
    await execFileAsync(ffmpegPath, [
      "-ss",
      "2", // Seek to 2 seconds to skip intro/black frames
      "-i",
      expandHome(filePath),
      "-vf",
      "thumbnail,scale=320:-1", // Use thumbnail filter to find best frame, then scale
      "-frames:v",
      "1", // Extract 1 frame
      "-vsync",
      "vfr", // Variable frame rate
      "-f",
      "image2",
      tempFile,
    ]);

    // Read the generated thumbnail and convert to base64
    const imageBuffer = await fs.readFile(tempFile);
    const base64Image = `data:image/png;base64,${imageBuffer.toString("base64")}`;

    // Clean up temp file
    await fs.unlink(tempFile);

    return base64Image;
  } catch (error) {
    // Clean up temp file if it exists
    try {
      await fs.unlink(tempFile);
    } catch {
      // Ignore cleanup errors
    }

    throw new Error(
      `Failed to generate video thumbnail: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
