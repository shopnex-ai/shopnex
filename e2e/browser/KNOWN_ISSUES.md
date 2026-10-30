# Known issues found by the browser tests

Found while writing phase 1 of the [e2e plan](../../docs/e2e-plan.md). The affected tests are marked `test.fixme`
with the issue number; enable them once the issue is fixed. Not worked around in the tests on purpose.

## 1. Admin login can lose the typed email

`browser/admin.spec.ts` › wrong password is rejected, right one reaches the dashboard.

- Observed: after filling Email and Password and pressing Login, the Email field is empty (browser says "Please fill out
  this field") while Password is still filled. Failed in 2 of 5 runs; the first run passed.
- Suspected cause (unconfirmed): the form is server-rendered and input typed before the page finishes loading is reset.
- Expect: whatever a person types into the login form is kept.

## 2. Hosted checkout rejects a fully filled form

`browser/checkout.spec.ts` › a shopper checks out and the owner sees the order in the admin.

- Observed: Email, country, last name, address, city, postal code and state filled, shipping and payment method chosen,
  "Place order" shows "Check the highlighted fields." and no field is marked. 3 of 3 runs.
- Possibly the same cause as issue 1 (a field cleared while the form refreshes to quote shipping); not confirmed.
- Expect: a filled form places the order, or the error names the field.
- Also check: the form refreshing while the buyer types (shipping methods appear after the address is entered).
