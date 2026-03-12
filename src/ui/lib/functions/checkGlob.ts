import picomatch from "picomatch/posix";

export function checkGlob(glob: string, path: string) {
  const result = picomatch(glob)(path, true);
  return result.isMatch;
}
