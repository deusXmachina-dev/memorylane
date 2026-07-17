// navigator.userAgentData is not yet in TypeScript's DOM lib.
interface Navigator {
  readonly userAgentData?: {
    readonly platform?: string
  }
}
