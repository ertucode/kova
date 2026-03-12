import { homedir } from "os";
import { GenericError, GenericResult } from "../../common/GenericError.js";
import { PathHelpers } from "../../common/PathHelpers.js";
import { Result } from "../../common/Result.js";
import { getServerConfig } from "../server-config.js";
import { spawn } from "child_process";
import { TaskManager } from "../TaskManager.js";
import { CommandReport } from "../../common/Command.js";
import { sendGenericEvent } from "../sendGenericEvent.js";

export async function runCommand(opts: {
  name: string;
  filePath: string;
  parameters: Record<string, string>;
}) {
  const { name, filePath, parameters } = opts;
  const config = await getServerConfig();
  const script = config.commands?.find((s) => s.name === name);
  if (!script) {
    console.error(`Script ${name} not found in config`);
    return GenericError.Message(`Script ${name} not found in config`);
  }

  let command = script.command.replace("{{path}}", filePath);

  if (parameters) {
    for (const [key, value] of Object.entries(parameters)) {
      const parameterDef = script.parameters!.find((p) => p.name === key);
      const val =
        parameterDef?.type === "path"
          ? PathHelpers.expandHome(homedir(), value)
          : value;
      command = command.replaceAll(`{{${key}}}`, val);
    }
  }

  console.log(`Running command: ${command}`, parameters);
  const taskId = TaskManager.create({
    type: "run-command",
    metadata: {
      command,
      parameters,
      fullPath: filePath,
    },
    progress: 0,
  });

  return new Promise<GenericResult<void>>((resolve) => {
    const child = spawn(command, [], { shell: true });

    let stderrData = "";

    child.stdout?.on("data", (data) => {
      const output = data.toString();
      const lines = output.split("\n").filter((line: string) => line.trim());
      for (const line of lines) {
        const report = parseLine(line);
        if (report) {
          handleCommandReport(report);
        }
      }
      TaskManager.pushInfo(taskId, lines);
    });

    child.stderr?.on("data", (data) => {
      const output = data.toString();
      stderrData += output;
      const lines = output.split("\n").filter((line: string) => line.trim());
      for (const line of lines) {
        const report = parseLine(line);
        if (report) {
          handleCommandReport(report);
        }
      }
      TaskManager.pushInfo(taskId, lines);
    });

    child.on("error", (error) => {
      console.error(`Error running script ${name}:`, error);
      resolve(GenericError.Unknown(error));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        console.error(`Script ${name} exited with code ${code}:`, stderrData);
        const result = GenericError.Unknown(
          stderrData || `Process exited with code ${code}`,
        );
        TaskManager.result(taskId, result);
        resolve(result);
        return;
      }
      console.log(`Script ${name} ran successfully:`);
      const result = Result.Success(undefined);
      TaskManager.result(taskId, result);
      resolve(result);
    });
  });
}

function parseLine(line: string) {
  if (!line) return;

  if (!line.startsWith("[kova]: ")) return;

  const json = line.slice("[kova]: ".length).trim();

  try {
    return CommandReport.parse(JSON.parse(json));
  } catch (e) {
    return;
  }
}

function handleCommandReport(report: CommandReport) {
  // Example report: "echo '[kova]: {\"type\":\"reload-path\",\"path\":\"/Users/cavitertugrulsirt/Downloads\"}'"
  if (report.type === "reload-path") {
    sendGenericEvent({
      type: "reload-path",
      path: report.path,
      fileToSelect: report.fileToSelect,
    });
  } else {
    const _exhaustiveCheck: never = report?.type;
    return _exhaustiveCheck;
  }
}
