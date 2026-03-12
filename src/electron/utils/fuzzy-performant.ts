import { spawn } from "child_process";
import { GenericError, GenericResult } from "../../common/GenericError.js";
import { Result } from "../../common/Result.js";
import { fzyPath } from "./get-vendor-path.js";
import { errorToString } from "../../common/errorToString.js";

export function fuzzyPerformant(
  items: string[],
  query: string,
): Promise<GenericResult<string[]>> {
  return new Promise((resolve, _) => {
    const child = spawn(fzyPath, ["-e", query]);

    let output = "";

    child.stdout.on("data", (data) => (output += data));
    child.stderr.on("data", (err) => {
      resolve(GenericError.Message(err.toString()));
      console.error(err);
    });

    child.on("close", () => {
      const results = output
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);

      resolve(Result.Success(results));
    });

    child.on("error", (e) => {
      console.error(e);
      resolve(GenericError.Message(errorToString(e)));
    });

    child.stdin.write(items.join("\n"));
    child.stdin.end();
  });
}
