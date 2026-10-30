# Releasing

Releases are cut by pushing a version tag. The `Release` workflow
(`.github/workflows/release.yaml`) runs lint, typecheck and build, publishes
the main Shopnex and Stripe app Docker images to GHCR with the same version
tag, then publishes a GitHub Release with generated notes and both image pull
commands.

## Steps

1. Make sure `main` is green in CI and contains everything you want to ship.

   ```sh
   git checkout main && git pull
   ```

2. Bump the version everywhere. This sets `version` in every workspace
   `package.json` (except `@shopnex/storefront-sdk`, which is versioned on its
   own) from the latest tag:

   ```sh
   pnpm bump patch   # or: minor | major | 1.2.3
   ```

   Commit the result, open a PR to `main` and merge it, then
   `git checkout main && git pull`.

3. Tag the merge commit and push. Use the version `pnpm bump` printed:

   ```sh
   git tag v0.10.0
   git push origin v0.10.0
   ```

4. Watch the run in the **Actions** tab, then review the release under
   **Releases**. The notes include the matching image references, for example
   `docker pull ghcr.io/shopnex-ai/shopnex:v0.8.0` and
   `docker pull ghcr.io/shopnex-ai/shopnex-stripe:v0.8.0`. Edit the notes there
   if needed.

## Notes

- Tags with a suffix (e.g. `v0.8.0-rc.1`) are published as pre-releases.
- Stable releases also move the `latest` GHCR tag, and `docker save` archives of
  both images are attached to the release as assets.
- Every release tag, including pre-releases, gets matching versioned GHCR tags
  for Shopnex and the Stripe app. Both images are multi-arch (`linux/amd64` and `linux/arm64`), built natively
  on each architecture and merged into one tag.
- Fix a bad release by deleting the GitHub Release and tag
  (`git push origin :refs/tags/v0.8.0`), fixing, and tagging again.
- The workflow does not publish to npm. If the `@shopnex/*` packages should be
  published, bump their `version` fields in the release commit and add a
  publish step.
