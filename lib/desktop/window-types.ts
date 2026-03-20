export {}

declare global {
  interface Window {
    thredosDesktop?: {
      openExternal: (url: string) => Promise<void> | void
      getPendingActivationUrl: () => Promise<string | null>
      consumePendingActivationUrl: () => Promise<string | null>
      onActivationUrl: (callback: (url: string) => void) => (() => void) | void
    }
  }
}
