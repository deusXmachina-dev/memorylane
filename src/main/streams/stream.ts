export type Offset = number

export interface StreamRecord<T> {
  offset: Offset
  timestamp: number
  payload: T
}

export type SubscriptionStartAt = { type: 'now' } | { type: 'offset'; offset: Offset }

export interface StreamSubscription {
  unsubscribe(): void
}

/**
 * Append-only stream contract with stable offsets.
 *
 * Offset rules:
 * - Offsets are monotonic and never renumbered.
 * - trimBefore() may delete old records, but get(trimmedOffset) must return null.
 * - append() always returns the global offset assigned at insertion time.
 *
 * Ack rules:
 * - ack() is monotonic per consumer and represents "last fully processed offset".
 * - getAck() returns null when the consumer has no committed progress.
 */
export interface DurableStream<T> {
  append(payload: T): Promise<Offset>
  get(offset: Offset): Promise<StreamRecord<T> | null>

  ack(consumerId: string, offset: Offset): Promise<void>
  getAck(consumerId: string): Promise<Offset | null>

  subscribe(options: {
    startAt: SubscriptionStartAt
    onRecord: (record: StreamRecord<T>) => void
  }): StreamSubscription

  /**
   * Remove records with offsets strictly lower than the given offset.
   * Returns the number of removed records.
   */
  trimBefore(offset: Offset): Promise<number>

  /** Lowest offset that may still be retrieved with get(). */
  getLowestAvailableOffset(): Promise<Offset>

  /** Next offset that append() will assign. */
  getNextOffset(): Promise<Offset>
}
