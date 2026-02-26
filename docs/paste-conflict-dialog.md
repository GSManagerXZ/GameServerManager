# 文件粘贴冲突处理功能

## 功能说明

在文件管理器中执行复制/剪切粘贴操作时，如果目标位置已存在同名文件或文件夹，系统会弹出冲突处理弹窗，让用户选择处理方式。

## 处理方式

- **替换**：用源文件覆盖目标位置的同名文件
- **保留两者（重命名）**：自动为粘贴的文件添加编号后缀，如 `文件(1).txt`、`文件(2).txt`
- **跳过**：跳过已存在的文件，只处理不冲突的文件
- **取消**：取消本次粘贴操作

## 触发方式

- 右键菜单点击「粘贴」
- 快捷键 `Ctrl+V`

当剪贴板中有文件且目标位置存在同名文件时，自动弹出冲突处理弹窗。如果没有冲突则直接执行粘贴。

## 涉及文件

| 文件 | 说明 |
|------|------|
| `client/src/components/PasteConflictDialog.tsx` | 冲突弹窗组件 |
| `client/src/pages/FileManagerPage.tsx` | 粘贴逻辑修改 |
| `client/src/stores/fileStore.ts` | pasteFiles 支持 conflictStrategy 参数 |
| `client/src/utils/fileApi.ts` | 新增 checkPasteConflicts API、copy/move 支持 conflictStrategy |
| `server/src/routes/files.ts` | 新增 `/check-paste-conflict` 接口、copy/move 接收 conflictStrategy |
| `server/src/modules/task/fileOperationWorker.ts` | 文件操作执行时根据策略处理冲突 |
