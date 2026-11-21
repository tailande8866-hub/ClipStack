/** 主题：深色（默认）/ 浅色 / 跟随系统。三个窗口共用同一份设置，存在 settings 表的 theme 键。 */
export type ThemeName = 'dark' | 'light'

export function setThemeClass(theme: string | undefined | null): ThemeName {
  const t: ThemeName = theme === 'light' ? 'light' : 'dark'
  document.documentElement.dataset.theme = t
  document.documentElement.style.colorScheme = t === 'light' ? 'light' : 'dark'
  return t
}

async function resolveTheme(value: string | null | undefined): Promise<ThemeName> {
  if (value === 'light' || value === 'dark') return value
  // auto / 没设置过：问主进程系统当前是深是浅
  try {
    const sys = await window.electronAPI.resolveTheme?.()
    return sys === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/** 启动时同步一次；之后跟着主进程广播的 theme:changed 走 */
export async function initTheme(): Promise<ThemeName> {
  let theme: ThemeName = 'dark'
  try {
    theme = setThemeClass(await resolveTheme(await window.electronAPI.getSetting('theme')))
  } catch {
    theme = setThemeClass('dark')
  }
  try {
    window.electronAPI.onThemeChanged?.((next) => {
      resolveTheme(next).then((t) => setThemeClass(t))
    })
  } catch {
    /* 忽略 */
  }
  return theme
}
