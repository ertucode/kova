import { describe, it, expect } from "vitest";
import { replacePlaceholders, FileInfo } from "./PlaceholderHelpers.js";

interface TestCase {
  description: string;
  placeholder: string;
  fileInfo: FileInfo;
  expected: string | RegExp;
}

const testCases: TestCase[] = [
  // Basic placeholders
  {
    description: "should replace [N] with filename without extension",
    placeholder: "[N]",
    fileInfo: {
      name: "document.pdf",
      ext: ".pdf",
      type: "file",
      fullPath: "/home/user/docs/document.pdf",
    },
    expected: "document",
  },
  {
    description: "[N] with [D]",
    placeholder: "[D]/[N].pdf",
    fileInfo: {
      name: "3. Taraf Login Servis Modeli.docx",
      fullPath:
        "/Users/cavitertugrulsirt/Downloads/3. Taraf Login Servis Modeli.docx",
      ext: ".docx",
      type: "file",
    },
    expected:
      "/Users/cavitertugrulsirt/Downloads/3. Taraf Login Servis Modeli.pdf",
  },
  {
    description: "should replace [E] with extension including dot",
    placeholder: "[E]",
    fileInfo: {
      name: "document.pdf",
      ext: ".pdf",
      type: "file",
      fullPath: "/home/user/docs/document.pdf",
    },
    expected: ".pdf",
  },
  {
    description: "should replace [N][E] with original filename",
    placeholder: "[N][E]",
    fileInfo: {
      name: "document.pdf",
      ext: ".pdf",
      type: "file",
      fullPath: "/home/user/docs/document.pdf",
    },
    expected: "document.pdf",
  },
  {
    description: "should change extension correctly",
    placeholder: "[N].txt",
    fileInfo: {
      name: "document.pdf",
      ext: ".pdf",
      type: "file",
      fullPath: "/home/user/docs/document.pdf",
    },
    expected: "document.txt",
  },
  {
    description: "should replace [F] with full path",
    placeholder: "[F]",
    fileInfo: {
      name: "document.pdf",
      ext: ".pdf",
      type: "file",
      fullPath: "/home/user/docs/document.pdf",
    },
    expected: "/home/user/docs/document.pdf",
  },
  {
    description: "should replace [D] with directory path",
    placeholder: "[D]",
    fileInfo: {
      name: "document.pdf",
      ext: ".pdf",
      type: "file",
      fullPath: "/home/user/docs/document.pdf",
    },
    expected: "/home/user/docs",
  },
  {
    description: "should replace [P] with parent folder name",
    placeholder: "[P]",
    fileInfo: {
      name: "document.pdf",
      ext: ".pdf",
      type: "file",
      fullPath: "/home/user/docs/document.pdf",
    },
    expected: "docs",
  },

  // Combined placeholders
  {
    description: "should build new path with different extension",
    placeholder: "[D]/[N].txt",
    fileInfo: {
      name: "report.pdf",
      ext: ".pdf",
      type: "file",
      fullPath: "/home/user/documents/report.pdf",
    },
    expected: "/home/user/documents/report.txt",
  },
  {
    description: "should build new filename with suffix",
    placeholder: "[N]_processed[E]",
    fileInfo: {
      name: "photo.jpg",
      ext: ".jpg",
      type: "file",
      fullPath: "/home/user/photos/photo.jpg",
    },
    expected: "photo_processed.jpg",
  },
  {
    description: "should build path with parent folder prefix",
    placeholder: "[P]_[N][E]",
    fileInfo: {
      name: "data.csv",
      ext: ".csv",
      type: "file",
      fullPath: "/home/user/exports/data.csv",
    },
    expected: "exports_data.csv",
  },

  // Filename ranges
  {
    description: "should replace [N1-5] with character range",
    placeholder: "[N1-5]",
    fileInfo: {
      name: "document.pdf",
      ext: ".pdf",
      type: "file",
      fullPath: "/home/user/docs/document.pdf",
    },
    expected: "docum",
  },
  {
    description:
      "should replace [N2,3] with 3 characters starting at position 2",
    placeholder: "[N2,3]",
    fileInfo: {
      name: "document.pdf",
      ext: ".pdf",
      type: "file",
      fullPath: "/home/user/docs/document.pdf",
    },
    expected: "ocu",
  },
  {
    description: "should replace [N1] with first character",
    placeholder: "[N1]",
    fileInfo: {
      name: "document.pdf",
      ext: ".pdf",
      type: "file",
      fullPath: "/home/user/docs/document.pdf",
    },
    expected: "d",
  },
  {
    description: "should handle fullPath with tilde",
    placeholder: "[D]/[N].pdf",
    fileInfo: {
      name: "file.tsx",
      ext: ".tsx",
      type: "file",
      fullPath: "~/home/user/file.tsx",
    },
    expected: "~/home/user/file.pdf",
  },

  // Directories
  {
    description: "should handle directory without extension",
    placeholder: "[N]",
    fileInfo: {
      name: "my-folder",
      ext: "",
      type: "dir",
      fullPath: "/home/user/my-folder",
    },
    expected: "my-folder",
  },
  {
    description: "should handle directory [E] as empty",
    placeholder: "[N][E]",
    fileInfo: {
      name: "my-folder",
      ext: "",
      type: "dir",
      fullPath: "/home/user/my-folder",
    },
    expected: "my-folder",
  },

  // Escaped brackets
  {
    description: "should handle escaped brackets \\[N\\]",
    placeholder: "\\[N\\]",
    fileInfo: {
      name: "document.pdf",
      ext: ".pdf",
      type: "file",
      fullPath: "/home/user/docs/document.pdf",
    },
    expected: "[N]",
  },
  {
    description: "should handle mixed escaped and regular placeholders",
    placeholder: "[N]_\\[backup\\][E]",
    fileInfo: {
      name: "document.pdf",
      ext: ".pdf",
      type: "file",
      fullPath: "/home/user/docs/document.pdf",
    },
    expected: "document_[backup].pdf",
  },

  // Date and time placeholders
  {
    description: "should replace [d] with current date in YYYY-MM-DD format",
    placeholder: "[N]_[d][E]",
    fileInfo: {
      name: "report.pdf",
      ext: ".pdf",
      type: "file",
      fullPath: "/home/user/report.pdf",
    },
    expected: /^report_\d{4}-\d{2}-\d{2}\.pdf$/,
  },
  {
    description: "should replace [t] with current time in HH-MM-SS format",
    placeholder: "[N]_[t][E]",
    fileInfo: {
      name: "log.txt",
      ext: ".txt",
      type: "file",
      fullPath: "/home/user/log.txt",
    },
    expected: /^log_\d{2}-\d{2}-\d{2}\.txt$/,
  },

  // Edge cases
  {
    description: "should handle file with no extension",
    placeholder: "[N][E]",
    fileInfo: {
      name: "README",
      ext: "",
      type: "file",
      fullPath: "/home/user/README",
    },
    expected: "README",
  },
  {
    description: "should handle file with no extension and add new extension",
    placeholder: "[N].md",
    fileInfo: {
      name: "README",
      ext: "",
      type: "file",
      fullPath: "/home/user/README",
    },
    expected: "README.md",
  },
  {
    description: "should handle file with multiple dots - [N]",
    placeholder: "[N]",
    fileInfo: {
      name: "my.backup.tar.gz",
      ext: ".gz",
      type: "file",
      fullPath: "/home/user/my.backup.tar.gz",
    },
    expected: "my.backup.tar",
  },
  {
    description: "should handle file with multiple dots - [N][E]",
    placeholder: "[N][E]",
    fileInfo: {
      name: "my.backup.tar.gz",
      ext: ".gz",
      type: "file",
      fullPath: "/home/user/my.backup.tar.gz",
    },
    expected: "my.backup.tar.gz",
  },
  {
    description: "should handle root directory file - [D]",
    placeholder: "[D]",
    fileInfo: {
      name: "file.txt",
      ext: ".txt",
      type: "file",
      fullPath: "/file.txt",
    },
    expected: "/",
  },
  {
    description: "should handle root directory file - [P]",
    placeholder: "[P]",
    fileInfo: {
      name: "file.txt",
      ext: ".txt",
      type: "file",
      fullPath: "/file.txt",
    },
    expected: "",
  },
  {
    description: "should handle empty template",
    placeholder: "",
    fileInfo: {
      name: "test.txt",
      ext: ".txt",
      type: "file",
      fullPath: "/home/test.txt",
    },
    expected: "",
  },
];

describe("replacePlaceholders", () => {
  testCases.forEach((testCase) => {
    it(testCase.description, () => {
      const result = replacePlaceholders(
        testCase.placeholder,
        testCase.fileInfo,
      );
      if (testCase.expected instanceof RegExp) {
        expect(result).toMatch(testCase.expected);
      } else {
        expect(result).toBe(testCase.expected);
      }
    });
  });
});
