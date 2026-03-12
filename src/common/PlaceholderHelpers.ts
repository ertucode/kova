import { PathHelpers } from "./PathHelpers.js";

/**
 * File information interface for placeholder replacement
 */
export interface FileInfo {
  name: string;
  fullPath?: string;
  ext?: PathHelpers.DottedExtension;
  type?: "file" | "dir";
}

/**
 * Parse placeholders and generate string with file information
 * Supported placeholders:
 * - [N]: Original filename (without extension for files, full name for folders)
 * - [N1-5]: Characters 1-5 of filename
 * - [N2,3]: 3 characters starting at position 2
 * - [E]: File extension
 * - [d]: Current date (YYYY-MM-DD)
 * - [t]: Current time (HH-MM-SS)
 * - [P]: Parent folder name
 * - [F]: Full path
 * - [D]: Directory path (full path without the item name)
 *
 * Escaping: Use \[N\] to get literal "[N]" in the output
 */
export function replacePlaceholders(
  template: string,
  fileInfo: FileInfo,
): string {
  const itemPath = fileInfo.fullPath || "";

  // Extract parent folder name from path
  const pathParts = itemPath.split(/[/\\]/).filter((p) => p); // Remove empty parts
  const parentFolder =
    pathParts.length > 1 ? pathParts[pathParts.length - 2] : "";

  const nameWithoutExt =
    fileInfo.type === "file" && fileInfo.ext
      ? fileInfo.name.substring(0, fileInfo.name.length - fileInfo.ext.length)
      : fileInfo.name;
  const extension =
    fileInfo.type === "file" && fileInfo.ext ? fileInfo.ext : "";

  // Temporarily replace escaped brackets with placeholders
  const ESCAPED_OPEN = "___ESCAPED_OPEN___";
  const ESCAPED_CLOSE = "___ESCAPED_CLOSE___";
  let result = template
    .replace(/\\\[/g, ESCAPED_OPEN)
    .replace(/\\\]/g, ESCAPED_CLOSE);

  // Parse [N] with optional ranges
  result = result.replace(
    /\[N(\d+)?(?:-(\d+)|,(\d+))?\]/g,
    (_match, start, end, count) => {
      if (!start) {
        return nameWithoutExt; // Plain [N]
      }

      const startIdx = parseInt(start, 10) - 1; // Convert to 0-based index

      if (end) {
        // [N1-5] format - range
        const endIdx = parseInt(end, 10);
        return nameWithoutExt.substring(startIdx, endIdx);
      } else if (count) {
        // [N2,3] format - start position and count
        const length = parseInt(count, 10);
        return nameWithoutExt.substring(startIdx, startIdx + length);
      } else {
        // [N1] format - single character
        return nameWithoutExt.charAt(startIdx);
      }
    },
  );

  // [E] - Extension
  result = result.replace(/\[E\]/g, extension);

  // [d] - Current date
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0]; // YYYY-MM-DD
  result = result.replace(/\[d\]/g, dateStr);

  // [t] - Current time
  const timeStr = now.toTimeString().split(" ")[0].replace(/:/g, "-"); // HH-MM-SS
  result = result.replace(/\[t\]/g, timeStr);

  // [P] - Parent folder
  result = result.replace(/\[P\]/g, parentFolder);

  // [F] - Full path
  result = result.replace(/\[F\]/g, itemPath);

  // [D] - Directory path (full path without the item name)
  const directoryPath = PathHelpers.parent(itemPath).path;
  result = result.replace(/\[D\]/g, directoryPath);

  // Restore escaped brackets
  result = result
    .replace(new RegExp(ESCAPED_OPEN, "g"), "[")
    .replace(new RegExp(ESCAPED_CLOSE, "g"), "]");

  return result;
}
