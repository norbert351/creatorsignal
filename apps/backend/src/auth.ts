import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

// ---------------------------------------------------------------------------
// Account auth for the viewer "login gate."
//
// Lightweight but real: passwords are salted-scrypt hashed (node:crypto, no
// new dependencies) and each account owns an opaque apiKey that the viewer
// sends as a Bearer token. The signup/login/logout/me routes live in api.ts;
// this module only owns the crypto + token primitives.
// ---------------------------------------------------------------------------

const ITERATIONS = 64 // scrypt key length in bytes (salt:hash storage)

/** Salted scrypt hash, stored as `salt:hash`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, ITERATIONS).toString('hex')
  return `${salt}:${hash}`
}

/** Constant-time check of a candidate password against a stored hash. */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = scryptSync(password, salt, ITERATIONS)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

/** Opaque bearer token issued to an account. */
export function newApiKey(): string {
  return `cs_${randomBytes(24).toString('hex')}`
}

export interface Account {
  userId: string
  email: string
  apiKey: string
  createdAt: string
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}
