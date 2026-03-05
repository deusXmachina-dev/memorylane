#!/usr/bin/env npx tsx
import { createControlPlaneServer } from '../src/main/control-plane/server'

const port = Number.parseInt(process.env.CONTROL_PLANE_PORT ?? '8787', 10)
const host = process.env.CONTROL_PLANE_HOST ?? '0.0.0.0'
const issuer = process.env.CONTROL_PLANE_ISSUER ?? `http://localhost:${port}`
const audience = process.env.CONTROL_PLANE_AUDIENCE ?? 'memorylane-control-plane'

const server = createControlPlaneServer({
  options: {
    issuer,
    audience,
  },
})

server.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`[control-plane] listening on ${host}:${port}`)
  // eslint-disable-next-line no-console
  console.log(`[control-plane] issuer=${issuer}`)
  // eslint-disable-next-line no-console
  console.log(
    '[control-plane] endpoints: /authorize /token /devices/link /tunnel/poll /context/query',
  )
})
