import { TerminalManager } from '../../src/modules/terminal/TerminalManager.js'

let input = ''
for await (const chunk of process.stdin) input += chunk
const { scriptPath, delay, secrets } = JSON.parse(input)
const logger = { info() {}, warn() {}, error() {}, debug() {} } as any
const manager = new TerminalManager({} as any, logger, {} as any)
const result = await manager.runManagedProcess({
  executablePath: process.execPath,
  args: ['-e', `setTimeout(() => process.stdout.write(require('fs').readFileSync(process.argv[1])), ${delay})`, scriptPath],
  inheritedFileDescriptors: [3],
  workingDirectory: process.cwd(),
  redactValues: secrets,
  timeoutMs: 5000
})
process.stdout.write(JSON.stringify(result))
