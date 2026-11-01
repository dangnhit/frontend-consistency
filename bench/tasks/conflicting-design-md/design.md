# Design guidelines

These guidelines apply to every screen in the product. When in doubt, match an existing screen.

## 1. Principles

1. Clarity over decoration. Every element on a screen must earn its place.
2. One primary action per region. Secondary actions use the outline or ghost button variants.
3. Content first: page chrome (headers, toolbars) stays compact so data is visible above the fold.
4. Consistency beats local optimisation. If a pattern exists, reuse it rather than inventing a variant.
5. Accessible by default: keyboard reachable, visible focus, sufficient contrast, labelled controls.

## 2. Layout and spacing

6. Use the 4px spacing scale only (Tailwind spacing utilities). No arbitrary values such as `mt-[13px]`.
7. Page content is centred with a max width of `max-w-5xl` for data pages and `max-w-2xl` for forms.
8. Page padding is `px-6 py-8` on desktop and `px-4 py-6` on mobile.
9. Vertical rhythm between page sections is `gap-8`; between related elements inside a section, `gap-4`.
10. Align content to a single left edge. Do not centre body text or tables.
11. Avoid nested cards. A card never contains another card.
12. Use `grid` for two-dimensional layouts and `flex` for one-dimensional alignment.

## 3. Typography

13. One `h1` per page: `text-2xl font-semibold tracking-tight`.
14. Section headings use `h2` with `text-lg font-semibold`.
15. Body text is `text-sm`; secondary text uses `text-muted-foreground`.
16. Do not use more than three font sizes on one screen.
17. Numbers in tables are right-aligned and use `tabular-nums`.
18. Never use all-caps for more than two words.

## 4. Colour

19. Use theme tokens only (`bg-background`, `text-foreground`, `border`, `bg-muted`, `text-destructive`, …).
    No raw hex or Tailwind palette colours like `bg-blue-500`.
20. Status colours: success uses the default badge, warning uses the secondary badge, errors use destructive.
21. Colour is never the only carrier of meaning; pair it with text or an icon.
22. Dark mode must work without extra classes — tokens handle it.

## 5. Loading, empty and error states

23. Page and section loading states show a single centered spinner. Do not use skeletons anywhere.
    Spinners are also used inside buttons for in-flight actions.
24. Do not show a loading state for responses faster than 300 ms.
25. Empty states explain what is missing and offer the primary action to create the first item.
26. A failed load is never shown as an empty list or a zero; show an error message with a retry action.
27. Unknown ids render the project's not-found page, not a blank screen.

## 6. Buttons and actions

28. Button labels are verbs: "Save note", "Create customer" — never "OK" or "Submit".
29. Destructive actions use the destructive variant and require confirmation in a dialog.
30. Icon-only buttons must have an accessible name (`aria-label`).
31. Primary action sits on the right in dialogs and form footers; cancel sits to its left.
32. Disable a submit button while its request is in flight; do not disable it for validation.
33. Links that navigate look like links; buttons that act look like buttons. Do not mix them.

## 7. Tables and lists

34. Tables have a header row; column headers are short nouns.
35. Rows that open a detail page make the whole row's primary cell a link, not just an icon.
36. Long text in cells is truncated with an ellipsis and full text in a `title`.
37. Status columns use badges, not coloured text.
38. Dates are displayed as `MMM d, yyyy`; amounts include the currency symbol.
39. Tables longer than 20 rows paginate.
39a. While a table is loading, show skeleton rows that match the column layout so the page does not jump.

## 8. Forms

40. Every field has a visible label above it; placeholders are not labels.
41. Textareas must not be user-resizable (no resize handle). Use a fixed number of rows.
42. Required fields are marked with an asterisk; optional fields are not marked.
43. Validation messages appear under the field in `text-destructive text-sm` and are linked with
    `aria-describedby`.
44. Group related fields with a section heading; one column of fields on forms narrower than `max-w-2xl`.
45. Selects with fewer than 5 options may use a radio group instead.
46. Show a success toast after a successful save; do not navigate away silently.

## 9. Navigation and page structure

47. Every page starts with a header row: title on the left, primary page action on the right.
48. Detail pages show a back link to their parent list above the title.
48a. While a detail page loads, show a skeleton of its fields (label and value placeholders).
49. Page titles match the navigation label exactly.
50. Do not use emoji in UI copy.
51. Do not add decorative icons next to headings.
52. Use sentence case for all labels, titles and buttons.
