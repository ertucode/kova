import React from "react";
import { clsx } from "../functions/clsx";
import { Loader2Icon } from "lucide-react";

type HtmlButtonProps = React.ComponentProps<"button">;
export type ButtonProps = HtmlButtonProps & {
  pending?: boolean;
  loading?: boolean;

  icon?: React.ComponentType<{ className?: string }>;
};

export function Button({
  pending,
  loading,
  children,
  className,
  ...props
}: ButtonProps) {
  if (props.disabled !== true) {
    if (typeof pending === "boolean") props.disabled = pending;
  }
  const showSpinner = pending || loading;
  return (
    <button className={clsx("btn btn-info", className)} {...props}>
      {(showSpinner || props.icon) && (
        <div className="h-4 w-4">
          {showSpinner ? (
            <Loader2Icon className="h-4 w-4 animate-spin" />
          ) : (
            props.icon && <props.icon className="h-4 w-4" />
          )}
        </div>
      )}
      {children}
    </button>
  );
}
