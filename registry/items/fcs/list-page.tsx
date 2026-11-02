import * as React from "react";

import { Page, type PageHeaderProps } from "./page";

export interface ListPageProps extends PageHeaderProps {
  /** Filters, search and view switches — one row above the list. Not the primary action (use `actions`). */
  toolbar?: React.ReactNode;
  /** The list itself: table, cards, or an AsyncBoundary around them. */
  children?: React.ReactNode;
}

/**
 * List screen: header, toolbar row, list. Locked by frontend-consistency (rule layout.page-template).
 */
export function ListPage({ toolbar, children, ...header }: ListPageProps) {
  return (
    <Page {...header}>
      {toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : null}
      <section className="flex flex-col gap-4">{children}</section>
    </Page>
  );
}
