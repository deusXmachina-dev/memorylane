import * as fs from 'fs'
import * as path from 'path'
import type { RecordingScript } from '@/shared/eval-review'

function scriptsPath(fixturesRoot: string): string {
  return path.join(fixturesRoot, 'scenarios.json')
}

export function listRecordingScripts(fixturesRoot: string): RecordingScript[] {
  const file = scriptsPath(fixturesRoot)
  if (!fs.existsSync(file)) return []
  return parseRecordingScripts(fs.readFileSync(file, 'utf-8'))
}

export function getRecordingScript(fixturesRoot: string, id: string): RecordingScript | null {
  return listRecordingScripts(fixturesRoot).find((s) => s.id === id) ?? null
}

/** Merges a scenarios file into the library; same-id scenarios are replaced. */
export function importRecordingScripts(fixturesRoot: string, sourceFile: string): number {
  const incoming = parseRecordingScripts(fs.readFileSync(sourceFile, 'utf-8'), { lint: true })
  const byId = new Map(listRecordingScripts(fixturesRoot).map((s) => [s.id, s]))
  for (const script of incoming) byId.set(script.id, script)
  fs.mkdirSync(fixturesRoot, { recursive: true })
  fs.writeFileSync(scriptsPath(fixturesRoot), JSON.stringify([...byId.values()], null, 2))
  return incoming.length
}

function contextKey(apps: string[]): string {
  return apps
    .map((a) => a.toLowerCase())
    .sort()
    .join('|')
}

export function parseRecordingScripts(
  json: string,
  { lint = false }: { lint?: boolean } = {},
): RecordingScript[] {
  const data: unknown = JSON.parse(json)
  if (!Array.isArray(data)) throw new Error('Scenarios file must be a JSON array')
  const ids = new Set<string>()
  return data.map((raw, i) => {
    const script = raw as RecordingScript
    const label = typeof script?.id === 'string' ? script.id : `#${i + 1}`
    const valid =
      typeof script?.id === 'string' &&
      typeof script.title === 'string' &&
      Array.isArray(script.targets) &&
      Array.isArray(script.setup) &&
      Array.isArray(script.steps) &&
      script.steps.length > 0 &&
      script.steps.every(
        (step) =>
          typeof step?.instruction === 'string' &&
          typeof step.seconds === 'number' &&
          Array.isArray(step.expect?.app),
      )
    if (!valid) throw new Error(`Invalid scenario ${label}`)
    for (let i = 1; lint && i < script.steps.length; i++) {
      const prev = script.steps[i - 1].expect
      const cur = script.steps[i].expect
      if (prev.tld === cur.tld && contextKey(prev.app) === contextKey(cur.app)) {
        throw new Error(
          `Scenario ${script.id}: steps ${i} and ${i + 1} are both ${cur.tld ?? cur.app.join('/')} — merge them into one step`,
        )
      }
    }
    if (ids.has(script.id)) throw new Error(`Duplicate scenario id ${script.id}`)
    ids.add(script.id)
    return script
  })
}
