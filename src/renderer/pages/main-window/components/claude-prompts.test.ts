import { describe, expect, it, vi } from 'vitest'
import type { ClusterInfo, ClusterSightingInfo } from '@types'
import {
  buildClusterAgentPrompt,
  buildClusterAnalyzePrompt,
  scrubClusterForShare,
} from './claude-prompts'

const cluster: ClusterInfo = {
  id: 'c1',
  title: 'Email Jane Novak the report',
  description: 'Weekly report for jane.doe@acme.co',
  apps: ['mail.google.com'],
  timesSeen: 3,
  timesPerWeek: 1.5,
  observedDays: 14,
  avgActiveMin: 12,
  mechanism: '',
  steps: ['mail.google.com: mail Jane Novak'],
  variables: ['recipient'],
  lastSeenAt: 0,
  recurrence: [],
}

const sightings: ClusterSightingInfo[] = [
  {
    id: 's1',
    title: 'Email Jane Novak the report',
    subject: 'Q3 report',
    apps: ['mail.google.com'],
    startedAt: 1753600000000,
    activeMin: 10,
    activityIds: ['550e8400-e29b-41d4-a716-446655440000', '3f2a9c81-77de-4b02-9e41-c05a12ef88a3'],
  },
]

const fakeScrub = vi.fn(async (texts: string[]) =>
  texts.map((t) => t.replace(/Jane Novak/g, '[redacted name]')),
)

describe('scrubClusterForShare', () => {
  it('routes every interpolated field through the scrubber with the app allowlist', async () => {
    const clean = await scrubClusterForShare(cluster, sightings, fakeScrub)

    expect(fakeScrub).toHaveBeenCalledWith(expect.arrayContaining([cluster.title]), [
      'mail.google.com',
    ])
    expect(clean.cluster.title).toBe('Email [redacted name] the report')
    expect(clean.cluster.steps).toEqual(['mail.google.com: mail [redacted name]'])
    expect(clean.sightings[0].title).toBe('Email [redacted name] the report')
    expect(clean.sightings[0].subject).toBe('Q3 report')
    expect(clean.sightings[0].activityIds).toEqual(sightings[0].activityIds)
  })
})

describe('buildClusterAnalyzePrompt', () => {
  it('keeps activity-id UUIDs intact in the assembled prompt', async () => {
    const clean = await scrubClusterForShare(cluster, sightings, fakeScrub)
    const prompt = buildClusterAnalyzePrompt(clean.cluster, clean.sightings)

    expect(prompt).toContain('550e8400-e29b-41d4-a716-446655440000')
    expect(prompt).toContain('3f2a9c81-77de-4b02-9e41-c05a12ef88a3')
    expect(prompt).not.toContain('Jane Novak')
  })
})

describe('buildClusterAgentPrompt', () => {
  it('keeps the regex backstop over the final string', () => {
    const prompt = buildClusterAgentPrompt(cluster)
    expect(prompt).not.toContain('jane.doe@acme.co')
    expect(prompt).toContain('[email address]')
  })
})
