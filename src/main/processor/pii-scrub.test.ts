import { describe, expect, it } from 'vitest'
import { PiiScrubber, type NerToken } from './pii-scrub'

const tok = (entity: string, index: number, word: string, score = 0.9): NerToken => ({
  entity,
  score,
  index,
  word,
  start: null,
  end: null,
})

const fakePipe =
  (tokensBySlice: (slice: string) => NerToken[]) =>
  async (slice: string): Promise<NerToken[]> =>
    tokensBySlice(slice)

describe('PiiScrubber', () => {
  it('reconstructs spans from null-offset tokens and replaces them', async () => {
    const scrubber = new PiiScrubber(
      fakePipe(() => [
        tok('B-GIVENNAME', 1, 'pav'),
        tok('I-GIVENNAME', 2, '##lina'),
        tok('B-SURNAME', 3, 'koutecka'),
      ]),
    )
    const [out] = await scrubber.scrubBatch(['Reviewed chat with Pavlina Koutecka today'])
    expect(out).toBe('Reviewed chat with [redacted name] [redacted name] today')
  })

  it('shifts spans found in later windows back to global offsets', async () => {
    const filler = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod. '
    const text = filler.repeat(30) + 'Contact Jonathan for access.'
    const scrubber = new PiiScrubber(
      fakePipe((slice) => (slice.includes('Jonathan') ? [tok('B-GIVENNAME', 1, 'jonathan')] : [])),
    )
    const [out] = await scrubber.scrubBatch([text])
    expect(out).toBe(filler.repeat(30) + 'Contact [redacted name] for access.')
  })

  it('merges overlapping spans into one placeholder', async () => {
    const scrubber = new PiiScrubber(
      fakePipe(() => [
        { ...tok('B-NAME', 1, 'anna'), start: 5, end: 9 },
        { ...tok('B-USERNAME', 5, 'anna-marie', 0.95), start: 5, end: 15 },
      ]),
    )
    const [out] = await scrubber.scrubBatch(['ping anna-marie now'])
    expect(out).toBe('ping [redacted username] now')
  })

  it('drops skip-listed entity types', async () => {
    const scrubber = new PiiScrubber(fakePipe(() => [tok('B-URL', 1, 'example.com')]))
    const [out] = await scrubber.scrubBatch(['visit example.com today'])
    expect(out).toBe('visit example.com today')
  })

  it('skips spans matching the allowlist', async () => {
    const scrubber = new PiiScrubber(fakePipe(() => [tok('B-NAME', 1, 'claude')]))
    const [out] = await scrubber.scrubBatch(['opened Claude to review'], ['Claude Code'])
    expect(out).toBe('opened Claude to review')
  })

  it('ignores tokens below the score threshold', async () => {
    const scrubber = new PiiScrubber(fakePipe(() => [tok('B-NAME', 1, 'claude', 0.2)]))
    const [out] = await scrubber.scrubBatch(['opened Claude to review'])
    expect(out).toBe('opened Claude to review')
  })

  it('maps labels to typed placeholders and falls back for unknown labels', async () => {
    const scrubber = new PiiScrubber(
      fakePipe((slice) =>
        slice.includes('jane@')
          ? [tok('B-EMAIL', 1, 'jane@acme.co')]
          : [tok('B-MYSTERY', 1, 'blob')],
      ),
    )
    const [email, unknown] = await scrubber.scrubBatch(['mail jane@acme.co', 'the blob thing'])
    expect(email).toBe('mail [email address]')
    expect(unknown).toBe('the [redacted] thing')
  })

  it('applies the regex backstop after NER', async () => {
    const scrubber = new PiiScrubber(fakePipe(() => []))
    const [out] = await scrubber.scrubBatch(['mail jane.doe@acme.co about order 100294'])
    expect(out).toBe('mail [email address] about order [id number]')
  })

  it('passes through empty and blank texts without model calls', async () => {
    let calls = 0
    const scrubber = new PiiScrubber(async () => {
      calls++
      return []
    })
    const out = await scrubber.scrubBatch(['', '   '])
    expect(out).toEqual(['', '   '])
    expect(calls).toBe(0)
  })
})
