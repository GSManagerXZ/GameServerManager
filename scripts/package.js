const fs = require('fs-extra')
const path = require('path')
const archiver = require('archiver')
const { execSync } = require('child_process')
const https = require('https')
const { pipeline } = require('stream')
const { promisify } = require('util')
const pipelineAsync = promisify(pipeline)

const packageName = 'gsm3-management-panel'
const version = require('../package.json').version
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
    // 直接复制node.exe到server目录
    const targetDir = path.join(packageDir, 'server')
    const targetFile = path.join(targetDir, 'node.exe')
    
    await fs.ensureDir(targetDir)
    await fs.copy(downloadedFile, targetFile)
    console.log('✅ Windows Node.js 部署到 server/node.exe')
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
    
    // 复制PTY文件
    await fs.copy(
      path.join(__dirname, '..', 'server', 'PTY'),
      path.join(packageDir, 'server', 'PTY')
    )
    
    console.log('🐍 复制Python文件...')
    // 复制Python文件和配置
    const pythonSourcePath = path.join(__dirname, '..', 'server', 'src', 'Python')
    if (await fs.pathExists(pythonSourcePath)) {
      await fs.copy(
        pythonSourcePath,
        path.join(packageDir, 'server', 'Python')
      )
      console.log('✅ Python文件复制完成')
    } else {
      console.log('⚠️  警告: Python目录不存在，跳过复制')
    }
    
    // 复制环境变量配置文件
    await fs.copy(
      path.join(__dirname, '..', 'server', '.env'),
      path.join(packageDir, 'server', '.env')
    )
    
    // 创建uploads目录
    await fs.ensureDir(path.join(packageDir, 'server', 'uploads'))
    console.log('📁 创建uploads目录...')
    
    // 复制server/data/games目录（包含游戏配置文件）
    const serverGamesPath = path.join(__dirname, '..', 'server', 'data', 'games')
    if (await fs.pathExists(serverGamesPath)) {
      await fs.ensureDir(path.join(packageDir, 'server', 'data'))
      await fs.copy(
        serverGamesPath,
        path.join(packageDir, 'server', 'data', 'games')
      )
      console.log('📋 复制游戏配置文件...')
    } else {
      console.log('⚠️  警告: server/data/games 目录不存在，跳过复制')
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
    
    console.log('📝 创建启动脚本...')
    // 根据目标平台创建启动脚本
    if (buildTarget === 'windows') {
      const startScript = `@echo off
echo 正在启动GSM3管理面板...
cd server
node.exe index.js
pause`
      
      await fs.writeFile(
        path.join(packageDir, 'start.bat'),
        startScript
      )
    } else if (buildTarget === 'linux') {
      const startShScript = `#!/bin/bash
echo "正在启动GSM3管理面板..."
chmod +x server/PTY/pty_linux_x64
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
cd server
node index.js
pause`
      
      await fs.writeFile(
        path.join(packageDir, 'start.bat'),
        startScript
      )
      
      const startShScript = `#!/bin/bash
echo "正在启动GSM3管理面板..."
chmod +x server/PTY/pty_linux_x64
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
    
    console.log('🐍 创建Python依赖安装脚本...')
    // 创建Python依赖安装脚本
    const installPythonDepsScript = `@echo off
echo 正在安装Python依赖...
cd server\Python
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple/ --trusted-host pypi.tuna.tsinghua.edu.cn
echo Python依赖安装完成！
pause`
    
    await fs.writeFile(
      path.join(packageDir, 'install-python-deps.bat'),
      installPythonDepsScript
    )
    
    // 创建Linux Python依赖安装脚本
    const installPythonDepsShScript = `#!/bin/bash
echo "正在安装Python依赖..."
cd server/src/Python
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple/ --trusted-host pypi.tuna.tsinghua.edu.cn
echo "Python依赖安装完成！"`
    
    await fs.writeFile(
      path.join(packageDir, 'install-python-deps.sh'),
      installPythonDepsShScript
    )
    
    // 设置Python脚本执行权限
    try {
      execSync(`chmod +x "${path.join(packageDir, 'install-python-deps.sh')}"`)
    } catch (e) {
      console.log('⚠️  无法设置Python脚本执行权限，请在Linux系统中手动设置')
    }
    
    console.log('📋 创建说明文件...')
    // 创建README
    const readme = `# GSM3 游戏服务端管理面板

## 安装说明

1. ${buildTarget ? `本包已内置 Node.js ${nodeVersion}，无需单独安装` : '确保已安装 Node.js (版本 >= 18)'}
2. 确保已安装 Python (版本 >= 3.8) 和 pip
3. 解压缩包到目标目录
4. 安装Python依赖:
   - 方式一 (推荐): 运行安装脚本
     - Windows: 双击 install-python-deps.bat
     - Linux/Mac: 运行 ./install-python-deps.sh
   - 方式二: 手动安装
     \`\`\`bash
     cd server/Python
     pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple/ --trusted-host pypi.tuna.tsinghua.edu.cn
     \`\`\`
5. (可选) 配置端口和其他参数:
   - 复制 .env.example 为 .env 并修改 SERVER_PORT 等配置
   - 复制 server/.env.example 为 server/.env 并配置详细参数
6. 运行启动脚本:
   - Windows: 双击 start.bat
   - Linux/Mac: 运行 ./start.sh

## 默认访问地址

http://localhost:3001

## 端口配置

- 修改根目录 .env 文件中的 SERVER_PORT 可以更改服务端口
- 修改后需要重启服务才能生效
- 确保防火墙允许新端口访问

## Python组件说明

本管理面板包含Python组件用于游戏配置文件的解析和管理:
- 支持多种配置文件格式 (YAML, JSON, TOML, Properties等)
- 提供游戏配置模板和自动化配置管理
- 位置: server/Python/
- 配置模板: server/Python/public/gameconfig/

## 注意事项

- ${buildTarget ? `本包已内置 Node.js ${nodeVersion} 和所有依赖` : 'Node.js依赖已预装'}，但需要手动安装Python依赖
- 首次运行会自动创建默认管理员账户 (admin/admin123)
- 请立即登录并修改默认密码
- 确保防火墙允许相关端口访问
- Python组件需要Python 3.8+环境支持
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