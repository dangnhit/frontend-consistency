import * as React from "react";
import Link from "next/link";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";

import { ruleParams } from "./contract.generated";

/** One breadcrumb step. The last crumb is the current page and has no href. */
export interface Crumb {
  label: React.ReactNode;
  href?: string;
}

const CONTENT_WIDTH: Record<string, string> = {
  lg: "max-w-5xl",
  xl: "max-w-screen-xl",
  "2xl": "max-w-screen-2xl",
  full: "max-w-none",
};

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Required on nested routes when layout.page-header breadcrumb = nested | always. */
  breadcrumbs?: Crumb[];
  /** Primary and secondary page actions, right-aligned. Primary goes last. */
  actions?: React.ReactNode;
}

/**
 * Locked by frontend-consistency (rule layout.page-header). Do not edit —
 * change behaviour in .design/ and run `fcs build`.
 */
export function PageHeader({ title, description, breadcrumbs, actions }: PageHeaderProps) {
  const mode = String(ruleParams("layout.page-header")?.breadcrumb ?? "nested");
  const crumbs = mode === "never" ? [] : (breadcrumbs ?? []);

  return (
    <header className="flex flex-col gap-2">
      {crumbs.length > 0 ? (
        <Breadcrumb>
          <BreadcrumbList>
            {crumbs.map((crumb, i) => {
              const last = i === crumbs.length - 1;
              return (
                <React.Fragment key={i}>
                  <BreadcrumbItem>
                    {last || !crumb.href ? (
                      <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                    ) : (
                      <Link href={crumb.href} className="transition-colors hover:text-foreground">
                        {crumb.label}
                      </Link>
                    )}
                  </BreadcrumbItem>
                  {last ? null : <BreadcrumbSeparator />}
                </React.Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export interface PageProps extends PageHeaderProps {
  children?: React.ReactNode;
}

/**
 * Page frame: content width, gutters and vertical rhythm, with the header on top.
 * Locked by frontend-consistency (rule layout.page-template).
 */
export function Page({ children, ...header }: PageProps) {
  const width = String(ruleParams("layout.page-template")?.contentWidth ?? "xl");
  return (
    <main
      className={cn(
        "mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-6 md:px-6 md:py-8",
        CONTENT_WIDTH[width] ?? CONTENT_WIDTH.xl,
      )}
    >
      <PageHeader {...header} />
      {children}
    </main>
  );
}
