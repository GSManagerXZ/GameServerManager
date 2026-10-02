import fs from 'fs'
import path from 'path'
import {
  findOneClickDeployGame,
  getArchiveSuffix,
  getOneClickDeployPlatform,
  isOneClickDeployGameSupported,
  isOneClickDeploySponsorEligible,
  normalizeOneClickDeployManifest,
  resolveOneClickDeployDownload,
  toPublicGames,
  type OneClickDeployManifest
} from '../utils/oneClickDeploySource.js'

// 构造一份覆盖常见写法的清单（赞助者与非赞助者共用同一个 url）
function createManifest(): OneClickDeployManifest {
  return normalizeOneClickDeployManifest({
    schemaVersion: 1,
    updatedAt: '2026-02-14T10:00:00+08:00',
    notice: '测试清单',
    games: [
      {
        id: 'multi-platform',
        name: '分平台游戏',
        description: '描述',
        type: ['生存', '联机'],
        version: 'v1.0.0',
        supportedPlatforms: ['windows', 'linux'],
        download: {
          fileName: 'game.zip',
          url: 'https://download.xiaozhuhouses.asia/d/abc/game.zip',
          platforms: {
            linux: {
              fileName: 'game-linux.tar.gz',
              url: 'https://download.xiaozhuhouses.asia/d/def/game-linux.tar.gz'
            }
          }
        }
      },
      {
        id: 'external-host',
        name: '自建直链游戏',
        download: {
          url: 'https://files.example.com/external-host.7z'
        }
      }
    ]
  })
}

describe('一键开服云端清单解析', () => {
  it('平台映射与旧在线部署保持一致', () => {
    expect(getOneClickDeployPlatform('win32')).toBe('windows')
    expect(getOneClickDeployPlatform('linux')).toBe('linux')
    expect(getOneClickDeployPlatform('darwin')).toBe('macos')
    expect(getOneClickDeployPlatform('freebsd')).toBe('linux')
  })

  it('能识别多段压缩包后缀', () => {
    expect(getArchiveSuffix('game-linux.tar.gz')).toBe('.tar.gz')
    expect(getArchiveSuffix('https://files.example.com/a/b.7z?token=1')).toBe('.7z')
    expect(getArchiveSuffix('readme.txt')).toBeNull()
  })

  it('规范化清单并补全默认值', () => {
    const manifest = createManifest()

    expect(manifest.games).toHaveLength(2)
    expect(manifest.notice).toBe('测试清单')

    const external = manifest.games[1]
    // 未声明 supportedPlatforms 时按全平台可用处理
    expect(external.supportedPlatforms).toEqual(['windows', 'linux', 'macos'])
    // 未声明 fileName/format 时按下载地址推断
    expect(external.download.fileName).toBe('external-host.7z')
    expect(external.download.format).toBe('7z')
  })

  it('拒绝结构非法的清单', () => {
    expect(() => normalizeOneClickDeployManifest({ games: 'oops' })).toThrow(/缺少 games 数组/)
    expect(() => normalizeOneClickDeployManifest([{ id: 'a' }])).toThrow(/缺少 games 数组/)
    expect(() => normalizeOneClickDeployManifest({ games: undefined })).toThrow(/缺少 games 数组/)
    expect(() => normalizeOneClickDeployManifest(null)).toThrow(/根节点不是对象/)
  })

  it('只有框架、games 为空的清单是合法状态', () => {
    const manifest = normalizeOneClickDeployManifest({
      schemaVersion: 1,
      updatedAt: '2026-02-14T10:00:00+08:00',
      notice: '',
      games: []
    })

    expect(manifest.games).toEqual([])
    expect(manifest.invalidGames).toEqual([])
    expect(toPublicGames(manifest, 'linux')).toEqual([])
  })

  it('单条记录无效时只跳过该条，不影响其它游戏', () => {
    const manifest = normalizeOneClickDeployManifest({
      games: [
        // 只有框架、还没填 id 的模板记录
        { name: '待补充', download: {} },
        { id: 'bad-format', name: '格式不支持', download: { url: 'https://files.example.com/bad.rar' } },
        { id: 'ok', name: '正常游戏', download: { url: 'https://files.example.com/ok.zip' } },
        // 与前面的记录 id 重复
        { id: 'ok', name: '重复记录', download: { url: 'https://files.example.com/dup.zip' } }
      ]
    })

    expect(manifest.games.map(game => game.id)).toEqual(['ok'])
    expect(manifest.invalidGames).toHaveLength(3)
    expect(manifest.invalidGames[0].reason).toMatch(/第 1 条记录缺少 id/)
    expect(manifest.invalidGames[1].reason).toMatch(/压缩包格式不受支持/)
    expect(manifest.invalidGames[2].reason).toMatch(/id 重复/)
    expect(manifest.invalidGames[1].id).toBe('bad-format')
  })

  it('平台名大小写不敏感，无法识别时回退全平台', () => {
    const manifest = normalizeOneClickDeployManifest({
      games: [
        { id: 'upper', name: '大写平台', supportedPlatforms: ['Windows'], download: { url: 'https://files.example.com/a.zip' } },
        { id: 'unknown', name: '未知平台', supportedPlatforms: ['android'], download: { url: 'https://files.example.com/b.zip' } }
      ]
    })

    expect(manifest.games[0].supportedPlatforms).toEqual(['windows'])
    expect(manifest.games[1].supportedPlatforms).toEqual(['windows', 'linux', 'macos'])
  })

  it('赞助者与非赞助者解析出同一个下载地址', () => {
    const manifest = createManifest()
    const game = findOneClickDeployGame(manifest, 'multi-platform')!

    const resolution = resolveOneClickDeployDownload(game, 'windows')
    expect(resolution.url).toBe('https://download.xiaozhuhouses.asia/d/abc/game.zip')
    expect(resolution.fileName).toBe('game.zip')
    expect(resolution.format).toBe('zip')
    // 通道差异只在下载请求是否携带会话 Cookie，解析结果里不再有 channel 字段
    expect(Object.keys(resolution)).not.toContain('channel')
  })

  it('平台专属配置优先于顶层配置', () => {
    const manifest = createManifest()
    const game = findOneClickDeployGame(manifest, 'multi-platform')!

    const linux = resolveOneClickDeployDownload(game, 'linux')
    expect(linux.fileName).toBe('game-linux.tar.gz')
    expect(linux.format).toBe('tar.gz')
    expect(linux.url).toBe('https://download.xiaozhuhouses.asia/d/def/game-linux.tar.gz')

    // macOS 没有独立配置时回退 Linux
    const macos = resolveOneClickDeployDownload(game, 'macos')
    expect(macos.fileName).toBe('game-linux.tar.gz')
    expect(macos.url).toBe('https://download.xiaozhuhouses.asia/d/def/game-linux.tar.gz')
  })

  it('只识别赞助者下载服务域名上的地址', () => {
    expect(isOneClickDeploySponsorEligible('https://download.xiaozhuhouses.asia/d/abc/game.zip')).toBe(true)
    expect(isOneClickDeploySponsorEligible('https://files.example.com/game.zip')).toBe(false)
    expect(isOneClickDeploySponsorEligible('download.xiaozhuhouses.asia/d/abc/game.zip')).toBe(false)
    expect(isOneClickDeploySponsorEligible('')).toBe(false)
    expect(isOneClickDeploySponsorEligible()).toBe(false)
  })

  it('平台支持判断与前端过滤一致', () => {
    const manifest = createManifest()
    const game = findOneClickDeployGame(manifest, 'multi-platform')!

    expect(isOneClickDeployGameSupported(game, 'windows')).toBe(true)
    expect(isOneClickDeployGameSupported(game, 'linux')).toBe(true)
    expect(isOneClickDeployGameSupported(game, 'macos')).toBe(false)
  })

  it('下发前端的列表带上统一下载地址与赞助者节点标记', () => {
    const manifest = createManifest()
    const games = toPublicGames(manifest, 'linux')

    const sponsorEligible = games.find(game => game.id === 'multi-platform')!
    expect(sponsorEligible.downloadUrl).toBe('https://download.xiaozhuhouses.asia/d/def/game-linux.tar.gz')
    expect(sponsorEligible.hasSponsorChannel).toBe(true)

    const external = games.find(game => game.id === 'external-host')!
    expect(external.downloadUrl).toBe('https://files.example.com/external-host.7z')
    expect(external.hasSponsorChannel).toBe(false)
  })

  it('仓库内交付的云端清单示例可以被正常解析', () => {
    const samplePath = path.resolve(__dirname, '../../../docs/oneClickDeploy.json')
    const raw = JSON.parse(fs.readFileSync(samplePath, 'utf8'))
    const manifest = normalizeOneClickDeployManifest(raw)

    expect(manifest.games.length).toBeGreaterThan(0)

    // 示例中的每个游戏都应该能在各平台上解析出可用下载地址
    for (const game of manifest.games) {
      for (const platform of game.supportedPlatforms) {
        const resolution = resolveOneClickDeployDownload(game, platform)
        expect(resolution.url).toBeTruthy()
        expect(getArchiveSuffix(resolution.fileName)).toBeTruthy()
        // 示例统一使用赞助者下载服务地址，便于验证专用节点提示
        expect(isOneClickDeploySponsorEligible(resolution.url)).toBe(true)
      }
    }
  })
})