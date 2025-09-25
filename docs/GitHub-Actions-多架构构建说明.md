# GitHub Actions 多架构构建说明

## 概述

项目现已支持通过GitHub Actions自动构建多架构Docker镜像，包括AMD64和ARM64平台。

## 可用的构建选项

### 1. 主构建工作流 (build.yml)

#### 手动触发选项：
- ✅ **构建Linux版本** - 构建Linux应用包
- ✅ **构建Windows版本** - 构建Windows应用包  
- ✅ **构建Docker镜像** - 构建多架构Docker镜像 (AMD64 + ARM64)
- 🆕 **构建ARM64 Docker镜像** - 仅构建ARM64 Docker镜像

#### 自动触发：
- 推送标签 (`v*`) 时自动构建所有版本
- 发布Release时自动构建所有版本

### 2. 专用多架构工作流 (docker-multiarch.yml)

提供更详细的多架构构建控制：
- 可选择构建平台组合
- 支持自定义镜像标签
- 包含架构验证测试

## 使用方法

### 方法一：GitHub网页操作

1. 进入GitHub仓库页面
2. 点击 **Actions** 标签
3. 选择 **Build Package** 工作流
4. 点击 **Run workflow**
5. 选择需要的构建选项：
   - ☑️ 构建ARM64 Docker镜像
   - ☑️ 构建Docker镜像（多架构）
6. 点击 **Run workflow** 开始构建

### 方法二：GitHub CLI命令

```bash
# 安装GitHub CLI
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update
sudo apt install gh

# 登录GitHub
gh auth login

# 触发ARM64构建
gh workflow run build.yml -f build_docker_arm=true

# 触发多架构构建
gh workflow run build.yml -f build_docker=true

# 触发所有构建
gh workflow run build.yml -f build_linux=true -f build_windows=true -f build_docker=true -f build_docker_arm=true

# 使用专用多架构工作流
gh workflow run docker-multiarch.yml -f tag=latest -f platforms="linux/amd64,linux/arm64" -f push_to_registry=true
```

## 构建产物

### ARM64专用构建
- 镜像标签：`xiaozhu674/gameservermanager:latest-arm64`
- 平台：仅 `linux/arm64`

### 多架构构建  
- 镜像标签：`xiaozhu674/gameservermanager:latest`
- 平台：`linux/amd64` + `linux/arm64`

## 验证构建结果

```bash
# 查看多架构镜像信息
docker buildx imagetools inspect xiaozhu674/gameservermanager:latest

# 拉取并测试ARM64镜像
docker pull --platform linux/arm64 xiaozhu674/gameservermanager:latest-arm64
docker run --platform linux/arm64 --rm xiaozhu674/gameservermanager:latest-arm64 uname -m

# 拉取并测试AMD64镜像
docker pull --platform linux/amd64 xiaozhu674/gameservermanager:latest
docker run --platform linux/amd64 --rm xiaozhu674/gameservermanager:latest uname -m
```

## 配置要求

### GitHub Secrets

确保仓库设置了以下Secrets：
- `DOCKERHUB_USERNAME` - Docker Hub用户名
- `DOCKERHUB_TOKEN` - Docker Hub访问令牌

### 设置方法：
1. 进入GitHub仓库 → Settings → Secrets and variables → Actions
2. 点击 **New repository secret**
3. 添加上述两个secrets

## 构建时间对比

| 构建类型 | 预估时间 | 说明 |
|---------|---------|------|
| 仅AMD64 | ~15分钟 | 标准构建 |
| 仅ARM64 | ~20分钟 | 需要模拟器 |
| 多架构 | ~25分钟 | 并行构建两个架构 |

## 故障排除

### 常见问题

1. **构建失败 - 权限错误**
   - 检查DOCKERHUB_USERNAME和DOCKERHUB_TOKEN是否正确设置

2. **ARM64构建超时**
   - ARM64构建需要QEMU模拟，时间较长属正常现象

3. **镜像推送失败**
   - 确认Docker Hub仓库存在且有推送权限

### 查看构建日志

1. 进入GitHub仓库 → Actions
2. 点击对应的工作流运行
3. 展开失败的步骤查看详细日志

## 最佳实践

1. **开发阶段**：使用ARM64专用构建进行快速测试
2. **发布阶段**：使用多架构构建确保兼容性
3. **标签管理**：为不同版本使用语义化版本标签
4. **缓存优化**：GitHub Actions会自动缓存构建层以加速后续构建

## 更新日志

- **v1.0**: 添加ARM64专用构建选项
- **v1.1**: 支持多架构并行构建
- **v1.2**: 添加构建验证和测试步骤
