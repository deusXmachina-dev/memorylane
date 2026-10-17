export function normalizeTitle(title: string): string {
  return title
    .replace(/[\p{So}\p{Sk}️‍]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleWords(title: string | undefined): Set<string> {
  if (!title) return new Set()
  return new Set(
    normalizeTitle(title)
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word !== '' && !/^\p{N}+$/u.test(word)),
  )
}

export function titlesShareWords(left: string | undefined, right: string | undefined): boolean {
  const leftWords = titleWords(left)
  const rightWords = titleWords(right)
  if (leftWords.size === 0 || rightWords.size === 0) return true
  for (const word of leftWords) {
    if (rightWords.has(word)) return true
  }
  return false
}
