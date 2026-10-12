import net from 'net'
import { RconManager, RconStatus } from '../modules/rcon/RconManager.js'

const PacketType = {
  SERVERDATA_EXECCOMMAND: 2,
  SERVERDATA_AUTH_RESPONSE: 2,
  SERVERDATA_RESPONSE_VALUE: 0
} as const

/** 按 Source RCON 布局构造响应包：length(4) + id(4) + type(4) + body + 两个 null 字节 */
function buildRconPacket(id: number, type: number, body = ''): Buffer {
  const bodyBuffer = Buffer.from(body, 'utf8')
  const length = 4 + 4 + bodyBuffer.length + 2
  const buffer = Buffer.alloc(4 + length)
  let offset = 0
  buffer.writeInt32LE(length, offset); offset += 4
  buffer.writeInt32LE(id, offset); offset += 4
  buffer.writeInt32LE(type, offset); offset += 4
  bodyBuffer.copy(buffer, offset); offset += bodyBuffer.length
  buffer.writeUInt8(0, offset)
  buffer.writeUInt8(0, offset + 1)
  return buffer
}

interface FakeRconServer {
  port: number
  close: () => Promise<void>
}

/**
 * 起一个最小的假 SRCDS：只实现认证握手。
 *
 * authResult 决定它对 SERVERDATA_AUTH 的回应——成功时回显请求 id，失败时按协议回 id=-1。
 * sendPreludeEmptyResponse 模拟「不完全遵循 Valve 握手流程」的第三方游戏服务器：
 * 部分实现（如 Net::SourceRCON 文档中提到的）不会先发那个空的 RESPONSE_VALUE。
 */
async function startFakeRconServer(
  authResult: 'success' | 'fail',
  sendPreludeEmptyResponse = true
): Promise<FakeRconServer> {
  const sockets: net.Socket[] = []
  const server = net.createServer(socket => {
    sockets.push(socket)
    let buffer = Buffer.alloc(0)

    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 4) {
        const length = buffer.readInt32LE(0)
        if (buffer.length < 4 + length) break
        const packet = buffer.slice(4, 4 + length)
        buffer = buffer.slice(4 + length)

        const id = packet.readInt32LE(0)
        const type = packet.readInt32LE(4)

        if (type === 3) {
          // SERVERDATA_AUTH：SRCDS 先回一个空的 RESPONSE_VALUE，再回 AUTH_RESPONSE
          if (sendPreludeEmptyResponse) {
            socket.write(buildRconPacket(id, PacketType.SERVERDATA_RESPONSE_VALUE))
          }
          const responseId = authResult === 'success' ? id : -1
          socket.write(buildRconPacket(responseId, PacketType.SERVERDATA_AUTH_RESPONSE))
        } else if (type === 2) {
          // SERVERDATA_EXECCOMMAND：回一个正常的 RESPONSE_VALUE
          const body = packet.slice(8, packet.length - 2).toString('utf8')
          socket.write(buildRconPacket(id, PacketType.SERVERDATA_RESPONSE_VALUE, `echo:${body}`))
        }
      }
    })

    socket.on('error', () => { /* 测试结束直接销毁，忽略 */ })
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port

  return {
    port,
    close: () => new Promise<void>(resolve => {
      for (const socket of sockets) socket.destroy()
      server.close(() => resolve())
    })
  }
}

describe('RCON 认证握手', () => {
  let server: FakeRconServer | null = null

  afterEach(async () => {
    if (server) await server.close()
    server = null
  })

  it('密码正确时应认证成功', async () => {
    server = await startFakeRconServer('success')
    const manager = new RconManager()

    await manager.connect({ host: '127.0.0.1', port: server.port, password: 'right', timeout: 2000 })

    expect(manager.getStatus()).toBe(RconStatus.AUTHENTICATED)
    expect(manager.isConnected()).toBe(true)
    manager.disconnect()
  })

  it('密码错误时应立即报出密码错误，而不是挂到认证超时', async () => {
    server = await startFakeRconServer('fail')
    const manager = new RconManager()

    await expect(
      manager.connect({ host: '127.0.0.1', port: server.port, password: 'wrong', timeout: 2000 })
    ).rejects.toThrow(/密码错误/)

    manager.disconnect()
  })

  it('密码错误时不应把连接标记为已认证', async () => {
    server = await startFakeRconServer('fail')
    const manager = new RconManager()

    await expect(
      manager.connect({ host: '127.0.0.1', port: server.port, password: 'wrong', timeout: 2000 })
    ).rejects.toThrow()

    expect(manager.isConnected()).toBe(false)
    manager.disconnect()
  })

  it('认证失败后不应残留未清理的待处理请求', async () => {
    server = await startFakeRconServer('fail')
    const manager = new RconManager()

    await expect(
      manager.connect({ host: '127.0.0.1', port: server.port, password: 'wrong', timeout: 2000 })
    ).rejects.toThrow()

    expect([...(manager as any).pendingRequests.keys()]).toEqual([])
    manager.disconnect()
  })

  it('认证失败应立即返回，不必等满超时时间', async () => {
    server = await startFakeRconServer('fail')
    const manager = new RconManager()

    const started = Date.now()
    await expect(
      manager.connect({ host: '127.0.0.1', port: server.port, password: 'wrong', timeout: 5000 })
    ).rejects.toThrow(/密码错误/)
    const elapsed = Date.now() - started

    // 认证超时是 5s；密码错误必须远早于它返回
    expect(elapsed).toBeLessThan(3000)
    manager.disconnect()
  })

  // 部分第三方游戏服务器不完全遵循 Valve 握手流程，不先发空的 RESPONSE_VALUE。
  // 修复不能为了兼容规范流程而弄坏这些服务器。
  it('服务器不先发空 RESPONSE_VALUE 时（不规范实现），密码正确仍应认证成功', async () => {
    server = await startFakeRconServer('success', false)
    const manager = new RconManager()

    await manager.connect({ host: '127.0.0.1', port: server.port, password: 'right', timeout: 2000 })

    expect(manager.getStatus()).toBe(RconStatus.AUTHENTICATED)
    manager.disconnect()
  })

  it('服务器不先发空 RESPONSE_VALUE 时，密码错误仍应报出密码错误', async () => {
    server = await startFakeRconServer('fail', false)
    const manager = new RconManager()

    await expect(
      manager.connect({ host: '127.0.0.1', port: server.port, password: 'wrong', timeout: 2000 })
    ).rejects.toThrow(/密码错误/)

    manager.disconnect()
  })
})

describe('RCON 命令执行', () => {
  let server: FakeRconServer | null = null

  afterEach(async () => {
    if (server) await server.close()
    server = null
  })

  it('认证成功后的命令应正常返回结果', async () => {
    server = await startFakeRconServer('success')
    const manager = new RconManager()
    await manager.connect({ host: '127.0.0.1', port: server.port, password: 'right', timeout: 2000 })

    const result = await manager.executeCommand('status')

    expect(result).toBe('echo:status')
    manager.disconnect()
  })
})