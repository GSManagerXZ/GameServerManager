import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  PTY_ASSETS,
  ensurePtyAsset,
  type PtyAssetKey
} from './ptyAssets.js'

interface ParsedArguments {
  assetKey: PtyAssetKey
  targetDir: string
}

function parseArguments(args: string[]): ParsedArguments {
  if (args[0] !== 'ensure') {
    throw new Error('仅支持 ensure 命令')
  }

  let assetKey: string | undefined
  let targetDir: string | undefined
  const seen = new Set<string>()

  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (flag !== '--asset' && flag !== '--target-dir') {
      throw new Error(`未知参数: ${flag || '(空)'}`)
    }
    if (seen.has(flag)) {
      throw new Error(`参数重复: ${flag}`)
    }
    if (!value || value.startsWith('--')) {
      throw new Error(`参数缺少值: ${flag}`)
    }
    seen.add(flag)

    if (flag === '--asset') {
      assetKey = value
    } else {
      targetDir = value
    }
  }

  if (!assetKey || !targetDir) {
    throw new Error('必须提供 --asset 和 --target-dir')
  }
  if (!Object.prototype.hasOwnProperty.call(PTY_ASSETS, assetKey)) {
    throw new Error(`未知 PTY 资产: ${assetKey}`)
  }

  return {
    assetKey: assetKey as PtyAssetKey,
    targetDir: path.resolve(targetDir)
  }
}

export async function runPtyAssetCli(args: string[] = process.argv.slice(2)): Promise<string> {
  const parsed = parseArguments(args)
  const targetStat = await fs.stat(parsed.targetDir).catch(() => null)
  if (!targetStat?.isDirectory()) {
    throw new Error(`PTY 目标路径不是目录: ${parsed.targetDir}`)
  }

  return ensurePtyAsset({
    asset: PTY_ASSETS[parsed.assetKey],
    targetDir: parsed.targetDir,
    token: process.env.GITHUB_TOKEN
  })
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runPtyAssetCli()
    .then(installedPath => {
      console.log(installedPath)
    })
    .catch(error => {
      console.error(error instanceof Error ? error.message : 'PTY 资产安装失败')
      process.exitCode = 1
    })
}
