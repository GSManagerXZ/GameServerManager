# TAR 安全漏洞缓解措施

## 漏洞信息

### Unicode 路径冲突竞态条件漏洞

- **影响版本**: node-tar <= 7.5.3
- **漏洞类型**: 竞态条件 (Race Condition)
- **影响平台**: macOS APFS/HFS+ 文件系统
- **CVE编号**: 待分配

**漏洞描述**: 
在 macOS APFS 等大小写/Unicode 规范化不敏感的文件系统上，node-tar 库的 `PathReservations` 系统无法正确处理 Unicode 字符冲突（如德语字符 `ß` 和 `ss`）。这允许恶意 tar 包通过包含冲突路径名的条目绕过库的内部并发保护措施，可能导致：

1. **符号链接投毒攻击** - 通过竞态条件创建指向敏感文件的符号链接
2. **任意文件覆写** - 通过 Unicode 路径冲突覆写目标系统上的任意文件

## 缓解措施

由于项目依赖限制无法升级 node-tar 到 7.5.4+，我们在代码层面实施了以下缓解措施：

### 统一安全过滤器

创建了 `server/src/utils/tarSecurityFilter.ts` 模块，该模块：

1. **默认阻止所有符号链接 (SymbolicLink)**
2. **默认阻止所有硬链接 (Link)**  
3. 阻止绝对路径
4. 阻止路径遍历（包含 `..` 的路径）
5. 验证解压后的路径不会逃逸目标目录

### 使用方法

```typescript
import { createTarSecurityFilter } from '../utils/tarSecurityFilter.js'

await tar.extract({
  file: archivePath,
  cwd: targetPath,
  filter: createTarSecurityFilter({ cwd: targetPath })
} as any)
```

### 已更新的文件

以下文件已更新使用统一的安全过滤器：

- `server/src/modules/backup/BackupManager.ts`
- `server/src/modules/task/compressionWorker.ts`
- `server/src/modules/steamcmd/SteamCMDManager.ts`
- `server/src/modules/environment/javaManager.ts`
- `server/src/routes/files.ts`
- `server/src/modules/game/othergame/unified-functions.ts`
- `server/src/modules/game/othergame/factorio-deployer.ts`

## 影响说明

**阻止符号链接的影响**:
- 某些服务器包可能包含符号链接用于共享库或配置文件
- 这些链接在解压时会被忽略，可能需要手动创建
- 对于 GameServerManager3 的主要用途（游戏服务器部署），这通常不会造成问题

**推荐的后续行动**:
1. 监控 node-tar 7.5.4+ 版本的兼容性
2. 在条件允许时升级 node-tar 到安全版本
3. 对于需要符号链接的特定场景，可通过选项禁用符号链接阻止（不推荐）

## 参考资料

- [node-tar 安全公告](https://github.com/isaacs/node-tar/security)
- [macOS APFS Unicode 规范化](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/APFS_Guide/FAQ/FAQ.html)
