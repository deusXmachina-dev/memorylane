import { RelayBroker } from './relay-broker'

describe('RelayBroker', () => {
  it('delivers queued request to polling device and resolves response', async () => {
    const broker = new RelayBroker()

    const responsePromise = broker.enqueue(
      'device-1',
      {
        toolName: 'search_context',
        toolInput: { query: 'oauth' },
      },
      2_000,
    )

    const request = await broker.poll('device-1', 500)
    expect(request).not.toBeNull()
    expect(request?.payload.toolName).toBe('search_context')

    const resolved = broker.resolve(request!.requestId, {
      result: { items: [{ id: 'a1' }] },
    })
    expect(resolved).toBe(true)

    await expect(responsePromise).resolves.toEqual({
      result: { items: [{ id: 'a1' }] },
    })
  })

  it('times out when device does not respond', async () => {
    const broker = new RelayBroker()
    const responsePromise = broker.enqueue(
      'device-1',
      {
        toolName: 'browse_timeline',
        toolInput: { startTime: '1 hour ago', endTime: 'now' },
      },
      50,
    )

    await expect(responsePromise).rejects.toThrow('Timed out waiting for device response')
  })
})
