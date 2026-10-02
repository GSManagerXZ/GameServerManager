import {
  assertFactorioHeadlessSupported,
  assertSteamCMDSupported,
  isX64Architecture,
  UnsupportedArchitectureError
} from '../utils/architectureSupport.js'

describe('architecture support guards', () => {
  it('recognizes common x64 architecture aliases', () => {
    expect(isX64Architecture('x64')).toBe(true)
    expect(isX64Architecture('x86_64')).toBe(true)
    expect(isX64Architecture('amd64')).toBe(true)
    expect(isX64Architecture('riscv64')).toBe(false)
    expect(isX64Architecture('arm64')).toBe(false)
  })

  it('allows SteamCMD on Windows and Linux x64', () => {
    expect(() => assertSteamCMDSupported('win32', 'arm64')).not.toThrow()
    expect(() => assertSteamCMDSupported('linux', 'x64')).not.toThrow()
    expect(() => assertSteamCMDSupported('linux', 'amd64')).not.toThrow()
  })

  it('rejects SteamCMD on unsupported Linux architectures', () => {
    expect(() => assertSteamCMDSupported('linux', 'riscv64')).toThrow(UnsupportedArchitectureError)
    expect(() => assertSteamCMDSupported('linux', 'arm64')).toThrow(/SteamCMD/)
  })

  it('allows Factorio headless only on Linux x64', () => {
    expect(() => assertFactorioHeadlessSupported('linux', 'x64')).not.toThrow()
    expect(() => assertFactorioHeadlessSupported('linux', 'riscv64')).toThrow(UnsupportedArchitectureError)
    expect(() => assertFactorioHeadlessSupported('win32', 'x64')).toThrow(/Factorio/)
  })
})
