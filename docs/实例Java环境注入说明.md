# 实例 Java 环境注入说明

## 背景

实例类型中的「Java服务端/我的世界Java版」（`instanceType = minecraft-java`）以及带 Java 环境的一键开服实例，
都需要在启动时使用所选版本的 Java。

早期实现是**把所选 Java 的可执行文件路径拼进启动命令**，例如：

```text
& "C:\GSM3\data\environment\Java\java21\jdk-21.0.1\bin\java.exe" -jar server.jar nogui
```

这种做法的缺点是：

1. 只有「没有启动脚本、直接跑 jar」的场景才会用到所选 Java；
2. 工作目录里存在 `run.sh` / `start.sh` / `run.bat` / `start.bat` 时，面板会直接执行脚本，
   而脚本内部的 `java` 走的是系统 `PATH`，**所选 Java 版本被完全忽略**；
3. 命令里写死绝对路径，后期 Java 安装目录变化或迁移实例时需要手工改命令。

现在改为：**Java 版本不作为启动命令的一部分，而是在实例启动时注入到终端会话的环境变量中**。

## 实现方式

实例启动流程（`server/src/modules/instance/InstanceManager.ts`）：

1. 读取实例配置的 `javaVersion`，通过 `JavaManager` 找到对应的 `java` 可执行文件，
   解析出 `JAVA_HOME`（`bin` 的上级目录）与 `bin` 目录（`server/src/utils/javaRuntimeEnvironment.ts`）。
2. 创建 PTY 终端会话时，把 `JAVA_HOME`、`PATH`（java `bin` 前置）作为**终端级环境变量**传给会话，
   终端内后续手动输入的 `java` 命令也会命中所选版本。
3. 终端就绪后，先向终端写入一行环境变量设置命令，再写入真正的启动命令。因此启动脚本
   `run.sh` / `start.sh` / `run.bat` / `start.bat` 里的 `java` 一定是所选版本。

注入的一行命令按平台生成：

| 平台 | 终端 | 注入内容 |
| --- | --- | --- |
| Windows | `powershell.exe` | `$env:JAVA_HOME='...'; $env:PATH='...\bin;'+$env:PATH` |
| Linux / macOS | `/bin/bash --login` | `export JAVA_HOME='...'; export PATH='.../bin':"$PATH"` |

为什么必须写这一行，而不是只靠创建会话时的环境变量：

- Linux 默认命令是 `/bin/bash --login`，Debian/Ubuntu 的 `/etc/profile` 会重写 `PATH`；
- 使用「终端用户」提权时 `sudo` 的 `secure_path` 也会覆盖 `PATH`。

写入 shell 的一行是在这些初始化完成之后执行的，所以一定生效，且对启动脚本（子进程）继承有效。

路径中的空格、单引号都会按平台规则转义（PowerShell 单引号串用 `''`，POSIX shell 用 `'\''`），
避免目录名影响命令解析。

## 启动命令的变化

「Java服务端/我的世界Java版」实例启动时仍会自动检测启动文件：

| 工作目录内容 | 启动命令 |
| --- | --- |
| 有 `start.sh` / `run.sh`（Windows 为 `start.bat` / `run.bat` / `start.cmd` / `run.cmd`） | `./run.sh`（Windows 为 `.\run.bat`），java 由环境变量注入 |
| 只有 jar（优先含 `server` 的 jar） | `java -jar "xxx.jar" nogui`，不再拼接 Java 绝对路径 |

一键开服/游戏部署页面创建的 Minecraft、整合包实例，也会把所选 Java 版本保存为实例的
`javaVersion`（不再把路径替换进启动命令），因此 Forge/NeoForge 生成的 `bash run.sh`、
`.\run.bat` 同样能用上所选 Java。

## 回退与提示

- 实例未选择 Java 环境（`javaVersion` 为空）：不做任何注入，使用系统 `PATH` 中的 `java`，行为与之前一致。
- 已选择但环境未安装 / 正在安装 / 解析失败：服务端记录中文告警，并在实例终端输出一行提示
  （`[提示] 未找到可用的 Java 环境 xxx，本次启动将使用系统 PATH 中的 java`），启动流程继续，不会因此失败。
- 旧实例（`javaVersion` 为空、启动命令里已写死 Java 绝对路径）不受影响，仍按原命令启动。

## 相关界面

- 实例管理 - 创建/编辑实例：实例类型下拉项为「Java服务端/我的世界Java版」，
  其下的「Java环境」下拉即 `javaVersion`；带 Java 环境的一键开服实例在编辑时同样会显示该项，可修改或清空。
- 游戏部署 - 文件部署：实例类型同名选项，以及「Java 环境」下拉。
- 运行中的实例不允许修改配置，Java 环境改动在下次启动生效。

## 如何验证

1. 在实例管理中对「Java服务端/我的世界Java版」实例选择非默认 Java 并启动；
2. 打开该实例的终端，可以看到启动前注入的一行 `export` / `$env:` 命令；
3. 在终端执行 `java -version`，应显示所选 Java 版本；
4. 若工作目录中存在 `run.sh`，其内部 `java -jar ...` 会使用同一版本。

## 已知限制

- 「启用输出流转发（仅 Windows）」模式下实例程序由 `programPath` 直接拉起，
  不使用启动命令；该进程同样继承终端级环境变量，但程序本身若是脚本仍需自行处理。
- 注入依赖 PTY 终端能力；缺少 PTY 资产的架构（如未提供内置 PTY 的 riscv64）无法创建实例终端，
  实例启动本身也不可用，属于既有限制。