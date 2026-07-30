import { StringDecoder } from 'string_decoder'

export class StreamingRedactor {
  private readonly decoder = new StringDecoder('utf8')
  private readonly secrets: string[]
  private readonly tailLength: number
  private pending = ''
  private ended = false

  constructor(values: string[] = []) {
    const variants = values
      .filter(Boolean)
      .flatMap(secret => [
        secret,
        // SteamCMD may echo runscript arguments using console-style escaping.
        secret.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      ])

    this.secrets = [...new Set(variants)]
      .sort((left, right) => right.length - left.length)
    this.tailLength = Math.max(0, ...this.secrets.map(secret => secret.length - 1))
  }

  write(data: Buffer): string {
    if (this.ended) return ''
    return this.process(this.decoder.write(data), false)
  }

  end(): string {
    if (this.ended) return ''
    this.ended = true
    return this.process(this.decoder.end(), true)
  }

  private process(decoded: string, flush: boolean): string {
    const combined = this.pending + decoded
    const emittedLength = flush
      ? combined.length
      : Math.max(0, combined.length - this.tailLength)
    const redacted = this.redact(combined)
    this.pending = redacted.slice(emittedLength)
    return redacted.slice(0, emittedLength)
  }

  private redact(value: string): string {
    return this.secrets.reduce(
      (redacted, secret) => redacted.split(secret).join('*'.repeat(secret.length)),
      value
    )
  }
}
