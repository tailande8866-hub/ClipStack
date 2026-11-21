import { useState, useEffect } from 'react'

// 保留时长以小时为单位，0 = 永久。直接从「1 天」起步，不再给小时级选项
const OPTIONS = [
  { value: '24', label: '1 天' },
  { value: '72', label: '3 天' },
  { value: '168', label: '7 天' },
  { value: '720', label: '30 天' },
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
