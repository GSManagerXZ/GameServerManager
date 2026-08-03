# Terminal Real PTY Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make browser Xterm dimensions, server-side session state, and the native MCSManager/PTY winsize converge after creation, reconnect, sidebar changes, fullscreen changes, and rapid container resizing.

**Architecture:** Use one fixed PTY asset manifest and shared CLI-backed installer contract; create one random FIFO or Named Pipe control channel per PTY; serialize RESIZE type `4` frames through a latest-wins queue; manage creation, close, reconnect, and retained processes with explicit server-side state; keep Xterm runtimes in a frontend `Map` ref and drive one active terminal through a callback ref, one `ResizeObserver`, one rAF fit scheduler, and one resize reporter.

**Tech Stack:** Node.js `>=18`, TypeScript 5.9, Axios 1.14, Socket.IO 4.8, React 18.3, Zustand 4.5, `@xterm/xterm` 5.5, FitAddon 0.10, WebLinksAddon 0.11, Jest/ts-jest, Vitest, Docker, Bash, POSIX FIFO, Windows Named Pipe.

**Global Constraints:** Execute every implementation, review, and verification task through the configured secondary model slot. The approved design has no unresolved blocking questions, so no further explore-agent investigation is required before implementation. Do not upgrade Xterm or existing dependencies, do not add an HTTP resize API, do not add a `SIGWINCH` fallback, do not add owner/actor authorization in this scope, and do not expose control endpoints to browsers or normal logs. Store runtime data under the existing `data/...` and `server/data/...` candidate paths. Use only existing panel notifications and styled interactions. Temporary tests and diagnostics must be deleted after passing. Run client and server `npx tsc --noEmit` before delivery. Every proposed `git commit` requires fresh, commit-specific user confirmation at execution time; approval of this plan or any earlier commit is not authorization for a later commit.

## File Structure and Responsibilities

### New files

- `server/src/utils/ptyAssets.ts`
  - Canonical release ID, build commit, asset tuples, integrity validation, two-step GitHub API download, redirect policy, native `-fifo` probe, and atomic replacement.
- `server/src/utils/ptyAssetCli.ts`
  - Thin compiled CLI used by packaging, Docker, and the installation script so those paths reuse the same manifest and download implementation.
- `server/src/utils/ptyControlChannel.ts`
  - Shared size validator, RESIZE frame encoder, latest-wins write queue, POSIX FIFO transport, Windows Named Pipe transport, and confirmed-exit endpoint cleanup.
- `client/src/utils/terminalFactory.ts`
  - The single Xterm/FitAddon/WebLinksAddon factory with the existing theme and desktop/mobile options.

### Modified runtime files

- `server/src/utils/ptyManager.ts`
  - Resolve candidate paths and ensure that only a manifest-valid, native-probed PTY can be returned.
- `server/src/modules/terminal/TerminalManager.ts`
  - Add create-attempt reservation, per-session control channels, real resize, single-flight close, retained targets, reconnect, and bounded cleanup.
- `server/src/modules/instance/InstanceManager.ts`
  - Await close results and only mark instances stopped after confirmed target removal.
- `server/src/index.ts`
  - Await terminal Socket handlers and implement ordered, isolated, 15-second graceful shutdown.
- `client/src/pages/TerminalPage.tsx`
  - Replace duplicated Xterm instances and resize paths with runtime refs, callback ref attachment, observer-driven fitting, state-machine events, and single-flight close.
- `client/src/utils/socket.ts`
  - Require create dimensions and expose typed terminal request methods.
- `client/src/types/index.ts`
  - Replace nonexistent terminal events with the actual event payload contract.
- `.gitignore`
  - Ignore normal `data/terminal-control/` and `server/data/terminal-control/` contents.

### Modified distribution and documentation files

- `scripts/package.js`
  - Invoke the compiled PTY asset CLI for the selected fixed assets.
- `Dockerfile`
  - Validate or install the current native asset through the same CLI.
- `install-gsm3.sh`
  - Use the bundled Node runtime and CLI instead of a mutable direct URL.
- `docs/PTY集成说明.md`
  - Document fixed assets, integrity checks, native probe, and the control channel.
- `docs/Docker构建说明.md`
  - Remove obsolete mutable PTY URL guidance and document the fixed installer path.

### Temporary files that must not remain

- `server/src/__tests__/pty-assets.tmp.test.ts`
- `scripts/.tmp-verify-pty-distribution.cjs`
- `server/src/__tests__/pty-control-channel.tmp.test.ts`
- `server/src/__tests__/pty-control-platform.tmp.test.ts`
- `server/src/__tests__/terminal-create-attempt.tmp.test.ts`
- `server/src/__tests__/terminal-resize.tmp.test.ts`
- `server/src/__tests__/terminal-close.tmp.test.ts`
- `server/src/__tests__/terminal-call-sites.tmp.test.ts`
- `client/src/pages/TerminalPage.resize.tmp.test.ts`
- `client/src/pages/TerminalPage.state.tmp.test.ts`

---

### Task 1: Add the canonical PTY manifest, downloader, probe, and runtime manager

**Files**

- Create: `server/src/utils/ptyAssets.ts`
- Create: `server/src/utils/ptyAssetCli.ts`
- Modify: `server/src/utils/ptyManager.ts`
- Modify: `server/src/modules/terminal/TerminalManager.ts`
- Temporary: `server/src/__tests__/pty-assets.tmp.test.ts`

**Interfaces**

```ts
export type PtyAssetKey =
  | 'linux-x64'
  | 'linux-arm64'
  | 'win32-x64'

export interface PtyAsset {
  key: PtyAssetKey
  platform: 'linux' | 'win32'
  arch: 'x64' | 'arm64'
  assetId: number
  name: string
  size: number
  sha256: string
}

export interface EnsurePtyAssetOptions {
  asset: PtyAsset
  targetDir: string
  token?: string
  logger?: {
    info(message: string): void
    warn(message: string): void
    error(message: string): void
  }
}

export function getPtyAsset(
  platform?: NodeJS.Platform,
  arch?: string
): PtyAsset

export async function verifyPtyAsset(
  filePath: string,
  asset: PtyAsset
): Promise<boolean>

export async function probePtyAsset(
  filePath: string,
  asset: PtyAsset
): Promise<void>

export async function ensurePtyAsset(
  options: EnsurePtyAssetOptions
): Promise<string>
```

CLI contract:

```text
node ptyAssetCli.js ensure --asset <linux-x64|linux-arm64|win32-x64> --target-dir <directory>
```

**Steps**

- [ ] Create `server/src/__tests__/pty-assets.tmp.test.ts` with assertions for the exact release metadata, platform mapping, exact-size/hash validation, and the rule that a hash-mismatched file is rejected before the probe function is called.

- [ ] Run the new test before implementation:

  ```bash
  cd /root/github_projects/GameServerManager/server
  npx jest --runInBand src/__tests__/pty-assets.tmp.test.ts
  ```

  Expected result: non-zero exit because `../utils/ptyAssets.js` does not yet exist.

- [ ] Add the canonical constants to `server/src/utils/ptyAssets.ts` exactly as follows:

  ```ts
  export const PTY_RELEASE_ID = 297277624
  export const PTY_BUILD_COMMIT =
    '09fc369dfa278504831260de2771d7cbd98d01c4'

  export const PTY_ASSETS: Record<PtyAssetKey, PtyAsset> = {
    'linux-x64': {
      key: 'linux-x64',
      platform: 'linux',
      arch: 'x64',
      assetId: 374651721,
      name: 'pty_linux_x64',
      size: 2654360,
      sha256: 'bbdfc8a5d0f57493e78c64bca56d370524c068c1d4d31cac653458a843d47f72'
    },
    'linux-arm64': {
      key: 'linux-arm64',
      platform: 'linux',
      arch: 'arm64',
      assetId: 374651727,
      name: 'pty_linux_arm64',
      size: 2752664,
      sha256: '48d8496997053b60eb84d2b02f4ec751298c7f214c615b08aca43309739ebf83'
    },
    'win32-x64': {
      key: 'win32-x64',
      platform: 'win32',
      arch: 'x64',
      assetId: 374651714,
      name: 'pty_win32_x64.exe',
      size: 3627520,
      sha256: 'fe35c154e623707d0dd2b728f41fd200bd3ead0a8cda8eb216b1e5e3e3ab2d40'
    }
  }
  ```

- [ ] Implement `getPtyAsset()` so only Linux x64, Linux ARM64, and Windows x64 resolve. Unsupported platform/architecture combinations must throw before filesystem or network work begins.

- [ ] Implement `verifyPtyAsset()` using `path.basename`, exact `stat.size`, and streamed SHA-256. Do not accept an otherwise executable file with the wrong basename, size, or digest.

- [ ] Implement a process-and-path keyed probe cache:

  ```ts
  const probeCache = new Map<string, Promise<void>>()
  ```

  Run `<current-native-pty> -h`, enforce a 3-second timeout, cap combined stdout/stderr at 64 KiB, and require the literal text `-fifo`. Do not execute cross-architecture assets.

- [ ] Implement the release metadata request:

  ```text
  GET https://api.github.com/repos/MCSManager/PTY/releases/297277624
  Accept: application/vnd.github+json
  User-Agent: GameServerManager-PTY-Installer
  X-GitHub-Api-Version: 2022-11-28
  ```

  Require `release.id === 297277624` and exactly one asset matching the manifest asset ID, name, and size.

- [ ] Implement the asset request:

  ```text
  GET https://api.github.com/repos/MCSManager/PTY/releases/assets/<asset-id>
  Accept: application/octet-stream
  User-Agent: GameServerManager-PTY-Installer
  X-GitHub-Api-Version: 2022-11-28
  ```

  Set `maxRedirects: 5`. If `Authorization` is configured, send it only to `api.github.com`; remove it in `beforeRedirect` whenever the destination hostname differs.

- [ ] Stream the asset into a randomly named temporary file in the target directory. Count bytes while streaming, abort immediately above the manifest size, then verify basename mapping, exact size, and SHA-256.

- [ ] On POSIX, apply mode `0755`. If the downloaded asset is native, probe the temporary file before replacement. Then use same-directory `rename`, clear the old and final-path probe cache entries, and verify/probe the final path again.

- [ ] Ensure all failure branches remove only the temporary file. Preserve an existing target file, but do not return or execute it when it is invalid or lacks `-fifo`.

- [ ] Add `server/src/utils/ptyAssetCli.ts` as a strict argument parser around `ensurePtyAsset()`. Reject unknown commands, missing arguments, unknown asset keys, and non-directory target arguments with exit code `1`; never print tokens or full redirect headers.

- [ ] Refactor `PtyManager` to preserve the existing candidate order:

  ```ts
  const candidates = [
    path.join(process.cwd(), 'data', 'lib'),
    path.join(process.cwd(), 'server', 'data', 'lib')
  ]
  ```

  The first existing candidate must pass manifest validation and native probe or be replaced there. If no candidate exists, install into the first writable candidate.

- [ ] Remove `PtyManager.DOWNLOAD_URL`, the zero-byte-only check, and the “file exists means installed” behavior. `getPtyPath()` must return only a verified and native-probed path.

- [ ] In `TerminalManager.initialize()`, remove the fallback that constructs an unchecked `data/lib/<name>` path. Leave `ptyPath` empty and log capability unavailability when `getPtyPath()` fails; later `createPty` calls must emit an explicit create error instead of spawning an unchecked file.

- [ ] Run the temporary tests again:

  ```bash
  cd /root/github_projects/GameServerManager/server
  npx jest --runInBand src/__tests__/pty-assets.tmp.test.ts
  ```

  Expected result: exit code `0`; all manifest, validation, and probe-order tests pass.

- [ ] Delete `server/src/__tests__/pty-assets.tmp.test.ts`.

- [ ] Run the server type check:

  ```bash
  cd /root/github_projects/GameServerManager/server
  npx tsc --noEmit
  ```

  Expected result: exit code `0`.

- [ ] Confirm the runtime manager no longer references a mutable PTY URL:

  ```bash
  cd /root/github_projects/GameServerManager
  if grep -n 'MCSManager/PTY.*latest' server/src/utils/ptyManager.ts; then exit 1; fi
  ```

  Expected result: no output and exit code `0`.

- [ ] Review the Task 1 diff. Before committing, obtain fresh user confirmation specifically for this commit; plan approval and prior confirmations do not count. Only after confirmation run:

  ```bash
  git add \
    server/src/utils/ptyAssets.ts \
    server/src/utils/ptyAssetCli.ts \
    server/src/utils/ptyManager.ts \
    server/src/modules/terminal/TerminalManager.ts
  git commit -m "feat: pin and verify PTY runtime assets"
  ```

  Expected result: one commit containing no temporary test file.

---

### Task 2: Route packaging, Docker, and installation through the fixed asset contract

**Files**

- Modify: `scripts/package.js`
- Modify: `Dockerfile`
- Modify: `install-gsm3.sh`
- Modify: `docs/PTY集成说明.md`
- Modify: `docs/Docker构建说明.md`
- Temporary: `scripts/.tmp-verify-pty-distribution.cjs`

**Interfaces**

Package asset selection:

```js
function getPtyAssetKeys(platform) {
  if (platform === 'linux') return ['linux-x64', 'linux-arm64']
  if (platform === 'windows') return ['win32-x64']
  return ['linux-x64', 'linux-arm64', 'win32-x64']
}
```

CLI invocations:

```text
node <package>/server/utils/ptyAssetCli.js ensure --asset linux-x64 --target-dir <package>/data/lib
node <package>/server/utils/ptyAssetCli.js ensure --asset linux-arm64 --target-dir <package>/data/lib
node <package>/server/utils/ptyAssetCli.js ensure --asset win32-x64 --target-dir <package>/data/lib
```

**Steps**

- [ ] Create `scripts/.tmp-verify-pty-distribution.cjs`. Make it read `server/src/utils/ptyManager.ts`, `scripts/package.js`, `Dockerfile`, and `install-gsm3.sh`; fail if any contains a PTY `latest` URL or if the three distribution paths do not invoke `ptyAssetCli.js`.

- [ ] Run the diagnostic before edits:

  ```bash
  cd /root/github_projects/GameServerManager
  node scripts/.tmp-verify-pty-distribution.cjs
  ```

  Expected result: non-zero exit identifying mutable PTY URLs in `scripts/package.js`, `Dockerfile`, and `install-gsm3.sh`.

- [ ] In `scripts/package.js`, import `execFileSync` alongside `execSync` and replace `PTY_GITHUB_URL`, PTY filename loops, and direct `downloadFile()` calls with `getPtyAssetKeys()` plus the compiled CLI.

- [ ] Invoke the CLI only after `package/server` has been copied and its production dependencies have been installed:

  ```js
  execFileSync(process.execPath, [
    path.join(packageDir, 'server', 'utils', 'ptyAssetCli.js'),
    'ensure',
    '--asset', assetKey,
    '--target-dir', libDir
  ], { stdio: 'inherit' })
  ```

  This avoids adding Axios to the root package because the CLI resolves Axios from `package/server/node_modules`.

- [ ] Make a PTY verification/download failure fail the package operation instead of producing a package that claims to contain PTY. Preserve the existing non-PTY Zip-Tools and 7z behavior.

- [ ] Replace the Docker PTY `wget` block with an architecture-to-key mapping and the packaged CLI:

  ```dockerfile
  RUN if [ "$TARGETARCH" = "amd64" ]; then \
        PTY_ASSET="linux-x64"; \
      elif [ "$TARGETARCH" = "arm64" ]; then \
        PTY_ASSET="linux-arm64"; \
      else \
        echo "不支持的 PTY 架构: $TARGETARCH" >&2; exit 1; \
      fi && \
      node /root/server/utils/ptyAssetCli.js ensure \
        --asset "$PTY_ASSET" \
        --target-dir /root/server/data/lib
  ```

  The Docker build must fail if the current native asset cannot be verified or probed.

- [ ] Replace the direct PTY download block in `install-gsm3.sh`. Map `uname -m` to `linux-x64` or `linux-arm64`, then invoke:

  ```bash
  "$install_path/node/bin/node" \
    "$install_path/server/utils/ptyAssetCli.js" ensure \
    --asset "$PTY_ASSET" \
    --target-dir "$install_path/data/lib"
  ```

  The bundled Node binary is already available after extraction and chmod. If this operation fails, print that terminal creation will remain unavailable until runtime verification succeeds; do not restore a mutable URL.

- [ ] Update `docs/PTY集成说明.md` with release ID `297277624`, build commit `09fc369dfa278504831260de2771d7cbd98d01c4`, all three asset IDs/names/sizes/hashes, the two-step API request, exact integrity verification, native `-fifo` probe, and the no-custom-binary rule.

- [ ] Update `docs/Docker构建说明.md` so it no longer recommends `releases/download/latest`. Document that the final image invokes the bundled `ptyAssetCli.js`, probes only the native image architecture, and rejects unverifiable PTY files.

- [ ] Run syntax checks:

  ```bash
  cd /root/github_projects/GameServerManager
  node --check scripts/package.js
  bash -n install-gsm3.sh
  ```

  Expected result: both commands are silent and exit `0`.

- [ ] Run the distribution diagnostic again:

  ```bash
  cd /root/github_projects/GameServerManager
  node scripts/.tmp-verify-pty-distribution.cjs
  ```

  Expected result: exit code `0`.

- [ ] Delete `scripts/.tmp-verify-pty-distribution.cjs`.

- [ ] Run the fixed-entry grep:

  ```bash
  cd /root/github_projects/GameServerManager
  if grep -n 'MCSManager/PTY.*latest' \
    server/src/utils/ptyManager.ts \
    scripts/package.js \
    Dockerfile \
    install-gsm3.sh; then
    exit 1
  fi
  ```

  Expected result: no output and exit code `0`.

- [ ] Run the server type check because the compiled CLI is part of the server build:

  ```bash
  cd /root/github_projects/GameServerManager/server
  npx tsc --noEmit
  ```

  Expected result: exit code `0`.

- [ ] Review the Task 2 diff. Before committing, obtain fresh user confirmation specifically for this commit; no earlier authorization applies. Only after confirmation run:

  ```bash
  git add \
    scripts/package.js \
    Dockerfile \
    install-gsm3.sh \
    docs/PTY集成说明.md \
    docs/Docker构建说明.md
  git commit -m "build: use fixed PTY assets across distribution"
  ```

  Expected result: one commit without the temporary diagnostic script.

---

### Task 3: Implement size validation, RESIZE framing, and the serialized latest-wins queue

**Files**

- Create: `server/src/utils/ptyControlChannel.ts`
- Temporary: `server/src/__tests__/pty-control-channel.tmp.test.ts`

**Interfaces**

```ts
export interface PtySize {
  cols: number
  rows: number
}

export interface PtyControlChannel {
  readonly endpoint: string
  waitUntilReady(timeoutMs: number): Promise<void>
  enqueueResize(size: PtySize): Promise<'written' | 'skipped'>
  close(): Promise<void>
}

export function validatePtySize(
  cols: unknown,
  rows: unknown
): PtySize

export function encodePtyResizeFrame(size: PtySize): Buffer
```

Internal transport boundary:

```ts
interface PtyControlWriter {
  write(
    frame: Buffer,
    callback: (error?: Error | null) => void
  ): boolean
  destroy(error?: Error): void
}

interface PtyControlTransport {
  waitUntilReady(timeoutMs: number): Promise<PtyControlWriter>
  destroyWriter(): void
  close(): Promise<void>
}
```

**Steps**

- [ ] Create `server/src/__tests__/pty-control-channel.tmp.test.ts` with a fake callback-driven writer. Cover validator boundaries, exact `120x40` bytes, one in-flight write, one latest pending write, overwritten requests returning `skipped`, duplicate requests returning `skipped`, and close waiting for all returned promises.

- [ ] Use this exact frame assertion:

  ```ts
  const frame = encodePtyResizeFrame({ cols: 120, rows: 40 })
  expect(frame.subarray(0, 3)).toEqual(Buffer.from([0x04, 0x00, 0x19]))
  expect(frame.subarray(3).toString('utf8'))
    .toBe('{"width":120,"height":40}')
  ```

- [ ] Run the test before implementation:

  ```bash
  cd /root/github_projects/GameServerManager/server
  npx jest --runInBand src/__tests__/pty-control-channel.tmp.test.ts
  ```

  Expected result: non-zero exit because the module is missing.

- [ ] Implement `validatePtySize()` with `Number.isSafeInteger`. Accept only `2 <= cols <= 1000` and `1 <= rows <= 1000`; throw on strings, floats, NaN, Infinity, or out-of-range values. Do not clamp.

- [ ] Implement `encodePtyResizeFrame()` using:

  ```ts
  const payload = Buffer.from(
    JSON.stringify({ width: size.cols, height: size.rows }),
    'utf8'
  )
  const frame = Buffer.allocUnsafe(3 + payload.length)
  frame.writeUInt8(4, 0)
  frame.writeUInt16BE(payload.length, 1)
  payload.copy(frame, 3)
  ```

  Reject a payload above `0xffff` even though the current validator makes that impossible.

- [ ] Implement queue state containing exactly one current write, one latest pending request, `lastWrittenSize`, a closed flag, and a `Set<Promise<...>>` or equivalent collection of unsettled resize operations.

- [ ] When idle, write immediately. Resolve `written` only from a successful full-frame write callback. While a write is active, keep only the newest distinct pending size and resolve the superseded pending request as `skipped`.

- [ ] Treat a request equal to `lastWrittenSize`, the current in-flight size, or the already-pending size as `skipped`.

- [ ] Implement `close()` so it atomically marks the queue closed, resolves pending and future requests as `skipped`, destroys the active writer, maps destruction-caused write errors to `skipped`, and waits for every resize promise created before close to settle.

- [ ] Preserve non-close write errors as rejected promises so `TerminalManager` can emit one resize error and terminate the affected session.

- [ ] Run the temporary test:

  ```bash
  cd /root/github_projects/GameServerManager/server
  npx jest --runInBand src/__tests__/pty-control-channel.tmp.test.ts
  ```

  Expected result: exit code `0`, including the `04 00 19` assertion and latest-pending behavior.

- [ ] Delete `server/src/__tests__/pty-control-channel.tmp.test.ts`.

- [ ] Run the server type check:

  ```bash
  cd /root/github_projects/GameServerManager/server
  npx tsc --noEmit
  ```

  Expected result: exit code `0`.

- [ ] Review the Task 3 diff. Obtain new user confirmation specifically for this commit before running it; current plan approval is insufficient. After confirmation run:

  ```bash
  git add server/src/utils/ptyControlChannel.ts
  git commit -m "feat: encode and serialize PTY resize frames"
  ```

  Expected result: one commit without the temporary queue test.

---

### Task 4: Add secure POSIX FIFO and Windows Named Pipe transports

**Files**

- Modify: `server/src/utils/ptyControlChannel.ts`
- Modify: `.gitignore`
- Temporary: `server/src/__tests__/pty-control-platform.tmp.test.ts`

**Interfaces**

```ts
export interface CreatePtyControlChannelOptions {
  sessionId: string
  logger: {
    debug(message: string): void
    warn(message: string): void
    error(message: string): void
  }
  platform?: NodeJS.Platform
  directoryCandidates?: string[]
}

export async function createPtyControlChannel(
  options: CreatePtyControlChannelOptions
): Promise<PtyControlChannel>

export async function removePtyControlEndpoint(
  endpoint: string,
  platform?: NodeJS.Platform
): Promise<void>
```

**Steps**

- [ ] Add the production POSIX candidates exactly in this order:

  ```ts
  const candidates = [
    path.join(process.cwd(), 'data', 'terminal-control'),
    path.join(process.cwd(), 'server', 'data', 'terminal-control')
  ]
  ```

- [ ] Select the first creatable directory, call `chmod(directory, 0o700)`, and generate each endpoint with at least `randomBytes(16).toString('hex')`. Do not put `sessionId` in the path.

- [ ] Generate Windows endpoints in this form:

  ```ts
  `\\\\.\\pipe\\gsm3-pty-${randomBytes(16).toString('hex')}`
  ```

  Do not attempt custom pipe ACL configuration; rely on the upstream pipe server’s default DACL as specified.

- [ ] Implement POSIX `waitUntilReady(timeoutMs)` as a bounded sequence: wait for the path, `lstat`, reject symlinks and non-FIFO entries, `chmod 0600`, then open a persistent write stream. Every stage must observe the same timeout and closed flag.

- [ ] Implement Windows readiness using `net.createConnection(endpoint)`. Resolve only after the connection event; reject on timeout, connection error, or channel close.

- [ ] Ensure readiness timeout or cancellation destroys any partial writer but does not unlink the endpoint while the PTY process may still be running.

- [ ] Implement `removePtyControlEndpoint()` as a confirmed-exit-only helper. On POSIX, re-check with `lstat`, refuse to follow symlinks, and unlink only a FIFO. On Windows, return without filesystem work.

- [ ] Restrict logs to platform, `sessionId`, and a failure-stage label such as `directory`, `lstat`, `chmod`, `open`, or `connect`. Never log the complete endpoint.

- [ ] Add these ignore entries:

  ```gitignore
  data/terminal-control/
  server/data/terminal-control/
  ```

- [ ] Create `server/src/__tests__/pty-control-platform.tmp.test.ts`. On Linux, use an injected temporary directory, create the returned endpoint with `mkfifo`, open a reader, verify readiness and one frame, verify missing FIFO timeout, verify symlink rejection, verify `close()` does not unlink, and verify explicit `removePtyControlEndpoint()` does unlink after simulated process exit.

- [ ] Run the platform test:

  ```bash
  cd /root/github_projects/GameServerManager/server
  npx jest --runInBand src/__tests__/pty-control-platform.tmp.test.ts
  ```

  Expected result on Linux: exit code `0`. If run on Windows, skip only the POSIX cases and execute a native Named Pipe connection case instead.

- [ ] Delete `server/src/__tests__/pty-control-platform.tmp.test.ts`.

- [ ] Run the server type check:

  ```bash
  cd /root/github_projects/GameServerManager/server
  npx tsc --noEmit
  ```

  Expected result: exit code `0`.

- [ ] Review the Task 4 diff. Obtain new user confirmation for this exact commit before committing; do not reuse prior approval. After confirmation run:

  ```bash
  git add server/src/utils/ptyControlChannel.ts .gitignore
  git commit -m "feat: add native PTY control transports"
  ```

  Expected result: one commit with no temporary platform test.

---

### Task 5: Add create-attempt reservation, control readiness, and deterministic fallback

**Files**

- Modify: `server/src/modules/terminal/TerminalManager.ts`
- Temporary: `server/src/__tests__/terminal-create-attempt.tmp.test.ts`

**Interfaces**

```ts
type CreateAttemptPhase =
  | 'starting'
  | 'fallback'
  | 'closing'
  | 'close-retained'

interface CreateCancellationToken {
  cancelled: boolean
}

interface CreateAttempt {
  id: string
  phase: CreateAttemptPhase
  cancellation: CreateCancellationToken
  createSize: PtySize
  process?: ChildProcess
  control?: PtyControlChannel
  endpoint?: string
  socket: Socket
  closePromise?: Promise<CloseResult>
  processExited: boolean
  finalEventSent: boolean
  // Existing name, cwd, output, persistence, stream-forward,
  // redactor, runtime option, and callback references.
}

interface PtySession {
  // Existing fields.
  state: 'ready' | 'closing'
  size: PtySize
  control: PtyControlChannel
  endpoint: string
  closePromise?: Promise<CloseResult>
  processExited: boolean
  finalEventSent: boolean
}

export interface TerminalManagerDependencies {
  spawnPty?: typeof spawn
  createControlChannel?: typeof createPtyControlChannel
}
```

Existing constructor remains source-compatible:

```ts
constructor(
  io: SocketIOServer,
  logger: winston.Logger,
  configManager: ConfigManager,
  dependencies: TerminalManagerDependencies = {}
)
```

**Steps**

- [ ] Create `server/src/__tests__/terminal-create-attempt.tmp.test.ts` with fake sockets, fake child processes, and deferred control readiness. Assert that two same-ID `createPty()` calls result in one spawn and one create error, with no `closePty()` call and no `pty-closed`.

- [ ] Add a test proving `pty-created` is not emitted until the channel readiness promise resolves.

- [ ] Add a fallback test proving the fallback occurs only when all three conditions are true: no explicit `runtimeOptions.command`, a configured non-empty default user, and primary exit code `0` within 1000ms. Assert that fallback uses the original measured size and a new endpoint.

- [ ] Run the tests before refactoring:

  ```bash
  cd /root/github_projects/GameServerManager/server
  npx jest --runInBand src/__tests__/terminal-create-attempt.tmp.test.ts
  ```

  Expected result: non-zero exit because the current implementation closes and replaces duplicate IDs, emits before control readiness, and uses fallback size `100x30`.

- [ ] Add:

  ```ts
  private createAttempts = new Map<string, CreateAttempt>()
  private acceptingTerminalOperations = true
  ```

- [ ] Make `CreatePtyData.cols` and `CreatePtyData.rows` required. At the beginning of `createPty()`, synchronously validate the payload, resolve the working directory, validate stream-forward arguments, and call `validatePtySize()` before allocating a process or endpoint.

- [ ] Add the no-await reservation block:

  ```ts
  if (
    this.sessions.has(sessionId) ||
    this.createAttempts.has(sessionId)
  ) {
    this.emitTerminalError(socket, sessionId, 'create', '会话ID已存在')
    return
  }

  const attempt = this.createAttemptRecord(/* validated data */)
  this.createAttempts.set(sessionId, attempt)
  ```

  There must be no `await` between either map check and `set()`.

- [ ] Remove the existing duplicate-ID call to `closePty()`. A duplicate create must emit exactly one `terminal-error` with `operation: 'create'`, leave the existing target untouched, and never emit `pty-closed`.

- [ ] Reject create immediately with `operation: 'create'` when `acceptingTerminalOperations` is false or `ptyPath` is empty.

- [ ] Move asynchronous directory permission changes, user lookup, `sudo`/`su` lookup, endpoint preparation, and spawn work after reservation. Every continuation must check both the cancellation token and map identity before mutating state or emitting.

- [ ] For each primary candidate, create a fresh channel before spawn and append:

  ```ts
  '-size', `${attempt.createSize.cols},${attempt.createSize.rows}`,
  '-fifo', control.endpoint
  ```

- [ ] Register process output and close handlers by resolving the current owner from `sessions` or `createAttempts` using both `sessionId` and process identity. Do not capture a stale copied owner that can survive promotion or replacement.

- [ ] Wait concurrently for control readiness and the primary 1000ms stability window. If the process exits before stability, classify it using the exact fallback conditions. Any non-fallback early exit becomes one create failure.

- [ ] Before fallback, close the primary channel, confirm that the primary process exited, and remove only its confirmed-exit FIFO. Set `phase = 'fallback'`, generate a new channel/endpoint, reuse `createSize`, and start `/bin/bash --login` without a user switch.

- [ ] Remove the fallback `'-size', '100,30'`. The fallback must use:

  ```ts
  '-size', `${attempt.createSize.cols},${attempt.createSize.rows}`
  ```

- [ ] Promote only if the process is still alive, control is ready, the attempt remains the same map object, and cancellation is false. Move ownership to `sessions`, set `state: 'ready'`, and emit exactly one `pty-created`.

- [ ] Start stream forwarding and the initial carriage return only after promotion. Preserve the existing output redaction and runtime callbacks.

- [ ] Ensure a process exit while still in `createAttempts` never emits `terminal-exit`. It may trigger fallback or a single create error, then performs confirmed-exit cleanup.

- [ ] Run the create-attempt tests:

  ```bash
  cd /root/github_projects/GameServerManager/server
  npx jest --runInBand src/__tests__/terminal-create-attempt.tmp.test.ts
  ```

  Expected result: exit code `0`; duplicate reservation, delayed `pty-created`, fallback conditions, original size reuse, and new endpoint checks pass.

- [ ] Delete `server/src/__tests__/terminal-create-attempt.tmp.test.ts`.

- [ ] Run the server type check:

  ```bash
  cd /root/github_projects/GameServerManager/server
  npx tsc --noEmit
  ```

  Expected result: exit code `0`.

- [ ] Review the Task 5 diff. Obtain fresh confirmation for this commit before executing it; no previous approval applies. After confirmation run:

  ```bash
  git add server/src/modules/terminal/TerminalManager.ts
  git commit -m "feat: reserve PTY creation attempts safely"
  ```

  Expected result: one commit without the temporary create-attempt test.

---

### Task 6: Replace fake SIGWINCH resize with control-channel writes

**Files**

- Modify: `server/src/modules/terminal/TerminalManager.ts`
- Temporary: `server/src/__tests__/terminal-resize.tmp.test.ts`

**Interfaces**

```ts
interface TerminalResizeData {
  sessionId: string
  cols: number
  rows: number
}

public async resizeTerminal(
  socket: Socket,
  data: TerminalResizeData
): Promise<void>
```

Error payload:

```ts
interface TerminalErrorPayload {
  sessionId: string
  operation: 'create' | 'input' | 'resize' | 'close'
  error: string
}
```

**Steps**

- [ ] Create `server/src/__tests__/terminal-resize.tmp.test.ts`. Inject a fake control channel and verify validator rejection, `skipped` producing no event, `written` producing one event, write failure producing one resize error, and a session/channel identity change during the awaited write suppressing the late acknowledgement.

- [ ] Run the test before implementation:

  ```bash
  cd /root/github_projects/GameServerManager/server
  npx jest --runInBand src/__tests__/terminal-resize.tmp.test.ts
  ```

  Expected result: non-zero exit because `resizeTerminal()` is synchronous and only sends `SIGWINCH`.

- [ ] Change `resizeTerminal()` to `async`. Validate `cols/rows` first with `validatePtySize()` and emit `terminal-error` with `operation: 'resize'` on invalid data.

- [ ] Look up a `ready` session only. Save both the session object and control channel object before awaiting:

  ```ts
  const session = this.sessions.get(sessionId)
  if (!session || session.state !== 'ready') return

  const control = session.control
  const result = await control.enqueueResize(size)
  ```

- [ ] After `await`, re-read `sessions.get(sessionId)` and require all of the following:
  - The object is the same `session`.
  - Its state is still `ready`.
  - Its control channel is still the same `control`.
  - The queue result is `written`.

- [ ] Only after that identity check, update `session.size` and `lastActivity`, then emit to the requesting socket:

  ```ts
  socket.emit('terminal-resized', {
    sessionId,
    cols: size.cols,
    rows: size.rows
  })
  ```

- [ ] For `skipped`, closed-channel cancellation, or failed identity checks, return silently without `terminal-resized`.

- [ ] On a non-close write error, emit one stable `terminal-error` with `operation: 'resize'`. If the same ready session still exists, terminate it with `intentional: false`; its process close handler must emit `terminal-exit`, not `pty-closed`.

- [ ] Remove all `SIGWINCH` calls and comments claiming that signals resize the native PTY. Do not add a fallback signal path.

- [ ] Update input handling so only `session.state === 'ready'` accepts input. Missing or unusable stdin must emit `operation: 'input'`; failed input is not queued or replayed.

- [ ] Run the resize tests:

  ```bash
  cd /root/github_projects/GameServerManager/server
  npx jest --runInBand src/__tests__/terminal-resize.tmp.test.ts
  ```

  Expected result: exit code `0`, including the delayed identity replacement case.

- [ ] Delete `server/src/__tests__/terminal-resize.tmp.test.ts`.

- [ ] Confirm no resize signal fallback remains:

  ```bash
  cd /root/github_projects/GameServerManager
  if grep -n 'SIGWINCH' server/src/modules/terminal/TerminalManager.ts; then
    exit 1
  fi
  ```

  Expected result: no output and exit code `0`.

- [ ] Run the server type check:

  ```bash
  cd /root/github_projects/GameServerManager/server
  npx tsc --noEmit
  ```

  Expected result: exit code `0`.

- [ ] Review the Task 6 diff. Obtain fresh, commit-specific confirmation before committing; prior permission is not reusable. After confirmation run:

  ```bash
  git add server/src/modules/terminal/TerminalManager.ts
  git commit -m "feat: write real PTY resize control frames"
  ```

  Expected result: one commit without the temporary resize test.

---

### Task 7: Implement single-flight close, retained targets, reconnect, and bounded cleanup

**Files**

- Modify: `server/src/modules/terminal/TerminalManager.ts`
- Temporary: `server/src/__tests__/terminal-close.tmp.test.ts`

**Interfaces**

```ts
export type CloseResult =
  | 'closed'
  | 'not-found'
  | 'still-running'

public async closePty(
  socket: Socket,
  data: { sessionId: string }
): Promise<CloseResult>

public async reconnectSession(
  socket: Socket,
  sessionId: string
): Promise<boolean>

public hasTarget(sessionId: string): boolean

public async cleanup(): Promise<void>
```

**Steps**

- [ ] Create `server/src/__tests__/terminal-close.tmp.test.ts` using fake child processes and fake timers. Assert that concurrent closes share one signal sequence, one result, and one event.

- [ ] Add cases for:
  - Missing target returns `not-found` and emits one `pty-closed`.
  - Exit after SIGTERM returns `closed`.
  - Exit after SIGKILL returns `closed`.
  - No exit after 3+1 seconds returns `still-running`, emits one close error, and preserves the target.
  - A retained create attempt reconnects to the latest socket.
  - A late process exit after timeout emits `pty-closed` once and removes the retained target.
  - Endpoint cleanup failure logs a warning but does not change `closed`.

- [ ] Run the tests before implementation:

  ```bash
  cd /root/github_projects/GameServerManager/server
  npx jest --runInBand src/__tests__/terminal-close.tmp.test.ts
  ```

  Expected result: non-zero exit because the current close is synchronous, deletes immediately, and emits success before process exit.

- [ ] Implement a target lookup that checks `sessions` first and `createAttempts` second. If both are absent, emit one `pty-closed` and return `not-found`.

- [ ] Before the first await, reuse or install the target’s single-flight promise:

  ```ts
  if (target.closePromise) {
    return target.closePromise
  }

  const closePromise = this.closeTarget(target, socket)
  target.closePromise = closePromise
  return closePromise
  ```

- [ ] On close start, set a ready session to `state = 'closing'`, or a create attempt to `phase = 'closing'`; set the cancellation token before closing the channel or process stdin.

- [ ] Call and await `control.close()` before emitting a terminal close result. This guarantees all prior resize promises settle before `pty-closed`.

- [ ] End PTY stdin, terminate the stream-forward child with isolated warning handling, send PTY `SIGTERM`, and wait up to 3000ms for actual `close`/`exit`. Do not use `ChildProcess.killed` as proof of exit.

- [ ] If still alive, send `SIGKILL` and wait another 1000ms. Use the process close event or explicit tracked `processExited` state as confirmation.

- [ ] Add an idempotent finalizer that:
  - Confirms the map still owns the same target.
  - Removes it from the correct map.
  - Removes the persistence record.
  - Calls `removePtyControlEndpoint()` only after process exit.
  - Emits exactly one final event when events are enabled.
  - Never changes `CloseResult` because persistence or endpoint cleanup failed.

- [ ] For confirmed intentional close, emit `pty-closed` and return `closed`. For confirmed non-intentional session exit, emit only `terminal-exit`. An attempt that exits before promotion must never emit `terminal-exit`.

- [ ] On timeout, leave a session in `sessions` with `state = 'closing'`. Leave an attempt in `createAttempts`, change its phase to `close-retained`, preserve process/control/endpoint/socket/cancellation references, clear `closePromise`, emit one `terminal-error` with `operation: 'close'`, and return `still-running`.

- [ ] Ensure a later process close invokes the same finalizer and emits at most one `pty-closed`. Do not clear the map merely because a kill signal was accepted.

- [ ] Convert `reconnectSession()` to async. Check ready or closing sessions first, then `phase === 'close-retained'` attempts. On a match, update the stored socket and return `true`.

- [ ] If a create attempt is currently transitioning through `closing` and has a `closePromise`, await that promise and restart the lookup. Return `false` only after a stable recheck confirms both maps contain no matching ID.

- [ ] Update `handleDisconnect()` so ready sessions remain owned and are marked disconnected. Cancel owned `starting` or `fallback` attempts and explicitly consume their bounded termination promise without emitting a terminal final event. Preserve retained references when termination times out.

- [ ] Update the delayed stream-forward auto-close call and disabled inactive cleanup path to use `void closePty(...).catch(...)`, `await`, or `Promise.allSettled`; no Promise may be dropped.

- [ ] Implement `cleanup()` by first setting `acceptingTerminalOperations = false`, stopping terminal process monitoring, cancelling every attempt, and collecting all unique attempt/session close tasks before awaiting.

- [ ] Use one parallel barrier:

  ```ts
  await Promise.allSettled([
    ...attemptTasks,
    ...sessionTasks
  ])
  ```

  Each target remains bounded by the 3-second SIGTERM plus 1-second SIGKILL waits. Finalize confirmed exits without emitting client events; log `error` or `critical` for still-running targets and retain their references for the process-wide 15-second shutdown deadline.

- [ ] Do not call `sessions.clear()` or `createAttempts.clear()` during cleanup. Confirmed finalizers remove owned entries individually; unconfirmed targets remain represented.

- [ ] Run the close tests:

  ```bash
  cd /root/github_projects/GameServerManager/server
  npx jest --runInBand src/__tests__/terminal-close.tmp.test.ts
  ```

  Expected result: exit code `0`; all three `CloseResult` values, retention, reconnect, finalizer idempotence, and single-flight cases pass.

- [ ] Delete `server/src/__tests__/terminal-close.tmp.test.ts`.

- [ ] Run the server type check:

  ```bash
  cd /root/github_projects/GameServerManager/server
  npx tsc --noEmit
  ```

  Expected result: exit code `0`.

- [ ] Review the Task 7 diff. Obtain fresh user confirmation for this exact commit before running it; earlier authorizations do not apply. After confirmation run:

  ```bash
  git add server/src/modules/terminal/TerminalManager.ts
  git commit -m "feat: make terminal closure single flight"
  ```

  Expected result: one commit without the temporary close test.

---

### Task 8: Await all server call sites and make graceful shutdown fault-isolated

**Files**

- Modify: `server/src/index.ts`
- Modify: `server/src/modules/instance/InstanceManager.ts`
- Modify: `server/src/modules/terminal/TerminalManager.ts`
- Modify: `server/src/routes/gameDeployment.ts`
- Temporary: `server/src/__tests__/terminal-call-sites.tmp.test.ts`

**Interfaces**

```ts
type SettledCleanup = () => void | Promise<void>

async function settle(
  name: string,
  cleanup: SettledCleanup
): Promise<void>
```

Instance close contract:

```ts
public async closeTerminal(id: string): Promise<boolean>
```

**Steps**

- [ ] Create `server/src/__tests__/terminal-call-sites.tmp.test.ts` as a temporary source-contract diagnostic. Assert that the terminal resize, close, and reconnect Socket handlers await their manager methods; both `InstanceManager.closePty()` sites consume the result; and shutdown uses a 15000ms deadline plus sequential `settle()` calls.

- [ ] Run the diagnostic before edits:

  ```bash
  cd /root/github_projects/GameServerManager/server
  npx jest --runInBand src/__tests__/terminal-call-sites.tmp.test.ts
  ```

  Expected result: non-zero exit listing the currently unawaited handlers and instance close calls.

- [ ] Convert the Socket.IO handlers in `server/src/index.ts`:

  ```ts
  socket.on('terminal-resize', async data => {
    await terminalManager.resizeTerminal(socket, data)
  })

  socket.on('close-pty', async data => {
    await terminalManager.closePty(socket, data)
  })

  socket.on('reconnect-session', async data => {
    const success = await terminalManager.reconnectSession(
      socket,
      data.sessionId
    )
    socket.emit(
      success ? 'session-reconnected' : 'session-reconnect-failed',
      { sessionId: data.sessionId }
    )
  })
  ```

  Wrap unexpected handler failures with logging so Socket.IO callbacks do not create unhandled rejections.

- [ ] Keep `create-pty` awaiting `createPty()`. Verify that it only maps `cwd` to `workingDirectory`; it must not close or replace an existing ID.

- [ ] In the 10-second `InstanceManager.stopInstance()` timer, use an async IIFE whose rejection is explicitly caught. Await `closePty()` and only clear instance status, PID, and terminal ID when the result is `closed` or `not-found` and `terminalManager.hasTarget(sessionId)` is false.

- [ ] If the forced stop returns `still-running`, keep the instance in `stopping`, preserve `terminalSessionId`, and log that manual retry is required.

- [ ] In `InstanceManager.closeTerminal()`, await `closePty()`. Return `false` and preserve ownership fields for `still-running`; only mark `stopped` after `closed | not-found` plus the no-target recheck.

- [ ] Keep `TerminalManager.hasSession()` as the ready-session check used by deployment code, and add `hasTarget()` for session-or-attempt lifecycle checks.

- [ ] In `server/src/routes/gameDeployment.ts`, retain `await terminalManager.createPty(...)` and replace the arbitrary post-create one-second wait with an immediate `hasSession()` check after the awaited method returns.

- [ ] Update every internal `closePty()` call in `TerminalManager`, including stream-forward timeout and inactive cleanup, so it is awaited, collected by `Promise.allSettled`, or explicitly consumed with `void ...catch(...)`.

- [ ] Convert `gracefulShutdown()` to `async`, retain the `shuttingDown` guard, and create the 15-second forced-exit timer immediately after setting the guard.

- [ ] Implement `settle(name, cleanup)` so it catches both synchronous throws and rejected promises, logs the manager name, and always resolves.

- [ ] Await managers sequentially in this exact order:

  ```text
  instanceManager
  terminalManager
  gameManager
  systemManager
  fileWatchManager
  steamcmdManager log-only step
  schedulerManager
  pluginManager
  ```

- [ ] Put the manager sequence inside `try`. In `finally`, use `settle()` to destroy every tracked raw socket, then use `Promise.allSettled()` to close Socket.IO and the HTTP server through Promise wrappers.

- [ ] On successful completion, clear the 15-second timer and exit `0`. Register signals using a top-level last-resort catch:

  ```ts
  process.on('SIGTERM', () => {
    void gracefulShutdown('SIGTERM').catch(handleShutdownEscape)
  })
  ```

- [ ] Run the call-site diagnostic again:

  ```bash
  cd /root/github_projects/GameServerManager/server
  npx jest --runInBand src/__tests__/terminal-call-sites.tmp.test.ts
  ```

  Expected result: exit code `0`.

- [ ] Delete `server/src/__tests__/terminal-call-sites.tmp.test.ts`.

- [ ] Search all terminal manager calls:

  ```bash
  cd /root/github_projects/GameServerManager
  grep -R -nE '\b(closePty|resizeTerminal|createPty|reconnectSession)\s*\(' \
    server/src \
    --include='*.ts'
  ```

  Expected result: every Promise-returning call is visibly awaited, returned, collected, or prefixed with `void` and followed by `.catch(...)`.

- [ ] Run the server type check:

  ```bash
  cd /root/github_projects/GameServerManager/server
  npx tsc --noEmit
  ```

  Expected result: exit code `0`.

- [ ] Review the Task 8 diff. Obtain fresh user confirmation specifically for this commit before committing; no current or earlier authorization covers it. After confirmation run:

  ```bash
  git add \
    server/src/index.ts \
    server/src/modules/instance/InstanceManager.ts \
    server/src/modules/terminal/TerminalManager.ts \
    server/src/routes/gameDeployment.ts
  git commit -m "fix: await terminal lifecycle operations"
  ```

  Expected result: one commit without the temporary call-site diagnostic.

---

### Task 9: Add the unified Xterm factory and correct Socket event types

**Files**

- Create: `client/src/utils/terminalFactory.ts`
- Modify: `client/src/utils/socket.ts`
- Modify: `client/src/types/index.ts`

**Interfaces**

```ts
export interface TerminalViewOptions {
  isMobile: boolean
}

export function createTerminalView(
  options: TerminalViewOptions
): {
  terminal: Terminal
  fitAddon: FitAddon
}
```

```ts
export interface CreateTerminalRequest {
  sessionId: string
  name?: string
  cols: number
  rows: number
  cwd?: string
  enableStreamForward?: boolean
  programPath?: string
}
```

```ts
export type TerminalOperation =
  | 'create'
  | 'input'
  | 'resize'
  | 'close'

export interface TerminalErrorEvent {
  sessionId: string
  operation: TerminalOperation
  error: string
}
```

**Steps**

- [ ] Create `client/src/utils/terminalFactory.ts` and move the existing theme object into it without changing any color.

- [ ] Configure the factory with:
  - `convertEol: true`
  - `disableStdin: false`
  - `cursorBlink: true`
  - `cursorStyle: 'block'`
  - `lineHeight: 1.2`
  - Desktop `fontSize: 14`, `scrollback: 1000`
  - Mobile `fontSize: 12`, `scrollback: 500`
  - Existing font family, tab width, and transparency settings

- [ ] Load one `FitAddon` and one `WebLinksAddon` inside the factory. Return only `{ terminal, fitAddon }`; do not accept or calculate `cols/rows`.

- [ ] Update `SocketClient.createTerminal()` so `cols` and `rows` are required:

  ```ts
  createTerminal(data: CreateTerminalRequest): void {
    this.emit('create-pty', data)
  }
  ```

- [ ] Add a named `reconnectTerminal(sessionId: string): void` wrapper for `reconnect-session`, while preserving the existing generic `emit()` API for unrelated events.

- [ ] Replace nonexistent event definitions in `SocketEvents`. Include the real payloads:

  ```ts
  'pty-created': (data: {
    sessionId: string
    workingDirectory: string
  }) => void

  'pty-closed': (data: { sessionId: string }) => void

  'terminal-output': (data: {
    sessionId: string
    data: string
    isHistorical?: boolean
  }) => void

  'terminal-resized': (data: {
    sessionId: string
    cols: number
    rows: number
  }) => void

  'terminal-error': (data: TerminalErrorEvent) => void

  'terminal-exit': (data: {
    sessionId: string
    code: number | null
    signal: string | null
  }) => void

  'session-reconnected': (data: { sessionId: string }) => void
  'session-reconnect-failed': (data: { sessionId: string }) => void
  'connection-status': (data: {
    connected: boolean
    reason?: string
  }) => void
  ```

- [ ] Remove `terminal-created` and `terminal-closed` from the type interface. Do not introduce aliases.

- [ ] Run the client type check:

  ```bash
  cd /root/github_projects/GameServerManager/client
  npx tsc --noEmit
  ```

  Expected result: exit code `0`.

- [ ] Review the Task 9 diff. Obtain fresh confirmation for this specific commit before running it; earlier approval is not valid. After confirmation run:

  ```bash
  git add \
    client/src/utils/terminalFactory.ts \
    client/src/utils/socket.ts \
    client/src/types/index.ts
  git commit -m "refactor: centralize terminal view creation"
  ```

  Expected result: one commit containing the factory and corrected event types.

---

### Task 10: Move terminal runtimes into refs and install the single observer/reporter path

**Files**

- Modify: `client/src/pages/TerminalPage.tsx`
- Temporary: `client/src/pages/TerminalPage.resize.tmp.test.ts`

**Interfaces**

```ts
interface TerminalTabMeta {
  id: string
  name: string
}

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
```

Required refs:

```ts
const runtimesRef = useRef(new Map<string, TerminalRuntime>())
const activeSessionIdRef = useRef<string | null>(null)
const terminalContainerRef = useRef<HTMLDivElement | null>(null)
const observerRef = useRef<ResizeObserver | null>(null)
const fitFrameRef = useRef<number | null>(null)
```

**Steps**

- [ ] Create `client/src/pages/TerminalPage.resize.tmp.test.ts` as a temporary source diagnostic. Assert that the final source has no `fontSize * 0.6`, no `calculateTerminalSize`, no direct `terminal.resize()`, exactly two `ref={setTerminalContainer}` uses, one `ResizeObserver` construction, and exactly one `socketClient.resizeTerminal()` call in `TerminalPage.tsx`.

- [ ] Run the diagnostic before refactoring:

  ```bash
  cd /root/github_projects/GameServerManager/client
  npx vitest --run src/pages/TerminalPage.resize.tmp.test.ts
  ```

  Expected result: non-zero exit identifying the current manual estimator, two object refs, direct resizes, and multiple reporters.

- [ ] Replace `TerminalSession[]` React state with `TerminalTabMeta[]`. Keep only tab metadata and `activeSessionId` in terminal-related React state; move `Terminal`, `FitAddon`, timers, and disposables into `runtimesRef`.

- [ ] Add a runtime creation helper that calls `createTerminalView({ isMobile })`, initializes `closeRequestInFlight: false`, registers one `onData` and one `onResize`, and stores both returned disposables.

- [ ] Gate `onData` so it forwards only when the runtime is the active session and `state === 'ready'`. Drop input in all other states without buffering.

- [ ] Implement a client size validator matching the server bounds exactly:

  ```ts
  function isValidTerminalSize(
    size: TerminalSize | null | undefined
  ): size is TerminalSize {
    return Boolean(
      size &&
      Number.isSafeInteger(size.cols) &&
      Number.isSafeInteger(size.rows) &&
      size.cols >= 2 &&
      size.cols <= 1000 &&
      size.rows >= 1 &&
      size.rows <= 1000
    )
  }
  ```

- [ ] Implement `ensureObserver()` so it lazily creates the component’s only `ResizeObserver`. Its callback must only call `scheduleFit()` and must read the current runtime, active ID, and container through refs.

- [ ] Implement `setTerminalContainer(node)` in this fixed order:
  1. Unobserve the old node.
  2. Store the new node.
  3. Return after clearing when `node === null`.
  4. Call `ensureObserver()`.
  5. Open or move the active Xterm element into the new node.
  6. Observe the node.
  7. Call `scheduleFit()`.

- [ ] Replace both normal and fullscreen container refs with:

  ```tsx
  ref={setTerminalContainer}
  ```

- [ ] Implement `scheduleFit()` so it cancels the prior rAF and schedules one new frame. The frame handles only the active runtime and requires non-zero container width and height.

- [ ] In the rAF callback, call `fitAddon.proposeDimensions()` first, validate the proposal, call `fitAddon.fit()`, then validate `terminal.cols/terminal.rows`. On any invalid or unavailable value, perform no create and no resize; wait for the next observer or attachment trigger.

- [ ] Remove `calculateTerminalSize()`, fallback dimensions, all `fontSize * 0.6` calculations, and every direct `terminal.resize()` call.

- [ ] Change normal creation to create a tab/runtime in `creating`, activate it, attach it, and defer `create-pty` until a valid post-fit size exists. Set `createSize` before emitting so repeated observer callbacks cannot create twice.

- [ ] For attached and restored server sessions, create runtimes in `disconnected`. Do not invent create dimensions or emit `create-pty`; attachment and reconnect behavior will use the existing server target.

- [ ] Implement the only reporter. `onResize` stores a valid `pendingSize` and schedules a 50ms trailing timer only when the runtime is active, ready, connected, and differs from `lastWrittenSize`.

- [ ] In the timer callback, re-read all state from refs, send only the newest valid pending size, update `lastWrittenSize`, and clear pending. The single outbound call must be:

  ```ts
  socketClient.resizeTerminal(sessionId, size.cols, size.rows)
  ```

- [ ] Add `seedResize(sessionId: string)` for transitions to ready and active-session switching. It must resolve the runtime from `runtimesRef`, place the current validated terminal size into `pendingSize`, and call the same reporter flush path; it must not introduce a second direct Socket emit path.

- [ ] Make active-session switching update metadata, move the selected Xterm element, call `scheduleFit()`, and seed only after a valid fit when the selected runtime is ready. Non-active runtimes must not fit or resize.

- [ ] Remove resize-related `setTimeout()` blocks from create, switch, fullscreen, mount, reconnect, and window-resize flows. Keep unrelated modal animation and focus timers only where still required.

- [ ] Ensure `terminal-resized` handling only stores `lastReportedSize`; it must not call fit, resize, seed, or reporter code.

- [ ] Run the resize diagnostic:

  ```bash
  cd /root/github_projects/GameServerManager/client
  npx vitest --run src/pages/TerminalPage.resize.tmp.test.ts
  ```

  Expected result: exit code `0`.

- [ ] Delete `client/src/pages/TerminalPage.resize.tmp.test.ts`.

- [ ] Run the client type check:

  ```bash
  cd /root/github_projects/GameServerManager/client
  npx tsc --noEmit
  ```

  Expected result: exit code `0`.

- [ ] Review the Task 10 diff. Obtain fresh user confirmation specifically for this commit before committing; prior approval does not apply. After confirmation run:

  ```bash
  git add client/src/pages/TerminalPage.tsx
  git commit -m "refactor: observe and fit the active terminal"
  ```

  Expected result: one commit without the temporary resize diagnostic.

---

### Task 11: Complete the frontend terminal state machine, reconnect, close retry, and cleanup

**Files**

- Modify: `client/src/pages/TerminalPage.tsx`
- Modify: `client/src/types/index.ts` if payload refinements are required
- Temporary: `client/src/pages/TerminalPage.state.tmp.test.ts`

**Interfaces**

```ts
function requestCloseIfIdle(sessionId: string): void
function clearPendingResize(runtime: TerminalRuntime): void
function disposeRuntime(sessionId: string): void
function seedResize(sessionId: string): void
```

**Steps**

- [ ] Create `client/src/pages/TerminalPage.state.tmp.test.ts` as a temporary source-contract diagnostic. Require the real event names, `closeRequestInFlight`, `requestCloseIfIdle`, `connection-status`, `operation === 'close'`, and explicit disposal order. Reject `terminal-created` and `terminal-closed`.

- [ ] Run the diagnostic before state-machine completion:

  ```bash
  cd /root/github_projects/GameServerManager/client
  npx vitest --run src/pages/TerminalPage.state.tmp.test.ts
  ```

  Expected result: non-zero exit until the legacy listeners and immediate close behavior are removed.

- [ ] Implement `clearPendingResize()` to clear the timer and pending size. Call it on disconnect, close start, exit, resize/input failure, and disposal.

- [ ] Implement `requestCloseIfIdle()` so it returns unless the runtime exists, Socket.IO is connected, and `closeRequestInFlight === false`. Set the flag to `true` before emitting `close-pty`.

- [ ] Handle `pty-created`:
  - `creating -> ready`, then active fit and seed.
  - `closing -> closing`, with no fit; call `requestCloseIfIdle()`.
  - Ignore the event in all other states.
  - Move the success notification here instead of showing it immediately after the create request.

- [ ] Handle transport disconnect from `connection-status`:
  - Preserve `closing`.
  - Move other live states to `disconnected`.
  - Clear `closeRequestInFlight`, timer, pending size, `lastWrittenSize`, and `lastReportedSize`.
  - Do not queue input, resize, or close requests while disconnected.

- [ ] Handle transport connect:
  - `disconnected -> reconnecting`.
  - Preserve `closing`.
  - For both cases, emit only `reconnect-session`.
  - Do not emit resize or close directly from the connect callback.

- [ ] Handle `session-reconnected`:
  - `reconnecting -> ready`, then attach, fit, and seed if active.
  - `closing -> closing`, do not fit or seed, then call `requestCloseIfIdle()`.
  - Do not infer readiness for disposed or exited runtimes.

- [ ] Handle `session-reconnect-failed`:
  - `reconnecting -> exited`.
  - `closing -> disposed` after clearing the close flag.
  - Show one stable panel notification for the reconnect failure.

- [ ] Replace immediate `closeTerminalSession()` disposal with state-based behavior:
  - `creating | ready -> closing`, clear resize work, then request close.
  - `disconnected | reconnecting -> closing`, clear resize work and wait for reconnect outcome.
  - `closing` calls `requestCloseIfIdle()` only when the flag is false.
  - `exited` disposes immediately.
  - `disposed` does nothing.

- [ ] Handle `terminal-error` by `operation`:
  - `create`: `creating -> exited`.
  - `input`: `ready -> exited`, clear resize work.
  - `resize`: `ready -> exited`, clear resize work.
  - `close`: clear `closeRequestInFlight`, preserve `closing`, and wait for an explicit user retry.
  - Never start an automatic close retry timer.

- [ ] Use stable notification text for repeated resize failures, for example:

  ```text
  终端尺寸同步失败，请关闭该会话后重新创建。
  ```

  Send it through `useNotificationStore`; log detailed raw errors only to the console.

- [ ] Handle `terminal-exit` idempotently. Any non-disposed, non-closing active state becomes `exited`; do not send close or resize automatically.

- [ ] Handle `pty-closed` by clearing `closeRequestInFlight`; only a `closing` runtime transitions to `disposed` and is then removed. Move the close notification here instead of displaying it at button click time.

- [ ] Implement `disposeRuntime()` in this exact order:
  1. Set `state = 'disposed'`.
  2. Clear resize timer and pending size.
  3. Dispose every `IDisposable`.
  4. Call `terminal.dispose()`.
  5. Delete the runtime from `runtimesRef`.
  6. Remove its tab metadata.
  7. Select another tab or set the active ID to `null`.

- [ ] Ensure a new terminal always receives a new session ID. Do not recreate with an ID that is still creating, ready, closing, retained, or waiting for `pty-closed`.

- [ ] Delete listeners for `terminal-created` and `terminal-closed`. Register and remove only:
  - `pty-created`
  - `pty-closed`
  - `terminal-output`
  - `terminal-resized`
  - `terminal-error`
  - `terminal-exit`
  - `session-reconnected`
  - `session-reconnect-failed`
  - `connection-status`

- [ ] On component unmount, cancel the current rAF, disconnect the observer, remove Socket/fullscreen/window listeners, and dispose every runtime through the same disposal helper.

- [ ] Run the state diagnostic:

  ```bash
  cd /root/github_projects/GameServerManager/client
  npx vitest --run src/pages/TerminalPage.state.tmp.test.ts
  ```

  Expected result: exit code `0`.

- [ ] Delete `client/src/pages/TerminalPage.state.tmp.test.ts`.

- [ ] Run focused static checks:

  ```bash
  cd /root/github_projects/GameServerManager

  if grep -nE 'terminal-created|terminal-closed|calculateTerminalSize|fontSize\s*\*\s*0\.6' \
    client/src/pages/TerminalPage.tsx; then
    exit 1
  fi

  test "$(
    grep -c 'socketClient\.resizeTerminal(' \
      client/src/pages/TerminalPage.tsx
  )" -eq 1
  ```

  Expected result: no forbidden output and exit code `0`.

- [ ] Run the client type check:

  ```bash
  cd /root/github_projects/GameServerManager/client
  npx tsc --noEmit
  ```

  Expected result: exit code `0`.

- [ ] Review the Task 11 diff. Obtain fresh confirmation for this exact commit before committing; no earlier confirmation applies. After confirmation run:

  ```bash
  git add \
    client/src/pages/TerminalPage.tsx \
    client/src/types/index.ts
  git commit -m "feat: enforce terminal client lifecycle states"
  ```

  Expected result: one commit without the temporary state diagnostic.

---

### Task 12: Perform complete static, race, distribution, and native-platform verification

**Files**

- Verify all implementation files listed above.
- Do not leave any temporary source or test files.
- Do not commit native binaries or runtime FIFO contents.

**Interfaces**

Final contracts to verify:

```ts
type CloseResult = 'closed' | 'not-found' | 'still-running'

type TerminalState =
  | 'creating'
  | 'ready'
  | 'disconnected'
  | 'reconnecting'
  | 'closing'
  | 'exited'
  | 'disposed'
```

```text
RESIZE frame:
04 | uint16be(JSON byte length) | {"width":cols,"height":rows}
```

**Steps**

- [ ] Run both required TypeScript checks:

  ```bash
  cd /root/github_projects/GameServerManager/client
  npx tsc --noEmit

  cd /root/github_projects/GameServerManager/server
  npx tsc --noEmit
  ```

  Expected result: both commands exit `0`.

- [ ] Check script syntax:

  ```bash
  cd /root/github_projects/GameServerManager
  node --check scripts/package.js
  bash -n install-gsm3.sh
  ```

  Expected result: both commands exit `0`.

- [ ] Print and review the canonical manifest without downloading:

  ```bash
  cd /root/github_projects/GameServerManager/server
  npx tsx -e "
    import {
      PTY_RELEASE_ID,
      PTY_BUILD_COMMIT,
      PTY_ASSETS
    } from './src/utils/ptyAssets.ts';
    console.log(JSON.stringify({
      releaseId: PTY_RELEASE_ID,
      buildCommit: PTY_BUILD_COMMIT,
      assets: PTY_ASSETS
    }, null, 2));
  "
  ```

  Expected result: release ID `297277624`, build commit `09fc369dfa278504831260de2771d7cbd98d01c4`, and the three exact asset tuples from Task 1.

- [ ] Confirm all four PTY entry points are free of mutable PTY release URLs:

  ```bash
  cd /root/github_projects/GameServerManager
  if grep -n 'MCSManager/PTY.*latest' \
    server/src/utils/ptyManager.ts \
    scripts/package.js \
    Dockerfile \
    install-gsm3.sh; then
    exit 1
  fi
  ```

  Expected result: no output and exit code `0`.

- [ ] Confirm no temporary diagnostics remain:

  ```bash
  cd /root/github_projects/GameServerManager
  test ! -e server/src/__tests__/pty-assets.tmp.test.ts
  test ! -e scripts/.tmp-verify-pty-distribution.cjs
  test ! -e server/src/__tests__/pty-control-channel.tmp.test.ts
  test ! -e server/src/__tests__/pty-control-platform.tmp.test.ts
  test ! -e server/src/__tests__/terminal-create-attempt.tmp.test.ts
  test ! -e server/src/__tests__/terminal-resize.tmp.test.ts
  test ! -e server/src/__tests__/terminal-close.tmp.test.ts
  test ! -e server/src/__tests__/terminal-call-sites.tmp.test.ts
  test ! -e client/src/pages/TerminalPage.resize.tmp.test.ts
  test ! -e client/src/pages/TerminalPage.state.tmp.test.ts
  ```

  Expected result: exit code `0`.

- [ ] Search changed implementation files for unresolved placeholders:

  ```bash
  cd /root/github_projects/GameServerManager
  if grep -nE 'T[B]D|T[O]DO|F[I]XME|待[定]' \
    server/src/utils/ptyAssets.ts \
    server/src/utils/ptyAssetCli.ts \
    server/src/utils/ptyManager.ts \
    server/src/utils/ptyControlChannel.ts \
    server/src/modules/terminal/TerminalManager.ts \
    server/src/modules/instance/InstanceManager.ts \
    server/src/index.ts \
    scripts/package.js \
    Dockerfile \
    install-gsm3.sh \
    client/src/utils/terminalFactory.ts \
    client/src/utils/socket.ts \
    client/src/types/index.ts \
    client/src/pages/TerminalPage.tsx; then
    exit 1
  fi
  ```

  Expected result: no output and exit code `0`.

- [ ] Inspect all server call sites:

  ```bash
  cd /root/github_projects/GameServerManager
  grep -R -nE '\b(closePty|resizeTerminal|createPty|reconnectSession)\s*\(' \
    server/src \
    --include='*.ts'
  ```

  Expected result: every Promise is awaited, returned, collected in `Promise.allSettled`, or explicitly consumed with an error handler.

- [ ] Confirm the frontend has one reporter and the two layout nodes share the callback ref:

  ```bash
  cd /root/github_projects/GameServerManager
  test "$(
    grep -c 'socketClient\.resizeTerminal(' \
      client/src/pages/TerminalPage.tsx
  )" -eq 1

  test "$(
    grep -c 'ref={setTerminalContainer}' \
      client/src/pages/TerminalPage.tsx
  )" -eq 2
  ```

  Expected result: exit code `0`.

- [ ] Recheck the protocol manually with a short one-off command or temporary diagnostic, then remove it immediately. For `120x40`, confirm JSON is `{"width":120,"height":40}` and the first bytes are `04 00 19`.

- [ ] Exercise rapid queue behavior with the same fake blocked writer used during Task 3: enqueue every 40ms for one second, release the first write, and confirm only the current in-flight plus final pending size are written. Remove the diagnostic after it passes.

- [ ] Exercise duplicate create and retained close fault injection with fake children: two concurrent same-ID creates must spawn once; a process that ignores SIGTERM and SIGKILL must remain in its map; reconnect must bind the new socket; a later close event must finalize once. Remove the diagnostic after it passes.

- [ ] Temporarily log the active reporter’s final `{ sessionId, cols, rows }` during native browser acceptance. Remove the log and rerun the client type check before delivery.

- [ ] On native Linux x64, verify the asset:

  ```bash
  stat -c '%s' data/lib/pty_linux_x64
  sha256sum data/lib/pty_linux_x64
  ./data/lib/pty_linux_x64 -h 2>&1 | grep -- '-fifo'
  ```

  Expected values:
  - Size: `2654360`
  - SHA-256: `bbdfc8a5d0f57493e78c64bca56d370524c068c1d4d31cac653458a843d47f72`
  - Probe output contains `-fifo`

- [ ] On native Linux ARM64, verify:

  ```bash
  stat -c '%s' data/lib/pty_linux_arm64
  sha256sum data/lib/pty_linux_arm64
  ./data/lib/pty_linux_arm64 -h 2>&1 | grep -- '-fifo'
  ```

  Expected values:
  - Size: `2752664`
  - SHA-256: `48d8496997053b60eb84d2b02f4ec751298c7f214c615b08aca43309739ebf83`
  - Probe output contains `-fifo`

- [ ] On native Windows x64, verify in PowerShell:

  ```powershell
  (Get-Item .\data\lib\pty_win32_x64.exe).Length
  (Get-FileHash .\data\lib\pty_win32_x64.exe -Algorithm SHA256).Hash.ToLower()
  & .\data\lib\pty_win32_x64.exe -h 2>&1 |
    Select-String -- '-fifo'
  ```

  Expected values:
  - Size: `3627520`
  - SHA-256: `fe35c154e623707d0dd2b728f41fd200bd3ead0a8cda8eb216b1e5e3e3ab2d40`
  - Probe output contains `-fifo`

- [ ] On each available native platform, create a terminal and run:

  ```bash
  stty size
  tput cols
  tput lines
  python3 -c 'print("0123456789" * 30)'
  ```

  On Windows PowerShell, also run:

  ```powershell
  [Console]::WindowWidth
  [Console]::WindowHeight
  ```

  Expected result: after layout movement stops, reported native dimensions match the final active reporter values within 500ms.

- [ ] Toggle the sidebar, enter and leave fullscreen, drag the window continuously for one second, and switch between two tabs. Confirm only the active ready tab sends resize, the final dimensions win, and no `terminal-resized -> fit -> terminal-resize` loop appears.

- [ ] Run `vim`, `top`, and, when installed, `htop`. Confirm they redraw correctly after every layout change, ASCII wrapping follows the final column boundary, and the cursor has no logical offset.

- [ ] Disconnect the network transport with a ready session, reconnect it, and confirm the client sends `reconnect-session` before any resize. Confirm `session-reconnected` returns the active runtime to ready and seeds one final resize.

- [ ] Start closing a session, disconnect, reconnect, and verify that the runtime remains `closing`; `session-reconnected` triggers only one guarded close request, with no fit or resize.

- [ ] Inject a close timeout and verify the close error clears `closeRequestInFlight` while preserving `closing`. Click close once more and confirm exactly one new server close attempt is made.

- [ ] Send two simultaneous create requests with the same ID. Confirm one create error, no `closePty` invocation, no `pty-closed`, and no mutation of the existing process, endpoint, or socket.

- [ ] Trigger graceful shutdown with one manager cleanup forced to reject. Confirm subsequent managers still run in order, sockets are destroyed in `finally`, Socket.IO and HTTP close are attempted, and the normal path completes before the 15-second forced-exit timer.

- [ ] If any native platform is unavailable, record it explicitly as `NOT RUN` with the missing host, container, or architecture as the reason. Do not report that platform as passing based on cross-architecture hash verification alone.

- [ ] Remove the temporary browser reporter log or any final fault-injection code, then rerun:

  ```bash
  cd /root/github_projects/GameServerManager/client
  npx tsc --noEmit

  cd /root/github_projects/GameServerManager/server
  npx tsc --noEmit
  ```

  Expected result: both exit `0`.

- [ ] Inspect `git status --short`. Expected result: only intended implementation and documentation changes are present; there are no downloaded binaries, FIFO files, temporary tests, diagnostic scripts, or generated build outputs.

## Spec Coverage and Final Self-Review

- [ ] **Fixed assets:** Release ID is `297277624`; build commit is `09fc369dfa278504831260de2771d7cbd98d01c4`; Linux x64, Linux ARM64, and Windows x64 asset IDs, names, sizes, and hashes exactly match the approved specification.

- [ ] **Download contract:** Runtime, package, Docker, and install paths all perform release JSON lookup followed by asset API download, use the fixed headers, follow at most five redirects, strip cross-host Authorization, enforce exact size/hash, use same-directory temporary files, and atomically rename only after validation.

- [ ] **Probe contract:** A local binary with the wrong name, size, or hash is never probed. A native valid asset must pass `<binary> -h` within three seconds, stay below 64 KiB output, and contain `-fifo`.

- [ ] **Distribution check:** `server/src/utils/ptyManager.ts`, `scripts/package.js`, `Dockerfile`, and `install-gsm3.sh` contain no PTY `releases/download/latest` path.

- [ ] **Protocol:** `validatePtySize()` enforces safe integers and `cols 2..1000`, `rows 1..1000`. `120x40` encodes as JSON `{"width":120,"height":40}` with frame prefix `04 00 19`.

- [ ] **Queue:** There is at most one in-flight frame and one latest pending resize. Superseded, duplicate, close-pending, and close-caused write failures resolve as `skipped`. `close()` resolves only after all resize promises settle.

- [ ] **Endpoints:** POSIX directories are `0700`, FIFOs are confirmed non-symlink FIFOs and chmodded `0600`, Windows uses random Named Pipe names, session IDs do not enter endpoint paths, and complete endpoints do not enter browser payloads or ordinary logs.

- [ ] **Create lifecycle:** `sessions` and `createAttempts` are checked and reserved synchronously without an intervening await. Duplicate IDs emit only a create error, never call `closePty`, and never emit `pty-closed`.

- [ ] **Fallback:** Fallback requires all three approved conditions, uses the 1000ms primary window, preserves the original `createSize`, creates a new endpoint, observes cancellation, and produces only one final create result.

- [ ] **Ready semantics:** A target enters `sessions` and emits `pty-created` only after the native control channel is ready.

- [ ] **Real resize:** No `SIGWINCH` fallback remains. `terminal-resized` means only that the complete frame was written to the OS pipe; it does not claim an upstream ACK.

- [ ] **Resize identity:** A delayed write acknowledgement is suppressed unless the same session object remains ready with the same control channel.

- [ ] **CloseResult consistency:** `CloseResult` is exactly `'closed' | 'not-found' | 'still-running'` everywhere. It is used only by genuine close operations, not duplicate create handling.

- [ ] **Single-flight close:** Concurrent closes share one promise, one signal sequence, one result, and one final event. SIGTERM waits three seconds and SIGKILL waits one second.

- [ ] **Retained targets:** A timed-out create attempt becomes `close-retained` and preserves process, channel, endpoint, socket, cancellation token, and the reusable `closePromise` slot. A timed-out session remains represented as closing.

- [ ] **Reconnect:** Closing sessions and `close-retained` attempts update their socket and return `session-reconnected`. `session-reconnect-failed` is emitted only after stable confirmation that both maps lack the ID.

- [ ] **Cleanup:** `TerminalManager.cleanup()` disables new work and performs one parallel `Promise.allSettled([...attemptTasks, ...sessionTasks])`. It does not clear unconfirmed references.

- [ ] **Shutdown:** The forced deadline is 15 seconds; managers are processed sequentially through isolated `settle()` calls; socket destruction and Socket.IO/HTTP closure always run in `finally`.

- [ ] **Call-site handling:** Every `createPty`, `resizeTerminal`, `closePty`, and `reconnectSession` call is awaited, returned, collected, or explicitly consumed. No Promise is silently dropped.

- [ ] **Frontend factory:** All three Xterm initialization paths use `createTerminalView()`, which returns only `{ terminal, fitAddon }`, preserves the existing theme, and does not accept or invent dimensions.

- [ ] **Frontend ownership:** Terminal tab metadata and active ID are the only terminal-session data in React state. Xterm instances, FitAddon instances, timers, state, dimensions, flags, and disposables live in `runtimesRef`.

- [ ] **TerminalState consistency:** The frontend state union is exactly `creating | ready | disconnected | reconnecting | closing | exited | disposed`, and every event transition matches the approved event table.

- [ ] **Measurement:** Both terminal containers share one callback ref; one observer drives one rAF scheduler; create and resize occur only after non-zero container dimensions, valid `proposeDimensions()`, `fit()`, and validated final Xterm dimensions.

- [ ] **Reporter:** There is one `terminal.onResize` per runtime and one `socketClient.resizeTerminal()` call site in `TerminalPage.tsx`. Only the active ready runtime can emit.

- [ ] **Acknowledgement behavior:** `terminal-resized` only updates `lastReportedSize`; it never triggers fit, direct resize, or another report.

- [ ] **Close retry:** `closeRequestInFlight` starts false, is set before emitting, and is cleared by close error, disconnect, and `pty-closed`. There is no timer-driven or error-driven infinite retry.

- [ ] **Event payloads:** `pty-created`, `pty-closed`, `terminal-output`, `terminal-resized`, `terminal-error`, `terminal-exit`, `session-reconnected`, and `session-reconnect-failed` payload types match between server emissions, client types, and handlers. No `terminal-created` or `terminal-closed` alias remains.

- [ ] **Notifications:** Errors and lifecycle results use the existing notification store. Resize errors use stable text for deduplication. No browser `alert`, `confirm`, or `prompt` is introduced.

- [ ] **Placeholder scan:** The unresolved-placeholder scan in Task 12 returns zero matches across all changed implementation files.

- [ ] **Type checks:** `cd client && npx tsc --noEmit` and `cd server && npx tsc --noEmit` both exit with code `0`.

- [ ] **Temporary artifacts:** Every temporary test and diagnostic file listed in this plan has been deleted after passing. No runtime FIFO or downloaded binary is committed.

- [ ] **Native verification honesty:** Linux x64, Linux ARM64, and Windows x64 results are reported individually. Any platform not exercised natively is recorded as `NOT RUN` with the reason and is not claimed as passing.

- [ ] **Remaining risks:** The implementation report explicitly states that owner/actor authorization remains out of scope, upstream provides no positive resize ACK, and crash-left FIFO scanning remains out of scope.
