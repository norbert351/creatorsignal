import { createHash, randomBytes } from 'node:crypto'

// ---------------------------------------------------------------------------
// Google OAuth 2.0 (authorization-code + PKCE) for the viewer "Continue with
// Google" button.
//
// Needs CREATORSIGNAL_GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET from the
// operator's Google Cloud OAuth client (redirect URI must include
// /api/auth/google/callback). When those are absent, the button is hidden.
// ---------------------------------------------------------------------------

export interface GoogleConfig {
  googleClientId?: string
  googleClientSecret?: string
}

export function googleConfigured(config: GoogleConfig): boolean {
  return Boolean(config.googleClientId && config.googleClientSecret)
}

// In-memory state -> { verifier, redirectUri } for the OAuth round trip.
// Translates the browser's code into the PKCE secret we sent. Fine for a
// demo; a multi-instance deploy would move this to storage.
const pending = new Map<string, { verifier: string; redirectUri: string }>()

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export interface AuthorizeRequest {
  url: string
  state: string
}

/** Builds the Google authorize URL and remembers the PKCE secret. */
export function buildAuthorizeUrl(config: GoogleConfig, origin: string): AuthorizeRequest {
  const redirectUri = `${origin}/api/auth/google/callback`
  const state = base64Url(randomBytes(24))
  const verifier = base64Url(randomBytes(32))
  pending.set(state, { verifier, redirectUri })
  const params = new URLSearchParams({
    client_id: config.googleClientId as string,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge(verifier),
    code_challenge_method: 'S256',
    access_type: 'online',
  })
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, state }
}

interface TokenResponse {
  id_token?: string
  error?: string
  error_description?: string
}

/** Exchanges the authorization code for an id_token. */
export async function exchangeCode(
  config: GoogleConfig,
  code: string,
  state: string,
): Promise<{ email: string; name: string } | { error: string }> {
  const record = pending.get(state)
  if (!record) return { error: 'invalid state' }
  pending.delete(state)
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      code,
      code_verifier: record.verifier,
      redirect_uri: record.redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const data = (await response.json().catch(() => ({}))) as TokenResponse
  if (!response.ok || !data.id_token) {
    return { error: data.error_description ?? data.error ?? 'token exchange failed' }
  }
  return parseIdToken(data.id_token)
}

/** Decodes the id_token JWT payload (email + name). No signature check — we
 *  get the token straight from Google's token endpoint over TLS. */
export function parseIdToken(idToken: string): { email: string; name: string } | { error: string } {
  const part = idToken.split('.')[1]
  if (!part) return { error: 'malformed id_token' }
  try {
    const json = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as {
      email?: string
      email_verified?: boolean
      name?: string
    }
    if (!json.email) return { error: 'id_token lacks email' }
    return { email: json.email, name: json.name ?? json.email.split('@')[0] ?? 'Creator' }
  } catch {
    return { error: 'could not decode id_token' }
  }
}
