import { spawn } from "child_process";
import readline from "readline";

export type GetFilePathsOptions = {
  extensions?: string[];
};
export function getFilePaths(opts?: GetFilePathsOptions) {
  return new Promise<string[]>((resolve, reject) => {
    const dirs = ["~/Downloads", "~/Desktop", "~/dev"];
    const args = [
      "--type",
      "f",
      ".",
      ...dirs,
      "--exclude",
      "node_modules",
      "--exclude",
      "dist",
      "--exclude",
      "build",
    ];

    if (opts?.extensions) {
      for (const ext of opts.extensions) {
        args.push(`-e ${ext}`);
      }
    }

    const fd = spawn("/opt/homebrew/bin/fd", args, { shell: true });

    const rl = readline.createInterface({ input: fd.stdout });
    const files: string[] = [];

    rl.on("line", (line) => {
      if (line) files.push(line);
    });

    fd.on("error", (err) => reject(err));
    fd.on("close", () => resolve(files));
  });
}
