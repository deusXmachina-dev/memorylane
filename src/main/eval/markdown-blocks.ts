/**
 * Splits a golden.md (or similar) into `## ` blocks. Both golden parsers
 * (activity-summary and task-mining) share this: strip HTML comments, then start
 * a new block at each line matching `headerRe`. Lines before the first header are
 * dropped. Returns each block as its lines, header line first.
 */
export function splitMarkdownBlocks(text: string, headerRe: RegExp): string[][] {
  const stripped = text.replace(/<!--[\s\S]*?-->/g, '')
  const blocks: string[][] = []
  let current: string[] | null = null
  for (const rawLine of stripped.split('\n')) {
    if (headerRe.test(rawLine)) {
      current = [rawLine]
      blocks.push(current)
    } else if (current) {
      current.push(rawLine)
    }
  }
  return blocks
}
