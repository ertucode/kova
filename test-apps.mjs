import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function testGetApps(filePath) {
  try {
    const { stdout: defaultOut } = await execAsync(
      `mdls -name kMDItemContentType -raw "${filePath}"`,
    );
    const contentType = defaultOut.trim();
    console.log("Content Type:", contentType);

    const { stdout } = await execAsync(
      `mdfind "kMDItemContentType == '${contentType}'" 2>/dev/null | grep -i ".app$" | head -20`,
    );

    console.log("Found apps via mdfind:");
    console.log(stdout);

    const apps = stdout
      .split("\n")
      .filter((line) => line.trim())
      .map((appPath) => {
        const name = appPath.split("/").pop()?.replace(".app", "") || appPath;
        return {
          name,
          path: appPath,
        };
      });

    console.log("\nParsed apps:", apps);
  } catch (error) {
    console.error("Error:", error);
  }
}

// Test with a JSON file - create a temp one
import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const testFile = join(tmpdir(), "test.json");
writeFileSync(testFile, '{"test": true}');

testGetApps(testFile);
