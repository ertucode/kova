import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

const dir = "vendor-bin/fzy";

if (!existsSync(dir)) {
  console.log("→ Cloning fzy...");
  execSync(`git clone --depth 1 https://github.com/jhawthorn/fzy ${dir}`, {
    stdio: "inherit",
  });
}

console.log("→ Building fzy...");
execSync(`make`, {
  cwd: dir,
  stdio: "inherit",
});
