import { writeFileSync } from 'node:fs'

const OUT = 'E:\\浮贴\\_preview'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let seq = 0

function connect(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url)
    ws.onopen = () => res(ws)
    ws.onerror = rej
  })
}
function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => reject(new Error('timeout ' + method)), 15000)
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id === id) {
        clearTimeout(timer)
        ws.removeEventListener('message', onMsg)
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
      }
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

const list = await (await fetch('http://127.0.0.1:9223/json/list')).json()
const main = list.find((t) => t.url.includes('index.html'))
const ws = await connect(main.webSocketDebuggerUrl)
await send(ws, 'Runtime.enable')
await send(ws, 'Runtime.evaluate', { expression: 'window.electronAPI.expandFromFloat()' })
await sleep(1500)

// 模拟鼠标移到第一张卡片附近
await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: 160, y: 250, button: 'none', clickCount: 0 })
await sleep(900)
await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: 150, y: 420, button: 'none', clickCount: 0 })
await sleep(900)

const info = await send(ws, 'Runtime.evaluate', {
  expression: `JSON.stringify({
    near: document.querySelectorAll('.clipboard-card.near').length,
    glowOpacity: getComputedStyle(document.querySelector('.cursor-glow')).opacity,
    dots: !!document.querySelector('.dot-veil'),
    dotOpacity: getComputedStyle(document.querySelector('.dot-veil')).opacity
  })`,
  returnByValue: true
})
console.log('INFO:', info.result.value)

const r = await send(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: false })
writeFileSync(OUT + '\\glass-main-hover.png', Buffer.from(r.data, 'base64'))
ws.close()
console.log('done')
