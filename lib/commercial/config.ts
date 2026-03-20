function readEnv(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return null
}

export function getDesktopReturnUrl(): string {
  return readEnv('THREDOS_DESKTOP_RETURN_URL', 'THREADOS_DESKTOP_RETURN_URL') ?? 'thredos://activate'
}

export function getDesktopLocalAppUrl(): string {
  return readEnv('THREDOS_DESKTOP_APP_URL', 'THREADOS_DESKTOP_APP_URL') ?? 'http://127.0.0.1:3010/app'
}

export function getDesktopBrowserReturnPath(): string {
  const path = readEnv('THREDOS_DESKTOP_BROWSER_RETURN_PATH', 'THREADOS_DESKTOP_BROWSER_RETURN_PATH')
  if (!path) return '/desktop/activate'
  return path.startsWith('/') ? path : `/${path}`
}

export function getClerkSignInUrl(): string | null {
  return readEnv('THREDOS_CLERK_SIGN_IN_URL', 'CLERK_SIGN_IN_URL')
}

export function getClerkSignUpUrl(): string | null {
  return readEnv('THREDOS_CLERK_SIGN_UP_URL', 'CLERK_SIGN_UP_URL')
}

export function getStripeSecretKey(): string | null {
  return readEnv('THREDOS_STRIPE_SECRET_KEY', 'STRIPE_SECRET_KEY')
}

export function getStripeWebhookSecret(): string | null {
  return readEnv('THREDOS_STRIPE_WEBHOOK_SECRET', 'STRIPE_WEBHOOK_SECRET')
}

export function getStripePriceId(): string | null {
  return readEnv('THREDOS_STRIPE_PRICE_ID', 'STRIPE_PRICE_ID')
}

export function getStripePublishableKey(): string | null {
  return readEnv('THREDOS_STRIPE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY')
}

export function getStripeCheckoutMode(): 'subscription' | 'payment' {
  return readEnv('THREDOS_STRIPE_CHECKOUT_MODE') === 'payment' ? 'payment' : 'subscription'
}

export function isStripeConfigured(): boolean {
  return Boolean(getStripeSecretKey() && getStripePriceId())
}

export function isClerkConfigured(): boolean {
  return Boolean(getClerkSignInUrl())
}

export function buildDesktopBrowserReturnUrl(
  origin: string,
  state: string,
  extras?: Record<string, string | null | undefined>,
): string {
  const url = new URL(getDesktopBrowserReturnPath(), origin)
  url.searchParams.set('state', state)
  url.searchParams.set('source', 'desktop')

  for (const [key, value] of Object.entries(extras ?? {})) {
    if (value) url.searchParams.set(key, value)
  }

  return url.toString()
}

export function buildClerkDesktopSignInUrl(origin: string, state: string): string | null {
  const baseUrl = getClerkSignInUrl()
  if (!baseUrl) return null

  const redirectUrl = buildDesktopBrowserReturnUrl(origin, state, {
    local_app: getDesktopLocalAppUrl(),
    return_to: getDesktopReturnUrl(),
  })
  const url = new URL(baseUrl)
  url.searchParams.set('redirect_url', redirectUrl)
  url.searchParams.set('sign_in_force_redirect_url', redirectUrl)
  url.searchParams.set('sign_up_force_redirect_url', redirectUrl)
  url.searchParams.set('source', 'desktop')
  url.searchParams.set('state', state)
  return url.toString()
}
