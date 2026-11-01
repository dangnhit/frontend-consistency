Add a customers area. There is no backend: create `lib/customers.ts` exporting 12 mock customers
(id, name, email, company, status: "active" | "churned", createdAt, notes) with async `getCustomers()` and
`getCustomer(id)` that resolve after ~800 ms.

Build:
1. /customers — page title, a table of customers (name, email, company, status), each row linking to the detail
   page, and a "New customer" button linking to /customers/new.
2. /customers/[id] — the customer's fields, a link back to the list; handle an unknown id.
3. /customers/new — a form: name, email, company, status, and notes (multi-line). "Create customer" submits
   (no backend: log the values).

Show an appropriate state while data loads. Follow the existing project conventions and components.

---session---

Add an invoices area. Create `lib/invoices.ts` with 15 mock invoices (id, number, customer, amount, status:
"draft" | "sent" | "paid", dueDate) and async `getInvoices()` / `getInvoice(id)` resolving after ~800 ms.

Build:
1. /invoices — a table of invoices (number, customer, amount, status, due date), rows linking to the detail page.
2. /invoices/[id] — invoice fields, a link back, and an "Internal note" form with a multi-line field and a
   "Save note" button (log the value). Handle an unknown id.

Show an appropriate state while data loads. Follow the existing project conventions and components.
