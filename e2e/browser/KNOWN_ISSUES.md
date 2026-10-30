# Known issues found by the browser tests

Found while writing phase 1 of the [e2e plan](../../docs/e2e-plan.md). Issues 1 and 2 are fixed in #113; once it is
merged, replace `test.fixme` with `test` in `admin.spec.ts` and `checkout.spec.ts`. Issue 3 is not fixed yet.

## 1. Admin login: pressing Login before the page is interactive (fixed in #113)

`browser/admin.spec.ts` › wrong password is rejected, right one reaches the dashboard.

- Cause: before hydration the form had no handler, so Login submitted it natively as a GET. The password ended up in the
  URL (`/admin/login?email=…&password=…`) and the page reloaded with an empty form.
- Fix: the Login button stays disabled until the page is interactive.

## 2. Hosted checkout wipes what was typed before hydration (fixed in #113)

`browser/checkout.spec.ts` › a shopper checks out and the owner sees the order in the admin.

- Cause: the country list was built with `Intl.DisplayNames` on server and browser, which differ, so hydration failed
  and React rebuilt the form, clearing the email. Placing the order then failed with "Enter a valid email" (the field was
  above the visible part of the page, so it looked as if no field was marked).
- Fix: the server builds the list once and sends it with the checkout data.

## 3. A failed order placement shows raw SQL to the buyer (open)

- Observed: when `insert into "orders" …` failed (order number collision after a test run left an order behind), the
  checkout page printed the whole failed query, with column names, under the Place order button.
- Expect: a generic "Could not place the order" message to the buyer; details only in the server log.
