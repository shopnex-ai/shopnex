# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems.

Report privately through GitHub: **Security → Report a vulnerability** on this repository
(private vulnerability reporting). Include what you found, the affected version or commit, and steps to reproduce.

This is a small project, so response times are best-effort. We aim to acknowledge reports within a few days, and we
will credit you in the fix unless you prefer otherwise.

## Scope

In scope: the admin, the Storefront and Admin APIs, hosted checkout, authentication and tenancy isolation
(one shop reading or changing another's data), API tokens and app scopes, webhook signing, and the first-party apps
in this repository.

Out of scope: vulnerabilities in third-party apps or storefronts, issues that need an already-compromised
server or admin account, and findings on instances you do not own.

## Supported versions

Fixes go to the latest release. Run the latest version and keep `BETTER_AUTH_SECRET` private and unique per deployment.

## Notes for operators

- Anyone who reaches a fresh install can claim it: finish `/admin/setup` right after deploying.
- Card data is handled by Stripe Checkout and never stored by Shopnex.
