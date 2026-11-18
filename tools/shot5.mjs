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
const wsMain = await connect(main.webSocketDebuggerUrl)
await send(wsMain, 'Runtime.enable')
await send(wsMain, 'Runtime.evaluate', { expression: 'window.electronAPI.openSettings()' })
await sleep(2500)

const list2 = await (await fetch('http://127.0.0.1:9223/json/list')).json()
const set = list2.find((t) => t.url.includes('settings.html'))
const ws = await connect(set.webSocketDebuggerUrl)
await send(ws, 'Runtime.enable')
await send(ws, 'Runtime.evaluate', {
  expression: `(()=>{const n=[...document.querySelectorAll('.nav-item')].find(e=>e.innerText.includes('通用')); n&&n.click(); return 1})()`
})
await sleep(1200)
const r = await send(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: false })
writeFileSync(OUT + '\\glass-general.png', Buffer.from(r.data, 'base64'))
console.log('done')
ws.close()
wsMain.close()
