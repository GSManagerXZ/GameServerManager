# 终端真实 PTY Resize 设计

## 1. 目标与背景

GameServerManager 当前使用 `@xterm/xterm` 5.5.0 和 MCSManager/PTY。已确认 A 类错位的表现为：调整窗口、侧边栏、普通/全屏布局后，纯 ASCII 自动换行位置和光标逻辑位置错误，`vim`、`top`、`htop` 仍按旧尺寸绘制。

根因分为两部分：

1. `client/src/pages/TerminalPage.tsx` 中 Xterm 的 `cols/rows` 会随 fit 改变，但存在手工字符尺寸估算、无容器时 `100x30` 回退、多个初始化和 resize 路径、仅监听 `window.resize`、回执再次 fit 等问题。
2. `server/src/modules/terminal/TerminalManager.ts` 的 `resizeTerminal` 只向 PTY 包装进程发送 `SIGWINCH`。该信号不携带新尺寸，未修改真实 PTY winsize；服务端随后仍发送 `terminal-resized`，造成虚假成功语义。

本设计保留 Xterm 5.5.0，通过 FitAddon、ResizeObserver 和 MCSManager/PTY `-fifo` 控制协议，使浏览器尺寸、服务端记录和真实 PTY winsize 最终一致。

### 1.1 成功标准
- `stty size`、`tput cols`、`tput lines` 在容器停止变化后 500ms 内等于活动 Xterm 的最终 `rows/cols`。
- 纯 ASCII 长行、光标、`vim`、`top`、`htop` 在侧边栏、全屏和窗口拖动后正确重绘。
- 仅活动且处于 `ready` 的终端发送 input/resize。
- resize 只有一个前端 reporter 和一个服务端串行控制队列。
- `terminal-resized` 只表示控制帧写入成功，不表示上游已 ACK `SetSize`。
- 旧 PTY 不支持 `-fifo` 时明确失败，不回退到 `SIGWINCH`。
- Client 和 Server 分别通过 `npx tsc --noEmit`。

## 2. 范围与已知风险

### 2.1 本阶段范围
- 保留 Xterm 5.5.0，不升级、不替换终端库。
- 统一普通终端、实例附加终端、恢复会话的 Xterm 初始化。
- 容器挂载并得到合法 FitAddon 尺寸后才创建 PTY。
- 使用单一 ResizeObserver、callback ref、rAF fit 和单一 resize reporter。
- 固定前端状态机和资源清理规则。
- 新增每会话 PTY 控制端点，按 RESIZE 类型 4 写入真实尺寸。
- 固定现有 Socket.IO 事件名和错误来源。
- 增加原生 PTY 能力探测和旧二进制受控替换。
- 覆盖 Linux x64、Linux ARM64、Windows x64 原生运行。

### 2.2 明确非目标
- 不实现 hterm、ghostty-web 或其他 renderer。
- 不升级 Xterm、FitAddon、WebLinksAddon。
- 不做无关页面、WebSocket、实例管理或安全重构。
- 不新增 HTTP resize 接口。
- 不使用浏览器 `alert`、`confirm`、`prompt`。
- 不自动扫描和删除崩溃遗留 FIFO。

### 2.3 已知既有安全风险

当前 `PtySession` 不保存 owner/actor，Socket.IO 只有连接级 token 认证。任意已认证连接如果获得其他会话的 sessionId，现有代码可能允许其 input、resize、close 或 reconnect 该会话。

这是既有会话授权风险，本阶段不引入 owner/actor，也不扩大到所有终端操作的授权改造。本文不得得出“终端控制面已经安全”的结论。该问题必须作为后续独立安全任务处理。

## 3. 现有事件兼容合同

请求事件保持不变：
- `create-pty`
- `terminal-input`
- `terminal-resize`
- `close-pty`
- `reconnect-session`

服务端事件固定为：
- `pty-created`
- `pty-closed`
- `terminal-output`
- `terminal-resized`
- `terminal-error`
- `terminal-exit`
- `session-reconnected`
- `session-reconnect-failed`

前端删除不存在的 `terminal-created`、`terminal-closed` 监听，补齐真实事件类型。不新增任何同义事件。

### 3.1 唯一失败事件表

| 操作/结果 | 服务端事件 | 前端状态处理 |
| --- | --- | --- |
| create 失败 | `terminal-error`，`operation: 'create'` | `creating -> exited` |
| input 失败 | `terminal-error`，`operation: 'input'` | `ready -> exited`，失败输入不重放 |
| resize 失败 | `terminal-error`，`operation: 'resize'` | `ready -> exited`，清 pending/timer；后续 `terminal-exit` 幂等 |
| SIGKILL 后 1 秒仍未确认 close/exit | 一次 `terminal-error`，`operation: 'close'` | 保持 `closing`，清 `closeRequestInFlight`，等待用户重试 |
| reconnect 失败 | 仅 `session-reconnect-failed` | `reconnecting -> exited`；`closing -> disposed` |
| 非 closing 的活动进程主动/异常退出 | 仅 `terminal-exit` | 非 disposed 状态进入 `exited` |
| closing target 已确认进程 close/exit | 仅 `pty-closed` | `closing -> disposed` |
| 请求开始前 create attempt/session 已不存在 | 仅 `pty-closed` | `closing -> disposed` |
| resize 写入成功 | `terminal-resized` | 记录确认尺寸，不 fit、不回发 |

`CloseResult` 只属于真正的 close 调用：`closed`/`not-found` 发 `pty-closed`，`still-running` 发 close error。重复 sessionId 的 create 只发一次 create error，绝不调用 `closePty`、不发 `pty-closed`。reconnect 仅在 sessions/createAttempts 均无该 ID 时失败；辅助清理 warning 不改变 CloseResult。

## 4. 前端设计

### 4.1 数据所有权

React state 只保存：
```ts
interface TerminalTabMeta {
  id: string
  name: string
}

const [terminalTabs, setTerminalTabs] = useState<TerminalTabMeta[]>([])
const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
```

Xterm 和频繁变化状态只保存在 ref：
```ts
type TerminalState =
  | 'creating'
  | 'ready'
  | 'disconnected'
  | 'reconnecting'
  | 'closing'
  | 'exited'
  | 'disposed'

interface TerminalSize {
  cols: number
  rows: number
}

interface TerminalRuntime {
  terminal: Terminal
  fitAddon: FitAddon
  state: TerminalState
  createSize?: TerminalSize
  pendingSize?: TerminalSize
  lastWrittenSize?: TerminalSize
  lastReportedSize?: TerminalSize
  resizeTimer?: ReturnType<typeof setTimeout>
  closeRequestInFlight: boolean
  disposables: IDisposable[]
}

const runtimesRef = useRef(new Map<string, TerminalRuntime>())
```

不把 `Terminal`、`FitAddon`、timer 或 disposable 放入 React state。长期回调通过 `runtimesRef`、`activeSessionIdRef` 和 container ref 读取最新状态，消除 stale closure。

### 4.2 统一 factory

新增 `client/src/utils/terminalFactory.ts`：
```ts
function createTerminalView(options: TerminalViewOptions): {
  terminal: Terminal
  fitAddon: FitAddon
}
```

factory 只负责：
- 创建 Xterm，并加载 FitAddon 和 WebLinksAddon；
- 固定 `convertEol: true`、`disableStdin: false`、`cursorBlink: true`、`lineHeight: 1.2`；
- 固定桌面 `fontSize: 14`、`scrollback: 1000`，移动端 `fontSize: 12`、`scrollback: 500`；
- 将 `TerminalPage.tsx` 现有 theme 对象原样迁入 factory，不改变颜色。

三种初始化路径全部调用 factory。factory 不接收 `cols/rows`，不计算 `fontSize * 0.6`，不提供 `100x30` 或 Xterm 默认尺寸给后端。

### 4.3 callback ref 与单一 observer

普通布局和全屏布局的终端 `<div>` 使用同一个 callback ref：
```ts
const setTerminalContainer = useCallback((node: HTMLDivElement | null) => {
  // unobserve old -> set current -> ensureObserver -> attach active
  // -> observe new -> scheduleFit
}, [])
```

`ensureObserver()` 按需创建并返回全组件唯一的 `ResizeObserver`。callback ref 可能早于 effect 执行，因此收到非空节点后必须在 `observe` 前调用 `ensureObserver()`，不得假设 observer 已由 effect 创建。新节点处理顺序固定为：

1. 通过 `observerRef.current` unobserve 旧节点。
2. 保存新节点。
3. 调用 `ensureObserver()`。
4. 将活动 Xterm element 打开或移动到新节点。
5. observe 新节点并调用 `scheduleFit()`。

callback ref 收到 `null` 时只 unobserve 旧节点并清空引用；卸载时 `observerRef.current?.disconnect()`。callback ref、ResizeObserver、rAF 和 Socket 回调只通过 `observerRef`、`activeSessionIdRef`、`runtimesRef` 等 ref 读取最新对象，不捕获 render 时的 runtime 或活动 id。

ResizeObserver 回调只调用 `scheduleFit()`。`scheduleFit()` 取消旧 rAF，在下一帧只处理活动 runtime；容器 `clientWidth` 和 `clientHeight` 必须都大于零。

### 4.4 唯一尺寸测量规则

fit/create 前必须：

1. Xterm 已 `open` 到当前容器。
2. 容器宽高都大于零。
3. `fitAddon.proposeDimensions()` 返回非空值。
4. proposed `cols/rows` 通过与服务端相同的范围校验。
5. 执行 `fitAddon.fit()`。
6. 读取并再次校验 `terminal.cols/terminal.rows`。

任一步失败都不 create、不 resize；等待下次 callback ref、ResizeObserver 或显式 `scheduleFit()`。禁止用 Xterm 构造默认值代替实际容器尺寸。

统一尺寸范围：
```text
2 <= cols <= 1000
1 <= rows <= 1000
```

`SocketClient.createTerminal` 的 `cols`、`rows` 改为必填参数。普通创建和实例附加必须先得到合法 `createSize` 再发送 `create-pty`。恢复会话 runtime 初始为 `disconnected`，open/fit 后进入 `reconnecting` 并发送 `reconnect-session`；裸 connect 不发送 resize。

### 4.5 固定状态机

只有 `ready` 可发送 input/resize。非 `ready` 输入直接丢弃，不缓存、不重放。

所有 runtime 创建时 `closeRequestInFlight = false`。统一 `requestCloseIfIdle()` 仅在 Socket 已连接且该值为 false 时执行，并在 emit `close-pty` 前置为 true。

状态转换和动作固定如下：
- 收到 `pty-created`：仅 `creating -> ready` 并执行活动 fit/seed；若已 `closing`，不 fit，只调用一次 `requestCloseIfIdle()`。
- transport disconnect：非 closing 状态按原合同进入 disconnected 并清尺寸状态；closing 保持不变；两者都将 `closeRequestInFlight` 清为 false。
- transport connect：disconnected 进入 reconnecting；closing 保持 closing；都只发 `reconnect-session`，不直接 resize/close。
- 收到 `session-reconnected`：ready session 对应的 reconnecting 进入 ready 并 fit/seed；`close-retained` target 对应的 closing 保持 closing、不 fit，只调用一次 `requestCloseIfIdle()`。
- 只有服务端稳定复查 sessions/createAttempts 均无该 ID 才收 `session-reconnect-failed`：reconnecting 进入 exited；closing 清 close flag 后 disposed。
- 用户关闭 creating/ready：进入 closing，取消 timer/pending并调用 `requestCloseIfIdle()`；关闭 disconnected/reconnecting 时进入 closing，等待 reconnect 结果。
- 用户在 closing 再点击关闭：仅当 `closeRequestInFlight` 为 false 时调用 `requestCloseIfIdle()`；已有请求时不重复 emit。
- input/resize error 使 ready 进入 exited。close error 清 close flag、保持 closing，等待用户显式重试；不得用 timer 或 error handler 自动无限重试。
- 用户关闭 exited 时直接 disposed；`terminal-exit` 进入 exited并禁止 input/resize。
- 收到 `pty-closed` 时先清 close flag，再由 closing 进入 disposed 并释放全部资源。

### 4.6 单一 resize reporter

每个 runtime 只注册一次 `terminal.onResize`。项目中只有 reporter 可以调用 `socketClient.resizeTerminal`。

`terminal.onResize` 将合法尺寸写入 `pendingSize`，但只有同时满足以下条件才启动 50ms trailing timer：
- runtime.state 为 `ready`；
- runtime 是活动会话；
- Socket 已连接；
- 尺寸不同于 `lastWrittenSize`。

定时器触发时重新检查条件，发送最新 pending，更新 `lastWrittenSize`，清 pending。`pty-created` 和使 runtime 进入 ready 的 `session-reconnected` 才显式 seed；close-retained 对应的 closing 不 seed。

`terminal-resized` 只把 payload 写入 `lastReportedSize`。它不得调用 `fitAddon.fit()`、`terminal.resize()` 或 reporter。

切换活动会话时：移动目标 Xterm element、`scheduleFit()`、合法 fit 后显式 seed 当前尺寸并 flush。非活动 runtime 不 fit、不 resize。

### 4.7 前端清理与通知

close、exit、disconnect、unmount 都先清 timer/pending。runtime dispose 顺序：

1. 状态设为 `disposed`。
2. 清 timer。
3. dispose `onData`、`onResize` 等 disposables。
4. `terminal.dispose()`。
5. 从 `runtimesRef` 和 `terminalTabs` 删除。

页面卸载还必须取消 rAF、disconnect observer、移除 Socket/fullscreen/window 监听并 dispose 全部 runtime。

错误使用现有 `useNotificationStore().addNotification()`；相同 resize 错误使用稳定文本，依赖现有去重。不得使用浏览器对话框。

## 5. 服务端设计

### 5.1 共享尺寸验证

在 `server/src/utils/ptyControlChannel.ts` 导出：
```ts
interface PtySize {
  cols: number
  rows: number
}

function validatePtySize(cols: unknown, rows: unknown): PtySize
```

它要求 safe integer 且满足 `cols 2..1000`、`rows 1..1000`。create 和 resize 必须调用同一个 validator；非法值不截断。

`create-pty` 的服务端数据类型把 cols/rows 定为必填。create 在分配进程或端点前验证；resize 在查找并写通道前验证。

### 5.2 控制通道接口与队列

新增 `server/src/utils/ptyControlChannel.ts`，对 TerminalManager 暴露：
```ts
interface PtyControlChannel {
  readonly endpoint: string
  waitUntilReady(timeoutMs: number): Promise<void>
  enqueueResize(size: PtySize): Promise<'written' | 'skipped'>
  close(): Promise<void>
}
```

每个通道内部只有一个 in-flight frame、一个 latest pending resize、一个 lastWrittenSize、一个关闭标志，以及当前通道产生但尚未 settle 的 resize Promise 集合。

规则：

1. 空闲时立即写入；写入中只保留 latest pending。被覆盖或重复请求返回 `skipped`。
2. 完整 frame 的 write callback 成功才返回 `written`；当前写入完成后只写最终 pending。
3. `close()` 首先原子设置关闭标志；此后所有 `enqueueResize` 立即返回 `skipped`，已有 pending 也返回 `skipped`。
4. `close()` 立即 destroy 当前 writer，使无法继续完成的 in-flight write 尽快回调；由主动 close 导致的 callback error 归一为 `skipped`，不产生 resize error。
5. `close()` 等待该通道全部已有 resize Promise settle 后才 resolve。TerminalManager 必须先 `await channel.close()`，因此 `pty-closed` 必然晚于全部相关 resize Promise settle。
6. 只有 `written` 且会话复核通过才发送 `terminal-resized`。非主动写失败才抛错；TerminalManager 发送一次 `terminal-error operation=resize`，关闭该 PTY，随后由进程退出发送 `terminal-exit`。

### 5.3 精确 RESIZE 协议

帧格式固定为：
```text
1 byte  type = 4
2 bytes UTF-8 JSON byte length，uint16 big-endian
N bytes compact UTF-8 JSON
```

JSON 固定为：
```json
{"width":120,"height":40}
```

编码使用 `JSON.stringify({ width: cols, height: rows })`、`Buffer.byteLength`、`writeUInt8(4, 0)`、`writeUInt16BE(length, 1)`，不附加换行。

`120x40` JSON 长度是 25 字节，frame 前三个字节必须为：
```text
04 00 19
```

上游没有成功 ACK，且当前控制实现丢弃错误响应。因此 `terminal-resized` 仅表示 GameServerManager 已把完整 frame 写入 OS 管道，不表示 `SetSize` 已被上游确认。

### 5.4 POSIX FIFO 与 Windows Named Pipe

Linux FIFO 放在项目数据目录：
```ts
const candidates = [
  path.join(process.cwd(), 'data', 'terminal-control'),
  path.join(process.cwd(), 'server', 'data', 'terminal-control'),
]
```

沿用项目多路径选择规则。目录创建后显式 `chmod 0700`。每个 endpoint 名使用至少 128-bit `crypto.randomBytes`，sessionId 不进入路径。

POSIX ready 必须同时满足：

1. FIFO 路径已出现；
2. `lstat` 确认是 FIFO 且不是 symlink；
3. 显式 `chmod 0600` 成功；
4. writer 成功打开。

任一条件在 3 秒内未满足则 create attempt 失败。只有进程已确认退出的 close/error/cleanup 才尝试删除该会话自己的 FIFO；未确认退出时保留，本阶段不扫描历史残留。

Windows endpoint 固定形态：
```text
\\.\pipe\gsm3-pty-<128-bit-random-hex>
```

依赖随机不可预测名称和 MCSManager/PTY 创建 Named Pipe 时的系统默认 DACL。Node 客户端不声明也不尝试收紧 Pipe ACL。ready 条件是 3 秒内成功连接。

endpoint 不发送到浏览器，不进入普通 info/debug 日志；仅允许安全审计日志记录平台、sessionId 和失败阶段，不记录完整 endpoint。

### 5.5 PTY 固定资产、下载与原生 probe

协议历史与 binary 身份分开记录：`v1.5.1` commit `418a696cd04de09dd366db70f6d275ab77d43422` 的源码已有 `-fifo` 和 RESIZE 类型 4，但该 release 无 binary assets。实际资产固定为 2026-03-16 release ID `297277624`，其构建源码身份记录为 commit `09fc369dfa278504831260de2771d7cbd98d01c4`；mutable tag、tag URL 和 commit 下载 URL 均不参与资产选择。

| 平台 | asset ID | name | size | SHA-256 digest |
| --- | ---: | --- | ---: | --- |
| Linux x64 | `374651721` | `pty_linux_x64` | `2654360` | `bbdfc8a5d0f57493e78c64bca56d370524c068c1d4d31cac653458a843d47f72` |
| Linux ARM64 | `374651727` | `pty_linux_arm64` | `2752664` | `48d8496997053b60eb84d2b02f4ec751298c7f214c615b08aca43309739ebf83` |
| Windows x64 | `374651714` | `pty_win32_x64.exe` | `3627520` | `fe35c154e623707d0dd2b728f41fd200bd3ead0a8cda8eb216b1e5e3e3ab2d40` |

本地 binary 必须先按当前平台 manifest 校验 basename、精确 size 和 SHA-256；三项完全匹配才允许执行 `<current-native-pty> -h`。任何一项不匹配都直接替换，即使该文件的 probe 输出包含 `-fifo`；不支持 custom/unmanaged binary。原生 probe timeout 3 秒，stdout+stderr 合计上限 64 KiB，输出必须含字面量 `-fifo`，结果按进程和 binary path 缓存为 Promise。匹配 manifest 但 probe 失败时标记 capability unavailable。

下载合同固定为两步：

1. GET `https://api.github.com/repos/MCSManager/PTY/releases/297277624`，使用 `Accept: application/vnd.github+json`，确认 release ID，并从 JSON 中找到与 manifest 的 asset ID、name、size 完全一致的唯一 asset。
2. GET `https://api.github.com/repos/MCSManager/PTY/releases/assets/<asset-id>`，使用 `Accept: application/octet-stream`，流式写入目标同目录临时文件。

两步都设置固定 `User-Agent: GameServerManager-PTY-Installer` 和 `X-GitHub-Api-Version: 2022-11-28`，最多跟随 5 次重定向；若使用 Authorization，只向 `api.github.com` 发送，跨 host 重定向必须剥离。下载最多接收 manifest size 字节，超限立即终止；落盘后再次验证 basename 对应的 manifest name、精确 size 和 SHA-256，POSIX 设置可执行权限。当前 OS/arch 文件再通过原生 probe 后才以同目录 `rename` 原子替换；清 probe 缓存并对最终路径复验。异架构文件在构建机只校验 name/size/hash，不执行。任一步失败都删除临时文件、保留旧文件并拒绝 create，不回退 `SIGWINCH`。

`server/src/utils/ptyManager.ts`、`scripts/package.js`、`Dockerfile`、`install-gsm3.sh` 必须使用同一固定 manifest、release JSON 校验和 asset API 下载合同；任何入口都不得使用 `releases/download/latest`。

### 5.6 create attempt、重复 ID 拒绝与 reconnect

`type CreateAttemptPhase = 'starting' | 'fallback' | 'closing' | 'close-retained'`。每个 attempt 保存 phase、cancellation token、createSize、process、endpoint、socket、持久化所需引用和 `closePromise?: Promise<CloseResult>`；control ready 前不加入 sessions。close 超时必须把 phase 设为 `close-retained` 并原对象留在 createAttempts，保留全部引用及 single-flight slot，重试期间再填充 closePromise。

`createPty` 完成 payload/尺寸验证后，在一个无 await 的同步临界段依次检查 `sessions.has(sessionId)` 与 `createAttempts.has(sessionId)`：任一存在即只发一次 create error 并 return；两者均不存在则立即把初始 attempt 预占进 createAttempts，之后才允许任何异步准备或 spawn。create 路径绝不调用 `closePty`、不消费 CloseResult、不覆盖旧引用，也不发送 `pty-closed`。

调用方若要替换终端，必须先独立 close，收到 `pty-closed` 后生成新的 sessionId 再 create；不支持同 ID 自动替换。

新 attempt 使用随机 endpoint spawn primary，参数含唯一 createSize、`-size cols,rows` 和 `-fifo endpoint`。fallback 仅在已配置 default user、无显式 command、primary 1000ms 内 code 0 三条件同时满足时使用；候选 primary 同时等待 control ready 与稳定窗口，fallback 复用 createSize 但换新 endpoint。成功只发一次 `pty-created`，全部启动失败只发一次 create error；进程确认退出才清引用，超时进入 close-retained。

create attempt 内退出不发 `terminal-exit`。creating close 只有确认退出或请求前 attempt 已不存在才发 `pty-closed`；4 秒仍存活返回 still-running。disconnect 取消但不发终态事件。

`reconnectSession` 对 closing 客户端先检查 ready sessions，再检查 phase=`close-retained` 的 createAttempts；命中任一目标都更新其 socket 并发 `session-reconnected`，前端保持 closing 后调用 `requestCloseIfIdle()`。若发现仍在 closing 转换中的 attempt，await 其 single-flight 后重新检查；只有稳定复查两个 map 都无该 ID 才发 `session-reconnect-failed`。

### 5.7 确定的 async 签名和调用顺序

TerminalManager 签名固定为：
```ts
type CloseResult = 'closed' | 'not-found' | 'still-running'

public async resizeTerminal(
  socket: Socket,
  data: TerminalResizeData
): Promise<void>

public async closePty(
  socket: Socket,
  data: { sessionId: string }
): Promise<CloseResult>

public async cleanup(): Promise<void>
```

`resizeTerminal` 顺序：验证尺寸 -> 查找 ready session 并保存 control channel identity -> `await enqueueResize` -> 重新按 sessionId 查找，确认仍是同一 session、状态仍为 ready、channel identity 未变化 -> 仅在结果为 written 时更新尺寸并向请求 socket 发 `terminal-resized`。复核失败静默结束，避免 close/recreate 后的迟到回执。非主动 resize 失败只发一次 resize error；会话仍存在时 `await terminateSession(session, { intentional: false })`，由 process close handler 发 `terminal-exit`。

每个 target 保存 `closePromise?: Promise<CloseResult>`。`closePty` 开始时若 sessions/createAttempts 均无目标，发一次 `pty-closed` 并返回 `not-found`；已有 closePromise 则 await 并返回同一结果，不重复信号/事件。owner 标记 closing/cancel token，关闭 channel/stdin，SIGTERM 最多 3 秒、必要时 SIGKILL 最多 1 秒。

确认 close/exit 后，幂等 finalizer 删除引用并尝试清 endpoint/持久化记录，发一次 `pty-closed` 并返回 `closed`。超时则 session 留在原 map；create attempt 设为 `close-retained`，owner 发一次 close error、清 closePromise 并返回 `still-running`。进程以后退出仍执行 finalizer；辅助清理 warning 不改变返回值。

`cleanup()` 禁止新 create/input/resize，取消全部 attempts，并为每个 target 加入已有或创建新的 single-flight 3+1 秒有界任务，必须一次 `await Promise.allSettled([...attemptTasks, ...sessionTasks])`。已退出者执行无事件 finalizer；still-running 记 error/critical、保留引用到 15 秒强制退出，cleanup 有界返回。

全仓调用点必须逐项改造：真正的 close Socket handler await 后可忽略 CloseResult；create handler 只执行同步 map 检查与预占，禁止调用 `closePty`；InstanceManager 只有 `closed | not-found` 且复查目标不存在才标记 stopped；timer/stream-forward/inactive cleanup 均 await、allSettled 或显式消费异常，禁止裸丢 Promise。

`gracefulShutdown` 设置 15 秒强制退出 timer。`settle(name, cleanup)` 捕获同步/异步异常、记录 manager 名并总是 resolve；按实际顺序逐个 `await settle`：instanceManager、terminalManager、gameManager、systemManager、fileWatchManager，记录 steamcmdManager 无 cleanup，再执行 schedulerManager、pluginManager。整个 manager 段放在 try；finally 中也通过 settle 销毁 sockets，并用 `Promise.allSettled` 执行 Socket.IO 与 HTTP server close，保证任何 manager reject 都不能跳过网络关闭。成功后清 timer 并退出 0；signal handler 的顶层 `.catch(...)` 只作为意外逃逸的最后防线。

## 6. 端到端时序

### 6.1 新建
```text
callback ref 获得容器
-> open Xterm
-> proposeDimensions 合法
-> fit
-> createSize 合法
-> create-pty（cols/rows 必填）
-> primary/fallback create attempt
-> control ready
-> pty-created
-> 前端 ready
-> 活动会话 fit + seed pending + reporter flush
```

### 6.2 布局变化
```text
ResizeObserver
-> rAF scheduleFit
-> 活动 ready runtime fit
-> terminal.onResize
-> 50ms reporter
-> terminal-resize
-> validatePtySize
-> control queue
-> RESIZE frame
-> terminal-resized
-> 前端只记录，不 fit
```

### 6.3 断线重连
```text
disconnect -> ready 等状态进入 disconnected；closing 保持 closing并清 close flag
connect -> 只发 reconnect-session
服务端 -> 查 ready sessions，再查 close-retained createAttempts
session-reconnected -> reconnecting 进入 ready 并 fit/seed
                    -> closing 保持 closing并 requestCloseIfIdle
两个 map 均无目标 -> session-reconnect-failed -> exited/disposed
```

reconnect 不创建新 target，不改变 retained phase；人工 close 重试继续复用同一 target 和前后端 single-flight。

## 7. 验证计划

### 7.1 静态检查
```bash
cd client && npx tsc --noEmit
cd server && npx tsc --noEmit
```

两条命令都必须退出码 0。

### 7.2 协议与队列
- 编码 `120x40`，JSON 必须是 `{"width":120,"height":40}`，frame 头为 `04 00 19`。
- 阻塞 writer 并每 40ms enqueue，确认最多一个 in-flight 和一个 latest pending；解除后只有最终尺寸 written。
- close 期间 pending、后续 enqueue 和主动 destroy 导致的 callback error 都返回 skipped，不产生 resize error。
- `close()` 必须晚于全部相关 resize Promise settle 才 resolve，`pty-closed` 更晚；不得出现迟到 resize error/回执。
- enqueue written 后替换或关闭 session，确认 identity/ready 复核阻止 `terminal-resized`；只有仍有效的 written 产生回执。

### 7.3 浏览器与 PTY

Linux 终端执行：
```bash
stty size
tput cols
tput lines
python3 -c 'print("0123456789" * 30)'
```

通过条件：
- 每次停止调整容器后 500ms 内，`stty size` 与活动 Xterm 最终 rows/cols 一致。
- ASCII 长行在当前列边界换行，光标无偏移。
- `vim`、`top`、已安装时的 `htop` 在侧边栏、普通/全屏切换和窗口拖动后完整重绘。
- 普通/全屏节点替换时 callback ref 先 unobserve 旧节点，再 observe 新节点并完成一次 fit。
- 非活动会话不发送 resize；切换为活动后 500ms 内同步。

快速 resize 测试：连续 1 秒、每 40ms 改变容器尺寸。最后一次变化后 500ms 内：
- `stty size` 等于最终尺寸；
- 没有回退到中间值；
- 没有 `terminal-resized -> fit -> terminal-resize` 循环；
- 前端只保留一个 timer，服务端只保留一个 pending。

### 7.4 状态机、关闭与 shutdown

逐项验证：
- runtime 初始化 close flag=false；发送前置 true；close error、pty-closed、disconnect 都清 false。
- closing 再点击仅在无 in-flight 时重发；迟到 created/reconnected 各最多触发一次，不存在 timer/error 自动重试循环。
- 并发 close 只运行一次信号序列并返回同一 CloseResult；closed/not-found/still-running 分别符合事件表。
- creating close 注入 SIGKILL 超时：attempt 进入 close-retained，断线重连收到 reconnected 而不 disposed，人工重试命中同一 process/endpoint。
- sessions 或 createAttempts 已有同 ID 时，create 只发一次 create error；断言 `closePty` 未调用、无 `pty-closed`，旧 target 完全不变。
- 两个并发同 ID create 只能一个同步预占并进入 spawn，另一个只收 create error，不得双创建。
- 人工 close 重试仍受 single-flight 门控；替换流程必须等待 `pty-closed` 后用新 sessionId create，不测试或支持同 ID 自动重建。
- 超时后进程退出只发一次 `pty-closed`；辅助清理失败只记 warning，不改变 `closed`。
- `cleanup()` 对全部 attempts/sessions 同时启动任务并 `Promise.allSettled`；单任务 4 秒有界，未退出者记 critical、保留引用并返回。
- 任一 manager cleanup reject 时后续 manager 仍按序执行，finally 仍销毁 sockets 并关闭 Socket.IO/HTTP；正常流程不触发 15 秒强制退出。
- fallback 三条件、1000ms 窗口和 cancellation token 仍只产生一个最终 create 结果。

### 7.5 固定资产与平台原生验收
- 对三项 manifest 逐一核对 release/asset ID、name、size、SHA-256；伪造“支持 `-fifo` 但 hash 错误”的文件，确认未 probe 即被替换或拒绝。
- 模拟 release JSON tuple 不匹配、超过 5 次重定向、跨 host Authorization、下载超限和落盘 hash 错误，均必须安全失败；跨 host 请求不得携带 Authorization。
- `ptyManager.ts`、`scripts/package.js`、`Dockerfile`、`install-gsm3.sh` 均不得含 `releases/download/latest`，并使用同一固定 metadata。
- Linux x64、Linux ARM64、Windows x64 分别在原生主机/容器执行 probe、FIFO/Named Pipe 和完整交互；Windows 用 `[Console]::WindowWidth/WindowHeight` 检查尺寸。
- 构建机对异架构文件只校验 name/size/hash，不执行；原生验收机必须执行 probe。

永久保留本节的可重复验收步骤。实现期间创建的临时协议、诊断或故障注入测试代码在成功后删除，遵守 `AGENTS.md`。

## 8. 落地、回滚与文件

### 8.1 落地顺序

1. 在 `ptyManager.ts` 固定三平台 manifest，实现 manifest-first 校验、release JSON/asset API 两步下载、落盘复验、原生 probe 和原子替换。
2. 将 `scripts/package.js`、`Dockerfile`、`install-gsm3.sh` 固定到相同 asset ID、size、hash 和下载合同，移除所有 `releases/download/latest`。
3. 实现 `ptyControlChannel.ts` 和真实 PTY resize 协议。
4. 将 TerminalManager create 改为同步重复 ID 拒绝/预占；CloseResult 仅用于 close，并完成 fallback/resize/cleanup 合同。
5. 更新全部 Socket、TerminalManager 内部 timer/cleanup、InstanceManager 和 gracefulShutdown 调用点。
6. 实现前端 factory、Map runtime、状态机、observer/reporter，以及 close 完成后生成新 sessionId 的调用方合同。
7. 对齐事件类型并执行全部原生平台验收。

### 8.2 回滚
- 前端可单独回滚，服务端事件名保持兼容；旧前端可能重复 fit，但真实 PTY resize 仍有效。
- 服务端或 PTY binary 回滚时必须同时回滚前端；新前端配旧服务端会重新出现真实 winsize 不同步。
- 不提供 `SIGWINCH` 运行时降级开关。
- 固定版本替换失败时保留旧文件，但 terminal capability 标记不可用并明确拒绝 create。

### 8.3 涉及文件

前端：
- `client/src/pages/TerminalPage.tsx`（等待 `pty-closed` 后用新 sessionId 创建）
- `client/src/utils/terminalFactory.ts`（新增）
- `client/src/utils/socket.ts`
- `client/src/types/index.ts`

服务端：
- `server/src/utils/ptyControlChannel.ts`（新增）
- `server/src/utils/ptyManager.ts`
- `server/src/modules/terminal/TerminalManager.ts`（同步重复 ID 拒绝/预占，CloseResult 仅用于 close）
- `server/src/modules/instance/InstanceManager.ts`
- `server/src/index.ts`
- `.gitignore`（忽略正常运行产生的 terminal-control 内容）

分发/构建：
- `scripts/package.js`
- `Dockerfile`
- `install-gsm3.sh`

不修改 Xterm 版本或 client lockfile。

## 9. 验收清单与剩余风险

验收必须全部满足：
- [ ] 三条 Xterm 初始化路径共用 factory，factory 只返回 `{ terminal, fitAddon }`，且统一 `convertEol: true`。
- [ ] React state 只保存 tab meta 和 active id，runtime 全部在 Map ref。
- [ ] 普通/全屏容器共用 callback ref，observer 只创建一次。
- [ ] proposeDimensions、容器尺寸和统一 validator 全部通过后才 fit/create。
- [ ] 固定状态机和事件表已实现，只有 ready 可 input/resize，close flag 的置位/清除完整。
- [ ] closing 人工重试受 in-flight 门控，无自动无限重试；disconnect/reconnect seed 行为符合设计。
- [ ] `terminal.onResize` reporter 是唯一 emit 路径，create/resize 共用 validator。
- [ ] fallback 三条件、1000ms 窗口和 cancellation token 已实现，每个 attempt 只有一个最终事件。
- [ ] 每会话控制端点随机且不泄露；队列 close 等全部 resize settle，written 回执经过 identity/ready 复核。
- [ ] `closePty` 返回 CloseResult，同 target 并发调用共享同一结果和事件。
- [ ] close 超时的 create attempt 进入 close-retained 并保留全部引用；reconnect 可重新绑定 socket。
- [ ] create 同步检查两个 map 并立即预占；重复 ID 只发 create error，不调用 close、不发 `pty-closed`。
- [ ] 调用方先 close 并等待 `pty-closed`，随后使用新 sessionId create；无同 ID 自动替换。
- [ ] cleanup 并行 allSettled、有界返回并保留未退出引用。
- [ ] 15 秒 graceful shutdown 使用逐 manager settle，网络销毁/关闭始终位于 finally。
- [ ] 所列 TerminalManager、Socket handler、InstanceManager 调用点全部 await 或显式消费异常。
- [ ] 四个分发/运行入口固定 manifest 和两步 API 合同；三平台原生验收通过。
- [ ] 两端 TypeScript 检查通过，临时测试代码已删除。

实现后仍明确存在以下风险：

1. 会话没有 owner/actor 授权；这是后续独立安全任务。
2. 上游没有成功 ACK，`terminal-resized` 只能证明 OS 管道写入成功；最终效果依赖 500ms 内的 PTY 行为验收。
3. 本阶段不扫描崩溃残留 FIFO；正常流程只在确认进程退出后清理，未确认退出的 endpoint/引用会保留到最终强制退出。
