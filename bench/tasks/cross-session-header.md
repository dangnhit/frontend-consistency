Add a customers area. There is no backend: create `lib/customers.ts` exporting 12 mock customers
(id, name, email, company, status: "active" | "churned", notes, createdAt) and async `getCustomers()` and
`getCustomer(id)` that resolve after ~800 ms, plus `updateCustomer(id, data)`.

Build the "Customers" list page at /customers: a title, a "New customer" button, a search box above the table,
and a table of customers (name, email, company, status), each row linking to /customers/[id].
Follow the existing project conventions and components.

---session---

Add the customer detail page at /customers/[id] using `getCustomer(id)`. Show the customer's fields, an "Edit"
button that goes to /customers/[id]/edit, and a way to get back to the list. Handle an unknown id.
Follow the existing project conventions and components.

---session---

Add the edit page at /customers/[id]/edit: a form for name, email, company, status and notes (multi-line),
saved with `updateCustomer`, then return to the detail page. Make it easy to get back to the customer and to the
list. Follow the existing project conventions and components.
