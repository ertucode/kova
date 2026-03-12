import { RefObject, useEffect, useRef } from "react";
import { shortcutRegistryAPI } from "./shortcutRegistry";
import { shortcutCustomizationStore } from "./shortcutCustomization";

export type ShortcutCode =
  | string
  | {
      code: string;
      metaKey?: boolean;
      shiftKey?: boolean;
      ctrlKey?: boolean;
      altKey?: boolean;
    };

export type ShortcutWithHandler = {
  command?: string;
  code: ShortcutCode | ShortcutCode[];
  handler: (e: KeyboardEvent | undefined) => void;
  enabledIn?:
    | RefObject<HTMLElement | null>
    | ((e: KeyboardEvent | undefined) => boolean);
  notCode?: ShortcutCode | ShortcutCode[];
  label: string;
};

export type SequenceShortcut = {
  command?: string;
  sequence: string[];
  handler: (e: KeyboardEvent | undefined) => void;
  timeout?: number;
  enabledIn?: RefObject<HTMLElement | null> | ((e: KeyboardEvent) => boolean);
  label: string;
};

export type UseShortcutsOptions = {
  isDisabled?: boolean;
  sequenceTimeout?: number;
  hideInPalette?: boolean;
};

export type ShortcutInput = $Maybe<DefinedShortcutInput> | boolean;

export type DefinedShortcutInput = ShortcutWithHandler | SequenceShortcut;

export function isSequenceShortcut(
  shortcut: ShortcutWithHandler | SequenceShortcut,
): shortcut is SequenceShortcut {
  return "sequence" in shortcut;
}

function applyCustomShortcut(
  shortcut: DefinedShortcutInput,
  customShortcuts: Record<string, any>,
): DefinedShortcutInput {
  const customCode = customShortcuts[shortcut.label];

  if (!customCode) {
    return shortcut;
  }

  const customizedShortcut = { ...shortcut };

  if (isSequenceShortcut(customizedShortcut)) {
    if (typeof customCode === "object" && "sequence" in customCode) {
      customizedShortcut.sequence = customCode.sequence;
    }
  } else {
    if (Array.isArray(customCode)) {
      customizedShortcut.code = customCode as ShortcutCode[];
    } else {
      customizedShortcut.code = customCode as ShortcutCode;
    }
  }

  return customizedShortcut;
}

export function useShortcuts(
  shortcuts: ShortcutInput[],
  opts?: UseShortcutsOptions,
) {
  const sequenceBufferRef = useRef<{ codes: string[]; lastTime: number }>({
    codes: [],
    lastTime: 0,
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (opts?.isDisabled) return;

      const customShortcuts =
        shortcutCustomizationStore.get().context.customShortcuts;
      const customizedShortcuts = shortcuts.map((s) => {
        if (!s || s === true) return s;
        return applyCustomShortcut(s, customShortcuts);
      });

      handleKeyDownWithShortcuts(
        e,
        customizedShortcuts,
        sequenceBufferRef.current,
        opts,
      );
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [shortcuts, opts]);

  useEffect(() => {
    if (opts?.hideInPalette || opts?.isDisabled) return;
    shortcuts.forEach((shortcut) => {
      if (!shortcut || shortcut === true) return;
      const command = (shortcut as any).command || shortcut.label;
      shortcutRegistryAPI.register(command, shortcut.label, shortcut as DefinedShortcutInput);
    });

    return () => {
      shortcuts.forEach((shortcut) => {
        if (!shortcut || shortcut === true) return;
        const command = (shortcut as any).command || shortcut.label;
        shortcutRegistryAPI.unregister(command);
      });
    };
  }, [shortcuts]);
}

function checkShortcutCode(code: ShortcutCode, e: KeyboardEvent) {
  if (typeof code === "string") {
    return e.code === code;
  }

  if (code.metaKey !== undefined && e.metaKey !== code.metaKey)
    return false;
  if (code.shiftKey !== undefined && e.shiftKey !== code.shiftKey)
    return false;
  if (code.ctrlKey !== undefined && e.ctrlKey !== code.ctrlKey)
    return false;
  if (code.altKey !== undefined && e.altKey !== code.altKey)
    return false;

  return e.code === code.code;
}

function getCodeSpecificity(code: ShortcutCode): number {
  if (typeof code === "string") {
    return 0;
  }

  let specificity = 0;
  if (code.metaKey !== undefined) specificity++;
  if (code.shiftKey !== undefined) specificity++;
  if (code.ctrlKey !== undefined) specificity++;
  if (code.altKey !== undefined) specificity++;

  return specificity;
}

function checkEnabledIn(
  enabledIn:
    | RefObject<HTMLElement | null>
    | ((e: KeyboardEvent) => boolean)
    | undefined,
  e: KeyboardEvent,
): boolean {
  if (e.target instanceof HTMLInputElement) {
    if (!enabledIn) return false;
    if (typeof enabledIn === "function") {
      return enabledIn(e);
    }
    return enabledIn.current === e.target;
  }
  return true;
}

export function handleKeyDownWithShortcuts(
  e: KeyboardEvent,
  shortcuts: ShortcutInput[],
  sequenceBuffer: { codes: string[]; lastTime: number },
  opts?: UseShortcutsOptions,
) {
  const now = Date.now();
  const defaultTimeout = opts?.sequenceTimeout ?? 500;

  const sequenceShortcuts = shortcuts.filter(
    (s): s is SequenceShortcut => !!s && s !== true && isSequenceShortcut(s),
  );

  if (sequenceShortcuts.length > 0) {
    const minTimeout = Math.min(
      ...sequenceShortcuts.map((s) => s.timeout ?? defaultTimeout),
    );
    if (now - sequenceBuffer.lastTime > minTimeout) {
      sequenceBuffer.codes = [];
    }

    sequenceBuffer.codes.push(e.code);
    sequenceBuffer.lastTime = now;

    const maxLength = Math.max(
      ...sequenceShortcuts.map((s) => s.sequence.length),
    );
    if (sequenceBuffer.codes.length > maxLength) {
      sequenceBuffer.codes = sequenceBuffer.codes.slice(-maxLength);
    }

    for (const shortcut of sequenceShortcuts) {
      if (!checkEnabledIn(shortcut.enabledIn, e)) continue;

      const timeout = shortcut.timeout ?? defaultTimeout;
      if (now - sequenceBuffer.lastTime > timeout) continue;

      if (sequenceBuffer.codes.length < shortcut.sequence.length) continue;

      const bufferEnd = sequenceBuffer.codes.slice(-shortcut.sequence.length);
      const matches = shortcut.sequence.every((code, i) => bufferEnd[i] === code);

      if (matches) {
        shortcut.handler(e);
        sequenceBuffer.codes = [];
        return;
      }
    }
  }

  const matchingShortcuts: Array<{
    shortcut: ShortcutWithHandler;
    specificity: number;
  }> = [];

  shortcuts.forEach((shortcut) => {
    if (!shortcut || shortcut === true) return;
    if (isSequenceShortcut(shortcut)) return;

    if (!checkEnabledIn(shortcut.enabledIn, e)) return;

    if (shortcut.notCode) {
      if (Array.isArray(shortcut.notCode)) {
        if (shortcut.notCode.some((c) => checkShortcutCode(c, e))) {
          return;
        }
      } else {
        if (checkShortcutCode(shortcut.notCode, e)) {
          return;
        }
      }
    }

    let matchedCode: ShortcutCode | null = null;
    if (Array.isArray(shortcut.code)) {
      const matched = shortcut.code.find((c) => checkShortcutCode(c, e));
      if (matched) {
        matchedCode = matched;
      }
    } else {
      if (checkShortcutCode(shortcut.code, e)) {
        matchedCode = shortcut.code;
      }
    }

    if (matchedCode) {
      const specificity = getCodeSpecificity(matchedCode);
      matchingShortcuts.push({ shortcut, specificity });
    }
  });

  if (matchingShortcuts.length > 0) {
    matchingShortcuts.sort((a, b) => b.specificity - a.specificity);
    const mostSpecific = matchingShortcuts[0];
    mostSpecific.shortcut.handler(e);
  }
}
