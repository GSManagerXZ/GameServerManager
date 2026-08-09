# Docker 终端 PTY 控制目录修复说明

## 问题现象

Docker 环境中创建终端时，服务端日志可能出现如下错误：

```text
PTY control directory unavailable platform=linux sessionId=<sessionId> stage=directory
```

该错误会导致终端 PTY 会话创建失败，页面无法正常打开交互式终端。

## 原因说明

终端 resize 控制通道会在 Linux 下创建一个仅当前进程用户可访问的私有控制目录。原先默认只尝试以下目录：

1. `data/terminal-control`
2. `server/data/terminal-control`

Docker 镜像中为了让面板和游戏服务端共享数据目录，运行时数据目录的父级可能被设置为组可写权限，例如 `775`。PTY 控制通道会对目录及父级路径做权限校验，组可写且非 sticky 的父目录会被判定为不安全，因此两个默认候选目录都可能失败。

## 修复方案

默认 POSIX 控制目录候选增加了临时目录兜底：

```text
<系统临时目录>/gsm3-terminal-control-<uid>
```

在常见 Linux/Docker 环境中该目录会解析为：

```text
/tmp/gsm3-terminal-control-0
```

服务端会自动创建该目录并设置为 `700` 权限。`/tmp` 是 sticky 目录，符合控制通道的父级路径安全校验，因此可以避免 Docker 数据卷权限导致的终端启动失败。

## 运维说明

- 该目录只保存终端控制通道运行期文件，不属于需要持久保存的业务数据。
- 服务重启后可自动重新创建，不需要手动维护。
- 若仍出现 `stage=directory`，新日志会携带 `reason=...`，可根据原因定位是权限、符号链接还是文件系统能力问题。

## 验证方式

重新构建并启动 Docker 容器后，在面板中创建终端：

1. 服务端不再出现 `PTY control directory unavailable`。
2. 终端会话可以正常创建。
3. 调整浏览器终端窗口大小时，终端 resize 控制通道可以继续工作。
