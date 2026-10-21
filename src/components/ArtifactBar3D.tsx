import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { ARTIFACT_CHART_COLORS, type ArtifactChartSpec } from '@/components/artifactChartSpec'

function compactNumber(value: number) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1, notation: Math.abs(value) >= 10000 ? 'compact' : 'standard' }).format(value)
}

/** 使用 Three.js 渲染可交互、带入场动画的真实三维分组柱状图。 */
export function ArtifactBar3D({ spec }: { spec: ArtifactChartSpec }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  const summary = useMemo(() => {
    const points = spec.series.flatMap((series) => series.data.map((value, categoryIndex) => ({ value, series: series.name, category: spec.categories[categoryIndex] })))
    const peak = points.reduce((best, point) => point.value > best.value ? point : best, points[0])
    const total = points.reduce((sum, point) => sum + point.value, 0)
    return { peak, total }
  }, [spec])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let frame = 0
    let disposed = false
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: true })
    } catch {
      setFailed(true)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.12
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.domElement.setAttribute('aria-label', `${spec.title}，三维柱状图`)
    renderer.domElement.setAttribute('role', 'img')
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(0x111722, 18, 34)
    const camera = new THREE.PerspectiveCamera(34, 1, .1, 80)
    const chartGroup = new THREE.Group()
    scene.add(chartGroup)

    const categories = spec.categories.length
    const seriesCount = spec.series.length
    const xGap = 1.6
    const zGap = 1.15
    const chartWidth = Math.max(5, (categories - 1) * xGap + 2.2)
    const chartDepth = Math.max(4, (seriesCount - 1) * zGap + 3)
    chartGroup.position.x = -(categories - 1) * xGap / 2
    chartGroup.position.z = -(seriesCount - 1) * zGap / 2

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(chartWidth + 3.8, chartDepth + 3.4),
      new THREE.MeshStandardMaterial({ color: 0x202a38, roughness: .72, metalness: .08 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.set((categories - 1) * xGap / 2, -.03, (seriesCount - 1) * zGap / 2)
    floor.receiveShadow = true
    chartGroup.add(floor)

    const grid = new THREE.GridHelper(Math.max(chartWidth + 2, chartDepth + 2), 18, 0x4f6680, 0x2f3b4b)
    grid.position.copy(floor.position)
    grid.position.y = .01
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = .42
    chartGroup.add(grid)

    scene.add(new THREE.HemisphereLight(0xdcecff, 0x16202c, 2.6))
    const keyLight = new THREE.DirectionalLight(0xfff1dc, 4.2)
    keyLight.position.set(-7, 11, 9)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.set(2048, 2048)
    scene.add(keyLight)
    const rimLight = new THREE.DirectionalLight(0x71d7ff, 3.4)
    rimLight.position.set(9, 5, -8)
    scene.add(rimLight)
    const accentLight = new THREE.PointLight(0xff7765, 36, 18, 2)
    accentLight.position.set(-5, 4, 4)
    scene.add(accentLight)

    const values = spec.series.flatMap((series) => series.data)
    const maxValue = Math.max(...values.map((value) => Math.abs(value)), 1)
    const bars: Array<{ mesh: THREE.Mesh; height: number; delay: number }> = []
    spec.series.forEach((series, seriesIndex) => {
      const color = new THREE.Color(series.color || ARTIFACT_CHART_COLORS[seriesIndex])
      series.data.forEach((value, categoryIndex) => {
        const height = Math.max(.18, Math.abs(value) / maxValue * 5.4)
        const geometry = new THREE.BoxGeometry(.76, 1, .76, 2, 8, 2)
        const material = new THREE.MeshPhysicalMaterial({
          color,
          emissive: color.clone().multiplyScalar(.12),
          roughness: .28,
          metalness: .22,
          clearcoat: .72,
          clearcoatRoughness: .2,
        })
        const mesh = new THREE.Mesh(geometry, material)
        mesh.castShadow = true
        mesh.receiveShadow = true
        mesh.position.set(categoryIndex * xGap, .02, seriesIndex * zGap)
        mesh.scale.y = .01
        mesh.userData = { value, category: spec.categories[categoryIndex], series: series.name }
        chartGroup.add(mesh)
        bars.push({ mesh, height, delay: categoryIndex * 80 + seriesIndex * 130 })

        const halo = new THREE.Mesh(
          new THREE.CircleGeometry(.62, 32),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .14, depthWrite: false }),
        )
        halo.rotation.x = -Math.PI / 2
        halo.position.set(categoryIndex * xGap, .025, seriesIndex * zGap)
        chartGroup.add(halo)
      })
    })

    camera.position.set(Math.max(8.5, chartWidth * .72), 8.2, Math.max(11.5, chartDepth * 1.5))
    camera.lookAt(0, 2.1, 0)
    const clock = new THREE.Clock()
    const pointer = new THREE.Vector2()
    const onPointerMove = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / Math.max(rect.width, 1) - .5) * 2
      pointer.y = ((event.clientY - rect.top) / Math.max(rect.height, 1) - .5) * 2
    }
    host.addEventListener('pointermove', onPointerMove)

    const resize = () => {
      const width = Math.max(320, host.clientWidth)
      const height = Math.max(330, host.clientHeight)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    const start = performance.now()
    const render = (now: number) => {
      if (disposed) return
      const elapsed = now - start
      bars.forEach(({ mesh, height, delay }) => {
        const progress = Math.min(1, Math.max(0, (elapsed - delay) / 980))
        const eased = 1 - Math.pow(1 - progress, 4)
        mesh.scale.y = Math.max(.01, height * eased)
        mesh.position.y = Math.max(.01, height * eased / 2)
      })
      const time = clock.getElapsedTime()
      camera.position.x += ((Math.max(8.5, chartWidth * .72) + pointer.x * 1.15 + Math.sin(time * .23) * .22) - camera.position.x) * .035
      camera.position.y += ((8.2 - pointer.y * .55) - camera.position.y) * .035
      camera.lookAt(0, 2.05, 0)
      renderer.render(scene, camera)
      frame = requestAnimationFrame(render)
    }
    frame = requestAnimationFrame(render)

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      host.removeEventListener('pointermove', onPointerMove)
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach((material) => material.dispose())
        }
      })
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [spec])

  return <div className="artifact-chart-3d-layout">
    <div className="artifact-chart-3d-stage" ref={hostRef}>{failed ? <p>当前浏览器无法创建 WebGL 三维图表。</p> : null}</div>
    <aside className="artifact-chart-3d-insights">
      <div><span>峰值</span><strong>{compactNumber(summary.peak.value)}{spec.unit || ''}</strong><small>{summary.peak.category} · {summary.peak.series}</small></div>
      <div><span>总量</span><strong>{compactNumber(summary.total)}{spec.unit || ''}</strong><small>{spec.categories.length} 个维度 · {spec.series.length} 组系列</small></div>
      <div className="artifact-chart-3d-legend"><span>系列</span>{spec.series.map((series, index) => <p key={series.name}><i style={{ background: series.color || ARTIFACT_CHART_COLORS[index] }} /><b>{series.name}</b><small>{compactNumber(series.data.at(-1) ?? 0)}{spec.unit || ''}</small></p>)}</div>
    </aside>
  </div>
}
