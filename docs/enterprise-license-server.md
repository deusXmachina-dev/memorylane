# MemoryLane License Server Contract

What the enterprise app calls on the license server.

## General rules

- All bodies are JSON, and all JSON responses use `Content-Type: application/json`.
- Every call authenticates with `Authorization: Bearer <token>`:
  - before activation, the token is the tenant token from the invite link;
  - after activation, the token is the `device_id`.
- Errors are any non-2xx status with `{ "error": "Human-readable message" }`.
- An unknown or deactivated `device_id` gets `401`.

## 1. GET /api/license/consent-document

Auth: tenant token.

```json
{ "state": "already_approved" }
```

or

```json
{
  "state": "required",
  "url": "https://…/api/license/consent-document/<sha256>",
  "version": 3,
  "sha256": "…",
  "title": "Monitoring notice",
  "content_type": "application/pdf"
}
```

The app downloads `url` (no auth), checks the `sha256`, and shows the document.

## 2. POST /api/license/activate

Auth: tenant token.

```json
{
  "device_id": "string",
  "email": "string",
  "document_version": 3,
  "outcome": "accepted"
}
```

- `outcome` is `accepted` or `declined`.
- `document_version` is omitted when consent is handled outside the app (the descriptor said `already_approved`).
- The app also sends `tenant_token` in the body. The server ignores it and uses the header.

Response: `200` with `{ "ok": true, "declined": false }`. A `502` means the device was bound but provisioning failed; the app keeps polling `/status`.

## 3. GET /api/license/status

Auth: `device_id`.

- `200` with `{ "activated": true }` (the boolean is required).
- `401` means not activated. The app treats it as inactive and drops its stored managed config.

## 4. GET /api/license/inference-config

Auth: `device_id`.

```json
{ "provider": "openrouter", "apiKey": "sk-or-…" }
```

or

```json
{
  "provider": "vertex",
  "apiKey": "<access token>",
  "project": "…",
  "location": "…",
  "expiresAt": 1767225600
}
```

- `provider: null` or `apiKey: null` means no key yet; the app keeps waiting.
- `expiresAt` is unix seconds. The app refetches before it passes.

## 5. GET /api/license/blacklist?platform=macos|windows

Auth: `device_id`.

```json
{ "excludedApps": ["com.example.app"], "excludedUrlPatterns": ["*.bank.com"] }
```

## Device data endpoints

Auth: `device_id`.

- `GET /api/device/data/state` returns `{ "last_end_ts": <ms> | null }`.
- `POST /api/device/data` is multipart `file`: a gzipped SQLite delta.
- `POST /api/device/report` sends `{ "app_version": "…", "platform": "macos" }`.
- `POST /api/device/logs` is multipart `file`: a zip of log files.
