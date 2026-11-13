import type { Forbid } from "./schema.js";

/**
 * Concern catalog: UI decisions agents tend to make differently on every screen, and the code signals that mark
 * them. The catalog never holds the answer — patterns in the project contract do. See docs/spec-v0.2.md §7.
 */
export interface Concern {
  id: string;
  title: string;
  signals: Forbid[];
}

const SPINNER_ICONS = ["Loader", "Loader2", "LoaderCircle", "LoaderPinwheel"].map((n) => ({ import: `lucide-react#${n}` }));

export const CONCERNS: Concern[] = [
  {
    id: "loading",
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
    title: "Text inputs",
    signals: [{ element: "input" }, { element: "textarea" }, { element: "select" }],
  },
  {
    id: "page-title",
    title: "Page titles",
    signals: [{ element: "h1" }],
  },
  {
    id: "breadcrumb",
    title: "Breadcrumbs",
    signals: [{ import: "@/components/ui/breadcrumb" }],
  },
  {
    id: "confirm",
    title: "Confirmations",
    signals: [{ call: "window.confirm" }, { call: "confirm" }, { import: "@/components/ui/alert-dialog" }],
  },
  {
    id: "toast",
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
