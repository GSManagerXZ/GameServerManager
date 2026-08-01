import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'

const KEY_BYTES = 32
const IV_BYTES = 12
const KEY_FILE = '.secret-key'
const AAD = Buffer.from('gsm3:easytier:secrets:v1', 'utf-8')

interface EncryptedSecretEnvelope {
  version: 1
  algorithm: 'aes-256-gcm'
  iv: string
  tag: string
  ciphertext: string
}

const parseKey = (value: string): Buffer => {
  const normalized = value.trim()
  const key = /^[a-f0-9]{64}$/i.test(normalized)
    ? Buffer.from(normalized, 'hex')
    : Buffer.from(normalized, 'base64')
  if (key.length !== KEY_BYTES) {
    throw new Error('EASYTIER_SECRET_KEY 必须是 32 字节的 base64 或 64 位十六进制值')
  }
  return key
}

const readOrCreateKey = async (keyPath: string): Promise<Buffer> => {
  if (process.env.EASYTIER_SECRET_KEY) return parseKey(process.env.EASYTIER_SECRET_KEY)
  try {
    return parseKey(await fs.readFile(keyPath, 'utf-8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const key = randomBytes(KEY_BYTES)
  try {
    await fs.writeFile(keyPath, `${key.toString('base64')}\n`, { encoding: 'utf-8', mode: 0o600, flag: 'wx' })
    if (process.platform !== 'win32') await fs.chmod(keyPath, 0o600)
    return key
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    return parseKey(await fs.readFile(keyPath, 'utf-8'))
  }
}

export class EasyTierSecretCipher {
  private key?: Buffer
  private readonly keyPath: string

  constructor(dataRoot: string) {
    this.keyPath = path.join(dataRoot, KEY_FILE)
  }

  async initialize(): Promise<void> {
    if (!this.key) this.key = await readOrCreateKey(this.keyPath)
  }

  async encrypt(value: unknown): Promise<string> {
    await this.initialize()
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', this.key as Buffer, iv)
    cipher.setAAD(AAD)
    const plaintext = Buffer.from(JSON.stringify(value), 'utf-8')
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const envelope: EncryptedSecretEnvelope = {
      version: 1,
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64')
    }
    return `${JSON.stringify(envelope, null, 2)}\n`
  }

  async decrypt<T>(content: string): Promise<T> {
    await this.initialize()
    const envelope = JSON.parse(content) as Partial<EncryptedSecretEnvelope>
    if (
      envelope.version !== 1 ||
      envelope.algorithm !== 'aes-256-gcm' ||
      !envelope.iv ||
      !envelope.tag ||
      !envelope.ciphertext
    ) {
      throw new Error('EasyTier 密钥文件格式无效')
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key as Buffer,
      Buffer.from(envelope.iv, 'base64')
    )
    decipher.setAAD(AAD)
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final()
    ])
    return JSON.parse(plaintext.toString('utf-8')) as T
  }
}
