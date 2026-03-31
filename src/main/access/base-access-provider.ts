import type { AccessState, SubscriptionPlan } from '../../shared/types'
import type { AccessProvider, AccessStateCallback, AccessUpdatePayload } from './types'

export abstract class BaseAccessProvider implements AccessProvider {
  protected accessState: AccessState
  protected onUpdate: AccessStateCallback | null = null

  protected constructor(initialState: AccessState) {
    this.accessState = initialState
  }

  public getAccessState(): AccessState {
    return this.accessState
  }

  public setUpdateCallback(callback: AccessStateCallback): void {
    this.onUpdate = callback
  }

  public abstract refreshAccessState(): Promise<void>
  public abstract startPeriodicRefresh(): void
  public abstract stopPeriodicRefresh(): void
  public abstract startCheckout(plan?: SubscriptionPlan): Promise<void>
  public abstract openSubscriptionPortal(): Promise<void>
  public abstract activateEnterpriseLicense(activationKey: string): Promise<void>

  protected setState(next: Partial<AccessState>, payload?: AccessUpdatePayload): void {
    this.accessState = {
      ...this.accessState,
      ...next,
    }
    this.onUpdate?.(this.accessState, payload)
  }
}
