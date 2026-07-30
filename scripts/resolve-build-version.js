const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const projectRoot = path.join(__dirname, '..')
const packageVersion = require('../package.json').version

function normalizeBuildVersion(value) {
  return String(value || '')
    .trim()
    .replace(/^refs\/tags\//i, '')
    .replace(/^v(?=\d)/i, '')
    .replace(/[^0-9A-Za-z._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 100)
}

function readGitDescription(cwd) {
  try {
    const result = execFileSync(
      'git',
      ['describe', '--tags', '--always', '--dirty', '--long'],
      {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }
    )
    const version = normalizeBuildVersion(result)
    const exactCleanTag = version.match(/^(.*)-0-g[0-9a-f]+$/i)
    return exactCleanTag?.[1] || version
  } catch {
    // Source archives may not include Git metadata; use the package fallback.
  }

  return ''
}

function resolveBuildMetadata(options = {}) {
  const env = options.env || process.env
  const cwd = options.cwd || projectRoot
  const candidates = [
    { value: env.BUILD_VERSION, isTag: false },
    { value: env.RELEASE_TAG, isTag: true },
    {
      value: env.GITHUB_REF_TYPE === 'tag' ? env.GITHUB_REF_NAME : '',
      isTag: true
    },
    { value: env.APP_VERSION, isTag: false },
    { value: env.VITE_APP_VERSION, isTag: false }
  ]

  for (const candidate of candidates) {
    const version = normalizeBuildVersion(candidate.value)
    if (version) {
      return {
        version,
        isStable: candidate.isTag && isStableTagVersion(env, version)
      }
    }
  }

  const gitVersion = readGitDescription(cwd)
  if (gitVersion) {
    const commitOnly = gitVersion.match(/^([0-9a-f]{7,40})(-dirty)?$/i)
    const version = commitOnly
      ? `dev-${commitOnly[1].slice(0, 12)}${commitOnly[2] || ''}`
      : gitVersion
    return { version, isStable: false }
  }

  return {
    version: normalizeBuildVersion(packageVersion) || 'development',
    isStable: false
  }
}

function isStableTagVersion(env, version) {
  const isPrerelease = String(env.RELEASE_PRERELEASE || '').toLowerCase() === 'true'
  return !isPrerelease && /^\d+\.\d+\.\d+$/.test(version)
}

function resolveBuildVersion(options = {}) {
  return resolveBuildMetadata(options).version
}

function appendGitHubValue(filePath, name, value) {
  if (!filePath) return
  fs.appendFileSync(filePath, `${name}=${value}\n`, 'utf8')
}

if (require.main === module) {
  const metadata = resolveBuildMetadata()
  appendGitHubValue(process.env.GITHUB_OUTPUT, 'version', metadata.version)
  appendGitHubValue(process.env.GITHUB_OUTPUT, 'is_stable', String(metadata.isStable))
  appendGitHubValue(process.env.GITHUB_ENV, 'APP_VERSION', metadata.version)
  appendGitHubValue(process.env.GITHUB_ENV, 'VITE_APP_VERSION', metadata.version)
  console.log(`Resolved build version: ${metadata.version} (stable tag: ${metadata.isStable})`)
}

module.exports = {
  normalizeBuildVersion,
  resolveBuildMetadata,
  resolveBuildVersion
}
