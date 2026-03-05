# Control Plane v0 (Dev)

## Run

```bash
npm run control-plane:start
```

Defaults:

- Host: `0.0.0.0`
- Port: `8787`
- Issuer: `http://localhost:8787`
- Audience: `memorylane-control-plane`

## Environment Variables

- `CONTROL_PLANE_PORT`
- `CONTROL_PLANE_HOST`
- `CONTROL_PLANE_ISSUER`
- `CONTROL_PLANE_AUDIENCE`
- `CONTROL_PLANE_OAUTH_CLIENTS_JSON`

Example `CONTROL_PLANE_OAUTH_CLIENTS_JSON`:

```json
[
  {
    "clientId": "memorylane-claude",
    "redirectUris": ["http://127.0.0.1:3737/callback"]
  }
]
```

## Implemented Endpoints

- `GET /healthz`
- `GET /.well-known/jwks.json`
- `GET /authorize` (auth code + PKCE)
- `POST /token` (`authorization_code`, `refresh_token`)
- `POST /devices/link`
- `GET /devices`
- `POST /tunnel/poll`
- `POST /tunnel/respond`
- `POST /context/query`

## Connect Local MemoryLane (Dev)

### 1. Get an access token (dev auth-code flow)

`/authorize` in v0 expects `user_id` directly.

```bash
VERIFIER='test-verifier-123'
CHALLENGE=$(node -e "const c=require('crypto');const d=c.createHash('sha256').update(process.argv[1]).digest('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');process.stdout.write(d)" "$VERIFIER")

AUTH_HEADERS=$(mktemp)
curl -sS -D "$AUTH_HEADERS" -o /dev/null \
  "http://127.0.0.1:8787/authorize?response_type=code&client_id=memorylane-claude&redirect_uri=http%3A%2F%2F127.0.0.1%3A3737%2Fcallback&code_challenge=${CHALLENGE}&code_challenge_method=S256&user_id=user-1&scope=context.search%20context.timeline%20context.details%20patterns.read%20mcp.connect"

LOCATION=$(awk '/^Location:/ {print $2}' "$AUTH_HEADERS" | tr -d '\r\n')
CODE=$(node -e "const u=new URL(process.argv[1]);process.stdout.write(u.searchParams.get('code')||'')" "$LOCATION")

TOKEN_JSON=$(curl -sS -X POST http://127.0.0.1:8787/token \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data "grant_type=authorization_code&code=${CODE}&client_id=memorylane-claude&redirect_uri=http%3A%2F%2F127.0.0.1%3A3737%2Fcallback&code_verifier=${VERIFIER}")

ACCESS_TOKEN=$(node -e "const j=JSON.parse(process.argv[1]);process.stdout.write(j.access_token||'')" "$TOKEN_JSON")
```

### 2. Link device and get `device_token`

```bash
LINK_JSON=$(curl -sS -X POST http://127.0.0.1:8787/devices/link \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"device_name":"my-memorylane"}')

DEVICE_TOKEN=$(node -e "const j=JSON.parse(process.argv[1]);process.stdout.write(j.device_token||'')" "$LINK_JSON")
```

### 3. Start local tunnel agent

```bash
CONTROL_PLANE_URL=http://127.0.0.1:8787 \
CONTROL_PLANE_DEVICE_TOKEN="$DEVICE_TOKEN" \
npm run control-plane:agent
```

The agent polls `/tunnel/poll`, executes local MemoryLane MCP tools against your local DB, and responds via `/tunnel/respond`.

## Notes

- This is single-node v0: tunnel routing is in memory.
- Device tunnel sessions are not durable across service restart.
- `/authorize` currently requires `user_id` query parameter to represent an already-authenticated user.
