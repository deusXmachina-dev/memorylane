import { net } from 'electron'
import { lookup } from 'node:dns/promises'
import { HostEnvironment } from './host-environment'
import { getLastSuspendAt, isSuspended, onResume, onSuspend } from './power-monitor'

export class ElectronHostEnvironment extends HostEnvironment {
  isSuspended(): boolean {
    return isSuspended()
  }

  isOnline(): boolean {
    return net.isOnline()
  }

  lastSuspendAt(): number {
    return getLastSuspendAt()
  }

  resolves(host: string): Promise<boolean> {
    return lookup(host).then(
      () => true,
      () => false,
    )
  }

  onSuspend(listener: () => void): () => void {
    return onSuspend(listener)
  }

  onResume(listener: () => void): () => void {
    return onResume(listener)
  }
}
