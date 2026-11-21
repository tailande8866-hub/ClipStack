import { nativeImage } from 'electron'
import { existsSync, statSync, writeFileSync, unlinkSync } from 'fs'
import { getHistory, updateImagePath } from './database'

// 老图片瘦身：库里早期存的都是原尺寸 PNG，一张好几兆。
// 每次启动/定时挑 2 张大的压成 JPEG（宽度超 1920 的先缩），慢慢把历史数据也瘦下来。
const BIG_BYTES = 1_400_000

export function runImageCompaction(limit = 2): number {
  let done = 0
  try {
    const items = getHistory(undefined, 300, 0, 'image')
    for (const it of items) {
      if (done >= limit) break
      const path = it.image_path
      if (!path || !path.toLowerCase().endsWith('.png')) continue
      if (!existsSync(path)) continue
      let size = 0
      try {
        size = statSync(path).size
      } catch {
        continue
      }
      if (size < BIG_BYTES) continue

      const img = nativeImage.createFromPath(path)
      if (img.isEmpty()) continue
      const s = img.getSize()
      const out = s.width > 1920 ? img.resize({ width: 1920, height: Math.round((s.height * 1920) / s.width) }) : img
      let buf: Buffer
      try {
        buf = out.toJPEG(82)
      } catch {
        continue
      }
      if (!buf || buf.length === 0) continue

      const newPath = path.replace(/\.png$/i, '') + '.jpg'
      try {
        writeFileSync(newPath, buf)
      } catch {
        continue
      }
      updateImagePath(it.id, newPath)
      try {
        if (existsSync(path)) unlinkSync(path)
      } catch {
        /* 被占用就先留着 */
      }
      done++
    }
  } catch {
    /* 压缩失败不影响主流程 */
  }
  return done
}
