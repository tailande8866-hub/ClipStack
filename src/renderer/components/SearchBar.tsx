import { useState, useEffect } from 'react'

interface Props {
  onSearch: (query: string) => void
}

export default function SearchBar({ onSearch }: Props) {
  const [value, setValue] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => onSearch(value), 300)
    return () => clearTimeout(timer)
  }, [value, onSearch])

  return (
    <div className="search-bar">
      <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="7" />
        <line x1="20" y1="20" x2="16.2" y2="16.2" />
      </svg>
      <input
        className="search-input"
        type="text"
        placeholder="搜索复制过的内容"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      {value && (
        <button className="search-clear" title="清空" onClick={() => setValue('')}>
          &times;
        </button>
      )}
    </div>
  )
}
