const SERVER_ONLY_ENVIRONMENT_NAMES = new Set([
  'EASYTIER_SECRET_KEY',
  'JWT_SECRET',
  'SESSION_SECRET'
])

export const buildChildProcessEnvironment = (
  overrides: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !SERVER_ONLY_ENVIRONMENT_NAMES.has(name))
  ),
  ...overrides
})
