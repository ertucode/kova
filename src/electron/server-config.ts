import { readFile } from "fs/promises";
import { homedir } from "os";
import z from "zod";
import { CommandMetadata } from "../common/Command.js";

export const ServerConfig = z.object({
  commands: z
    .object({
      command: z.string(),
    })
    .and(CommandMetadata)
    .array()
    .nullish(),
});
export type ServerConfig = z.infer<typeof ServerConfig>;

async function loadConfig(): Promise<ServerConfig> {
  const path = homedir() + "/.config/kova/kova.json";
  try {
    const file = await readFile(path, "utf-8");
    const parsed = ServerConfig.parse(JSON.parse(file));

    if (parsed.commands) {
      const nameSet = new Set(parsed.commands.map((s) => s.name));
      if (nameSet.size !== parsed.commands.length) {
        console.error("Duplicate command names found in config");
        parsed.commands = undefined;
      }
    }

    console.log("Loaded config:", JSON.stringify(parsed, null, 2));
    return parsed;
  } catch (error) {
    console.error(error);
    return ServerConfig.parse({});
  }
}

const configPromise = loadConfig();

export const getServerConfig = () => configPromise;
