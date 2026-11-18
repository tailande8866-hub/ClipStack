import { useState, useEffect } from 'react'

// 保留时长以小时为单位，0 = 永久
const OPTIONS = [
  { value: '2', label: '2 小时' },
  { value: '4', label: '4 小时' },
  { value: '6', label: '6 小时' },
  { value: '24', label: '1 天' },
  { value: '72', label: '3 天' },
  { value: '168', label: '7 天' },
  { value: '0', label: '永久' },
]

export default function RetentionSelector() {
  const [hours, setHours] = useState('24')

  useEffect(() => {
    window.electronAPI.getSetting('retention_hours').then((val) => {
      if (val) setHours(val)
    })
  }, [])

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value
    setHours(value)
    await window.electronAPI.setSetting('retention_hours', value)
  }

  return (
    <select className="retention-select" value={hours} onChange={handleChange}>
      {OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}
