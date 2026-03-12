import { BrowserWindow } from "electron";
import { GenericEvent } from "../common/GenericEvent.js";

export function sendGenericEvent(event: GenericEvent) {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length === 0) return;

  for (const win of windows) {
    win.webContents.send("generic:event", event);
  }
}
