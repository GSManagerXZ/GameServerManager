import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'

export interface TerminalViewOptions {
  isMobile: boolean
}

export function createTerminalView(
  options: TerminalViewOptions
): {
  terminal: Terminal
  fitAddon: FitAddon
} {
  const terminal = new Terminal({
    theme: {
      background: '#1a1a1a',
      foreground: '#ffffff',
      cursor: '#ffffff',
      selectionBackground: '#ffffff30',
      black: '#000000',
      red: '#ff6b6b',
      green: '#51cf66',
      yellow: '#ffd43b',
      blue: '#74c0fc',
      magenta: '#f06292',
      cyan: '#4dd0e1',
      white: '#ffffff',
      brightBlack: '#666666',
      brightRed: '#ff8a80',
      brightGreen: '#69f0ae',
      brightYellow: '#ffff8d',
      brightBlue: '#82b1ff',
      brightMagenta: '#ff80ab',
      brightCyan: '#84ffff',
      brightWhite: '#ffffff'
    },
    fontFamily: 'JetBrains Mono, Fira Code, Consolas, Monaco, monospace',
    fontSize: options.isMobile ? 12 : 14,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: 'block',
    scrollback: options.isMobile ? 500 : 1000,
    tabStopWidth: 4,
    allowTransparency: true,
    disableStdin: false,
    convertEol: true
  })

  const fitAddon = new FitAddon()
  const webLinksAddon = new WebLinksAddon()

  terminal.loadAddon(fitAddon)
  terminal.loadAddon(webLinksAddon)

  return { terminal, fitAddon }
}
