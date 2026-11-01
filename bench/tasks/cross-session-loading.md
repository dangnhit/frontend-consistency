Add a customers area. There is no backend: create `lib/customers.ts` exporting 12 mock customers
(id, name, email, company, status: "active" | "churned", createdAt) and an async `getCustomers()` that
resolves after ~800 ms, plus `getCustomer(id)` with the same delay.

Build the "Customers" list page at /customers: page title, a table of customers (name, email, company, status),
each row linking to /customers/[id]. Show an appropriate state while the data loads.
Follow the existing project conventions and components.

---session---

Add the customer detail page at /customers/[id], using `getCustomer(id)` from `lib/customers.ts`.
Show the customer's fields and a link back to the list. Show an appropriate state while the data loads,
and handle an unknown id. Follow the existing project conventions and components.
