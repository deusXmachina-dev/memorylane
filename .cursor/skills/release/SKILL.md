---
name: release
description: Prepare a MemoryLane release by updating the version and release notes, then creating and pushing the tagged release commit that triggers CI. Use when the user asks to release, ship, publish, bump version, or cut a stable or prerelease version.
---

# MemoryLane Release Workflow

Use this skill for both normal releases and prereleases. The GitHub Actions release pipeline builds macOS and Windows artifacts after the tagged commit is pushed. Tags without a suffix publish regular releases. Tags with a semver suffix such as `-beta.1` publish GitHub prereleases.

## Prerequisites

- Working tree is clean (`git status` shows nothing to commit)
- On the `main` branch, up to date with origin
- Dependencies installed with `bun install`

## Steps

### 1. Install dependencies

```bash
bun install
```

Always run this first so all workspace packages are present before any release edits, checks, or git operations.

### 2. Determine the new version

Ask the user if not provided.

- Stable: `MAJOR.MINOR.PATCH`
- Prerelease: `MAJOR.MINOR.PATCH-label.N`

The git tag format is always `v<version>`.

### 3. Review changes since the last tag

```bash
git log --oneline $(git describe --tags --abbrev=0)..HEAD
git diff --stat $(git describe --tags --abbrev=0)..HEAD
```

Summarize the key user-facing changes. This drives `RELEASE_NOTES.md`.

### 4. Bump version in `package.json`

Update the `"version"` field to the new version.

### 5. Update `RELEASE_NOTES.md`

Follow the existing format in the file. Keep the wording brief and current.

- **Title**: `# MemoryLane vX.Y.Z`
- **What's Changed**: Summarize the commits into user-facing bullet points. Reference GitHub issues where applicable (for example `closes #4`).
- **Features**: Update the feature list if new capabilities were added.
- **Known Issues & Limitations**: Remove any issues that have been resolved. Add new ones if applicable.
- **Installation**: Keep the macOS and Windows install guidance aligned with the current release channel.
- **Full Changelog**: Update the tag reference in the URL.

### 6. Update `README.md` if needed

Check the "Coming Soon" and "Limitations" sections. If a released feature is listed there, move or remove it.

### 7. Format and lint

```bash
bun run format
bun run lint
```

### 8. Commit and tag

Stage only the files you changed:

```bash
git add package.json RELEASE_NOTES.md
# Add README.md only if it changed for this release.
git add README.md
git commit -m "release: vX.Y.Z"
git tag vX.Y.Z
```

Create the tag only after the commit succeeds. Do not run `git commit` and `git tag` in parallel.

If the version is a prerelease, keep the same commit format and tag shape:

```bash
git commit -m "release: vX.Y.Z-label.N"
git tag vX.Y.Z-label.N
```

After tagging, verify it points at the release commit:

```bash
git rev-parse HEAD
git rev-parse vX.Y.Z
```

For prereleases:

```bash
git rev-parse HEAD
git rev-parse vX.Y.Z-label.N
```

These SHAs must match before pushing.

### 9. Push the commit and tag


```bash
git push origin HEAD
git push origin vX.Y.Z
```

For a prerelease version, push the prerelease tag instead:

```bash
git push origin HEAD
git push origin vX.Y.Z-label.N
```

Pushing the tag triggers `.github/workflows/release.yml`. That workflow builds both platforms and creates the GitHub release automatically.


## Checklist

Before finishing, verify:

- [ ] `package.json` version matches the new tag
- [ ] `RELEASE_NOTES.md` title and changelog link reference the new version
- [ ] Resolved known issues are removed from release notes
- [ ] `README.md` "Coming Soon" doesn't list shipped features
- [ ] `bun install` has been run before release steps
- [ ] `bun run format` and `bun run lint` pass
- [ ] Commit message matches the version tag
- [ ] The correct `v<version>` tag is pushed to origin
