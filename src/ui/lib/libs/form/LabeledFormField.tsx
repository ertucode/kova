import { Alert } from "@/lib/components/alert";
import { clsx } from "@/lib/functions/clsx";
import React from "react";

export type LabeledFormFieldNonInputProps = {
  label: React.ReactNode;
  error?: $Maybe<string>;
  required?: boolean;
};
export type LabeledFormFieldProps = LabeledFormFieldNonInputProps &
  (
    | LabeledFormFieldNoChildrenProps
    | {
        name?: string;
        children: React.ReactNode;
      }
  );
export type LabeledFormFieldNoChildrenProps = {
  name: string;
} & React.InputHTMLAttributes<HTMLInputElement>;

export function LabeledFormField(props: LabeledFormFieldProps) {
  return (
    <div className="w-full flex flex-col gap-1">
      <label
        className={clsx(
          "w-full text-xs",
          props.required && "after:content-['_*']",
        )}
      >
        {props.label}
      </label>

      {"children" in props ? (
        props.children
      ) : (
        <input
          id={props.name}
          {...props}
          className={clsx("input w-full", props.className)}
        />
      )}
      <>{props.error ? <Alert className="mt-3">{props.error}</Alert> : null}</>
    </div>
  );
}

export type LabeledInputProps = React.InputHTMLAttributes<HTMLInputElement> &
  LabeledFormFieldNonInputProps;

export const LabeledFormInputField = React.forwardRef<
  HTMLInputElement,
  LabeledInputProps
>(({ className, type, ...props }, ref) => {
  const { name, ...rest } = props;
  return (
    <LabeledFormField {...rest}>
      <input
        id={props.name}
        ref={ref}
        type={type}
        {...props}
        className={clsx("input w-full", className)}
      />
    </LabeledFormField>
  );
});
LabeledFormInputField.displayName = "LabeledFormInputField";
