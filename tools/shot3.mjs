import { writeFileSync } from 'node:fs'

const OUT = 'E:\\浮贴\\_preview'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let seq = 0
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    ws.onopen = () => resolve(ws)
    ws.onerror = reject
  })
}
function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => reject(new Error('timeout ' + method)), 15000)
    const onMsg = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id === id) {
        clearTimeout(timer)
        ws.removeEventListener('message', onMsg)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
      }
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function targets() {
  const res = await fetch('http://127.0.0.1:9223/json/list')
  return res.json()
}

let list = await targets()
const mainPage = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
const wsMain = await connect(mainPage.webSocketDebuggerUrl)
await send(wsMain, 'Runtime.enable')
await send(wsMain, 'Runtime.evaluate', { expression: `window.electronAPI.openSettings()` })
await sleep(2500)

list = await targets()
const set = list.find((t) => t.url.includes('settings.html'))
const ws2 = await connect(set.webSocketDebuggerUrl)
await send(ws2, 'Runtime.enable')
await send(ws2, 'Runtime.evaluate', {
  expression: `(()=>{const n=[...document.querySelectorAll('.nav-item')].find(e=>e.innerText.includes('关于')); n&&n.click(); return n?n.innerText:'no'})()`
})
await sleep(1500)
const info = await send(ws2, 'Runtime.evaluate', {
  expression: `JSON.stringify({hero: !!document.querySelector('.about-hero'), h: document.querySelector('.about-hero')?.getBoundingClientRect().height, img: document.querySelector('.about-logo img')?.complete})`,
  returnByValue: true
})
console.log('ABOUT:', info.result.value)
const s = await send(ws2, 'Page.captureScreenshot', { format: 'png', fromSurface: false })
writeFileSync(OUT + '\\about-banner.png', Buffer.from(s.data, 'base64'))
console.log('done')
ws2.close()
wsMain.close()
