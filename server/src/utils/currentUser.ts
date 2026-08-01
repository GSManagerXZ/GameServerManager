import os from 'os'

export const getCurrentUsername = (): string | undefined => {
  try {
    const username = os.userInfo().username.trim()
    if (username) return username
  } catch {
    // Minimal containers may run with a UID that has no passwd entry.
  }

  const fallback = process.env.USER || process.env.USERNAME
  if (fallback?.trim()) return fallback.trim()
  if (typeof process.getuid === 'function' && process.getuid() === 0) return 'root'
  return undefined
}
