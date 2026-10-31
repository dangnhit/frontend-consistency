"use client";

import * as React from "react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { ruleParams } from "./contract.generated";

const RESIZE_CLASS: Record<string, string> = {
  none: "resize-none",
  vertical: "resize-y",
};

const RESIZE_UTILITY = /(^|\s)([\w-]+:)*resize(-x|-y|-none)?(?=\s|$)/g;

export interface TextareaFieldProps extends Omit<React.ComponentProps<"textarea">, "children"> {
  /** Visible label. Required: placeholders are not labels. */
  label: string;
  name: string;
  /** Helper text shown under the field. */
  hint?: React.ReactNode;
  /** Error message; marks the field invalid and replaces the hint. */
  error?: React.ReactNode;
}

/**
 * Locked by frontend-consistency (rule forms.textarea.resize). Do not edit —
 * change behaviour in .design/ and run `fcs build`.
 */
export function TextareaField({
  label,
  name,
  hint,
  error,
  id,
  rows = 4,
  className,
  required,
  ...props
}: TextareaFieldProps) {
  const autoId = React.useId();
  const fieldId = id ?? `${name}-${autoId}`;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;

  const resize = ruleParams("forms.textarea.resize")?.resize;
  const resizeClass = resize ? RESIZE_CLASS[resize] : undefined;
  // Per-screen resize utilities are ignored when the contract decides resize.
  const userClass = resizeClass ? className?.replace(RESIZE_UTILITY, " ").trim() : className;

  const describedBy = [error ? errorId : hint ? hintId : null, props["aria-describedby"]].filter(Boolean).join(" ");

  return (
    <div className="grid gap-2">
      <Label htmlFor={fieldId}>
        {label}
        {required ? <span aria-hidden="true" className="text-destructive">*</span> : null}
      </Label>
      <Textarea
        {...props}
        id={fieldId}
        name={name}
        rows={rows}
        required={required}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={describedBy || undefined}
        className={cn(userClass, resizeClass)}
      />
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
