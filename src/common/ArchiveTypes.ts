import { GenericResult } from "./GenericError.js";

export namespace ArchiveTypes {
  export const Types = [
    // ZIP
    { label: "ZIP", extension: ".zip" },

    // 7-Zip
    { label: "7-Zip", extension: ".7z" },

    // TAR (plain)
    { label: "TAR", extension: ".tar" },

    // TAR + GZIP
    { label: "TAR.GZ", extension: ".tar.gz" },
    { label: "TGZ", extension: ".tgz" },

    // TAR + BZIP2
    { label: "TAR.BZ2", extension: ".tar.bz2" },
    { label: "TBZ2", extension: ".tbz2" },

    // TAR + XZ
    { label: "TAR.XZ", extension: ".tar.xz" },
    { label: "TXZ", extension: ".txz" },

    // Standalone compression
    { label: "GZIP", extension: ".gz" },
    { label: "BZIP2", extension: ".bz2" },
  ] as const;

  export type ArchiveType = (typeof Types)[number]["extension"];

  export const SupportedExtensions = new Set(Types.map((t) => t.extension));

  export type ArchiveOpts = {
    source: string[]; // array of file paths to archive
    destination: string;
    progressCallback: (progress: number) => void;
    abortSignal: AbortSignal;
  };

  export type ArchiveResult = GenericResult<void>;

  export type UnarchiveOpts = {
    source: string; // single archive file path to extract
    destination: string;
    progressCallback: (progress: number) => void;
    abortSignal: AbortSignal;
    extractWithoutPaths?: boolean; // Extract files without directory structure
  };

  export type UnarchiveResult = GenericResult<void>;

  export type ArchiveEntry = {
    name: string;
    isDirectory: boolean;
    size: number;
    compressedSize?: number;
    comment?: string;
  };

  export type ReadContentsResult = GenericResult<ArchiveEntry[]>;
}
