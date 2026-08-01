import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const resolveFirstExistingPath = (paths: string[]): string => (
  paths.find(candidate => fs.existsSync(candidate)) || paths[0]
)

export const getDefaultEasyTierDataRoot = (): string => {
  const baseDir = process.cwd()
  const possiblePaths = [
    path.join(baseDir, 'data', 'easytier'),
    path.join(baseDir, 'server', 'data', 'easytier'),
    path.join(__dirname, '../../data/easytier'),
    path.join(__dirname, '../../../data/easytier')
  ]
  return resolveFirstExistingPath(possiblePaths)
}
