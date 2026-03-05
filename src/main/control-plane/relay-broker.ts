import { randomUUID } from 'node:crypto'

export interface RelayRequestPayload {
  toolName: string
  toolInput: unknown
}

export interface RelayRequest {
  requestId: string
  createdAt: number
  payload: RelayRequestPayload
}

export interface RelayResponse {
  result?: unknown
  error?: string
}

interface InflightRequest {
  resolve: (value: RelayResponse) => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

export class RelayBroker {
  private readonly pendingByDevice = new Map<string, RelayRequest[]>()
  private readonly pollWaitersByDevice = new Map<
    string,
    Array<(value: RelayRequest | null) => void>
  >()
  private readonly inflightByRequestId = new Map<string, InflightRequest>()

  public async enqueue(
    deviceId: string,
    payload: RelayRequestPayload,
    timeoutMs: number,
  ): Promise<RelayResponse> {
    const request: RelayRequest = {
      requestId: randomUUID(),
      createdAt: Date.now(),
      payload,
    }

    const delivered = this.deliverToWaitingPoller(deviceId, request)
    if (!delivered) {
      const queue = this.pendingByDevice.get(deviceId) ?? []
      queue.push(request)
      this.pendingByDevice.set(deviceId, queue)
    }

    return new Promise<RelayResponse>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.inflightByRequestId.delete(request.requestId)
        reject(new Error('Timed out waiting for device response'))
      }, timeoutMs)

      this.inflightByRequestId.set(request.requestId, { resolve, reject, timeoutId })
    })
  }

  public async poll(deviceId: string, timeoutMs: number): Promise<RelayRequest | null> {
    const queue = this.pendingByDevice.get(deviceId) ?? []
    if (queue.length > 0) {
      const request = queue.shift() ?? null
      if (queue.length === 0) {
        this.pendingByDevice.delete(deviceId)
      } else {
        this.pendingByDevice.set(deviceId, queue)
      }
      return request
    }

    return new Promise<RelayRequest | null>((resolve) => {
      const waiters = this.pollWaitersByDevice.get(deviceId) ?? []
      waiters.push(resolve)
      this.pollWaitersByDevice.set(deviceId, waiters)

      setTimeout(() => {
        const currentWaiters = this.pollWaitersByDevice.get(deviceId) ?? []
        const nextWaiters = currentWaiters.filter((waiter) => waiter !== resolve)
        if (nextWaiters.length === 0) {
          this.pollWaitersByDevice.delete(deviceId)
        } else {
          this.pollWaitersByDevice.set(deviceId, nextWaiters)
        }
        resolve(null)
      }, timeoutMs)
    })
  }

  public resolve(requestId: string, response: RelayResponse): boolean {
    const inflight = this.inflightByRequestId.get(requestId)
    if (!inflight) return false

    clearTimeout(inflight.timeoutId)
    this.inflightByRequestId.delete(requestId)
    inflight.resolve(response)
    return true
  }

  private deliverToWaitingPoller(deviceId: string, request: RelayRequest): boolean {
    const waiters = this.pollWaitersByDevice.get(deviceId) ?? []
    const next = waiters.shift()
    if (!next) {
      return false
    }

    if (waiters.length === 0) {
      this.pollWaitersByDevice.delete(deviceId)
    } else {
      this.pollWaitersByDevice.set(deviceId, waiters)
    }

    next(request)
    return true
  }
}
