# Releasing

Releases are cut by pushing a version tag. The `Release` workflow
(`.github/workflows/release.yaml`) then runs lint, typecheck and build, and
publishes a GitHub Release with notes generated from merged PRs and commits
since the previous tag.

## Steps

1. Make sure `main` is green in CI and contains everything you want to ship.

   ```sh
   git checkout main && git pull
   ```

2. Pick the next version ([semver](https://semver.org)). The latest tag is:

   ```sh
   git describe --tags --abbrev=0
   ```

3. Tag and push:

   ```sh
   git tag v0.8.0
   git push origin v0.8.0
   ```

4. Watch the run in the **Actions** tab, then review the release under
   **Releases**. Edit the notes there if needed.

## Notes

- Tags with a suffix (e.g. `v0.8.0-rc.1`) are published as pre-releases.
- Fix a bad release by deleting the GitHub Release and tag
  (`git push origin :refs/tags/v0.8.0`), fixing, and tagging again.
- The workflow does not publish to npm. If the `@shopnex/*` packages should be
  published, bump their `version` fields in the release commit and add a
  publish step.
