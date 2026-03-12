import type { DragEvent } from "react";

export type DragItem = {
  fullPath: string;
  type: "file" | "dir";
  name: string;
};

const DRAG_ITEMS_MIME = "application/x-mygui-drag-items";
const FILE_DRAG_MIME = "application/x-mygui-file-drag";
const NATIVE_FILES_TYPE = "Files";

export const getDragItemsFromDataTransfer = (
  e: DragEvent,
): DragItem[] | null => {
  const dragItemsJson = e.dataTransfer.getData(DRAG_ITEMS_MIME);
  if (!dragItemsJson) {
    return null;
  }

  try {
    const items = JSON.parse(dragItemsJson) as DragItem[];
    return items.length > 0 ? items : null;
  } catch (error) {
    console.error("Failed to parse drag items", error);
    return null;
  }
};

export const resolveDragItemsFromEvent = (
  e: DragEvent,
  fallbackItems?: DragItem[] | null,
): DragItem[] | null => {
  const items = getDragItemsFromDataTransfer(e);
  if (items) {
    return items;
  }

  if (fallbackItems && fallbackItems.length > 0) {
    return fallbackItems;
  }

  return null;
};

export const isFileDragEvent = (e: DragEvent, hasActiveDrag: boolean) => {
  if (e.dataTransfer.types.includes(FILE_DRAG_MIME)) {
    return true;
  }

  if (hasActiveDrag && e.dataTransfer.types.includes(NATIVE_FILES_TYPE)) {
    return true;
  }

  return false;
};
