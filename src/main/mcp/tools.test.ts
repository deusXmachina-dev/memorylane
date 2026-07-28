import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
// eslint-disable-next-line import/no-unresolved
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerTools, type EditionContext, type MCPServices } from './tools'
import { StorageService, type Cluster, type Sighting } from '../storage'
import { applyMigrations } from '../storage/migrator'
import { createStoredActivity, deleteDbFiles } from '../storage/test-utils'
import type { EmbeddingService } from '../processor/embedding'
import { CLUSTER_VIEW_CONFIG } from '@/shared/constants'

type Handler = (args: unknown) => Promise<{
  content: { type: string; text: string }[]
  isError?: boolean
}>

function registerWithMockServer(
  ctx: EditionContext,
  getServices: () => MCPServices | null = () => null,
): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  const mockServer = {
    registerTool: (name: string, _meta: unknown, handler: Handler): void => {
      handlers.set(name, handler)
    },
  } as unknown as McpServer

  registerTools(
    mockServer,
    getServices,
    async () => {},
    () => ctx,
  )
  return handlers
}

describe('get_db_path tool', () => {
  it('reports the enterprise default path when edition is enterprise', async () => {
    const ctx: EditionContext = {
      edition: 'enterprise',
      source: 'default',
      currentDbPath: '/example/MemoryLane Enterprise/memorylane.db',
    }
    const handlers = registerWithMockServer(ctx)
    const handler = handlers.get('get_db_path')
    expect(handler).toBeDefined()

    const result = await handler!({})
    const payload = JSON.parse(result.content[0].text)

    expect(payload.edition).toBe('enterprise')
    expect(payload.source).toBe('default')
    expect(payload.path).toBe(ctx.currentDbPath)
    expect(payload.defaultForEdition).toMatch(
      /MemoryLane Enterprise(-dev)?[\\/]memorylane(-dev)?\.db$/,
    )
  })

  it('reports the customer default when edition is customer, and echoes the source', async () => {
    const ctx: EditionContext = {
      edition: 'customer',
      source: 'flag',
      currentDbPath: '/tmp/custom.db',
    }
    const handlers = registerWithMockServer(ctx)
    const handler = handlers.get('get_db_path')!

    const result = await handler({})
    const payload = JSON.parse(result.content[0].text)

    expect(payload.edition).toBe('customer')
    expect(payload.source).toBe('flag')
    expect(payload.path).toBe('/tmp/custom.db')
    expect(payload.defaultForEdition).not.toMatch(/Enterprise/)
    expect(payload.defaultForEdition).toMatch(/MemoryLane(-dev)?[\\/]memorylane(?:-dev)?\.db$/)
  })
})

describe('pattern tools (task clusters)', () => {
  const TEST_DB_PATH = path.join(os.tmpdir(), 'temp_mcp_tools_test.db')
  const ctx: EditionContext = {
    edition: 'customer',
    source: 'default',
    currentDbPath: TEST_DB_PATH,
  }
  let storage: StorageService
  let handlers: Map<string, Handler>

  const HOUR_MS = 60 * 60 * 1000
  const DAY_MS = 24 * HOUR_MS
  const now = Date.now()

  const createSighting = (overrides: Partial<Sighting> & { id: string }): Sighting => ({
    id: overrides.id,
    title: overrides.title ?? 'Test sighting',
    subject: overrides.subject ?? '',
    description: overrides.description ?? 'Did the thing',
    steps: overrides.steps ?? [],
    apps: overrides.apps ?? ['TestApp'],
    activityIds: overrides.activityIds ?? ['act-1'],
    startedAt: overrides.startedAt ?? now - 2 * HOUR_MS,
    endedAt: overrides.endedAt ?? now - HOUR_MS,
    interactionMin: overrides.interactionMin ?? 5,
    runId: overrides.runId ?? 'run-1',
    detectedAt: overrides.detectedAt ?? now - HOUR_MS,
  })

  const createCluster = (overrides: Partial<Cluster> & { id: string }): Cluster => ({
    id: overrides.id,
    label: overrides.label ?? '',
    description: overrides.description ?? '',
    centroid: overrides.centroid ?? null,
    mechanism: overrides.mechanism ?? '',
    steps: overrides.steps ?? [],
    variables: overrides.variables ?? [],
    labeledSize: overrides.labeledSize ?? 0,
    createdAt: overrides.createdAt ?? now,
  })

  const addClusterWithMembers = (cluster: Cluster, sightings: Sighting[]): void => {
    storage.clusters.create(cluster)
    for (const s of sightings) {
      storage.sightings.add(s)
      storage.clusters.addMembership(cluster.id, s.id)
    }
  }

  beforeEach(() => {
    deleteDbFiles(TEST_DB_PATH)
    storage = new StorageService(TEST_DB_PATH)
    applyMigrations(storage.getDatabase())
    const services: MCPServices = { storage, embeddingService: {} as EmbeddingService }
    handlers = registerWithMockServer(ctx, () => services)
  })

  afterEach(() => {
    storage.close()
    deleteDbFiles(TEST_DB_PATH)
  })

  describe('list_patterns', () => {
    it('returns the mining empty state when no clusters exist', async () => {
      const result = await handlers.get('list_patterns')!({})
      expect(result.isError).toBeUndefined()
      expect(result.content[0].text).toContain('No recurring task patterns found yet')
    })

    it('reports hidden one-offs in the empty state when all clusters are noise', async () => {
      addClusterWithMembers(createCluster({ id: 'c-noise' }), [
        createSighting({ id: 's1', interactionMin: 5 }),
      ])

      const text = (await handlers.get('list_patterns')!({})).content[0].text
      expect(text).toContain('mining is working')
      expect(text).toContain('1 task has been seen only once')
      expect(text).not.toContain('No recurring task patterns found yet')
    })

    it('reports runs per week once activity days are observed', async () => {
      storage.activities.add(createStoredActivity({ id: 'act-d1', startTimestamp: now - DAY_MS }))
      storage.activities.add(
        createStoredActivity({ id: 'act-d2', startTimestamp: now - 2 * DAY_MS }),
      )
      addClusterWithMembers(createCluster({ id: 'c1', label: 'Real task' }), [
        createSighting({ id: 's1' }),
        createSighting({ id: 's2' }),
      ])

      const text = (await handlers.get('list_patterns')!({})).content[0].text
      expect(text).toContain('~7.0/wk over 2 observed days')
    })

    it('lists a labeled cluster with stats and apps', async () => {
      addClusterWithMembers(
        createCluster({ id: 'c1', label: 'Invoice processing', description: 'Copies totals' }),
        [
          createSighting({ id: 's1', apps: ['Excel'], interactionMin: 4 }),
          createSighting({ id: 's2', apps: ['Excel', 'Chrome'], interactionMin: 8 }),
        ],
      )

      const text = (await handlers.get('list_patterns')!({})).content[0].text
      expect(text).toContain('1 recurring task pattern')
      expect(text).toContain('c1 | Invoice processing')
      expect(text).toContain('Excel, Chrome')
      expect(text).toContain('seen 2x')
      expect(text).toContain('avg 6 min active/run')
      expect(text).toContain('Copies totals')
    })

    it('falls back to the most common member title for unlabeled clusters', async () => {
      addClusterWithMembers(createCluster({ id: 'c1', label: '' }), [
        createSighting({ id: 's1', title: 'Weekly report', interactionMin: 15 }),
        createSighting({ id: 's2', title: 'Weekly report', interactionMin: 15 }),
        createSighting({ id: 's3', title: 'Other thing', interactionMin: 15 }),
      ])

      const text = (await handlers.get('list_patterns')!({})).content[0].text
      expect(text).toContain('c1 | Weekly report')
    })

    it('hides one-off noise clusters and reports the hidden count', async () => {
      addClusterWithMembers(createCluster({ id: 'c-noise' }), [
        createSighting({ id: 's1', interactionMin: 5 }),
      ])
      addClusterWithMembers(createCluster({ id: 'c-real', label: 'Real task' }), [
        createSighting({ id: 's2' }),
        createSighting({ id: 's3' }),
      ])

      const text = (await handlers.get('list_patterns')!({})).content[0].text
      expect(text).toContain('1 recurring task pattern (1 hidden as one-off noise)')
      expect(text).toContain('c-real')
      expect(text).not.toContain('c-noise')
    })

    it('renders the Replace with recommendation', async () => {
      addClusterWithMembers(
        createCluster({ id: 'c1', mechanism: 'A script that fills the form' }),
        [createSighting({ id: 's1' }), createSighting({ id: 's2' })],
      )

      const text = (await handlers.get('list_patterns')!({})).content[0].text
      expect(text).toContain('Replace with: A script that fills the form')
    })
  })

  describe('search_patterns', () => {
    beforeEach(() => {
      addClusterWithMembers(
        createCluster({
          id: 'c1',
          label: 'Invoice processing',
          description: 'Copies totals into the ledger',
          mechanism: 'Automate with a spreadsheet macro',
        }),
        [
          createSighting({ id: 's1', apps: ['Excel'] }),
          createSighting({ id: 's2', apps: ['Excel'] }),
        ],
      )
    })

    it.each([
      ['title', 'INVOICE'],
      ['description', 'ledger'],
      ['app', 'excel'],
      ['mechanism', 'macro'],
    ])('matches by %s case-insensitively', async (_field, query) => {
      const text = (await handlers.get('search_patterns')!({ query })).content[0].text
      expect(text).toContain(`1 pattern matching "${query}"`)
      expect(text).toContain('c1')
    })

    it('reports when nothing matches', async () => {
      const text = (await handlers.get('search_patterns')!({ query: 'zzz' })).content[0].text
      expect(text).toBe('No patterns matching "zzz".')
    })
  })

  describe('get_pattern_details', () => {
    it('reports an unknown pattern ID', async () => {
      const text = (await handlers.get('get_pattern_details')!({ patternId: 'nope' })).content[0]
        .text
      expect(text).toBe('No pattern found with ID "nope".')
    })

    it('returns the header plus runs newest-first with activity IDs', async () => {
      addClusterWithMembers(createCluster({ id: 'c1', label: 'Daily standup notes' }), [
        createSighting({
          id: 's-old',
          startedAt: now - 5 * HOUR_MS,
          endedAt: now - 4 * HOUR_MS,
          activityIds: ['act-old'],
        }),
        createSighting({
          id: 's-new',
          startedAt: now - 2 * HOUR_MS,
          endedAt: now - HOUR_MS,
          subject: 'sprint 12',
          activityIds: ['act-a', 'act-b'],
        }),
      ])

      const text = (await handlers.get('get_pattern_details')!({ patternId: 'c1' })).content[0].text
      expect(text).toContain('c1 | Daily standup notes')
      expect(text).toContain(
        `Runs (2 in the last ${CLUSTER_VIEW_CONFIG.STATS_WINDOW_DAYS} days, newest first):`,
      )
      expect(text.indexOf('s-new')).toBeLessThan(text.indexOf('s-old'))
      expect(text).toContain('Test sighting — sprint 12')
      expect(text).toContain('Activity IDs: act-a, act-b')
    })

    it('never prints raw member step text (steps are not scrubbed for egress)', async () => {
      addClusterWithMembers(createCluster({ id: 'c1', label: 'Daily standup notes' }), [
        createSighting({
          id: 's1',
          startedAt: now - 5 * HOUR_MS,
          steps: ['mail.acme.com: email John Smith the report'],
        }),
        createSighting({ id: 's2', steps: ['mail.acme.com: email John Smith the report'] }),
      ])

      const list = (await handlers.get('list_patterns')!({})).content[0].text
      const details = (await handlers.get('get_pattern_details')!({ patternId: 'c1' })).content[0]
        .text
      expect(list).not.toContain('John Smith')
      expect(details).not.toContain('John Smith')
    })

    it('truncates runs to the limit, newest first', async () => {
      addClusterWithMembers(createCluster({ id: 'c1' }), [
        createSighting({ id: 's-old', startedAt: now - 5 * HOUR_MS, endedAt: now - 4 * HOUR_MS }),
        createSighting({ id: 's-new', startedAt: now - 2 * HOUR_MS, endedAt: now - HOUR_MS }),
      ])

      const text = (await handlers.get('get_pattern_details')!({ patternId: 'c1', limit: 1 }))
        .content[0].text
      expect(text).toContain(
        `Runs (showing 1 of 2 in the last ${CLUSTER_VIEW_CONFIG.STATS_WINDOW_DAYS} days, newest first):`,
      )
      expect(text).toContain('s-new')
      expect(text).not.toContain('s-old')
    })

    it('excludes runs older than the stats window so the run count matches the header', async () => {
      const staleStart = now - (CLUSTER_VIEW_CONFIG.STATS_WINDOW_DAYS + 5) * DAY_MS
      addClusterWithMembers(createCluster({ id: 'c1' }), [
        createSighting({
          id: 's-stale',
          startedAt: staleStart,
          endedAt: staleStart + HOUR_MS,
          detectedAt: staleStart + HOUR_MS,
        }),
        createSighting({ id: 's-recent' }),
      ])

      const text = (await handlers.get('get_pattern_details')!({ patternId: 'c1' })).content[0].text
      expect(text).toContain('seen 1x')
      expect(text).toContain(
        `Runs (1 in the last ${CLUSTER_VIEW_CONFIG.STATS_WINDOW_DAYS} days, newest first):`,
      )
      expect(text).not.toContain('s-stale')
    })

    it('distinguishes a stale cluster from one with no runs at all', async () => {
      const staleStart = now - (CLUSTER_VIEW_CONFIG.STATS_WINDOW_DAYS + 5) * DAY_MS
      addClusterWithMembers(createCluster({ id: 'c-stale' }), [
        createSighting({
          id: 's-stale',
          startedAt: staleStart,
          endedAt: staleStart + HOUR_MS,
          detectedAt: staleStart + HOUR_MS,
        }),
      ])

      const text = (await handlers.get('get_pattern_details')!({ patternId: 'c-stale' })).content[0]
        .text
      expect(text).toContain(`No runs in the last ${CLUSTER_VIEW_CONFIG.STATS_WINDOW_DAYS} days.`)
    })
  })

  describe('missing task-mining tables', () => {
    it('returns a friendly error from all three tools when the DB was never migrated', async () => {
      const freshPath = path.join(os.tmpdir(), 'temp_mcp_tools_unmigrated_test.db')
      deleteDbFiles(freshPath)
      const bare = new StorageService(freshPath)
      const services: MCPServices = { storage: bare, embeddingService: {} as EmbeddingService }
      const bareHandlers = registerWithMockServer(ctx, () => services)

      try {
        for (const [name, args] of [
          ['list_patterns', {}],
          ['search_patterns', { query: 'x' }],
          ['get_pattern_details', { patternId: 'c1' }],
        ] as const) {
          const result = await bareHandlers.get(name)!(args)
          expect(result.isError).toBe(true)
          expect(result.content[0].text).toContain('Task-mining tables not found')
        }
      } finally {
        bare.close()
        deleteDbFiles(freshPath)
      }
    })
  })
})
