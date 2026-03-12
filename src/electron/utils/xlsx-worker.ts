import { parentPort } from "worker_threads";
import * as XLSX from "xlsx";
import fsP from "fs/promises";

interface WorkerMessage {
  id: string;
  filePath: string;
  maxRows: number;
}

interface WorkerResult {
  id: string;
  success: true;
  sheets: Record<string, unknown[][]>;
  isTruncated: boolean;
}

interface WorkerError {
  id: string;
  success: false;
  error: string;
}

if (!parentPort) {
  throw new Error("This module must be run as a worker thread");
}

parentPort.on("message", async (message: WorkerMessage) => {
  const { id, filePath, maxRows } = message;
  
  try {
    // Read and parse the file in the worker thread
    const buffer = await fsP.readFile(filePath);
    const workbook = XLSX.read(buffer, { type: "buffer" });

    // Convert sheets to JSON with row limits
    const sheets: Record<string, unknown[][]> = {};
    let totalRows = 0;
    let isTruncated = false;

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const range = XLSX.utils.decode_range(sheet["!ref"]!);

      // Limit rows (0-based, inclusive)
      range.e.r = Math.min(range.e.r, maxRows - 1);

      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        range,
      }) as unknown[][];

      const remainingRows = maxRows - totalRows;
      if (remainingRows <= 0) {
        isTruncated = true;
        break;
      }

      if (rows.length > remainingRows) {
        sheets[sheetName] = rows.slice(0, remainingRows);
        totalRows += remainingRows;
        isTruncated = true;
      } else {
        sheets[sheetName] = rows;
        totalRows += rows.length;
      }
    }

    const result: WorkerResult = {
      id,
      success: true,
      sheets,
      isTruncated,
    };

    parentPort!.postMessage(result);
  } catch (error) {
    const errorResult: WorkerError = {
      id,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
    parentPort!.postMessage(errorResult);
  }
});
