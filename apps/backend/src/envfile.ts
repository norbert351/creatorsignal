import { existsSync, readFileSync } from 'node:fs'

/**
 * Minimal .env loader. Never overrides variables already present in the
 * environment, which matters on hosts that export DATABASE_URL or PORT
 * globally (see the CREATORSIGNAL_ prefixed config below).
 */
export function loadEnvFile(path = '.env'): void {
  if (!existsSync(path)) return
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (process.env[key] === undefined) process.env[key] = value
  }
}
