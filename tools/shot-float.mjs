import { writeFileSync } from 'node:fs'

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
const fl = list.find((t) => t.url.includes('float.html'))
const ws = await connect(fl.webSocketDebuggerUrl)
await send(ws, 'Runtime.enable')
await send(ws, 'Runtime.evaluate', { expression: 'window.electronAPI.collapseToFloat()' })
await sleep(1500)
const info = await send(ws, 'Runtime.evaluate', {
  expression: `JSON.stringify({x: screenX, y: screenY, w: outerWidth, h: outerHeight, dpr: devicePixelRatio,
    ball: (()=>{const b=document.querySelector('.float-ball').getBoundingClientRect(); return {x:b.x,y:b.y,w:b.width,h:b.height}})(),
    bg: getComputedStyle(document.querySelector('.float-ball')).backgroundImage.slice(0,80)})`,
  returnByValue: true
})
console.log(info.result.value)
writeFileSync('E:\\浮贴\\_preview\\float-pos.json', info.result.value)
ws.close()
await sleep(200)
console.log('ok')
