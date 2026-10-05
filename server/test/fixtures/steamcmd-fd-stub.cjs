#!/usr/bin/env node
const fs = require('node:fs')

const script = process.argv[process.argv.indexOf('+runscript') + 1]
const contents = fs.readFileSync(script, 'utf8')
process.stdout.write(contents)
process.exitCode = contents.includes('invalid-command') ? 7 : 0
