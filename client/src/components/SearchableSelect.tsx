import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface Option {
  id: string
  name: string
}

interface SearchableSelectProps {
  value: string
  onChange: (value: string) => void
  options: Option[]
  placeholder?: string
  disabled?: boolean
  className?: string
}

const SearchableSelect: React.FC<SearchableSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = '请选择或输入搜索',
  disabled = false,
  className = ''
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [displayValue, setDisplayValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const isSelectingRef = useRef(false) // 标记是否正在通过点击选项触发

  // 过滤选项
  const filteredOptions = options.filter(option =>
    option.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    option.id.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // 更新显示值
  useEffect(() => {
    if (value) {
      const selectedOption = options.find(option => option.id === value)
      setDisplayValue(selectedOption?.name || value)
      setSearchTerm('')
    } else {
      setDisplayValue('')
      setSearchTerm('')
    }
  }, [value, options])

  // 处理输入变化
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value
    setSearchTerm(inputValue)
    setDisplayValue(inputValue)
    setIsOpen(true)
    
    // 如果输入值完全匹配某个选项，自动选择
    const exactMatch = options.find(option => 
      option.name.toLowerCase() === inputValue.toLowerCase() ||
      option.id.toLowerCase() === inputValue.toLowerCase()
    )
    
    if (exactMatch && exactMatch.id !== value) {
      onChange(exactMatch.id)
    } else if (!exactMatch && value) {
      // 如果没有匹配项且当前有选中值，清空选中值
      onChange('')
    }
  }

  // 处理选项点击
  const handleOptionClick = (option: Option) => {
    isSelectingRef.current = true // 标记正在选择，防止 blur 覆盖显示值
    onChange(option.id)
    setDisplayValue(option.name)
    setIsOpen(false)
    setSearchTerm('')
    inputRef.current?.blur()
  }

  // 处理输入框焦点
  const handleInputFocus = () => {
    if (!disabled) {
      setIsOpen(true)
      setSearchTerm(displayValue)
    }
  }

  // 处理输入框失焦
  const handleInputBlur = (e: React.FocusEvent) => {
    // 延迟关闭，允许点击选项
    setTimeout(() => {
      // 如果是通过点击选项触发的 blur，跳过恢复逻辑
      if (isSelectingRef.current) {
        isSelectingRef.current = false
        return
      }
      if (!dropdownRef.current?.contains(e.relatedTarget as Node)) {
        setIsOpen(false)
        // 如果没有选中值，恢复显示值
        if (!value) {
          setDisplayValue('')
          setSearchTerm('')
        } else {
          const selectedOption = options.find(option => option.id === value)
          setDisplayValue(selectedOption?.name || value)
          setSearchTerm('')
        }
      }
    }, 150)
  }

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false)
      inputRef.current?.blur()
    } else if (e.key === 'Enter' && filteredOptions.length === 1) {
      handleOptionClick(filteredOptions[0])
    } else if (e.key === 'ArrowDown' && !isOpen) {
      setIsOpen(true)
    }
  }

  // 点击外部关闭下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className={`relative z-20 ${className}`} ref={dropdownRef}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={isOpen ? searchTerm : displayValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className={`
            w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-md 
            bg-white dark:bg-gray-700 text-gray-900 dark:text-white 
            focus:ring-2 focus:ring-blue-500 focus:border-transparent
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-all duration-200
          `}
        />
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className="absolute inset-y-0 right-0 flex items-center px-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          {isOpen ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* 下拉选项 */}
      {isOpen && (
        <div className={`
          absolute z-50 w-full mt-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 
          rounded-md shadow-lg max-h-60 overflow-auto
          animate-in fade-in-0 zoom-in-95 duration-200
        `}>
          {filteredOptions.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
              {searchTerm ? '没有匹配的选项' : '暂无选项'}
            </div>
          ) : (
            filteredOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => handleOptionClick(option)}
                className={`
                  w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-600
                  transition-colors duration-150
                  ${value === option.id 
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' 
                    : 'text-gray-900 dark:text-white'
                  }
                `}
              >
                <div className="font-medium">{option.name}</div>
                {option.id !== option.name && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {option.id}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default SearchableSelect