export function describeSemanticError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

export function safeJsonStringify(value: unknown): string {
  try {
    return `${JSON.stringify(value, null, 2)}\n`
  } catch (error) {
    return `${JSON.stringify({ error: describeSemanticError(error) }, null, 2)}\n`
  }
}
