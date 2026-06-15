#!/usr/bin/env npx tsx
/**
 * Scaffolds a new pattern-detection fixture: a day of distractor activities
 * (noise) plus a 3-sighting "needle" stub, with golden.json + manifest.json
 * pre-wired to the needle ids. Edit the text to taste, then run:
 *   npm run eval-patterns -- --fixtures <name>
 *
 * Usage:
 *   npm run new-pattern-fixture -- --name openrouter-credits
 *   npm run new-pattern-fixture -- --name foo --force   (overwrite existing)
 */

import * as fs from 'fs'
import * as path from 'path'
import type {
  FixtureActivity,
  PatternFixtureManifest,
  PatternGolden,
} from '../src/main/eval/pattern-types'
import { PATTERN_FIXTURE_SCHEMA_VERSION } from '../src/main/eval/pattern-types'

const FIXTURES_ROOT = path.resolve('evals/pattern-detection/fixtures')

function parseArgs(): { name: string; force: boolean } {
  const args = process.argv.slice(2)
  let name = ''
  let force = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) {
      name = args[i + 1]
      i++
    } else if (args[i] === '--force') {
      force = true
    }
  }
  if (!name) {
    console.error('Missing --name <fixture-name>')
    process.exit(1)
  }
  return { name, force }
}

// A spread of plausible, non-repetitive distractor activities across the day.
const DISTRACTORS: Array<Omit<FixtureActivity, 'id'>> = [
  {
    offsetMin: 540,
    durationMin: 12,
    app: 'Slack',
    windowTitle: '#engineering',
    tld: null,
    summary:
      'Read overnight messages in the engineering channel and replied to a thread about the flaky CI run.',
    ocrText: 'engineering  CI failed on main  retrying...',
  },
  {
    offsetMin: 555,
    durationMin: 18,
    app: 'VS Code',
    windowTitle: 'auth.ts — backend',
    tld: null,
    summary: 'Edited the auth middleware to add a token-refresh path and fixed a type error.',
    ocrText: 'function refreshToken(req, res)  TS2345',
  },
  {
    offsetMin: 580,
    durationMin: 8,
    app: 'Google Chrome',
    windowTitle: 'Stack Overflow — JWT expiry',
    tld: 'stackoverflow.com',
    summary: 'Looked up how to handle JWT expiry edge cases on Stack Overflow.',
    ocrText: 'jwt expired  refresh token rotation',
  },
  {
    offsetMin: 600,
    durationMin: 25,
    app: 'VS Code',
    windowTitle: 'auth.test.ts — backend',
    tld: null,
    summary: 'Wrote unit tests for the token-refresh path and ran the suite locally.',
    ocrText: 'describe(refresh)  3 passing',
  },
  {
    offsetMin: 650,
    durationMin: 15,
    app: 'Gmail',
    windowTitle: 'Inbox',
    tld: 'mail.google.com',
    summary: 'Triaged inbox, archived newsletters, replied to a customer question about pricing.',
    ocrText: 'Inbox (14)  Re: pricing question',
  },
  {
    offsetMin: 690,
    durationMin: 30,
    app: 'Figma',
    windowTitle: 'Onboarding flow',
    tld: null,
    summary:
      'Reviewed the new onboarding flow mockups and left comments on the empty-state screens.',
    ocrText: 'Onboarding  Empty state  Comment',
  },
  {
    offsetMin: 740,
    durationMin: 20,
    app: 'Notion',
    windowTitle: 'Sprint planning',
    tld: 'notion.so',
    summary: 'Updated the sprint board, moved two tickets to done and wrote next week’s goals.',
    ocrText: 'Sprint 24  Done  In progress',
  },
  {
    offsetMin: 800,
    durationMin: 10,
    app: 'Google Chrome',
    windowTitle: 'GitHub — pull request #482',
    tld: 'github.com',
    summary: 'Reviewed a teammate’s pull request and approved it after a small comment.',
    ocrText: 'PR #482  Approve  1 comment',
  },
  {
    offsetMin: 820,
    durationMin: 22,
    app: 'VS Code',
    windowTitle: 'recorder.ts — main',
    tld: null,
    summary: 'Refactored the screenshot recorder to debounce rapid capture triggers.',
    ocrText: 'debounce(captureNow, 250)',
  },
  {
    offsetMin: 870,
    durationMin: 14,
    app: 'Spotify',
    windowTitle: 'Focus playlist',
    tld: null,
    summary: 'Switched the focus playlist while continuing to code.',
    ocrText: 'Focus  Deep work',
  },
  {
    offsetMin: 900,
    durationMin: 35,
    app: 'Zoom',
    windowTitle: 'Design sync',
    tld: null,
    summary: 'Joined the design sync call to align on the onboarding redesign timeline.',
    ocrText: 'Design sync  4 participants',
  },
  {
    offsetMin: 960,
    durationMin: 16,
    app: 'Google Chrome',
    windowTitle: 'MDN — IntersectionObserver',
    tld: 'developer.mozilla.org',
    summary: 'Read the MDN docs for IntersectionObserver to lazy-load the timeline view.',
    ocrText: 'IntersectionObserver  threshold  rootMargin',
  },
  {
    offsetMin: 990,
    durationMin: 28,
    app: 'VS Code',
    windowTitle: 'timeline.tsx — renderer',
    tld: null,
    summary: 'Implemented lazy-loading for the timeline list and verified scroll performance.',
    ocrText: 'useIntersectionObserver  rows',
  },
  {
    offsetMin: 1050,
    durationMin: 12,
    app: 'Terminal',
    windowTitle: 'npm test',
    tld: null,
    summary: 'Ran the full test suite before lunch; everything green.',
    ocrText: 'Test Files  42 passed',
  },
  {
    offsetMin: 1110,
    durationMin: 18,
    app: 'Google Chrome',
    windowTitle: 'Hacker News',
    tld: 'news.ycombinator.com',
    summary: 'Skimmed Hacker News over lunch.',
    ocrText: 'Show HN  Ask HN  points',
  },
  {
    offsetMin: 1140,
    durationMin: 24,
    app: 'Linear',
    windowTitle: 'MEM-231',
    tld: 'linear.app',
    summary: 'Wrote up a bug report for the timeline flicker and attached a screen recording.',
    ocrText: 'MEM-231  Bug  Attach',
  },
]

// Three sightings of the SAME repetitive task — the needle. Replace with your
// own repetitive workflow and update golden.json to match.
const NEEDLE: FixtureActivity[] = [
  {
    id: 'needle-0930',
    offsetMin: 570,
    durationMin: 5,
    app: 'Replace Me',
    windowTitle: 'Repetitive task — instance 1',
    tld: null,
    summary: 'Did the repetitive manual task (instance 1): describe the same steps each time.',
    ocrText: 'screen content for instance 1',
  },
  {
    id: 'needle-1300',
    offsetMin: 780,
    durationMin: 6,
    app: 'Replace Me',
    windowTitle: 'Repetitive task — instance 2',
    tld: null,
    summary: 'Did the repetitive manual task (instance 2): the same steps as before.',
    ocrText: 'screen content for instance 2',
  },
  {
    id: 'needle-1645',
    offsetMin: 1005,
    durationMin: 5,
    app: 'Replace Me',
    windowTitle: 'Repetitive task — instance 3',
    tld: null,
    summary: 'Did the repetitive manual task (instance 3): the same steps again.',
    ocrText: 'screen content for instance 3',
  },
]

function main() {
  const { name, force } = parseArgs()
  const dir = path.join(FIXTURES_ROOT, name)
  if (fs.existsSync(dir) && !force) {
    console.error(`Fixture "${name}" already exists at ${dir}. Pass --force to overwrite.`)
    process.exit(1)
  }
  fs.mkdirSync(dir, { recursive: true })

  const distractors: FixtureActivity[] = DISTRACTORS.map((d, i) => ({
    id: `noise-${String(i + 1).padStart(2, '0')}`,
    ...d,
  }))
  const activities = [...distractors, ...NEEDLE].sort((x, y) => x.offsetMin - y.offsetMin)

  fs.writeFileSync(
    path.join(dir, 'activities.jsonl'),
    activities.map((a) => JSON.stringify(a)).join('\n') + '\n',
    'utf8',
  )

  const golden: PatternGolden = {
    patterns: [
      {
        id: `${name}-pattern`,
        name: 'Repetitive task name',
        description: 'What is done manually, step by step, each time.',
        apps: ['Replace Me'],
        automationIdea: 'How this could be automated (a concrete API, script, or tool).',
        needleActivityIds: NEEDLE.map((n) => n.id),
        minSightings: 2,
      },
    ],
    acceptableExtraPatterns: [],
    notes: `${distractors.length} distractor activities around ${NEEDLE.length} needle sightings. Edit the needle + golden to describe a real automatable pattern.`,
  }
  fs.writeFileSync(path.join(dir, 'golden.json'), JSON.stringify(golden, null, 2) + '\n', 'utf8')

  const manifest: PatternFixtureManifest = {
    name,
    label: name,
    description: 'TODO: describe what this fixture exercises.',
    activityCount: activities.length,
    needlePatternCount: golden.patterns.length,
    schemaVersion: PATTERN_FIXTURE_SCHEMA_VERSION,
  }
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  )

  console.log(`Scaffolded fixture at ${path.relative(process.cwd(), dir)}`)
  console.log('Next: edit activities.jsonl (the NEEDLE rows) + golden.json, then:')
  console.log(`  npm run eval-patterns -- --fixtures ${name}`)
}

main()
