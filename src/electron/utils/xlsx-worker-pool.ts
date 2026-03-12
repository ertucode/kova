import { Worker } from "worker_threads";
import path from "path";
import { fileURLToPath } from "url";

interface XlsxWorkerResult {
  success: true;
  sheets: Record<string, unknown[][]>;
  isTruncated: boolean;
}

interface XlsxWorkerError {
  success: false;
  error: string;
}

type XlsxWorkerResponse = XlsxWorkerResult | XlsxWorkerError;

interface WorkerResponseMessage {
  id: string;
  success: boolean;
  sheets?: Record<string, unknown[][]>;
  isTruncated?: boolean;
  error?: string;
}

interface PendingTask {
  resolve: (result: XlsxWorkerResponse) => void;
  reject: (error: Error) => void;
}

class XlsxWorkerPool {
  private workers: Worker[] = [];
  private availableWorkers: Worker[] = [];
  private pendingTasks: Map<string, PendingTask> = new Map();
  private taskQueue: Array<{ id: string; filePath: string; maxRows: number }> =
    [];
  private nextTaskId = 0;
  private readonly poolSize: number;
  private workerPath: string;
  private initialized = false;

  constructor(poolSize = 2) {
    this.poolSize = poolSize;
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    this.workerPath = path.join(__dirname, "xlsx-worker.js");
  }

  /**
   * Initialize the worker pool
   */
  private init() {
    if (this.initialized) return;
    this.initialized = true;

    for (let i = 0; i < this.poolSize; i++) {
      this.createWorker();
    }
  }

  /**
   * Create a new worker and add it to the pool
   */
  private createWorker() {
    const worker = new Worker(this.workerPath);

    worker.on("message", (response: WorkerResponseMessage) => {
      const task = this.pendingTasks.get(response.id);
      if (task) {
        this.pendingTasks.delete(response.id);
        
        // Convert WorkerResponseMessage to XlsxWorkerResponse
        if (response.success) {
          task.resolve({
            success: true,
            sheets: response.sheets!,
            isTruncated: response.isTruncated!,
          });
        } else {
          task.resolve({
            success: false,
            error: response.error!,
          });
        }
      }

      // Mark worker as available and process next task
      this.availableWorkers.push(worker);
      this.processQueue();
    });

    worker.on("error", (error) => {
      console.error("Worker error:", error);
      // Find and reject any pending tasks for this worker
      // In practice, we'd need to track which worker is handling which task
      // For now, we'll just remove the worker and create a new one
      this.removeWorker(worker);
      this.createWorker();
    });

    worker.on("exit", (code) => {
      if (code !== 0) {
        console.error(`Worker stopped with exit code ${code}`);
        this.removeWorker(worker);
      }
    });

    this.workers.push(worker);
    this.availableWorkers.push(worker);
  }

  /**
   * Remove a worker from the pool
   */
  private removeWorker(worker: Worker) {
    const workerIndex = this.workers.indexOf(worker);
    if (workerIndex !== -1) {
      this.workers.splice(workerIndex, 1);
    }

    const availableIndex = this.availableWorkers.indexOf(worker);
    if (availableIndex !== -1) {
      this.availableWorkers.splice(availableIndex, 1);
    }
  }

  /**
   * Process the next task in the queue
   */
  private processQueue() {
    if (this.taskQueue.length === 0 || this.availableWorkers.length === 0) {
      return;
    }

    const worker = this.availableWorkers.shift()!;
    const task = this.taskQueue.shift()!;

    worker.postMessage({
      id: task.id,
      filePath: task.filePath,
      maxRows: task.maxRows,
    });
  }

  /**
   * Process an XLSX file using a worker from the pool
   */
  async processXlsx(
    filePath: string,
    maxRows: number,
  ): Promise<XlsxWorkerResponse> {
    this.init();

    return new Promise((resolve, reject) => {
      const taskId = `task-${this.nextTaskId++}`;

      this.pendingTasks.set(taskId, { resolve, reject });
      this.taskQueue.push({ id: taskId, filePath, maxRows });

      this.processQueue();
    });
  }

  /**
   * Terminate all workers in the pool
   */
  async terminate() {
    const promises = this.workers.map((worker) => worker.terminate());
    await Promise.all(promises);
    this.workers = [];
    this.availableWorkers = [];
    this.pendingTasks.clear();
    this.taskQueue = [];
    this.initialized = false;
  }
}

// Create a singleton instance
export const xlsxWorkerPool = new XlsxWorkerPool(2);
