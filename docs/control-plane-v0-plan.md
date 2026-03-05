# MemoryLane Control Plane v0 Plan

## Goal

Ship a first working control plane that lets users connect a local MemoryLane instance and grant third-party apps scoped access to MemoryLane context.

## v0 Scope

- OAuth-based user auth and consent.
- Device linking for local MemoryLane instances.
- Outbound tunnel from MemoryLane desktop to control plane.
- Context relay API that forwards allowed requests to the linked local instance.
- Basic policy and scope enforcement.
- Initial third-party integration path: OAuth MCP for Claude connection.

## Out of Scope (v0)

- Multi-device merge/sync of local history.
- Rich admin UI and advanced analytics.
- Fine-grained enterprise RBAC.
- Cross-region failover.

## Architecture

### Components

1. **Auth + Control Plane Service (single VM process)**
   - OAuth Authorization Server endpoints (`/authorize`, `/token`, `/jwks`).
   - Control API (`/devices`, `/connections`, `/integrations`, `/policies`).
   - Relay API (`/context/query`) that validates token/scopes and forwards requests.
2. **Tunnel Gateway (same process in v0)**
   - Accepts persistent outbound connections from desktop clients.
   - Maps `user + device` to active tunnel session.
3. **Desktop Agent (MemoryLane app)**
   - Authenticates user and links device.
   - Maintains outbound tunnel.
   - Executes local context queries by reusing existing MCP tool logic.
4. **Data Stores**
   - Postgres: users, devices, grants, integrations, policies, audit logs.
   - In-memory session map inside the control-plane process for active tunnel routing.
   - Secret storage for signing keys and client credentials (env/secret manager).

## Security Model (v0)

- OAuth 2.1 style with PKCE for public clients.
- Short-lived access tokens + refresh tokens.
- Signed JWT access tokens, JWKS exposed.
- Scopes:
  - `context.search`
  - `context.timeline`
  - `context.details`
  - `patterns.read`
  - `mcp.connect`
- Policy gates (server-side):
  - OCR allowed/denied.
  - Max lookback window.
  - App/domain denylist.
- Audit log for every relayed context request.

## End-to-End Flows

### 1. Device Link

1. User signs in to MemoryLane desktop.
2. Desktop registers device and keypair with control plane.
3. Desktop opens outbound tunnel and heartbeats.
4. Control plane marks device `online`.

### 2. Third-Party Connection

1. User clicks connect Claude via OAuth MCP in control plane UI.
2. OAuth consent is completed for requested scopes.
3. Control plane stores grant and integration metadata.

### 3. Context Request Relay

1. Third-party app calls `/context/query` with bearer token.
2. Control plane validates signature, token, scopes, policy.
3. Control plane routes request over active tunnel to target device.
4. Desktop executes local query and returns response.
5. Control plane returns response and writes audit event.

## Deployment (Simple v0)

- Run a single control-plane process on one VM.
- Keep tunnel routing state in memory (no Redis).
- Use Postgres for durable state only (users/devices/grants/policies/audit logs).
- Terminate TLS at load balancer or reverse proxy; enforce HTTPS-only.
- Keep signing keys in a secure secret store and rotate manually on a scheduled cadence.
- Accept that restarts drop active tunnel sessions; desktop clients must auto-reconnect.

## Implementation Plan

### Phase 0: Contracts and Schema

- Define OAuth/token claims, scope model, and error contract.
- Define relay request/response protocol between control plane and desktop agent.
- Create DB schema for users/devices/grants/policies/audit logs.

### Phase 1: Auth + Device Link

- Implement `/authorize`, `/token`, `/jwks`.
- Implement desktop login + device registration.
- Persist and validate linked device identity.

### Phase 2: Tunnel + Relay MVP

- Implement tunnel session manager with in-memory routing.
- Implement `/context/query` with scope/policy checks.
- Wire desktop handler to existing local query paths.

### Phase 3: First Integrations

- OAuth MCP connect flow for Claude clients.
- Claude integration against control-plane relay endpoints.
- Basic integration settings in MemoryLane UI.

### Phase 4: Hardening

- Add revocation, token rotation, and timeout handling.
- Add structured audit views and error monitoring.
- Add end-to-end tests for auth, relay, and policy denial paths.

## Deliverables for v0 Review Gate

- Running VM-hosted control-plane service with OAuth + relay endpoints.
- Desktop build that can link/unlink device and maintain tunnel.
- At least one third-party integration exercising scoped context access.
- Documentation for token scopes, policies, and operational runbook.

## Risks and Mitigations

- **Tunnel instability on laptop sleep/network changes**
  - Auto-reconnect with exponential backoff and session rebind.
- **Over-broad access**
  - Default-minimum scopes and deny-sensitive scopes (`context.details`) unless explicitly granted.
- **Single-instance failure/restart drops active sessions**
  - Require desktop auto-reconnect and expose clear online/offline device status.
- **Latency**
  - Keep relay payloads small and support time-window-limited queries.

## Open Questions

1. Should v0 support one active device per user or multiple concurrent devices?
   Just one
2. Should `context.details` require a second explicit consent step?
   Probly not
3. Should non-MCP integrations be deferred entirely until v1?
   yes
