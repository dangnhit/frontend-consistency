import type { Forbid } from "./schema.js";

/**
 * Concern catalog: UI decisions agents tend to make differently on every screen, and the code signals that mark
 * them. The catalog never holds the answer — patterns in the project contract do. See docs/spec-v0.2.md §7.
 */
export interface Concern {
  id: string;
  title: string;
  signals: Forbid[];
  /** Frame concerns: route files whose default-export root element is the signal (scan groups by root). */
  rootFiles?: string[];
  /**
   * Regex (case-insensitive) for names of components/functions that *implement* this concern. `fcs scan` treats an
   * export containing the concern's signals as the project's shared implementation only when its name (or file name)
   * matches; otherwise the signals inside it are incidental (a button that shows a spinner is not "the loading state").
   */
  names?: string;
}

const SPINNER_ICONS = ["Loader", "Loader2", "LoaderCircle", "LoaderPinwheel"].map((n) => ({ import: `lucide-react#${n}` }));

export const CONCERNS: Concern[] = [
  {
    id: "loading",
    names: "load|spin|skeleton|pending|busy|progress|placeholder|suspense|boundary",
    title: "Loading states",
    signals: [
      ...SPINNER_ICONS,
      { className: "animate-spin" },
      { import: "@/components/ui/skeleton" },
      { import: "@/components/ui/spinner" },
      { text: "^loading(\\.{3}|…)?$" },
    ],
  },
  {
    id: "text-input",
    names: "input|field|textarea|textbox|editor|select",
    title: "Text inputs",
    signals: [{ element: "input" }, { element: "textarea" }, { element: "select" }],
  },
  {
    id: "page-title",
    names: "header|title|heading",
    title: "Page titles",
    signals: [{ element: "h1" }],
  },
  {
    id: "breadcrumb",
    names: "crumb",
    title: "Breadcrumbs",
    signals: [{ import: "@/components/ui/breadcrumb" }],
  },
  {
    id: "confirm",
    names: "confirm|alert-?dialog|delete|destructive",
    title: "Confirmations",
    signals: [{ call: "window.confirm" }, { call: "confirm" }, { import: "@/components/ui/alert-dialog" }],
  },
  {
    id: "page-frame",
    title: "Page frame",
    signals: [],
    rootFiles: ["app/**/page.{tsx,jsx,ts,js}", "src/app/**/page.{tsx,jsx,ts,js}"],
  },
  {
    id: "empty-state",
    names: "empty|blank|zero|placeholder|no-?data",
    title: "Empty states",
    signals: [{ text: "^no\\s.+\\s(yet|found)[.!]?$" }, { text: "^nothing (here|to show)( yet)?[.!]?$" }],
  },
  {
    id: "error-display",
    names: "error|alert|message|notice|banner|problem",
    title: "Error messages",
    signals: [{ className: "text-destructive" }, { className: "/^text-red-\\d{3}$/" }],
  },
  {
    id: "date-format",
    names: "date|time|day|ago|calendar|format",
    title: "Date formatting",
    signals: [
      { call: ".toLocaleDateString" },
      { call: ".toLocaleTimeString" },
      { call: "Intl.DateTimeFormat" },
      { import: "date-fns#format" },
      { import: "dayjs" },
      { import: "moment" },
    ],
  },
  {
    id: "money-format",
    names: "money|price|currency|amount|number|format",
    title: "Money and number formatting",
    signals: [{ call: "Intl.NumberFormat" }, { call: ".toFixed" }],
  },
  {
    id: "toast",
    names: "toast|notif|snack|flash",
    title: "Notifications",
    signals: [{ call: "alert" }, { call: "window.alert" }, { import: "sonner" }, { import: "react-hot-toast" }, { import: "@/components/ui/sonner" }],
  },
];

export function getConcern(id: string): Concern | undefined {
  return CONCERNS.find((c) => c.id === id);
}

/** Module part of an import matcher or ref (`"lucide-react#Loader2"` → `"lucide-react"`). */
export function moduleOf(spec: string): string {
  const i = spec.indexOf("#");
  return i === -1 ? spec : spec.slice(0, i);
}
