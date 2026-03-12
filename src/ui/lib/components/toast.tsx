import React, { useState, useCallback, ReactNode } from "react";
import { CheckCircle, XCircle, AlertTriangle, Info, X } from "lucide-react";
import { errorResponseToMessage, GenericError } from "@common/GenericError";

export type ToastSeverity = "success" | "error" | "warning" | "info";
export type ToastLocation =
  | "top-left"
  | "top-right"
  | "top-center"
  | "bottom-left"
  | "bottom-right"
  | "bottom-center";

export interface ToastOptions {
  title?: ReactNode;
  message?: ReactNode;
  severity: ToastSeverity;
  timeout?: number;
  location?: ToastLocation;
  customIcon?: React.ComponentType<{ className?: string }>;
  closeOnOutsideClick?: boolean;
}

interface Toast extends ToastOptions {
  id: string;
}

// Global toast manager - available anywhere, even outside React
class ToastManager {
  private showFn:
    | ((options: ToastOptions | GenericError.ResultType) => string)
    | null = null;
  private hideFn: ((id: string) => void) | null = null;

  setShowFunction(
    fn: (options: ToastOptions | GenericError.ResultType) => string,
  ) {
    this.showFn = fn;
  }

  setHideFunction(fn: (id: string) => void) {
    this.hideFn = fn;
  }

  show(options: ToastOptions | GenericError.ResultType) {
    if (!this.showFn) {
      console.warn("Toast system not initialized yet");
      return null;
    }
    return this.showFn(options);
  }

  hide(id: string) {
    if (!this.hideFn) {
      return;
    }
    this.hideFn(id);
  }
}

// Export a singleton instance
export const toast = new ToastManager();

const getLocationClasses = (location: ToastLocation = "top-right") => {
  const baseClasses = "toast z-1000000";
  switch (location) {
    case "top-left":
      return `${baseClasses} toast-start toast-top`;
    case "top-right":
      return `${baseClasses} toast-end toast-top`;
    case "top-center":
      return `${baseClasses} toast-center toast-top`;
    case "bottom-left":
      return `${baseClasses} toast-start toast-bottom`;
    case "bottom-right":
      return `${baseClasses} toast-end toast-bottom`;
    case "bottom-center":
      return `${baseClasses} toast-center toast-bottom`;
    default:
      return `${baseClasses} toast-end toast-bottom`;
  }
};

const getSeverityStroke = (severity: ToastSeverity) => {
  switch (severity) {
    case "success":
      return "stroke-success";
    case "error":
      return "stroke-error";
    case "warning":
      return "stroke-warning";
    case "info":
      return "stroke-info";
  }
};

const getSeverityIcon = (
  severity: ToastSeverity,
  CustomIcon: React.ComponentType<{ className?: string }> | undefined,
) => {
  const stroke = getSeverityStroke(severity);
  if (CustomIcon) {
    return <CustomIcon className={"shrink-0 h-6 w-6 " + stroke} />;
  }
  switch (severity) {
    case "success":
      return <CheckCircle className="shrink-0 h-6 w-6 stroke-success" />;
    case "error":
      return <XCircle className="shrink-0 h-6 w-6 stroke-error" />;
    case "warning":
      return <AlertTriangle className="shrink-0 h-6 w-6 stroke-warning" />;
    case "info":
      return <Info className="shrink-0 h-6 w-6 stroke-info" />;
  }
};

const ToastItem: React.FC<{ toast: Toast; onClose: (id: string) => void }> = ({
  toast,
  onClose,
}) => {
  return (
    <div className={`alert shadow-lg min-w-[300px] max-w-md`} data-toast-root="true">
      {getSeverityIcon(toast.severity, toast.customIcon)}
      <div>
        <h3 className="font-bold">
          {toast.title && <h3 className="font-bold">{toast.title}</h3>}
        </h3>
        <div className="text-xs">
          {toast.message && <div className="text-xs">{toast.message}</div>}
        </div>
      </div>
      <button
        className="btn btn-sm btn-circle btn-ghost"
        onClick={() => onClose(toast.id)}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};

export const ToastRenderer = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const removeOutsideClosableToasts = useCallback(() => {
    setToasts((prev) => prev.filter((toast) => !toast.closeOnOutsideClick));
  }, []);

  const show = useCallback(
    (opts: ToastOptions | GenericError.ResultType) => {
      const options: ToastOptions =
        "error" in opts
          ? {
              severity: "error",
              message: errorResponseToMessage(opts.error),
            }
          : opts;
      const id = Math.random().toString(36).substring(2, 9);
      const newToast: Toast = { ...options, id };

      setToasts((prev) => [...prev, newToast]);

      if (options.timeout !== Infinity && options.timeout !== undefined) {
        setTimeout(() => {
          removeToast(id);
        }, options.timeout);
      } else if (options.timeout === undefined) {
        // Default timeout: 5 seconds
        setTimeout(() => {
          removeToast(id);
        }, 5000);
      }

      return id;
    },
    [removeToast],
  );

  // Register the show function with the global toast manager
  React.useEffect(() => {
    toast.setShowFunction(show);
    toast.setHideFunction(removeToast);
  }, [removeToast, show]);

  React.useEffect(() => {
    const hasOutsideClosable = toasts.some((item) => item.closeOnOutsideClick);
    if (!hasOutsideClosable) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-toast-root="true"]')) {
        return;
      }
      removeOutsideClosableToasts();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [removeOutsideClosableToasts, toasts]);

  // Group toasts by location
  const toastsByLocation = toasts.reduce(
    (acc, toast) => {
      const location = toast.location || "top-right";
      if (!acc[location]) {
        acc[location] = [];
      }
      acc[location].push(toast);
      return acc;
    },
    {} as Record<ToastLocation, Toast[]>,
  );

  return (
    <>
      {Object.entries(toastsByLocation).map(([location, locationToasts]) => (
        <div
          key={location}
          className={getLocationClasses(location as ToastLocation)}
        >
          {locationToasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onClose={removeToast} />
          ))}
        </div>
      ))}
    </>
  );
};
