import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Loader, RefreshCw } from 'lucide-react'
import type { SteamBranchInfo } from '@/types'

interface SteamBranchSelectorProps {
  id: string
  value: string
  branches: SteamBranchInfo[]
  loading: boolean
  error: string
  disabled?: boolean
  refreshDisabled?: boolean
  onChange: (branch: string) => void
  onRefresh: () => void
}

export default function SteamBranchSelector({
  id,
  value,
  branches,
  loading,
  error,
  disabled = false,
  refreshDisabled = false,
  onChange,
  onRefresh
}: SteamBranchSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const toggleButtonRef = useRef<HTMLButtonElement>(null)
  const listId = `${id}-list`
  const statusId = `${id}-status`

  useEffect(() => {
    if (disabled) setIsOpen(false)
  }, [disabled])

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const shouldRestoreToggleFocus = document.activeElement !== inputRef.current
      setIsOpen(false)
      if (shouldRestoreToggleFocus) toggleButtonRef.current?.focus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const statusText = loading
    ? '正在发现可见分支...'
    : error
    ? `${error}；仍可手动输入已知分支`
    : refreshDisabled && branches.length === 0
    ? '请先填写Steam用户名和密码，再查询可见分支'
    : `已发现 ${branches.length} 个可见分支；私有分支可直接输入名称`

  return (
    <div ref={containerRef} className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          autoComplete="off"
          aria-describedby={statusId}
          className="min-w-0 flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-60"
          placeholder={loading ? '正在发现可见分支...' : '输入Steam分支名称'}
        />
        <button
          ref={toggleButtonRef}
          type="button"
          onClick={() => setIsOpen(current => !current)}
          disabled={disabled}
          aria-expanded={isOpen}
          aria-controls={isOpen ? listId : undefined}
          className="min-h-11 flex-shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronDown aria-hidden="true" className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          <span>{isOpen ? '收起分支' : `查看分支${branches.length > 0 ? ` (${branches.length})` : ''}`}</span>
        </button>
      </div>

      {isOpen && (
        <div
          id={listId}
          className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-600 dark:bg-gray-700"
        >
          <div className="flex min-h-11 items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-600 dark:bg-gray-700/70">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              可见分支 ({branches.length})
            </span>
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading || refreshDisabled || disabled}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-blue-600 transition-colors hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-900/30"
            >
              {loading
                ? <Loader aria-hidden="true" className="h-4 w-4 animate-spin" />
                : <RefreshCw aria-hidden="true" className="h-4 w-4" />}
              <span>重新查询</span>
            </button>
          </div>

          {loading && branches.length === 0 ? (
            <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-gray-500 dark:text-gray-300" role="status">
              <Loader aria-hidden="true" className="h-4 w-4 animate-spin" />
              <span>正在查询可见分支...</span>
            </div>
          ) : branches.length > 0 ? (
            <select
              value={value.trim()}
              size={Math.min(branches.length, 6)}
              aria-label="选择已查询到的Steam分支"
              onChange={(event) => onChange(event.target.value)}
              disabled={disabled}
              className="block max-h-56 w-full border-0 bg-white px-2 py-1 text-sm text-gray-700 focus:ring-2 focus:ring-inset focus:ring-blue-500 dark:bg-gray-700 dark:text-gray-200"
            >
              {branches.map(branchInfo => (
                <option key={branchInfo.name} value={branchInfo.name} className="py-2">
                  {branchInfo.name}
                  {branchInfo.isDefault ? ' · 默认' : ''}
                  {branchInfo.requiresPassword ? ' · 需密码' : ''}
                  {branchInfo.description && branchInfo.description !== branchInfo.name ? ` · ${branchInfo.description}` : ''}
                  {branchInfo.buildId ? ` · Build ${branchInfo.buildId}` : ''}
                </option>
              ))}
            </select>
          ) : (
            <div className="px-3 py-5 text-sm text-gray-500 dark:text-gray-300">
              {refreshDisabled
                ? '请先填写Steam用户名和密码，再重新查询可见分支。'
                : error
                ? '分支查询失败，可直接在上方输入已知分支名称。'
                : '没有查询到可见分支，可直接在上方输入已知分支名称。'}
            </div>
          )}
        </div>
      )}

      <p
        id={statusId}
        aria-live="polite"
        className={`text-xs ${error ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`}
      >
        {statusText}
      </p>
    </div>
  )
}
