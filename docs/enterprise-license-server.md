# MemoryLane License Server Contract

The app expects exactly 3 endpoints.

## General rules

- All bodies are JSON.
- All JSON responses use `Content-Type: application/json`.
- `device_id` is the stable device identifier from the app.
- Activation state comes only from `/license/status`.
- API key delivery comes only from `/license/key`.

## 1. POST /license/activate

Request body:

```json
{
  "device_id": "string",
  "activation_key": "string"
}
```

Success:

- Status `200`

```json
{
  "ok": true
}
```

Failure:

- Any non-2xx status

```json
{
  "error": "Human-readable error message"
}
```

## 2. GET /license/status

Query:

- `device_id`

Success response:

- Status `200`

```json
{
  "activated": true
}
```

or

```json
{
  "activated": false
}
```

Rules:

- `activated` must exist.
- `activated` must be a boolean.
- No alternative fields are supported.

## 3. GET /license/key

Query:

- `device_id`

Success response:

- Status `200`

```json
{
  "key": "sk-or-..."
}
```

or

```json
{
  "key": null
}
```

Rules:

- `key` must exist.
- `key` must be either a string or `null`.
- No alternative fields are supported.

## App behavior

- `POST /license/activate`:
  - non-2xx = activation failed immediately
- `GET /license/status`:
  - `activated: false` = app becomes inactive and deletes stored managed key
  - `activated: true` = app continues to `/license/key`
- `GET /license/key`:
  - string key = app stores key and becomes usable
  - `null` = app keeps waiting, up to 20 seconds during activation flow
