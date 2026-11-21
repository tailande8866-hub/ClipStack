/** 主题：深色（默认）/ 浅色。三个窗口共用同一份设置，值存在 settings 表的 theme 键。 */
export type ThemeName = 'dark' | 'light'

export function setThemeClass(theme: string | undefined | null): ThemeName {
  const t: ThemeName = theme === 'light' ? 'light' : 'dark'
  document.documentElement.dataset.theme = t
  document.documentElement.style.colorScheme = t === 'light' ? 'light' : 'dark'
  return t
}

/** 启动时同步一次；之后跟着主进程广播的 theme:changed 走 */
export async function initTheme(): Promise<ThemeName> {
  let theme: ThemeName = 'dark'
  try {
    const v = await window.electronAPI.getSetting('theme')
    theme = setThemeClass(v)
  } catch {
    theme = setThemeClass('dark')
  }
  try {
    window.electronAPI.onThemeChanged?.((next) => setThemeClass(next))
  } catch {
    /* 忽略 */
  }
  return theme
}
