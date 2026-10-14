import Papa from 'papaparse'
import { parse, type Expression, type Node, type Program, type VariableDeclarator } from 'acorn'
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'

/**
 * 功能：描述统一地图文档及其统计摘要。
 * 字段语义：包含 GeoJSON、坐标、地点、路线、里程和来源格式。
 * 数据来源：GeoJSON、CSV、TSV、KML 或 GPX 正文；数据去向：地图查看器。
 * 约束：坐标已校验并归一；稳定性：新增字段保持向后兼容；关联：地图产物链路。
 */
export type ArtifactMapDocument = {
  /** 统一后的地图要素。 */
  geojson: FeatureCollection
  /** 所有几何中出现的坐标数量，包含路线顶点。 */
  pointCount: number
  /** 按六位小数去重后的地点数量。 */
  uniquePointCount: number
  /** 线状路线数量。 */
  routeCount: number
  /** 所有线状路线的球面估算总里程。 */
  totalDistanceKm: number
  /** 原始文件格式。 */
  sourceFormat: 'geojson' | 'json' | 'csv' | 'tsv' | 'kml' | 'gpx' | 'html'
}

type ArtifactCoordinateSystem = 'wgs84' | 'gcj02' | 'bd09'

/**
 * 功能：描述地图解析成功、失败或非地图文件三种结果。
 * 字段语义：`document` 为地图文档，`error` 为可展示的中文错误。
 * 数据来源：地图解析器；数据去向：文件中心和对话产物查看器。
 * 约束：非地图文件两项均为空；稳定性：解析失败不抛业务异常；关联：地图产物链路。
 */
export type ArtifactMapParseResult = {
  /** 成功解析后的地图文档；非地图文件或失败时为空。 */
  document: ArtifactMapDocument | null
  /** 可向用户展示的解析错误；非地图文件时为空。 */
  error: string | null
}

const GEOJSON_TYPES = new Set([
  'FeatureCollection', 'Feature', 'Point', 'MultiPoint', 'LineString',
  'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection',
])
const LATITUDE_KEYS = new Set(['lat', 'latitude', 'latitudedeg', 'latitudedegrees', 'y', '纬度', '纬度值', '纬度坐标'])
const LONGITUDE_KEYS = new Set(['lng', 'lon', 'long', 'longitude', 'longitudedeg', 'longitudedegrees', 'x', '经度', '经度值', '经度坐标'])
const ORDER_KEYS = new Set(['order', 'sequence', 'seq', 'index', '序号', '顺序'])
const LABEL_KEYS = new Set(['name', 'title', 'label', 'location', 'place', '名称', '标题', '地点', '站点'])
const GROUP_KEYS = new Set(['route', 'group', 'line', 'track', '路线', '线路', '分组'])
const HTML_LATITUDE_KEYS = ['lat', 'latitude', '纬度']
const HTML_LONGITUDE_KEYS = ['lng', 'lon', 'longitude', '经度']
const HTML_LABEL_KEYS = ['name', 'title', 'label', 'location', 'place', 'n', 'routeName', 'route_name', '名称', '标题', '地点', '站点', '路线名称']
const HTML_ROUTE_KEYS = ['stops', 'points', 'locations', 'places', 'markers', 'waypoints', 'route', '路线', '站点']
const HTML_ROUTE_COORDINATE_KEYS = ['coords', 'coordinates', 'path', 'polyline', 'line', '轨迹', '坐标', '路线坐标']
const HTML_GROUP_KEYS = ['group', 'routeName', 'route_name', 'line', 'track', 'route', '分组', '路线名称', '线路', '路线']
const COORDINATE_SYSTEM_KEYS = ['coordinateSystem', 'coordSystem', 'coordinatesystem', 'coordsystem', '坐标系']
const STATIC_MAP_CONTAINER_KEYS = new Set(['pois', 'points', 'places', 'locations', 'routes', 'items', 'data', '点位', '地点', '路线', '数据'])

function normalizedColumn(value: string) {
  return value.replace(/^\uFEFF/, '').trim().toLocaleLowerCase().replace(/[\s_.()（）\u005B\u005D【】/-]+/g, '')
}

function matchingColumn(columns: string[], candidates: Set<string>) {
  const exact = columns.find((column) => candidates.has(normalizedColumn(column)))
  if (exact) return exact
  return columns.find((column) => {
    const normalized = normalizedColumn(column)
    return [...candidates].some((candidate) => candidate.length >= 3 && (normalized.startsWith(candidate) || normalized.endsWith(candidate)))
  })
}

function finiteCoordinate(value: unknown) {
  if (value == null || (typeof value === 'string' && !value.trim())) return null
  const number = typeof value === 'number' ? value : Number(String(value).trim())
  return Number.isFinite(number) ? number : null
}

function coordinateSystem(value: unknown): ArtifactCoordinateSystem | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLocaleLowerCase().replace(/[-_\s]/g, '')
  if (normalized === 'wgs84' || normalized === 'epsg4326') return 'wgs84'
  if (normalized === 'gcj02' || normalized === 'mars') return 'gcj02'
  if (normalized === 'bd09' || normalized === 'baidu') return 'bd09'
  return null
}

function outOfChina(lng: number, lat: number) {
  return lng < 72.004 || lng > 137.8347 || lat < .8293 || lat > 55.8271
}

function transformLatitude(lng: number, lat: number) {
  let value = -100 + 2 * lng + 3 * lat + .2 * lat * lat + .1 * lng * lat + .2 * Math.sqrt(Math.abs(lng))
  value += (20 * Math.sin(6 * lng * Math.PI) + 20 * Math.sin(2 * lng * Math.PI)) * 2 / 3
  value += (20 * Math.sin(lat * Math.PI) + 40 * Math.sin(lat / 3 * Math.PI)) * 2 / 3
  return value + (160 * Math.sin(lat / 12 * Math.PI) + 320 * Math.sin(lat * Math.PI / 30)) * 2 / 3
}

function transformLongitude(lng: number, lat: number) {
  let value = 300 + lng + 2 * lat + .1 * lng * lng + .1 * lng * lat + .1 * Math.sqrt(Math.abs(lng))
  value += (20 * Math.sin(6 * lng * Math.PI) + 20 * Math.sin(2 * lng * Math.PI)) * 2 / 3
  value += (20 * Math.sin(lng * Math.PI) + 40 * Math.sin(lng / 3 * Math.PI)) * 2 / 3
  return value + (150 * Math.sin(lng / 12 * Math.PI) + 300 * Math.sin(lng / 30 * Math.PI)) * 2 / 3
}

function gcj02ToWgs84(lng: number, lat: number): [number, number] {
  if (outOfChina(lng, lat)) return [lng, lat]
  const latitude = lat / 180 * Math.PI
  let magic = Math.sin(latitude)
  magic = 1 - .006693421622965943 * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  const deltaLat = transformLatitude(lng - 105, lat - 35) * 180 / ((6335552.717000426 / (magic * sqrtMagic)) * Math.PI)
  const deltaLng = transformLongitude(lng - 105, lat - 35) * 180 / ((6378245 / sqrtMagic) * Math.cos(latitude) * Math.PI)
  return [lng * 2 - (lng + deltaLng), lat * 2 - (lat + deltaLat)]
}

function bd09ToWgs84(lng: number, lat: number): [number, number] {
  const x = lng - .0065
  const y = lat - .006
  const z = Math.sqrt(x * x + y * y) - .00002 * Math.sin(y * Math.PI * 3000 / 180)
  const theta = Math.atan2(y, x) - .000003 * Math.cos(x * Math.PI * 3000 / 180)
  return gcj02ToWgs84(z * Math.cos(theta), z * Math.sin(theta))
}

function coordinateSystemFromProperties(properties: Feature['properties']) {
  if (!properties) return null
  for (const key of COORDINATE_SYSTEM_KEYS) {
    const result = coordinateSystem(properties[key])
    if (result) return result
  }
  return null
}

function convertPosition(position: Position, source: ArtifactCoordinateSystem): Position {
  if (source === 'wgs84') return position
  const converted = source === 'gcj02'
    ? gcj02ToWgs84(Number(position[0]), Number(position[1]))
    : bd09ToWgs84(Number(position[0]), Number(position[1]))
  return [...converted, ...position.slice(2)]
}

function convertGeometry(geometry: Geometry, source: ArtifactCoordinateSystem): Geometry {
  if (geometry.type === 'Point') return { ...geometry, coordinates: convertPosition(geometry.coordinates, source) }
  if (geometry.type === 'MultiPoint' || geometry.type === 'LineString') return { ...geometry, coordinates: geometry.coordinates.map((position) => convertPosition(position, source)) }
  if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') return { ...geometry, coordinates: geometry.coordinates.map((line) => line.map((position) => convertPosition(position, source))) }
  if (geometry.type === 'MultiPolygon') return { ...geometry, coordinates: geometry.coordinates.map((polygon) => polygon.map((ring) => ring.map((position) => convertPosition(position, source)))) }
  return { ...geometry, geometries: geometry.geometries.map((item) => convertGeometry(item, source)) }
}

function validPosition(value: unknown): value is Position {
  if (!Array.isArray(value) || value.length < 2) return false
  const lng = finiteCoordinate(value[0])
  const lat = finiteCoordinate(value[1])
  return lng != null && lat != null && Math.abs(lng) <= 180 && Math.abs(lat) <= 90
}

function normalizeGeometry(value: unknown): Geometry | null {
  if (!value || typeof value !== 'object') return null
  const geometry = value as { type?: unknown; coordinates?: unknown; geometries?: unknown }
  if (typeof geometry.type !== 'string' || !GEOJSON_TYPES.has(geometry.type) || geometry.type === 'Feature' || geometry.type === 'FeatureCollection') return null
  if (geometry.type === 'Point') return validPosition(geometry.coordinates) ? { type: 'Point', coordinates: geometry.coordinates } : null
  if (geometry.type === 'MultiPoint') {
    const coordinates = Array.isArray(geometry.coordinates) ? geometry.coordinates.filter(validPosition) : []
    return coordinates.length ? { type: 'MultiPoint', coordinates } : null
  }
  if (geometry.type === 'LineString') {
    const coordinates = Array.isArray(geometry.coordinates) ? geometry.coordinates.filter(validPosition) : []
    return coordinates.length >= 2 ? { type: 'LineString', coordinates } : null
  }
  if (geometry.type === 'MultiLineString') {
    const coordinates = Array.isArray(geometry.coordinates)
      ? geometry.coordinates.flatMap((line) => {
        const positions = Array.isArray(line) ? line.filter(validPosition) : []
        return positions.length >= 2 ? [positions] : []
      })
      : []
    return coordinates.length ? { type: 'MultiLineString', coordinates } : null
  }
  if (geometry.type === 'Polygon') {
    const coordinates = Array.isArray(geometry.coordinates)
      ? geometry.coordinates.flatMap((ring) => {
        const positions = Array.isArray(ring) ? ring.filter(validPosition) : []
        return positions.length >= 3 ? [positions] : []
      })
      : []
    return coordinates.length ? { type: 'Polygon', coordinates } : null
  }
  if (geometry.type === 'MultiPolygon') {
    const coordinates = Array.isArray(geometry.coordinates)
      ? geometry.coordinates.flatMap((polygon) => {
        if (!Array.isArray(polygon)) return []
        const rings = polygon.flatMap((ring) => {
          const positions = Array.isArray(ring) ? ring.filter(validPosition) : []
          return positions.length >= 3 ? [positions] : []
        })
        return rings.length ? [rings] : []
      })
      : []
    return coordinates.length ? { type: 'MultiPolygon', coordinates } : null
  }
  const geometries = Array.isArray(geometry.geometries) ? geometry.geometries.flatMap((item) => {
    const normalized = normalizeGeometry(item)
    return normalized ? [normalized] : []
  }) : []
  return geometries.length ? { type: 'GeometryCollection', geometries } : null
}

function featureProperties(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asFeatureCollection(value: unknown): FeatureCollection | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { type?: unknown; features?: unknown; geometry?: unknown; properties?: unknown }
  if (typeof candidate.type !== 'string' || !GEOJSON_TYPES.has(candidate.type)) return null
  if (candidate.type === 'FeatureCollection') {
    if (!Array.isArray(candidate.features)) return null
    const features = candidate.features.flatMap((item) => {
      if (!item || typeof item !== 'object' || (item as { type?: unknown }).type !== 'Feature') return []
      const source = item as { geometry?: unknown; properties?: unknown }
      const geometry = normalizeGeometry(source.geometry)
      return geometry ? [{ type: 'Feature', geometry, properties: featureProperties(source.properties) } as Feature] : []
    })
    return features.length ? { type: 'FeatureCollection', features } : null
  }
  if (candidate.type === 'Feature') {
    const geometry = normalizeGeometry(candidate.geometry)
    return geometry ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry, properties: featureProperties(candidate.properties) }] } : null
  }
  const geometry = normalizeGeometry(candidate)
  return geometry ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry, properties: {} }] } : null
}

function coordinateStats(geometry: Geometry | null): { points: number; routes: number } {
  if (!geometry) return { points: 0, routes: 0 }
  if (geometry.type === 'Point') return { points: 1, routes: 0 }
  if (geometry.type === 'MultiPoint') return { points: geometry.coordinates.length, routes: 0 }
  if (geometry.type === 'LineString') return { points: geometry.coordinates.length, routes: 1 }
  if (geometry.type === 'MultiLineString') return { points: geometry.coordinates.reduce((sum, line) => sum + line.length, 0), routes: geometry.coordinates.length }
  if (geometry.type === 'Polygon') return { points: geometry.coordinates.reduce((sum, ring) => sum + ring.length, 0), routes: geometry.coordinates.length }
  if (geometry.type === 'MultiPolygon') return { points: geometry.coordinates.flat(2).length, routes: geometry.coordinates.reduce((sum, polygon) => sum + polygon.length, 0) }
  return geometry.geometries.reduce((total, item) => {
    const current = coordinateStats(item)
    return { points: total.points + current.points, routes: total.routes + current.routes }
  }, { points: 0, routes: 0 })
}

function geometryPositions(geometry: Geometry | null): Position[] {
  if (!geometry) return []
  if (geometry.type === 'Point') return [geometry.coordinates]
  if (geometry.type === 'MultiPoint' || geometry.type === 'LineString') return geometry.coordinates
  if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') return geometry.coordinates.flat()
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat(2)
  return geometry.geometries.flatMap(geometryPositions)
}

function distanceKm(left: Position, right: Position) {
  const radians = (value: number) => value * Math.PI / 180
  const lat1 = radians(Number(left[1]))
  const lat2 = radians(Number(right[1]))
  const latDelta = lat2 - lat1
  const lngDelta = radians(Number(right[0]) - Number(left[0]))
  const value = Math.sin(latDelta / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(lngDelta / 2) ** 2
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

function sequenceDistanceKm(positions: Position[]) {
  return positions.slice(1).reduce((total, position, index) => total + distanceKm(positions[index], position), 0)
}

function geometryDistanceKm(geometry: Geometry | null): number {
  if (!geometry) return 0
  if (geometry.type === 'LineString') return sequenceDistanceKm(geometry.coordinates)
  if (geometry.type === 'MultiLineString') return geometry.coordinates.reduce((total, line) => total + sequenceDistanceKm(line), 0)
  if (geometry.type === 'GeometryCollection') return geometry.geometries.reduce((total, item) => total + geometryDistanceKm(item), 0)
  return 0
}

function createDocument(geojson: FeatureCollection, sourceFormat: ArtifactMapDocument['sourceFormat']): ArtifactMapDocument {
  const normalizedGeojson: FeatureCollection = {
    ...geojson,
    features: geojson.features.map((feature) => {
      const source = coordinateSystemFromProperties(feature.properties)
      if (!source || source === 'wgs84') return feature
      return {
        ...feature,
        geometry: convertGeometry(feature.geometry, source),
        properties: { ...(feature.properties || {}), sourceCoordinateSystem: source, coordinateSystem: 'wgs84' },
      }
    }),
  }
  const stats = normalizedGeojson.features.reduce((total, feature) => {
    const current = coordinateStats(feature.geometry)
    return { points: total.points + current.points, routes: total.routes + current.routes }
  }, { points: 0, routes: 0 })
  const uniqueCoordinates = new Set(normalizedGeojson.features.flatMap((feature) => geometryPositions(feature.geometry)).map((position) => `${Number(position[0]).toFixed(6)},${Number(position[1]).toFixed(6)}`))
  const totalDistanceKm = normalizedGeojson.features.reduce((total, feature) => total + geometryDistanceKm(feature.geometry), 0)
  return { geojson: normalizedGeojson, pointCount: stats.points, uniquePointCount: uniqueCoordinates.size, routeCount: stats.routes, totalDistanceKm, sourceFormat }
}

function scalarProperties(row: Record<string, unknown>, excluded: Set<string>) {
  const properties: Record<string, unknown> = {}
  for (const [key, rawValue] of Object.entries(row)) {
    if (excluded.has(key) || Object.keys(properties).length >= 20) continue
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) properties[key] = rawValue
    else if (typeof rawValue === 'boolean') properties[key] = rawValue
    else if (typeof rawValue === 'string' && rawValue.trim()) properties[key] = rawValue.trim().slice(0, 240)
    else if (Array.isArray(rawValue)) {
      const values = rawValue.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).slice(0, 8).map((value) => value.trim().slice(0, 500))
      if (values.length) properties[key] = values
    }
  }
  return properties
}

function parseDelimited(content: string, sourceFormat: 'csv' | 'tsv'): ArtifactMapParseResult {
  const parsed = Papa.parse<Record<string, unknown>>(content, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: 'greedy',
    delimiter: sourceFormat === 'tsv' ? '\t' : '',
  })
  const columns = parsed.meta.fields ?? []
  const latitude = matchingColumn(columns, LATITUDE_KEYS)
  const longitude = matchingColumn(columns, LONGITUDE_KEYS)
  if (!latitude || !longitude) return { document: null, error: '表格中未找到经度和纬度列' }
  const order = matchingColumn(columns, ORDER_KEYS)
  const label = matchingColumn(columns, LABEL_KEYS)
  const group = matchingColumn(columns, GROUP_KEYS)
  const rows = parsed.data.flatMap((row, index) => {
    const lat = finiteCoordinate(row[latitude])
    const lng = finiteCoordinate(row[longitude])
    if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return []
    const excluded = new Set([latitude, longitude, order, label, group].filter((value): value is string => Boolean(value)))
    return [{
      lat,
      lng,
      index,
      order: order ? finiteCoordinate(row[order]) : null,
      label: label ? String(row[label] ?? '').trim() : '',
      group: group ? String(row[group] ?? '').trim() : '',
      properties: scalarProperties(row, excluded),
    }]
  })
  if (rows.length === 0) return { document: null, error: '表格中没有有效的经纬度记录' }
  rows.sort((left, right) => (left.order ?? left.index) - (right.order ?? right.index))
  const features: Feature[] = rows.map((row, index) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [row.lng, row.lat] },
    properties: { ...row.properties, name: row.label || `点位 ${index + 1}`, order: row.order ?? index + 1, group: row.group || '路线' },
  }))
  const groups = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = row.group || '__default__'
    const items = groups.get(key) ?? []
    items.push(row)
    groups.set(key, items)
  }
  for (const [key, items] of groups) {
    if (items.length < 2) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: items.map((item) => [item.lng, item.lat]) },
      properties: { name: key === '__default__' ? '路线' : key },
    })
  }
  return { document: createDocument({ type: 'FeatureCollection', features }, sourceFormat), error: null }
}

function xmlDocument(content: string) {
  const document = new DOMParser().parseFromString(content, 'application/xml')
  return document.getElementsByTagName('parsererror').length > 0 ? null : document
}

function xmlElements(parent: Document | Element, localName: string) {
  return Array.from(parent.getElementsByTagNameNS('*', localName))
}

function coordinateSequence(value: string): Position[] {
  return value.trim().split(/\s+/).flatMap((entry) => {
    const [lng, lat, altitude] = entry.split(',').map(Number)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return []
    return [[lng, lat, ...(Number.isFinite(altitude) ? [altitude] : [])]]
  })
}

function xmlText(parent: Document | Element, localName: string) {
  return xmlElements(parent, localName)[0]?.textContent?.trim() || ''
}

function parseKml(content: string): ArtifactMapParseResult {
  const document = xmlDocument(content)
  if (!document) return { document: null, error: 'KML XML 格式无效' }
  const features: Feature[] = []
  for (const placemark of xmlElements(document, 'Placemark')) {
    const name = xmlText(placemark, 'name') || '地图要素'
    const description = xmlText(placemark, 'description')
    const properties = { name, ...(description ? { description: description.slice(0, 500) } : {}) }
    for (const coordinates of xmlElements(placemark, 'coordinates')) {
      const positions = coordinateSequence(coordinates.textContent || '')
      if (positions.length === 1) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: positions[0] }, properties })
      else if (positions.length > 1) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: positions }, properties })
    }
  }
  if (features.length === 0) return { document: null, error: 'KML 中没有可显示的点位或路线' }
  return { document: createDocument({ type: 'FeatureCollection', features }, 'kml'), error: null }
}

function gpxPoint(element: Element): Position | null {
  const lat = finiteCoordinate(element.getAttribute('lat'))
  const lng = finiteCoordinate(element.getAttribute('lon'))
  const elevation = finiteCoordinate(xmlText(element, 'ele'))
  return lat == null || lng == null ? null : [lng, lat, ...(elevation == null ? [] : [elevation])]
}

function parseGpx(content: string): ArtifactMapParseResult {
  const document = xmlDocument(content)
  if (!document) return { document: null, error: 'GPX XML 格式无效' }
  const features: Feature[] = []
  for (const track of [...xmlElements(document, 'trkseg'), ...xmlElements(document, 'rte')]) {
    const points = [...xmlElements(track, 'trkpt'), ...xmlElements(track, 'rtept')]
    const positions = points.flatMap((element) => {
      const point = gpxPoint(element)
      return point ? [point] : []
    })
    const times = points.map((point) => xmlText(point, 'time')).filter(Boolean)
    if (positions.length > 1) features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: positions },
      properties: { name: xmlText(track, 'name') || '轨迹', ...(times[0] ? { startTime: times[0] } : {}), ...(times.at(-1) ? { endTime: times.at(-1) } : {}) },
    })
  }
  for (const waypoint of xmlElements(document, 'wpt')) {
    const point = gpxPoint(waypoint)
    if (!point) continue
    const name = xmlText(waypoint, 'name') || '点位'
    const description = xmlText(waypoint, 'desc') || xmlText(waypoint, 'cmt')
    const time = xmlText(waypoint, 'time')
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: point },
      properties: { name, ...(description ? { description: description.slice(0, 500) } : {}), ...(time ? { time } : {}), ...(point.length > 2 ? { elevation: point[2] } : {}) },
    })
  }
  if (features.length === 0) return { document: null, error: 'GPX 中没有可显示的点位或轨迹' }
  return { document: createDocument({ type: 'FeatureCollection', features }, 'gpx'), error: null }
}

type LiteralBudget = { remaining: number }

function literalKey(node: Expression) {
  if (node.type === 'Identifier') return node.name
  if (node.type === 'Literal' && (typeof node.value === 'string' || typeof node.value === 'number')) return String(node.value)
  return null
}

function staticLiteral(node: Expression, budget: LiteralBudget, depth = 0): unknown {
  budget.remaining -= 1
  if (budget.remaining < 0 || depth > 12) return undefined
  if (node.type === 'Literal') return node.value
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? ''
  if (node.type === 'UnaryExpression' && (node.operator === '-' || node.operator === '+')) {
    const value = staticLiteral(node.argument, budget, depth + 1)
    return typeof value === 'number' ? (node.operator === '-' ? -value : value) : undefined
  }
  if (node.type === 'ArrayExpression') {
    const values: unknown[] = []
    for (const item of node.elements) {
      if (!item || item.type === 'SpreadElement') return undefined
      const value = staticLiteral(item, budget, depth + 1)
      if (value === undefined) return undefined
      values.push(value)
    }
    return values
  }
  if (node.type === 'ObjectExpression') {
    const value: Record<string, unknown> = {}
    for (const item of node.properties) {
      if (item.type !== 'Property' || item.kind !== 'init' || item.method || item.computed) return undefined
      const key = literalKey(item.key)
      if (!key) return undefined
      const child = staticLiteral(item.value, budget, depth + 1)
      if (child === undefined) return undefined
      value[key] = child
    }
    return value
  }
  return undefined
}

function walkAst(node: Node, visitor: (node: Node) => void, budget: LiteralBudget) {
  if (budget.remaining-- <= 0) return
  visitor(node)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'start' || key === 'end' || key === 'loc') continue
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child === 'object' && typeof child.type === 'string') walkAst(child as Node, visitor, budget)
    } else if (value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string') {
      walkAst(value as Node, visitor, budget)
    }
  }
}

function recordValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (record[key] != null) return record[key]
  const normalized = new Map(Object.keys(record).map((key) => [normalizedColumn(key), key]))
  for (const key of keys) {
    const source = normalized.get(normalizedColumn(key))
    if (source && record[source] != null) return record[source]
  }
  return undefined
}

function htmlPoint(record: unknown) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null
  const item = record as Record<string, unknown>
  const lat = finiteCoordinate(recordValue(item, HTML_LATITUDE_KEYS))
  const lng = finiteCoordinate(recordValue(item, HTML_LONGITUDE_KEYS))
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { item, lat, lng }
}

function htmlProperties(record: Record<string, unknown>, fallbackName: string, order?: number) {
  const properties = scalarProperties(record, new Set([...HTML_LATITUDE_KEYS, ...HTML_LONGITUDE_KEYS, ...HTML_LABEL_KEYS, ...HTML_ROUTE_KEYS, ...HTML_ROUTE_COORDINATE_KEYS]))
  const label = recordValue(record, HTML_LABEL_KEYS)
  return { ...properties, name: typeof label === 'string' && label.trim() ? label.trim() : fallbackName, ...(order == null ? {} : { order }) }
}

function coordinateMetadata(properties: Record<string, unknown>) {
  for (const key of COORDINATE_SYSTEM_KEYS) {
    const value = properties[key]
    if (coordinateSystem(value)) return { coordinateSystem: value }
  }
  return {}
}

function featuresFromPointArray(value: unknown[], groupName: string, color?: string, connect = true, routeProperties: Record<string, unknown> = {}) {
  const points = value.flatMap((item, index) => {
    const point = htmlPoint(item)
    return point ? [{ ...point, index }] : []
  })
  if (points.length === 0) return []
  const features: Feature[] = points.map((point, index) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
    properties: {
      ...coordinateMetadata(routeProperties),
      ...htmlProperties(point.item, `${groupName} ${index + 1}`, point.index + 1),
      group: typeof recordValue(point.item, HTML_GROUP_KEYS) === 'string' && String(recordValue(point.item, HTML_GROUP_KEYS)).trim()
        ? String(recordValue(point.item, HTML_GROUP_KEYS)).trim()
        : groupName,
      ...(color ? { color } : {}),
    },
  }))
  if (connect && points.length >= 2) features.push({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: points.map((point) => [point.lng, point.lat]) },
    properties: { ...routeProperties, name: groupName, ...(color ? { color } : {}) },
  })
  return features
}

function routeCoordinates(value: unknown) {
  if (!Array.isArray(value)) return null
  const positions = value.filter(validPosition).map((position) => [Number(position[0]), Number(position[1]), ...position.slice(2)] as Position)
  return positions.length >= 2 && positions.length === value.length ? positions : null
}

function chartLikeStaticValue(value: Record<string, unknown>) {
  return Array.isArray(value.series) && (Array.isArray(value.categories) || Array.isArray(value.xAxis) || typeof value.type === 'string')
}

function featuresFromStaticRecord(record: Record<string, unknown>, fallbackName: string) {
  const point = htmlPoint(record)
  if (point) return featuresFromPointArray([record], fallbackName, undefined, false)
  const label = recordValue(record, HTML_LABEL_KEYS)
  const groupName = typeof label === 'string' && label.trim() ? label.trim() : fallbackName
  const colorValue = record.color
  const color = typeof colorValue === 'string' && /^#[0-9a-f]{3,8}$/i.test(colorValue) ? colorValue : undefined
  const coordinates = HTML_ROUTE_COORDINATE_KEYS
    .map((key) => routeCoordinates(recordValue(record, [key])))
    .find((candidate): candidate is Position[] => Boolean(candidate))
  if (!coordinates) return []
  const routeProperties = scalarProperties(record, new Set([...HTML_ROUTE_KEYS, ...HTML_ROUTE_COORDINATE_KEYS, ...HTML_LABEL_KEYS, 'color']))
  return [{
    type: 'Feature',
    geometry: { type: 'LineString', coordinates },
    properties: { ...routeProperties, name: groupName, ...(color ? { color } : {}) },
  } as Feature]
}

function featuresFromStaticValue(value: unknown, fallbackName: string, depth = 0): Feature[] {
  const geojson = asFeatureCollection(value)
  if (geojson) return geojson.features
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const direct = featuresFromStaticRecord(record, fallbackName)
    if (direct.length > 0 || depth >= 2 || chartLikeStaticValue(record)) return direct
    return Object.entries(record).flatMap(([key, nested]) => {
      if (!STATIC_MAP_CONTAINER_KEYS.has(normalizedColumn(key))) return []
      return featuresFromStaticValue(nested, key, depth + 1)
    })
  }
  if (!Array.isArray(value)) return []
  const directPoints = value.filter((item) => htmlPoint(item)).length
  if (directPoints > 0 && directPoints >= Math.ceil(value.length / 2)) {
    const connect = /(?:route|track|path|line|路线|线路|轨迹|路径)/i.test(fallbackName)
    return featuresFromPointArray(value, fallbackName, undefined, connect)
  }
  const features: Feature[] = []
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return
    const record = entry as Record<string, unknown>
    const routeValue = HTML_ROUTE_KEYS.map((key) => recordValue(record, [key])).find((candidate) => Array.isArray(candidate) && candidate.some((item) => htmlPoint(item)))
    const label = recordValue(record, HTML_LABEL_KEYS)
    const groupName = typeof label === 'string' && label.trim() ? label.trim() : `${fallbackName} ${index + 1}`
    const colorValue = record.color
    const color = typeof colorValue === 'string' && /^#[0-9a-f]{3,8}$/i.test(colorValue) ? colorValue : undefined
    const routeProperties = scalarProperties(record, new Set([...HTML_ROUTE_KEYS, ...HTML_ROUTE_COORDINATE_KEYS, ...HTML_LABEL_KEYS, 'color']))
    if (Array.isArray(routeValue)) {
      features.push(...featuresFromPointArray(routeValue, groupName, color, true, routeProperties))
      return
    }
    const coordinates = HTML_ROUTE_COORDINATE_KEYS
      .map((key) => routeCoordinates(recordValue(record, [key])))
      .find((candidate): candidate is Position[] => Boolean(candidate))
    if (!coordinates) return
    features.push(...featuresFromStaticRecord(record, groupName))
  })
  return features
}

function parseHtmlMap(content: string): ArtifactMapParseResult {
  const document = new DOMParser().parseFromString(content, 'text/html')
  const features: Feature[] = []
  for (const script of Array.from(document.querySelectorAll('script[type="application/json"]'))) {
    if (!script.hasAttribute('data-ai-office-map') && !script.classList.contains('geojson')) continue
    try {
      const value = JSON.parse(script.textContent || '')
      features.push(...featuresFromStaticValue(value, '内嵌地图'))
    } catch {
      continue
    }
  }
  for (const script of Array.from(document.querySelectorAll('script:not([src])'))) {
    const scriptType = script.getAttribute('type') || ''
    if ((scriptType && scriptType !== 'text/javascript' && scriptType !== 'application/javascript') || !script.textContent?.trim() || script.textContent.length > 2_000_000) continue
    let program: Program
    try { program = parse(script.textContent, { ecmaVersion: 'latest', sourceType: 'script' }) }
    catch { continue }
    walkAst(program, (node) => {
      if (node.type !== 'VariableDeclarator') return
      const declarator = node as VariableDeclarator
      if (declarator.id.type !== 'Identifier' || !declarator.init) return
      const value = staticLiteral(declarator.init, { remaining: 20_000 })
      if (value === undefined) return
      features.push(...featuresFromStaticValue(value, declarator.id.name))
    }, { remaining: 50_000 })
  }
  if (features.length === 0) return { document: null, error: null }
  return { document: createDocument({ type: 'FeatureCollection', features }, 'html'), error: null }
}

/**
 * 功能：把地图产物或 HTML 内嵌静态路线转换为统一 GeoJSON 文档；参数：相对路径和 UTF-8 正文。
 * 返回：地图文档、格式错误或非地图空结果；错误：返回中文字符串，不抛业务异常。
 * 状态：无状态纯函数；并发与取消：无异步操作，不涉及取消。
 * 权限：不访问文件系统和网络；关联：文件中心和对话产物查看器。
 */
export function parseArtifactMap(path: string, content: string): ArtifactMapParseResult {
  const extension = path.toLocaleLowerCase().match(/\.([^.]+)$/)?.[1] || ''
  try {
    if (extension === 'csv' || extension === 'tsv') return parseDelimited(content, extension)
    if (extension === 'kml') return parseKml(content)
    if (extension === 'gpx') return parseGpx(content)
    if (extension === 'html' || extension === 'htm') return parseHtmlMap(content)
    if (extension !== 'geojson' && extension !== 'json') return { document: null, error: null }
    const value = JSON.parse(content)
    const geojson = asFeatureCollection(value)
    if (geojson) return { document: createDocument(geojson, 'geojson'), error: null }
    if (extension === 'geojson') return { document: null, error: '文件不是有效的 GeoJSON 对象' }
    const features = featuresFromStaticValue(value, 'JSON 地图')
    return features.length > 0
      ? { document: createDocument({ type: 'FeatureCollection', features }, 'json'), error: null }
      : { document: null, error: null }
  } catch (error) {
    if (extension === 'json') return { document: null, error: null }
    return { document: null, error: error instanceof Error ? `地图数据解析失败：${error.message}` : '地图数据解析失败' }
  }
}
