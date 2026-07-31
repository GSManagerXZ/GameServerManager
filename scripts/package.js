const fs = require('fs-extra')
const path = require('path')
const archiver = require('archiver')
const { execSync } = require('child_process')
const https = require('https')
const { pipeline } = require('stream')
const { promisify } = require('util')
const iconv = require('iconv-lite')
const { resolveBuildVersion } = require('./resolve-build-version')
const pipelineAsync = promisify(pipeline)

const packageName = 'gsm3-management-panel'
const version = resolveBuildVersion()
const distDir = path.join(__dirname, '..', 'dist')
const packageDir = path.join(distDir, 'package')

// 获取命令行参数
const args = process.argv.slice(2)
const buildTarget = args.find(arg => arg.startsWith('--target='))?.split('=')[1]
const skipZip = args.includes('--no-zip') || args.includes('--skip-zip')
const outputFile = buildTarget 
  ? path.join(distDir, `${packageName}-${buildTarget}-v${version}.zip`)
  : path.join(distDir, `${packageName}-v${version}.zip`)

const nodeVersion = '22.17.0'

// Zip-Tools GitHub 下载配置（始终使用最新版本）
const ZIP_TOOLS_GITHUB_URL = 'https://github.com/MCSManager/Zip-Tools/releases/latest/download/'

// PTY GitHub 下载配置（tag 名为 latest）
const PTY_GITHUB_URL = 'https://github.com/MCSManager/PTY/releases/download/latest/'

/**
 * 获取目标平台对应的 Zip-Tools 二进制文件名列表
 * 打包时下载所有该平台支持的架构版本
 */
function getZipToolsBinaries(platform) {
  if (platform === 'linux') {
    return ['file_zip_linux_x64', 'file_zip_linux_arm64']
  } else if (platform === 'windows') {
    // GitHub Releases 上 Zip-Tools 只有 win32_x64 版本
    return ['file_zip_win32_x64.exe']
  }
  // 未指定平台时下载所有版本
  return [
    'file_zip_linux_x64',
    'file_zip_linux_arm64',
    'file_zip_win32_x64.exe',
    'file_zip_darwin_amd64',
    'file_zip_darwin_arm64',
  ]
}

/**
 * 获取目标平台对应的 7z 二进制文件名列表
 * 打包时下载所有该平台支持的架构版本
 */
function get7zBinaries(platform) {
  if (platform === 'linux') {
    return ['7z_linux_x64', '7z_linux_arm64']
  } else if (platform === 'windows') {
    return ['7z_win32_x64.exe', '7z_win32_arm64.exe']
  }
  // 未指定平台时下载所有版本
  return [
    '7z_linux_x64', '7z_linux_arm64', '7z_linux_386', '7z_linux_arm',
    '7z_win32_x64.exe', '7z_win32_arm64.exe',
    '7z_darwin_x64', '7z_darwin_arm64',
  ]
}

/**
 * 从 GitHub Releases 下载单个文件（支持 302 重定向）
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)
    const request = (currentUrl, redirectCount = 0) => {
      // 防止无限重定向
      if (redirectCount > 10) {
        fs.unlink(destPath, () => {})
        reject(new Error(`重定向次数过多: ${url}`))
        return
      }
      const options = {
        headers: {
          'User-Agent': 'GSM3-Packager/1.0',
          'Accept': 'application/octet-stream'
        }
      }
      // 解析URL并合并options
      const parsedUrl = new URL(currentUrl)
      options.hostname = parsedUrl.hostname
      options.path = parsedUrl.pathname + parsedUrl.search
      options.port = parsedUrl.port || 443

      https.get(options, (response) => {
        // 处理 GitHub 的 301/302 重定向
        if (response.statusCode === 301 || response.statusCode === 302) {
          response.resume() // 消费响应体，释放连接
          request(response.headers.location, redirectCount + 1)
          return
        }
        if (response.statusCode !== 200) {
          fs.unlink(destPath, () => {})
          reject(new Error(`下载失败 (HTTP ${response.statusCode}): ${currentUrl}`))
          return
        }
        response.pipe(file)
        file.on('finish', () => {
          file.close(() => {
            // 验证下载的文件不是HTML页面
            const fd = require('fs').openSync(destPath, 'r')
            const buf = Buffer.alloc(16)
            require('fs').readSync(fd, buf, 0, 16, 0)
            require('fs').closeSync(fd)
            const header = buf.toString('utf8', 0, 16)
            if (header.includes('<') || header.includes('<!DOCTYPE') || header.includes('<html')) {
              fs.unlink(destPath, () => {})
              reject(new Error(`下载到的是HTML页面而非二进制文件: ${url}`))
              return
            }
            resolve(destPath)
          })
        })
      }).on('error', (err) => {
        fs.unlink(destPath, () => {})
        reject(err)
      })
    }
    request(url)
  })
}

/**
 * 下载 Zip-Tools 二进制文件到打包目录的 data/lib/
 * 从 GitHub Releases 下载，确保打包产物内置 Zip-Tools
 */
async function downloadZipTools(platform) {
  const binaries = getZipToolsBinaries(platform)
  const libDir = path.join(packageDir, 'data', 'lib')
  await fs.ensureDir(libDir)

  console.log('📥 正在从 GitHub 下载 Zip-Tools (latest)...')
  let hasSuccess = false

  for (const binaryName of binaries) {
    const url = `${ZIP_TOOLS_GITHUB_URL}${binaryName}`
    const destPath = path.join(libDir, binaryName)

    console.log(`   下载: ${binaryName}`)
    try {
      await downloadFile(url, destPath)
      // 非 Windows 二进制文件设置可执行权限
      if (!binaryName.endsWith('.exe')) {
        try {
          execSync(`chmod +x "${destPath}"`)
        } catch (e) {
          // Windows 构建环境无法 chmod，忽略
        }
      }
      console.log(`   ✅ ${binaryName} 下载完成`)
      hasSuccess = true
    } catch (err) {
      console.error(`   ⚠️ ${binaryName} 下载失败（跳过）: ${err.message}`)
    }
  }

  if (!hasSuccess) {
    throw new Error('所有 Zip-Tools 文件下载均失败')
  }
  console.log('✅ Zip-Tools 下载完成')
}

/**
 * 下载 7z 二进制文件到打包目录的 data/lib/
 * 从 GitHub Releases 下载，确保打包产物内置 7z
 */
async function download7z(platform) {
  const binaries = get7zBinaries(platform)
  const libDir = path.join(packageDir, 'data', 'lib')
  await fs.ensureDir(libDir)

  console.log('📥 正在从 GitHub 下载 7z (latest)...')
  let hasSuccess = false

  for (const binaryName of binaries) {
    const url = `${ZIP_TOOLS_GITHUB_URL}${binaryName}`
    const destPath = path.join(libDir, binaryName)

    console.log(`   下载: ${binaryName}`)
    try {
      await downloadFile(url, destPath)
      // 非 Windows 二进制文件设置可执行权限
      if (!binaryName.endsWith('.exe')) {
        try {
          execSync(`chmod +x "${destPath}"`)
        } catch (e) {
          // Windows 构建环境无法 chmod，忽略
        }
      }
      console.log(`   ✅ ${binaryName} 下载完成`)
      hasSuccess = true
    } catch (err) {
      console.error(`   ⚠️ ${binaryName} 下载失败（跳过）: ${err.message}`)
    }
  }

  if (!hasSuccess) {
    throw new Error('所有 7z 文件下载均失败')
  }
  console.log('✅ 7z 下载完成')
}

/**
 * 获取目标平台对应的 PTY 二进制文件名列表
 * 打包时下载所有该平台支持的架构版本
 */
function getPtyBinaries(platform) {
  if (platform === 'linux') {
    return ['pty_linux_x64', 'pty_linux_arm64']
  } else if (platform === 'windows') {
    return ['pty_win32_x64.exe']
  }
  // 未指定平台时下载所有版本
  return [
    'pty_linux_x64',
    'pty_linux_arm64',
    'pty_win32_x64.exe',
  ]
}

/**
 * 下载 PTY 二进制文件到打包目录的 data/lib/
 * 从 GitHub Releases 下载，确保打包产物内置 PTY
 */
async function downloadPty(platform) {
  const binaries = getPtyBinaries(platform)
  const libDir = path.join(packageDir, 'data', 'lib')
  await fs.ensureDir(libDir)

  console.log('📥 正在从 GitHub 下载 PTY (latest)...')
  let hasSuccess = false

  for (const binaryName of binaries) {
    const url = `${PTY_GITHUB_URL}${binaryName}`
    const destPath = path.join(libDir, binaryName)

    console.log(`   下载: ${binaryName}`)
    try {
      await downloadFile(url, destPath)
      // 非 Windows 二进制文件设置可执行权限
      if (!binaryName.endsWith('.exe')) {
        try {
          execSync(`chmod +x "${destPath}"`)
        } catch (e) {
          // Windows 构建环境无法 chmod，忽略
        }
      }
      console.log(`   ✅ ${binaryName} 下载完成`)
      hasSuccess = true
    } catch (err) {
      console.error(`   ⚠️ ${binaryName} 下载失败（跳过）: ${err.message}`)
    }
  }

  if (!hasSuccess) {
    throw new Error('所有 PTY 文件下载均失败')
  }
  console.log('✅ PTY 下载完成')
}

async function downloadNodejs(platform) {
  const nodeUrls = {
    linux: `https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-linux-x64.tar.xz`,
    windows: `https://nodejs.org/download/release/latest-v22.x/win-x64/node.exe`
  }
  
  const url = nodeUrls[platform]
  if (!url) {
    throw new Error(`不支持的平台: ${platform}`)
  }
  
  const fileName = url.split('/').pop()
  const filePath = path.join(__dirname, '..', fileName)
  
  console.log(`📥 正在下载 Node.js ${nodeVersion} for ${platform}...`)
  
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath)
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`下载失败: ${response.statusCode}`))
        return
      }
      
      response.pipe(file)
      file.on('finish', () => {
        file.close()
        console.log(`✅ Node.js 下载完成: ${fileName}`)
        resolve(filePath)
      })
    }).on('error', (err) => {
      fs.unlink(filePath, () => {}) // 删除不完整的文件
      reject(err)
    })
  })
}

// 解压和部署Node.js
async function deployNodejs(platform, downloadedFile) {
  const projectRoot = path.join(__dirname, '..')
  
  if (platform === 'linux') {
    console.log('📦 正在解压 Linux Node.js...')
    // 解压到临时目录
    execSync(`tar -xf "${downloadedFile}"`, { cwd: projectRoot })
    
    // 重命名为node文件夹
    const extractedDir = path.join(projectRoot, `node-v${nodeVersion}-linux-x64`)
    const targetDir = path.join(packageDir, 'node')
    
    if (await fs.pathExists(extractedDir)) {
      await fs.move(extractedDir, targetDir)
      console.log('✅ Linux Node.js 部署到项目根目录/node')
    } else {
      throw new Error('Linux Node.js 解压失败')
    }
  } else if (platform === 'windows') {
    console.log('📦 正在部署 Windows Node.js...')
    // 复制node.exe到打包根目录（start.bat不再cd server，cwd为根目录）
    const targetFile = path.join(packageDir, 'node.exe')
    
    await fs.copy(downloadedFile, targetFile)
    console.log('✅ Windows Node.js 部署到打包根目录/node.exe')
  }
  
  // 清理下载的文件
  await fs.remove(downloadedFile)
}

async function createPackage() {
  try {
    console.log(`🚀 开始创建生产包${buildTarget ? ` (目标平台: ${buildTarget})` : ''}...`)
    
    // 清理并创建目录
    await fs.remove(distDir)
    await fs.ensureDir(packageDir)
    
    console.log('📦 复制服务端文件...')
    // 复制服务端构建文件
    await fs.copy(
      path.join(__dirname, '..', 'server', 'dist'),
      path.join(packageDir, 'server')
    )
    
    // 复制服务端package.json和必要文件
    await fs.copy(
      path.join(__dirname, '..', 'server', 'package.json'),
      path.join(packageDir, 'server', 'package.json')
    )
    
    // PTY 文件不再从本地复制，改为从 GitHub 下载到 data/lib/ 目录
    
    // 复制环境变量配置文件
    await fs.copy(
      path.join(__dirname, '..', 'server', '.env'),
      path.join(packageDir, 'server', '.env')
    )
    
    // 创建uploads目录
    await fs.ensureDir(path.join(packageDir, 'server', 'uploads'))
    console.log('📁 创建uploads目录...')
    
    // 复制server/data/games目录（包含游戏配置文件）到打包根目录的data/下
    // 修复：Windows打包后不再cd server，process.cwd()为根目录，数据统一放在data/下
    const serverGamesPath = path.join(__dirname, '..', 'server', 'data', 'games')
    if (await fs.pathExists(serverGamesPath)) {
      await fs.ensureDir(path.join(packageDir, 'data'))
      await fs.copy(
        serverGamesPath,
        path.join(packageDir, 'data', 'games')
      )
      console.log('📋 复制游戏配置文件...')
    } else {
      console.log('⚠️  警告: server/data/games 目录不存在，跳过复制')
    }

    // 复制server/data/gameconfig目录（包含游戏配置模板文件）到打包根目录的data/下
    const serverGamesConfigPath = path.join(__dirname, '..', 'server', 'data', 'gameconfig')
    if (await fs.pathExists(serverGamesConfigPath)) {
      await fs.ensureDir(path.join(packageDir, 'data'))
      await fs.copy(
        serverGamesConfigPath,
        path.join(packageDir, 'data', 'gameconfig')
      )
      console.log('📋 复制游戏配置模板文件...')
    } else {
      console.log('⚠️  警告: server/data/gameconfig 目录不存在，跳过复制')
    }

    // 复制server/data/plugins目录（包含内置插件）到打包根目录的data/下
    const serverPluginsPath = path.join(__dirname, '..', 'server', 'data', 'plugins')
    if (await fs.pathExists(serverPluginsPath)) {
      await fs.ensureDir(path.join(packageDir, 'data'))
      await fs.copy(
        serverPluginsPath,
        path.join(packageDir, 'data', 'plugins')
      )
      console.log('📋 复制内置插件文件...')
    } else {
      console.log('⚠️  警告: server/data/plugins 目录不存在，跳过复制')
    }
    
    console.log('📥 安装服务端生产依赖...')
    // 在打包的服务端目录中安装生产依赖
    try {
      execSync('npm install --production --omit=dev', {
        cwd: path.join(packageDir, 'server'),
        stdio: 'inherit'
      })
      console.log('✅ 服务端依赖安装完成')
    } catch (error) {
      console.error('❌ 服务端依赖安装失败:', error)
      throw error
    }
    
    console.log('🎨 复制前端文件...')
    // 复制前端构建文件
    await fs.copy(
      path.join(__dirname, '..', 'client', 'dist'),
      path.join(packageDir, 'public')
    )
    
    // 根据目标平台下载和部署Node.js
    if (buildTarget) {
      const downloadedNodeFile = await downloadNodejs(buildTarget)
      await deployNodejs(buildTarget, downloadedNodeFile)
    } else {
      console.log('ℹ️  未指定目标平台，跳过Node.js下载')
    }
    
    // 下载 Zip-Tools 二进制文件（从 GitHub Releases）
    try {
      await downloadZipTools(buildTarget)
    } catch (error) {
      console.error('⚠️  Zip-Tools 下载失败，打包产物中将不包含 Zip-Tools:', error.message)
      console.log('   用户启动时会自动从镜像站下载')
    }
    
    // 下载 7z 二进制文件（从 GitHub Releases）
    try {
      await download7z(buildTarget)
    } catch (error) {
      console.error('⚠️  7z 下载失败，打包产物中将不包含 7z:', error.message)
      console.log('   用户启动时会自动从镜像站下载')
    }
    
    // 下载 PTY 二进制文件（从 GitHub Releases）
    try {
      await downloadPty(buildTarget)
    } catch (error) {
      console.error('⚠️  PTY 下载失败，打包产物中将不包含 PTY:', error.message)
      console.log('   用户启动时会自动从镜像站下载')
    }
    
    console.log('📝 创建启动脚本...')
    // 根据目标平台创建启动脚本
    if (buildTarget === 'windows') {
      // Windows平台复制scripts\start.bat文件
      await fs.copy(
        path.join(__dirname, 'start.bat'),
        path.join(packageDir, 'start.bat')
      )
    } else if (buildTarget === 'linux') {
      const startShScript = `#!/bin/bash
echo "正在启动GSM3管理面板..."
# PTY 文件已迁移到 data/lib/ 目录，启动时由服务端自动检测
node/bin/node server/index.js`
      
      await fs.writeFile(
        path.join(packageDir, 'start.sh'),
        startShScript
      )
      
      // 设置执行权限
      try {
        execSync(`chmod +x "${path.join(packageDir, 'start.sh')}"`)
      } catch (e) {
        console.log('⚠️  无法设置执行权限，请在Linux系统中手动设置')
      }
    } else {
      // 默认创建通用启动脚本（需要系统已安装Node.js）
      const startScript = `@echo off
echo 正在启动GSM3管理面板...
node server/index.js
pause`
      
      await fs.writeFile(
        path.join(packageDir, 'start.bat'),
        startScript,
        'latin1'  // 使用ANSI编码
      )
      
      const startShScript = `#!/bin/bash
echo "正在启动GSM3管理面板..."
# PTY 文件已迁移到 data/lib/ 目录，启动时由服务端自动检测
node server/index.js`
      
      await fs.writeFile(
        path.join(packageDir, 'start.sh'),
        startShScript
      )
      
      // 设置执行权限
      try {
        execSync(`chmod +x "${path.join(packageDir, 'start.sh')}"`)
      } catch (e) {
        console.log('⚠️  无法设置执行权限，请在Linux系统中手动设置')
      }
    }
    
    console.log('📋 创建说明文件...')
    // 创建README
    const readme = `# GSM3 游戏服务端管理面板

## 安装说明

1. ${buildTarget ? `本包已内置 Node.js ${nodeVersion}，无需单独安装` : '确保已安装 Node.js (版本 >= 18)'}
2. 解压缩包到目标目录
3. (可选) 配置端口和其他参数:
   - 复制 .env.example 为 .env 并修改 SERVER_PORT 等配置
   - 复制 server/.env.example 为 server/.env 并配置详细参数
4. 运行启动脚本:
   - Windows: 双击 start.bat
   - Linux/Mac: 运行 ./start.sh

## 默认访问地址

http://localhost:3001

## 端口配置

- 修改根目录 .env 文件中的 SERVER_PORT 可以更改服务端口
- 修改后需要重启服务才能生效
- 确保防火墙允许新端口访问

## 注意事项

- ${buildTarget ? `本包已内置 Node.js ${nodeVersion} 和所有依赖` : 'Node.js依赖已预装'}
- 首次运行会自动创建默认管理员账户 (admin/admin123)
- 请立即登录并修改默认密码
- 确保防火墙允许相关端口访问
- 建议在生产环境中使用 PM2 等进程管理工具

版本: ${version}
构建时间: ${new Date().toLocaleString('zh-CN')}`
    
    await fs.writeFile(
      path.join(packageDir, 'README.md'),
      readme
    )
    
    if (skipZip) {
      console.log('⏭️ 跳过压缩包创建...')
      console.log('✅ 打包完成!')
      console.log(`📁 输出目录: ${packageDir}`)
    } else {
      console.log('🗜️ 创建压缩包...')
      // 创建ZIP压缩包
      await createZip(packageDir, outputFile)
      
      console.log('✅ 打包完成!')
      console.log(`📦 输出文件: ${outputFile}`)
      console.log(`📁 包大小: ${(await fs.stat(outputFile)).size / 1024 / 1024} MB`)
    }
    
  } catch (error) {
    console.error('❌ 打包失败:', error)
    process.exit(1)
  }
}

function createZip(sourceDir, outputFile) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputFile)
    const archive = archiver('zip', {
      zlib: { level: 9 } // 最高压缩级别
    })
    
    output.on('close', () => {
      resolve()
    })
    
    archive.on('error', (err) => {
      reject(err)
    })
    
    archive.pipe(output)
    archive.directory(sourceDir, false)
    archive.finalize()
  })
}

// 运行打包
createPackage()
