import { useEffect, useRef } from 'react'
import { mountSilverField, mountStarfield } from '../duo-particles'

type Kind = 'silver' | 'starfield'

/** 背景粒子层：绝对铺满父容器，不挡鼠标，永远在内容下面 */
export default function ParticleVeil({ kind }: { kind: Kind }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const mounted = kind === 'starfield' ? mountStarfield(host) : mountSilverField(host)
    return () => {
      mounted?.destroy()
    }
  }, [kind])

  return <div ref={hostRef} className={`fx-veil fx-${kind}`} aria-hidden="true" />
}
