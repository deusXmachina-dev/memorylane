---
name: release
description: Run the full release workflow for MemoryLane — bump version, update release notes, commit, tag, push, build, and create a GitHub release. Use when the user asks to release, ship, publish, bump version, or cut a new version.
---

# Release Workflow

## Prerequisites

- Working tree is clean (`git status` shows nothing to commit)
- On the `main` branch, up to date with origin
- `gh` CLI is authenticated (`gh auth status` — run with `required_permissions: ["all"]`)

## Steps

### 1. Determine the new version

Ask the user if not provided. Follow semver: `MAJOR.MINOR.PATCH`.

### 2. Review changes since the last tag

```bash
git log --oneline $(git describe --tags --abbrev=0)..HEAD
git diff --stat $(git describe --tags --abbrev=0)..HEAD
```

Summarize the key changes — this drives the release notes.

### 3. Bump version in `package.json`

Update the `"version"` field to the new version.

### 4. Update `RELEASE_NOTES.md`

Follow the existing format in the file. Key sections to update:

- **Title**: `# MemoryLane vX.Y.Z`
- **What's Changed**: Summarize the commits into user-facing bullet points. Reference GitHub issues where applicable (e.g., `closes #4`).
- **Features**: Update the feature list if new capabilities were added.
- **Known Issues & Limitations**: Remove any issues that have been resolved. Add new ones if applicable.
- **Installation**: Keep the curl one-liner and permission instructions up to date.
- **Full Changelog**: Update the tag reference in the URL.

### 5. Update `README.md` if needed

Check the "Coming Soon" and "Limitations" sections. If a released feature is listed there, move or remove it.

### 6. Format and lint

```bash
npm run format
npm run lint
```

### 7. Commit, tag, and push

```bash
git add -A
git commit -m "release: vX.Y.Z"
git tag vX.Y.Z
```

Push requires network access — run outside the sandbox (`required_permissions: ["all"]`):

```bash
git push origin main --tags
```

Push before building. The build is deterministic (runs from the local working tree
pinned to the tagged commit) and can take a long time due to notarization. Pushing
first ensures the tag is on the remote immediately, regardless of how long the build
takes or whether other commits land on `main` in the meantime.

### 8. Build the app

```bash
npm run make:mac
```

The build produces both a ZIP and a DMG in `dist/` with **stable filenames**
(no version number). Verify they exist:

```bash
ls dist/MemoryLane-arm64-mac.zip
ls dist/MemoryLane-arm64-mac.dmg
```

These stable names are configured via `artifactName` in `electron-builder.yml`.
They allow `https://github.com/{owner}/{repo}/releases/latest/download/{asset}`
URLs to always resolve to the latest release, which `install.sh` depends on.

Notarization runs automatically via `build/notarize.js` (requires `APPLE_ID` and
`APPLE_APP_PASSWORD` in `.env`). The build will take a few extra minutes while Apple
processes the notarization request. If the env vars are not set, notarization is
skipped and the app is only code-signed.

After the build completes, verify notarization and code signing:

```bash
spctl --assess --verbose=4 --type execute "dist/mac-arm64/MemoryLane.app"
codesign --verify --deep --strict "dist/mac-arm64/MemoryLane.app"
```

`spctl` should report `accepted` and `codesign` should exit 0 with no output.

### 9. Create GitHub release

Run outside the sandbox (`required_permissions: ["all"]`):

```bash
gh release create vX.Y.Z \
  dist/MemoryLane-arm64-mac.zip \
  dist/MemoryLane-arm64-mac.dmg \
  --title "vX.Y.Z" \
  --notes-file RELEASE_NOTES.md
```

## Checklist

Before finishing, verify:

- [ ] `package.json` version matches the new tag
- [ ] `RELEASE_NOTES.md` title, download filename, and changelog link all reference the new version
- [ ] Resolved known issues are removed from release notes
- [ ] `README.md` "Coming Soon" doesn't list shipped features
- [ ] `npm run format` and `npm run lint` pass
- [ ] Tag is pushed to origin
- [ ] `dist/MemoryLane-arm64-mac.zip` exists
- [ ] `dist/MemoryLane-arm64-mac.dmg` exists
- [ ] Notarization verified (`spctl --assess` reports `accepted`)
- [ ] GitHub release is published with both ZIP and DMG attached
