import { writeFileSync, mkdirSync } from 'node:fs'

const OUT = 'E:\\浮贴\\_preview'
mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function targets() {
  const res = await fetch('http://127.0.0.1:9223/json/list')
  return res.json()
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    ws.onopen = () => resolve(ws)
    ws.onerror = reject
  })
}

let seq = 0
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

const list = await targets()
console.log(list.map((t) => `${t.type} | ${t.title} | ${t.url}`).join('\n'))

const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
  || list.find((t) => t.type === 'page')

const ws = await connect(page.webSocketDebuggerUrl)
await send(ws, 'Runtime.enable')

const items = await send(ws, 'Runtime.evaluate', {
  expression: `JSON.stringify({ title: document.title, cards: document.querySelectorAll('.card, .clip-card, .item').length, text: document.body.innerText.slice(0,300) })`,
  returnByValue: true
})
console.log('MAIN:', items.result.value)

await send(ws, 'Runtime.evaluate', { expression: `window.electronAPI.expandFromFloat()` })
await sleep(1800)
const shot = await send(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: false })
writeFileSync(OUT + '\\main.png', Buffer.from(shot.data, 'base64'))

// 打开设置窗
await send(ws, 'Runtime.evaluate', { expression: `window.electronAPI.openSettings()` })
await sleep(2500)

const list2 = await targets()
console.log(list2.map((t) => `${t.type} | ${t.title} | ${t.url}`).join('\n'))
const set = list2.find((t) => t.url.includes('settings.html'))
if (set) {
  const ws2 = await connect(set.webSocketDebuggerUrl)
  await send(ws2, 'Runtime.enable')
  const info = await send(ws2, 'Runtime.evaluate', {
    expression: `JSON.stringify({ title: document.title, w: innerWidth, h: innerHeight, text: document.body.innerText.slice(0,400) })`,
    returnByValue: true
  })
  console.log('SETTINGS:', info.result.value)
  const s1 = await send(ws2, 'Page.captureScreenshot', { format: 'png' })
  writeFileSync(OUT + '\\settings.png', Buffer.from(s1.data, 'base64'))
  // 切到数据页
  await send(ws2, 'Runtime.evaluate', {
    expression: `(()=>{const n=[...document.querySelectorAll('.nav-item')].find(e=>e.innerText.includes('数据')); if(n) n.click(); return n?n.innerText:'no';})()`
  })
  await sleep(1200)
  const s2 = await send(ws2, 'Page.captureScreenshot', { format: 'png' })
  writeFileSync(OUT + '\\settings-data.png', Buffer.from(s2.data, 'base64'))
  // 关于页
  await send(ws2, 'Runtime.evaluate', {
    expression: `(()=>{const n=[...document.querySelectorAll('.nav-item')].find(e=>e.innerText.includes('关于')); if(n) n.click(); return n?n.innerText:'no';})()`
  })
  await sleep(1200)
  const s3 = await send(ws2, 'Page.captureScreenshot', { format: 'png' })
  writeFileSync(OUT + '\\settings-about.png', Buffer.from(s3.data, 'base64'))
  ws2.close()
}

const flo = list2.find((t) => t.url.includes('float.html'))
if (flo) {
  const ws3 = await connect(flo.webSocketDebuggerUrl)
  await send(ws3, 'Runtime.enable')
  const f = await send(ws3, 'Runtime.evaluate', {
    expression: `JSON.stringify({ title: document.title, w: innerWidth, h: innerHeight })`,
    returnByValue: true
  })
  console.log('FLOAT:', f.result.value)
  const fs = await send(ws3, 'Page.captureScreenshot', { format: 'png' })
  writeFileSync(OUT + '\\float.png', Buffer.from(fs.data, 'base64'))
  ws3.close()
}

ws.close()
console.log('done')
