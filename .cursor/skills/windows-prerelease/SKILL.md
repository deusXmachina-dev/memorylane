---
name: windows-prerelease
description: Run the Windows pre-release workflow for MemoryLane - bump a prerelease version, update release notes, build Windows artifacts, and publish a GitHub pre-release with Windows updater files. Use when the user asks for a Windows beta/rc/canary release, Windows-only test release, or any GitHub prerelease.
---

# Windows Pre-release Workflow

Use this skill for Windows distribution. Stable releases remain macOS-only.

## Prerequisites

- Work on Windows (the workflow builds Windows sidecars and installer)
- Working tree is clean (`git status` shows nothing to commit)
- Current branch is up to date with origin
- `gh` CLI is authenticated (`gh auth status` - run with `required_permissions: ["all"]`)

## Steps

### 1. Determine the prerelease version

Ask the user if not provided. Follow semver prerelease format, for example:

- `0.12.0-beta.1`
- `0.12.0-rc.1`

Tag format stays `v<prerelease-version>`, for example `v0.12.0-beta.1`.

### 2. Review changes since the last tag

Get the last tag, then run:

```bash
git describe --tags --abbrev=0
git log --oneline <last-tag>..HEAD
git diff --stat <last-tag>..HEAD
```

Summarize key user-facing changes for release notes.

### 3. Bump version in `package.json`

Update the `"version"` field to the new prerelease version.

### 4. Update `RELEASE_NOTES.md`

Follow existing format in the file and make sure the title/version matches the prerelease tag. Keep the copy clear that Windows ships through prereleases while stable releases remain macOS-only.

### 5. Update `README.md` if needed

If any shipped functionality is still listed as upcoming, update it.

### 6. Format and lint

```bash
npm run format
npm run lint
```

### 7. Commit, tag, and push

Stage only release metadata files:

```bash
git add package.json RELEASE_NOTES.md
# Add README.md only if it was updated for this release
git add README.md
git commit -m "release(win): v<prerelease-version>"
git tag v<prerelease-version>
```

Push requires network access - run outside the sandbox (`required_permissions: ["all"]`):

```bash
git push origin HEAD --tags
```

### 8. Build Windows artifacts

```bash
npm run make:win:signed
```

This command expects Azure Trusted Signing auth variables (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`) to be available. The wrapper script loads them from `.env` when needed.

### 9. Verify generated files

At minimum, confirm installer and updater metadata exist:

```bash
ls dist/*.exe
ls dist/latest.yml
ls dist/*.blockmap
```

Confirm `dist/latest.yml` has the prerelease version:

```bash
cat dist/latest.yml
```

### 10. Create the GitHub prerelease

Run outside the sandbox (`required_permissions: ["all"]`):

```bash
gh release create v<prerelease-version> \
  dist/*.exe \
  dist/latest.yml \
  dist/*.blockmap \
  --title "v<prerelease-version> (Windows)" \
  --notes-file RELEASE_NOTES.md \
  --prerelease
```

`--prerelease` is required. `latest.yml` and blockmap files should be uploaded so `electron-updater` can resolve this release correctly.

## Checklist

Before finishing, verify:

- [ ] `package.json` version matches the prerelease tag
- [ ] `RELEASE_NOTES.md` references the same prerelease version
- [ ] `npm run format` and `npm run lint` pass
- [ ] Tag is pushed to origin
- [ ] `dist/*.exe` exists
- [ ] `dist/latest.yml` exists and has the correct version
- [ ] `dist/*.blockmap` exists
- [ ] GitHub release was created with `--prerelease`
