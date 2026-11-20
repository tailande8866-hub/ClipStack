/** 全局轻提示：卡片内的 state 会因为列表刷新而丢失，这里放到组件外 */
let listeners: Array<(msg: string) => void> = []

export function showToast(msg: string) {
  listeners.forEach((fn) => fn(msg))
}

export function subscribeToast(fn: (msg: string) => void) {
  listeners = [...listeners, fn]
  return () => {
    listeners = listeners.filter((x) => x !== fn)
  }
}
