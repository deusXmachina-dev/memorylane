import type { Dispatcher } from 'undici'

declare global {
  interface RequestInit {
    dispatcher?: Dispatcher
  }
}
