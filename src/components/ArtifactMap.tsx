import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Feature, Position } from 'geojson'
import type { ArtifactMapDocument } from '@/components/artifactMapData'

type BaseLayer = 'satellite' | 'street' | 'route'
type RouteOption = {
  id: string
  label: string
  color: string
  feature: Feature
  summary: string | null
  distance: string | null
  tip: string | null
}

const SATELLITE_TILE_URL = import.meta.env.VITE_OFFICE_SATELLITE_TILE_URL
  || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const STREET_TILE_URL = import.meta.env.VITE_OFFICE_STREET_TILE_URL
  || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

function featureLabel(feature: Feature) {
  const properties = feature.properties || {}
  for (const key of ['name', 'title', 'label', 'routeName', 'route_name', '名称', '标题', '路线名称']) {
    const value = properties[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

const PROPERTY_LABELS: Record<string, string> = {
  address: '地址', description: '说明', elevation: '海拔', altitude: '海拔', ele: '海拔',
  time: '时间', startTime: '开始时间', endTime: '结束时间', category: '分类', group: '分组',
  t: '时间', note: '说明', nav: '导航关键词', price: '价格', items: '推荐内容', color: '路线颜色',
  openingHours: '营业时间', hours: '营业时间', phone: '电话', telephone: '电话',
  rating: '评分', score: '评分', ratingCount: '评价数', reviewCount: '评价数',
  ratingSource: '评分来源', source: '数据来源', sourceCoordinateSystem: '原坐标系', coordinateSystem: '显示坐标系',
  地址: '地址', 说明: '说明', 描述: '说明', 海拔: '海拔', 时间: '时间', 分类: '分类', 营业时间: '营业时间', 电话: '电话', 评分: '评分', 评价数: '评价数',
}

const IMAGE_KEYS = ['images', 'photos', 'image', 'photo', 'thumbnail', 'cover', 'imageUrl', 'photoUrl', '图片', '照片', '封面']
const RATING_KEYS = ['rating', 'score', 'stars', '评分']
const RATING_COUNT_KEYS = ['ratingCount', 'reviewCount', 'reviews', '评价数', '评论数']
const SOURCE_KEYS = ['ratingSource', 'source', '评分来源', '数据来源']
const SOURCE_URL_KEYS = ['sourceUrl', 'url', 'link', 'website', '来源链接', '官网']
const DETAIL_RESERVED_KEYS = new Set([
  ...IMAGE_KEYS, ...RATING_KEYS, ...RATING_COUNT_KEYS, ...SOURCE_KEYS, ...SOURCE_URL_KEYS,
  'description', 'note', '说明', '描述', 'address', '地址', 'openingHours', 'hours', '营业时间',
  'phone', 'telephone', '电话', 'price', '价格', 'category', '分类',
])

function featureColor(feature: Feature | undefined, fallback: string) {
  const value = feature?.properties?.color
  return typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback
}

function featureGroup(feature: Feature) {
  const value = feature.properties?.group
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function featureProperty(feature: Feature, keys: string[]) {
  for (const key of keys) {
    const value = feature.properties?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function featureValue(feature: Feature, keys: string[]) {
  for (const key of keys) if (feature.properties?.[key] != null) return feature.properties[key]
  return null
}

function safeExternalUrl(value: unknown, image = false) {
  if (typeof value !== 'string') return null
  const url = value.trim()
  if (image && /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(url)) return url
  if (/^https:\/\//i.test(url)) return url
  return null
}

function featureImages(feature: Feature) {
  const values = IMAGE_KEYS.flatMap((key) => {
    const value = feature.properties?.[key]
    if (Array.isArray(value)) return value
    if (typeof value !== 'string') return []
    const trimmed = value.trim()
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) return parsed
      } catch {
        return [value]
      }
    }
    return trimmed.includes('|') ? trimmed.split('|') : [trimmed]
  })
  return [...new Set(values.flatMap((value) => {
    const url = safeExternalUrl(value, true)
    return url ? [url] : []
  }))].slice(0, 6)
}

function numericProperty(feature: Feature, keys: string[]) {
  const value = featureValue(feature, keys)
  if (value == null || (typeof value === 'string' && !value.trim())) return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function routeOptions(document: ArtifactMapDocument): RouteOption[] {
  return document.geojson.features.flatMap((feature, index) => {
    if (feature.geometry.type !== 'LineString' && feature.geometry.type !== 'MultiLineString') return []
    return [{
      id: `route-${index}`,
      label: featureLabel(feature) || `路线 ${index + 1}`,
      color: featureColor(feature, '#f05d43'),
      feature,
      summary: featureProperty(feature, ['summary', 'description', '说明', '描述']),
      distance: featureProperty(feature, ['dist', 'distance', '里程', '距离']),
      tip: featureProperty(feature, ['tip', 'note', '提示', '建议']),
    }]
  })
}

function pointVisual(feature: Feature) {
  const content = [featureLabel(feature), featureProperty(feature, ['category', 'group', 'items', 'note', 'description'])].filter(Boolean).join(' ')
  if (/(?:餐|美食|夜市|小吃|food|restaurant|cafe)/i.test(content)) return { icon: '🍜', label: '美食' }
  if (/(?:酒店|住宿|民宿|hotel|hostel)/i.test(content)) return { icon: '🏨', label: '住宿' }
  if (/(?:车站|机场|码头|地铁|station|airport|terminal)/i.test(content)) return { icon: '🚉', label: '交通' }
  if (/(?:海|湖|河|滩|湾|瀑布|beach|lake|river)/i.test(content)) return { icon: '🌊', label: '自然景观' }
  if (/(?:景区|公园|古|寺|馆|广场|山|view|park|museum)/i.test(content)) return { icon: '📸', label: '打卡点' }
  return { icon: '📍', label: '地点' }
}

function pointDescription(feature: Feature) {
  const time = featureProperty(feature, ['t', 'time', '时间'])
  const note = featureProperty(feature, ['note', 'description', '说明', '描述'])
  const detail = featureProperty(feature, ['items', 'price', 'address', '推荐内容', '价格', '地址'])
  return [time, note, detail].filter(Boolean).join(' · ').slice(0, 72)
}

function tooltipContent(feature: Feature) {
  const visual = pointVisual(feature)
  const wrapper = window.document.createElement('div')
  wrapper.className = 'artifact-map-callout-content'
  const imageUrl = featureImages(feature)[0]
  const icon = imageUrl ? window.document.createElement('img') : window.document.createElement('span')
  if (icon instanceof HTMLImageElement) {
    icon.src = imageUrl
    icon.alt = ''
    icon.loading = 'lazy'
    icon.referrerPolicy = 'no-referrer'
  } else icon.textContent = visual.icon
  const copy = window.document.createElement('div')
  const title = window.document.createElement('strong')
  title.textContent = featureLabel(feature) || visual.label
  copy.append(title)
  const description = pointDescription(feature)
  if (description) {
    const detail = window.document.createElement('small')
    detail.textContent = description
    copy.append(detail)
  }
  wrapper.append(icon, copy)
  return wrapper
}

function routeCalloutPlacement(order: number) {
  const placements: Array<{ direction: L.Direction; offset: L.PointExpression }> = [
    { direction: 'right', offset: [16, 0] },
    { direction: 'bottom', offset: [0, 16] },
    { direction: 'left', offset: [-16, 0] },
    { direction: 'top', offset: [0, -16] },
  ]
  return placements[(Math.max(1, order) - 1) % placements.length]
}

function representativePosition(feature: Feature): Position | null {
  const geometry = feature.geometry
  if (!geometry) return null
  if (geometry.type === 'Point') return geometry.coordinates
  if (geometry.type === 'MultiPoint' || geometry.type === 'LineString') return geometry.coordinates[0] || null
  if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') return geometry.coordinates[0]?.[0] || null
  if (geometry.type === 'MultiPolygon') return geometry.coordinates[0]?.[0]?.[0] || null
  for (const item of geometry.geometries) {
    const position = representativePosition({ type: 'Feature', geometry: item, properties: {} })
    if (position) return position
  }
  return null
}

function featureDetails(feature: Feature | null) {
  if (!feature) return null
  const position = representativePosition(feature)
  const properties = feature.properties || {}
  const entries = Object.entries(properties).flatMap(([key, value]) => {
    if (['name', 'title', 'label', '名称', '标题', 'order'].includes(key) || DETAIL_RESERVED_KEYS.has(key)) return []
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return []
    const text = String(value).trim()
    return text ? [[PROPERTY_LABELS[key] || key, text.slice(0, 240)] as const] : []
  }).slice(0, 10)
  return {
    title: featureLabel(feature) || '地图要素',
    geometry: ({ Point: '点位', MultiPoint: '点位组', LineString: '路线', MultiLineString: '多段路线', Polygon: '区域', MultiPolygon: '多区域', GeometryCollection: '组合要素' })[feature.geometry.type],
    latitude: position ? Number(position[1]) : null,
    longitude: position ? Number(position[0]) : null,
    altitude: position && position.length > 2 && Number.isFinite(Number(position[2])) ? Number(position[2]) : null,
    images: featureImages(feature),
    rating: numericProperty(feature, RATING_KEYS),
    ratingCount: numericProperty(feature, RATING_COUNT_KEYS),
    ratingSource: featureProperty(feature, SOURCE_KEYS),
    sourceUrl: safeExternalUrl(featureValue(feature, SOURCE_URL_KEYS)),
    description: featureProperty(feature, ['description', 'note', '说明', '描述', 'items', '推荐内容']),
    address: featureProperty(feature, ['address', '地址']),
    openingHours: featureProperty(feature, ['openingHours', 'hours', '营业时间', 'time', '时间']),
    phone: featureProperty(feature, ['phone', 'telephone', '电话']),
    price: featureProperty(feature, ['price', '价格']),
    category: featureProperty(feature, ['category', '分类']),
    entries,
  }
}

function routePositions(feature: Feature | undefined): Position[] {
  if (!feature) return []
  if (feature.geometry.type === 'LineString') return feature.geometry.coordinates
  if (feature.geometry.type === 'MultiLineString') return feature.geometry.coordinates.flat()
  return []
}

/**
 * 功能：在可切换卫星、街道和纯路线底图上渲染统一 GeoJSON 文档。
 * 参数：document 为已解析地图文档。
 * 返回：返回 React 地图查看界面。
 * 错误：底图失败时保留路线图层并显示提示。
 * 状态：维护当前底图模式和瓦片加载状态。
 * 并发与取消：组件卸载或数据切换时销毁 Leaflet 地图和请求。
 * 权限：只访问配置的公开瓦片地址，不读取本地文件。
 * 关联：由文件中心和对话产物查看器复用。
 */
export function ArtifactMap({ document }: { document: ArtifactMapDocument }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null)
  const routes = useMemo(() => routeOptions(document), [document])
  const routeLabels = useMemo(() => new Set(routes.map((route) => route.label)), [routes])
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(() => routes[0]?.id ?? null)
  const [showPoints, setShowPoints] = useState(true)
  const [baseLayer, setBaseLayer] = useState<BaseLayer>('satellite')
  const [tileFailed, setTileFailed] = useState(false)
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [animationProgress, setAnimationProgress] = useState(0)
  const selected = useMemo(() => featureDetails(selectedFeature), [selectedFeature])
  const selectedRoute = routes.find((route) => route.id === selectedRouteId) ?? routes[0] ?? null
  const standalonePointCount = useMemo(() => document.geojson.features.filter((feature) => {
    if (feature.geometry.type !== 'Point' && feature.geometry.type !== 'MultiPoint') return false
    const group = featureGroup(feature)
    return !group || !routeLabels.has(group)
  }).length, [document, routeLabels])
  const selectedRoutePointCount = useMemo(() => selectedRoute ? document.geojson.features.filter((feature) => {
    return (feature.geometry.type === 'Point' || feature.geometry.type === 'MultiPoint') && featureGroup(feature) === selectedRoute.label
  }).length : document.uniquePointCount, [document, selectedRoute])
  const visibleDocument = useMemo(() => {
    if (!selectedRoute) return document.geojson
    return {
      type: 'FeatureCollection' as const,
      features: document.geojson.features.filter((feature) => {
        if (feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString') return feature === selectedRoute.feature
        if (feature.geometry.type === 'Point' || feature.geometry.type === 'MultiPoint') {
          const group = featureGroup(feature)
          return group === selectedRoute.label || (showPoints && (!group || !routeLabels.has(group)))
        }
        return true
      }),
    }
  }, [document, routeLabels, selectedRoute, showPoints])
  const focusDocument = useMemo(() => selectedRoute ? {
    type: 'FeatureCollection' as const,
    features: visibleDocument.features.filter((feature) => feature === selectedRoute.feature || featureGroup(feature) === selectedRoute.label),
  } : visibleDocument, [selectedRoute, visibleDocument])

  useEffect(() => {
    setSelectedRouteId(routes[0]?.id ?? null)
    setShowPoints(true)
    setSelectedFeature(null)
    setIsPlaying(false)
    setAnimationProgress(0)
  }, [document, routes])

  useEffect(() => {
    setSelectedFeature(null)
    setIsPlaying(false)
    setAnimationProgress(0)
  }, [selectedRouteId, showPoints])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    setTileFailed(false)
    const map = L.map(host, { preferCanvas: true, zoomControl: true, attributionControl: true })
    setMapInstance(map)
    if (baseLayer !== 'route') {
      const satellite = baseLayer === 'satellite'
      const tiles = L.tileLayer(satellite ? SATELLITE_TILE_URL : STREET_TILE_URL, {
        maxZoom: satellite ? 19 : 20,
        attribution: satellite
          ? '影像 © Esri 及其数据提供方'
          : '地图数据 © OpenStreetMap contributors',
      })
      let failedTiles = 0
      tiles.on('tileerror', () => {
        failedTiles += 1
        if (failedTiles >= 3) setTileFailed(true)
      })
      tiles.addTo(map)
    }
    let pointSequence = 0
    L.geoJSON(visibleDocument, {
      style: (feature) => ({
        color: featureColor(feature, feature?.geometry.type.includes('Polygon') ? '#2f8f83' : '#f05d43'),
        weight: feature?.geometry.type.includes('Polygon') ? 2 : 4,
        opacity: .94,
        fillColor: '#2f8f83',
        fillOpacity: .18,
      }),
      pointToLayer: (feature, latlng) => {
        pointSequence += 1
        const order = feature.properties && typeof feature.properties.order === 'number' && Number.isFinite(feature.properties.order)
          ? Math.max(1, Math.round(feature.properties.order))
          : pointSequence
        const color = featureColor(feature, '#e84f3d')
        const routePoint = featureGroup(feature) === selectedRoute?.label
        const visual = pointVisual(feature)
        return L.marker(latlng, {
          icon: routePoint
            ? L.divIcon({ className: 'artifact-map-marker', html: `<span style="background:${color}">${order}</span>`, iconSize: [24, 24], iconAnchor: [12, 12] })
            : L.divIcon({ className: 'artifact-map-poi-marker', html: `<span>${visual.icon}</span>`, iconSize: [34, 34], iconAnchor: [17, 17] }),
        })
      },
      onEachFeature: (feature, layer) => {
        const label = featureLabel(feature)
        if (label) {
          if (feature.geometry.type === 'Point') {
            const routePoint = featureGroup(feature) === selectedRoute?.label
            const order = typeof feature.properties?.order === 'number' ? Math.max(1, Math.round(feature.properties.order)) : pointSequence
            const placement = routePoint ? routeCalloutPlacement(order) : { direction: 'top' as const, offset: [0, -14] as L.PointExpression }
            const { direction, offset } = placement
            layer.bindTooltip(tooltipContent(feature), { permanent: routePoint, direction, offset, opacity: .98, className: routePoint ? 'artifact-map-callout' : 'artifact-map-poi-tooltip' })
          } else {
            const content = window.document.createElement('strong')
            content.textContent = label
            layer.bindTooltip(content, { direction: 'top', offset: [0, -6], opacity: .96 })
          }
        }
        layer.on('click', () => setSelectedFeature(feature))
      },
    }).addTo(map)
    const bounds = L.geoJSON(focusDocument).getBounds()
    if (bounds.isValid()) map.fitBounds(bounds.pad(.14), { maxZoom: 14 })
    else map.setView([35, 105], 4)
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map)
    const frame = window.requestAnimationFrame(() => map.invalidateSize())
    return () => {
      window.cancelAnimationFrame(frame)
      setMapInstance((current) => current === map ? null : current)
      map.remove()
    }
  }, [baseLayer, focusDocument, selectedRoute, visibleDocument])

  useEffect(() => {
    if (!mapInstance || !isPlaying) return
    if (!mapInstance.getContainer().isConnected || !mapInstance.getPane('overlayPane')) {
      setIsPlaying(false)
      setAnimationProgress(0)
      return
    }
    const positions = routePositions(selectedRoute?.feature)
    const points = positions.map((position) => L.latLng(Number(position[1]), Number(position[0])))
    if (points.length < 2) {
      setIsPlaying(false)
      setAnimationProgress(0)
      return
    }
    const segments = points.slice(1).map((point, index) => points[index].distanceTo(point))
    const totalDistance = segments.reduce((total, distance) => total + distance, 0)
    if (totalDistance <= 0) {
      setIsPlaying(false)
      setAnimationProgress(0)
      return
    }
    const duration = Math.min(30_000, Math.max(8_000, points.length * 900))
    const trail = L.polyline([points[0]], {
      renderer: L.svg(),
      className: 'artifact-map-trail',
      color: selectedRoute?.color || '#2e91b8',
      weight: 6,
      opacity: .96,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false,
    }).addTo(mapInstance)
    const marker = L.marker(points[0], {
      interactive: false,
      zIndexOffset: 1200,
      icon: L.divIcon({ className: 'artifact-map-traveler', html: '<span>➜</span>', iconSize: [30, 30], iconAnchor: [15, 15] }),
    }).addTo(mapInstance)
    let animationFrame = 0
    let reportedProgress = -1
    const startedAt = performance.now()
    setAnimationProgress(0)
    const animate = (now: number) => {
      const ratioOfRoute = Math.min(1, (now - startedAt) / duration)
      const travelled = totalDistance * ratioOfRoute
      let remaining = travelled
      let segmentIndex = 0
      while (segmentIndex < segments.length - 1 && remaining > segments[segmentIndex]) {
        remaining -= segments[segmentIndex]
        segmentIndex += 1
      }
      const segmentDistance = segments[segmentIndex] || 1
      const ratio = Math.min(1, remaining / segmentDistance)
      const from = points[segmentIndex]
      const to = points[segmentIndex + 1]
      const current = L.latLng(from.lat + (to.lat - from.lat) * ratio, from.lng + (to.lng - from.lng) * ratio)
      marker.setLatLng(current)
      trail.setLatLngs([...points.slice(0, segmentIndex + 1), current])
      const heading = Math.atan2(-(to.lat - from.lat), to.lng - from.lng) * 180 / Math.PI
      marker.getElement()?.querySelector<HTMLElement>('span')?.style.setProperty('--traveler-heading', `${heading}deg`)
      const progress = Math.round(ratioOfRoute * 100)
      if (progress !== reportedProgress) {
        reportedProgress = progress
        setAnimationProgress(progress)
      }
      if (ratioOfRoute < 1) animationFrame = window.requestAnimationFrame(animate)
      else setIsPlaying(false)
    }
    animationFrame = window.requestAnimationFrame(animate)
    return () => {
      window.cancelAnimationFrame(animationFrame)
      if (mapInstance.hasLayer(marker)) mapInstance.removeLayer(marker)
      if (mapInstance.hasLayer(trail)) mapInstance.removeLayer(trail)
    }
  }, [isPlaying, mapInstance, selectedRoute])

  const togglePlayback = () => {
    if (isPlaying) {
      setIsPlaying(false)
      setAnimationProgress(0)
      return
    }
    setAnimationProgress(0)
    setIsPlaying(true)
  }

  const selectRoute = (routeId: string) => {
    setIsPlaying(false)
    setAnimationProgress(0)
    setSelectedRouteId(routeId)
  }

  const togglePoints = () => {
    setIsPlaying(false)
    setAnimationProgress(0)
    setShowPoints((value) => !value)
  }

  return <section className="artifact-map" aria-label="路线地图" data-point-count={document.pointCount} data-route-count={document.routeCount} data-visible-route={selectedRoute?.id || 'all'}>
    <header className="artifact-map-toolbar">
      <div><strong>交互路线图</strong><span>{document.uniquePointCount} 个地点 · {document.routeCount} 条路线{document.totalDistanceKm > 0 ? ` · ${document.totalDistanceKm.toFixed(document.totalDistanceKm >= 100 ? 0 : 1)} km` : ''} · {document.sourceFormat.toUpperCase()}</span></div>
      <div className="artifact-map-layers" role="group" aria-label="地图底图">
        <button type="button" aria-pressed={baseLayer === 'satellite'} onClick={() => setBaseLayer('satellite')}>卫星</button>
        <button type="button" aria-pressed={baseLayer === 'street'} onClick={() => setBaseLayer('street')}>地图</button>
        <button type="button" aria-pressed={baseLayer === 'route'} onClick={() => setBaseLayer('route')}>仅路线</button>
      </div>
    </header>
    {routes.length > 0 ? <section className="artifact-map-route-panel" aria-label="路线选择">
      <div className="artifact-map-route-strip" role="tablist" aria-label="选择要显示的路线">
        {routes.map((route, index) => <button key={route.id} type="button" role="tab" aria-selected={route.id === selectedRoute?.id} aria-label={`显示路线 ${index + 1}：${route.label}`} onClick={() => selectRoute(route.id)}>
          <span style={{ background: route.color }} />
          <b>路线 {index + 1}</b>
        </button>)}
        {standalonePointCount > 0 ? <button type="button" className="artifact-map-poi-toggle" aria-pressed={showPoints} onClick={togglePoints}>🍜 打卡点 {standalonePointCount}</button> : null}
      </div>
      {selectedRoute ? <div className="artifact-map-route-summary" style={{ borderLeftColor: selectedRoute.color }}>
        <div><strong>{selectedRoute.label}</strong><div><span>{selectedRoutePointCount} 个站点</span><button type="button" aria-pressed={isPlaying} onClick={togglePlayback}>{isPlaying ? '停止演示' : '演示路线'}</button></div></div>
        {selectedRoute.summary ? <p>{selectedRoute.summary}</p> : null}
        {isPlaying || animationProgress > 0 ? <section className="artifact-map-playback" aria-label="路线演示进度">
          <div role="progressbar" aria-label="路线演示进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={animationProgress} data-progress={animationProgress}><span style={{ width: `${animationProgress}%`, background: selectedRoute.color }} /></div>
          <small>{animationProgress >= 100 ? '演示完成' : `行进中 ${animationProgress}%`}</small>
        </section> : null}
        <footer>{selectedRoute.distance ? <span>{selectedRoute.distance}</span> : null}{selectedRoute.tip ? <span>{selectedRoute.tip}</span> : null}</footer>
      </div> : null}
    </section> : null}
    {tileFailed && baseLayer !== 'route' ? <p className="artifact-map-warning">底图网络暂时不可用，路线数据仍可查看，也可以切换“仅路线”。</p> : null}
    <div className="artifact-map-stage">
      <div ref={hostRef} className={`artifact-map-canvas base-${baseLayer}`} />
      {selected ? <aside className="artifact-map-details" aria-label="地点信息">
        <button type="button" aria-label="关闭地点信息" onClick={() => setSelectedFeature(null)}>×</button>
        {selected.images.length ? <div className="artifact-map-photo-strip">{selected.images.map((image) => <img key={image} src={image} alt={`${selected.title}照片`} loading="lazy" referrerPolicy="no-referrer" />)}</div> : null}
        <small>{selected.geometry}</small>
        <strong>{selected.title}</strong>
        {selected.category ? <span className="artifact-map-category">{selected.category}</span> : null}
        {selected.rating != null ? <div className="artifact-map-rating"><b>{selected.rating.toFixed(1)}</b><span>★</span>{selected.ratingCount != null ? <small>{Math.round(selected.ratingCount)} 条评价</small> : null}{selected.ratingSource ? <small>{selected.ratingSource}</small> : null}</div> : null}
        {selected.description ? <p className="artifact-map-description">{selected.description}</p> : null}
        {selected.latitude != null && selected.longitude != null ? <p>{selected.latitude.toFixed(6)}, {selected.longitude.toFixed(6)}</p> : null}
        {(selected.address || selected.openingHours || selected.phone || selected.price) ? <dl>
          {selected.address ? <div><dt>地址</dt><dd>{selected.address}</dd></div> : null}
          {selected.openingHours ? <div><dt>营业时间</dt><dd>{selected.openingHours}</dd></div> : null}
          {selected.phone ? <div><dt>电话</dt><dd>{selected.phone}</dd></div> : null}
          {selected.price ? <div><dt>价格</dt><dd>{selected.price}</dd></div> : null}
        </dl> : null}
        {selected.altitude != null ? <dl><div><dt>海拔</dt><dd>{selected.altitude.toFixed(1)} m</dd></div></dl> : null}
        {selected.entries.length ? <dl>{selected.entries.map(([label, value], index) => <div key={`${label}-${index}`}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : null}
        {selected.sourceUrl ? <a className="artifact-map-source" href={selected.sourceUrl} target="_blank" rel="noreferrer">查看数据来源</a> : null}
      </aside> : null}
    </div>
  </section>
}
