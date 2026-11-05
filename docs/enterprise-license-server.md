# MemoryLane License Server Contract

What the enterprise app calls on the license server.

## General rules

- Bodies are JSON except the multipart file uploads.
- Every call authenticates with `Authorization: Bearer <token>`:
  - before activation, the token is the tenant token from the invite link;
  - after activation, the token is the `device_id`.
- On a non-2xx status the app shows the body's `error` string if there is one.

## 1. GET /api/license/consent-document

Auth: tenant token.

```json
{ "state": "already_approved" }
```

or

```json
{
  "state": "required",
  "url": "…",
  "version": 3,
  "sha256": "…",
  "title": "Monitoring notice",
  "content_type": "application/pdf"
}
```

The app downloads `url` with the same tenant-token header, refuses a URL on another origin, checks the `sha256`, and shows the document. Only `application/pdf` is accepted.

## 2. POST /api/license/activate

Auth: tenant token.

```json
{
  "tenant_token": "string",
  "device_id": "string",
  "email": "string",
  "document_version": 3,
  "outcome": "accepted"
}
```

- `outcome` is `accepted` or `declined`.
- `document_version` is omitted when the descriptor said `already_approved`.

Response: `200` with `{ "ok": true, "declined": false }`. On `502` the app treats provisioning as pending and keeps polling `/status`.

## 3. GET /api/license/status

Auth: `device_id`.

- `200` with `{ "activated": true }` (the boolean is required).
- `401` means not activated. The app becomes inactive.

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
- `expiresAt` (Vertex only) is unix seconds. The app refetches shortly before it.

## 5. GET /api/license/blacklist?platform=macos|windows

Auth: `device_id`.

```json
{ "excludedApps": ["com.example.app"], "excludedUrlPatterns": ["*.bank.com"] }
```

## Device data endpoints

Auth: `device_id`.

- `GET /api/device/data/state` returns `{ "last_end_ts": <number> | null }`.
- `POST /api/device/data` is multipart `file`: a gzipped SQLite delta.
- `POST /api/device/report` sends `{ "app_version": "…", "platform": "macos" }`.
- `POST /api/device/logs` is multipart `file`: a zip of log files.
