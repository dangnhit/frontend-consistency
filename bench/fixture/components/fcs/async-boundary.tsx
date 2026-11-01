"use client";

import * as React from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { ruleParams } from "./contract.generated";

/**
 * Locked by frontend-consistency (rule loading.page). Do not edit —
 * change behaviour in .design/ (params.pattern, delayMs) and run `fcs build`.
 */

export type SkeletonVariant = "list" | "table" | "detail" | "form" | "cards";

const DEFAULTS = { pattern: "skeleton", delayMs: 300 } as const;

function loadingParams(): { pattern: string; delayMs: number } {
  const p = (ruleParams("loading.page") ?? {}) as Partial<{ pattern: string; delayMs: number }>;
  return { pattern: p.pattern ?? DEFAULTS.pattern, delayMs: Number(p.delayMs ?? DEFAULTS.delayMs) };
}

/** Renders nothing until `delayMs` has passed, so fast loads never flash a loading state. */
function useDelayed(delayMs: number): boolean {
  const [visible, setVisible] = React.useState(delayMs <= 0);
  React.useEffect(() => {
    if (delayMs <= 0) return;
    const t = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);
  return visible;
}

function Line({ className }: { className?: string }) {
  return <Skeleton className={cn("h-4", className)} />;
}

function Shape({ variant }: { variant: SkeletonVariant }) {
  switch (variant) {
    case "list":
      return (
        <div className="grid gap-4">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="size-10 rounded-full" />
              <div className="grid flex-1 gap-2">
                <Line className="w-1/3" />
                <Line className="w-2/3" />
              </div>
            </div>
          ))}
        </div>
      );
    case "table":
      return (
        <div className="grid gap-2">
          <Skeleton className="h-9 w-full" />
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      );
    case "detail":
      return (
        <div className="grid gap-6">
          <div className="grid gap-2">
            <Skeleton className="h-7 w-1/3" />
            <Line className="w-1/4" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="grid gap-2">
                <Line className="w-1/4" />
                <Line className="w-3/4" />
              </div>
            ))}
          </div>
        </div>
      );
    case "form":
      return (
        <div className="grid max-w-xl gap-6">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="grid gap-2">
              <Line className="w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
          <Skeleton className="h-9 w-28" />
        </div>
      );
    case "cards":
      return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      );
  }
}

export interface PageSkeletonProps {
  /** Shape of the content being loaded. Pick the one matching the final layout. */
  variant: SkeletonVariant;
  /** Accessible label announced to screen readers. */
  label?: string;
  className?: string;
}

/** The project's loading state. Skeleton or spinner is decided by the contract, not by the screen. */
export function PageSkeleton({ variant, label = "Loading", className }: PageSkeletonProps) {
  const { pattern, delayMs } = loadingParams();
  const visible = useDelayed(delayMs);
  if (!visible) return null;
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={cn("w-full", className)}>
      <span className="sr-only">{label}</span>
      {pattern === "spinner" ? (
        <div className="flex min-h-48 items-center justify-center">
          <LoaderCircle aria-hidden="true" className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div aria-hidden="true">
          <Shape variant={variant} />
        </div>
      )}
    </div>
  );
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  onRetry?: () => void;
  title: string;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  retry = () => {
    this.setState({ error: null });
    this.props.onRetry?.();
  };

  render() {
    if (!this.state.error) return this.props.children;
    // A failed load is never rendered as empty or zero: say it failed and offer a retry.
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 p-4">
        <div className="grid gap-1">
          <p className="text-sm font-medium">{this.props.title}</p>
          <p className="text-sm text-muted-foreground">{this.state.error.message || "Something went wrong."}</p>
        </div>
        <Button variant="outline" size="sm" onClick={this.retry}>
          Try again
        </Button>
      </div>
    );
  }
}

export interface AsyncBoundaryProps {
  children: React.ReactNode;
  /** Shape of the loading state; matches the content inside. */
  skeleton: SkeletonVariant;
  /** Heading of the error state. */
  errorTitle?: string;
  /** Called after "Try again" (e.g. router.refresh or a query reset). */
  onRetry?: () => void;
}

/** Suspense + error boundary with the contract's loading state. Use instead of a bare <Suspense>. */
export function AsyncBoundary({ children, skeleton, errorTitle = "Couldn't load this section", onRetry }: AsyncBoundaryProps) {
  return (
    <ErrorBoundary title={errorTitle} onRetry={onRetry}>
      <React.Suspense fallback={<PageSkeleton variant={skeleton} />}>{children}</React.Suspense>
    </ErrorBoundary>
  );
}
