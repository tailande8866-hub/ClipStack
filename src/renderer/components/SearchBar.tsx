import { useState, useEffect } from 'react'

interface Props {
  value: string
  onChange: (query: string) => void
}

export default function SearchBar({ value, onChange }: Props) {
  const [local, setLocal] = useState(value)

  // 外部清空（比如按 Esc）时同步回输入框
  useEffect(() => {
    setLocal(value)
  }, [value])

  useEffect(() => {
    const timer = setTimeout(() => onChange(local), 300)
    return () => clearTimeout(timer)
  }, [local, onChange])

  return (
    <div className="search-bar">
      <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="7" />
        <line x1="20" y1="20" x2="16.2" y2="16.2" />
      </svg>
      <input
        className="search-input"
        type="text"
        placeholder="搜索复制过的内容（含截图里的字）"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
      />
      {local && (
        <button
          className="search-clear"
          title="清空"
          onClick={() => {
            setLocal('')
            onChange('')
          }}
        >
          &times;
        </button>
      )}
    </div>
  )
}
