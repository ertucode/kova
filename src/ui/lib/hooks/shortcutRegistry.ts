// Global registry for all active shortcuts
// Uses a Map with command IDs as keys to store shortcuts

import { DefinedShortcutInput, ShortcutCode, isSequenceShortcut } from "./useShortcuts";
import { shortcutCustomizationStore } from "./shortcutCustomization";

export type RegisteredShortcut = {
  command: string;
  label: string;
  shortcut: DefinedShortcutInput;
  defaultShortcut: DefinedShortcutInput;
};

const shortcutRegistry = new Map<string, RegisteredShortcut>();

export const shortcutRegistryAPI = {
  register: (command: string, label: string, shortcut: DefinedShortcutInput) => {
    shortcutRegistry.set(command, { 
      command,
      label, 
      shortcut,
      defaultShortcut: shortcut,
    });
  },

  unregister: (command: string) => {
    shortcutRegistry.delete(command);
  },

  getAll: () => {
    const customShortcuts = shortcutCustomizationStore.get().context.customShortcuts;
    
    return Array.from(shortcutRegistry.values()).map((registered) => {
      const customKey = customShortcuts[registered.command];
      
      if (!customKey) {
        return registered;
      }

      // Apply custom shortcut override
      const customizedShortcut = { ...registered.shortcut };
      
      if (isSequenceShortcut(customizedShortcut)) {
        // Handle sequence shortcuts
        if (typeof customKey === "object" && "sequence" in customKey) {
          customizedShortcut.sequence = customKey.sequence;
        }
      } else {
        // Handle regular shortcuts
        if (Array.isArray(customKey)) {
          customizedShortcut.code = customKey as ShortcutCode[];
        } else {
          customizedShortcut.code = customKey as ShortcutCode;
        }
      }

      return {
        ...registered,
        shortcut: customizedShortcut,
      };
    });
  },

  clear: () => {
    shortcutRegistry.clear();
  },
};
