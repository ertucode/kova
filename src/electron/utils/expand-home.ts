import path from "path";
import os from "os";

export function expandHome(p: string) {
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  if (!p.startsWith("/")) return "/" + p;
  return p;
}
