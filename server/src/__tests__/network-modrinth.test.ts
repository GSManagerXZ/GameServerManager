import { EventEmitter } from 'events'
import { Readable } from 'stream'
import http from 'http'
import https from 'https'
import type { Request, Response } from 'express'
import networkRouter from '../routes/network.js'

jest.mock('../middleware/auth.js', () => ({ authenticateToken: jest.fn() }))

const mockTcpConnections: Array<{ host: string; port: number }> = []
jest.mock('net', () => ({
  __esModule: true,
  default: {
    Socket: class extends require('events').EventEmitter {
      setTimeout() { return this }
      destroy() { return this }
      connect(port: number, host: string, onConnect: () => void) {
        mockTcpConnections.push({ host, port })
        queueMicrotask(() => {
          if (port === 80) this.emit('error', new Error('TCP port 80 is blocked'))
          else onConnect()
        })
        return this
      }
    }
  }
}))

// Run the actual registered route handler; HTTP and TCP transports are local
// fixtures so this regression does not depend on public services or DNS.
async function check(path: '/check-single' | '/check-all', body = {}) {
  const route = networkRouter.stack.find(layer => layer.route?.path === path).route
  const handler = route.stack[route.stack.length - 1].handle
  const response = { json: jest.fn(), status: jest.fn() }
  response.status.mockReturnValue(response)
  await handler({ body } as Request, response as unknown as Response, jest.fn())
  expect(response.status).not.toHaveBeenCalled()
  return response.json.mock.calls[0][0]
}

describe('Modrinth network checks', () => {
  const requests: string[] = []
  let apiStatus: number

  beforeEach(() => {
    requests.length = 0
    mockTcpConnections.length = 0
    apiStatus = 200

    const get = (url: string | URL, _options: http.RequestOptions, callback: (res: http.IncomingMessage) => void) => {
      const target = new URL(url)
      requests.push(target.toString())
      const request = Object.assign(new EventEmitter(), { destroy: jest.fn() })
      queueMicrotask(() => {
        let statusCode = 200
        const headers: http.IncomingHttpHeaders = {}
        if (target.hostname === 'api.modrinth.com') {
          statusCode = target.pathname === '/v2/tag/category' ? apiStatus : 301
          headers.location = 'https://docs.modrinth.com/'
        } else if (target.hostname === 'cdn.modrinth.com') {
          statusCode = 307
          headers.location = `https://cdn-alt.modrinth.com${target.pathname}`
        } else if (target.hostname === 'cdn-alt.modrinth.com' && target.pathname === '/') {
          statusCode = 404
        } else if (target.hostname === 'custom.example') {
          statusCode = 302
          headers.location = 'https://redirect.example/'
        }
        const response = Object.assign(Readable.from(['fixture']), { statusCode, headers })
        callback(response as http.IncomingMessage)
      })
      return request as unknown as http.ClientRequest
    }

    jest.spyOn(https, 'get').mockImplementation(get as typeof https.get)
    jest.spyOn(http, 'get').mockImplementation(get as typeof http.get)
  })

  afterEach(() => jest.restoreAllMocks())

  it('checks the API resource when the client sends the legacy domain and item id', async () => {
    const result = await check('/check-single', { id: 'modrinth-api', url: 'api.modrinth.com' })
    expect(result.data).toMatchObject({ id: 'modrinth-api', status: 'success', responseTime: expect.any(Number) })
    expect(requests).toEqual(['https://api.modrinth.com/v2/tag/category'])
    expect(mockTcpConnections).toEqual([])
  })

  it('follows the CDN resource redirect instead of probing the domain root and TCP 80', async () => {
    const result = await check('/check-single', { id: 'modrinth-cdn', url: 'cdn.modrinth.com' })
    expect(result.data.status).toBe('success')
    expect(requests).toEqual([
      'https://cdn.modrinth.com/data/P7dR8mSH/icon.png',
      'https://cdn-alt.modrinth.com/data/P7dR8mSH/icon.png'
    ])
    expect(mockTcpConnections).toEqual([])
  })

  it('preserves an actual API HTTP failure without replacing it with a TCP error', async () => {
    apiStatus = 503
    const result = await check('/check-single', { id: 'modrinth-api', url: 'api.modrinth.com' })
    expect(result.data.status).toBe('failed')
    expect(result.data.error).toContain('503')
    expect(mockTcpConnections).toEqual([])
  })

  it('uses the same checks in check-all while retaining the other configured services', async () => {
    const result = await check('/check-all')
    expect(result.data.results).toHaveLength(7)
    expect(result.data.results.every(item => item.status === 'success')).toBe(true)
    expect(result.data.results.filter(item => item.id.startsWith('modrinth-'))).toEqual([
      expect.objectContaining({ id: 'modrinth-api', url: 'https://api.modrinth.com/v2/tag/category', status: 'success' }),
      expect.objectContaining({ id: 'modrinth-cdn', url: 'https://cdn.modrinth.com/data/P7dR8mSH/icon.png', status: 'success' })
    ])
    // GSManager 组已移除，其余检测项不再使用 TCP 检测
    expect(mockTcpConnections).toEqual([])
  })

  it('leaves redirect behavior unchanged for custom checks without an opt-in', async () => {
    const result = await check('/check-single', { url: 'https://custom.example/' })
    expect(result.data.status).toBe('failed')
    expect(result.data.error).toContain('302')
    expect(requests).toEqual(['https://custom.example/'])
    expect(mockTcpConnections).toEqual([])
  })
})
