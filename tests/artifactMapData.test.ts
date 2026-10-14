import { describe, expect, it } from 'vitest'
import { parseArtifactMap } from '@/components/artifactMapData'

describe('地图产物解析', () => {
  it('解析 GeoJSON 路线和点位', () => {
    const result = parseArtifactMap('routes/demo.geojson', JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [113.26, 23.13] }, properties: { name: '起点' } },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[113.26, 23.13], [112.94, 28.23]] }, properties: { name: '路线' } },
      ],
    }))
    expect(result.error).toBeNull()
    expect(result.document).toMatchObject({ sourceFormat: 'geojson', pointCount: 3, uniquePointCount: 2, routeCount: 1 })
    expect(result.document?.totalDistanceKm).toBeGreaterThan(500)
  })

  it('保留通用 routeName 供路线选择器展示', () => {
    const result = parseArtifactMap('route-name.geojson', JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[113.2, 23.1], [113.3, 23.2]] }, properties: { routeName: 'D1 城区路线' } }],
    }))
    expect(result.document?.geojson.features[0].properties?.routeName).toBe('D1 城区路线')
  })

  it('把带经纬度、顺序和分组的 CSV 转换为多条路线', () => {
    const result = parseArtifactMap('routes.csv', [
      '名称,纬度,经度,顺序,路线',
      '甲,23.13,113.26,1,A',
      '乙,24.48,118.08,2,A',
      '丙,30.27,120.15,1,B',
      '丁,31.23,121.47,2,B',
    ].join('\n'))
    expect(result.error).toBeNull()
    expect(result.document).toMatchObject({ sourceFormat: 'csv', pointCount: 8, uniquePointCount: 4, routeCount: 2 })
    expect(result.document?.geojson.features).toHaveLength(6)
  })

  it('支持 BOM、常见经纬度别名并保留地点属性', () => {
    const result = parseArtifactMap('places.csv', [
      '\uFEFFLocation,Latitude (deg),Longitude (deg),Address,Category,Altitude',
      '观景台,23.1300,113.2600,山顶入口,景点,128.5',
      '酒店,23.1400,113.2700,中心路 1 号,住宿,35',
    ].join('\n'))
    expect(result.error).toBeNull()
    expect(result.document).toMatchObject({ uniquePointCount: 2, routeCount: 1 })
    expect(result.document?.geojson.features[0].properties).toMatchObject({
      name: '观景台', Address: '山顶入口', Category: '景点', Altitude: 128.5,
    })
  })

  it('支持 KML 和 GPX 标准轨迹', () => {
    const kml = parseArtifactMap('route.kml', '<kml><Document><Placemark><name>线路</name><description>沿江路线</description><LineString><coordinates>113.2,23.1 114.0,24.0</coordinates></LineString></Placemark></Document></kml>')
    const gpx = parseArtifactMap('route.gpx', '<gpx><trk><trkseg><trkpt lat="23.1" lon="113.2"><ele>12</ele><time>2026-09-30T01:00:00Z</time></trkpt><trkpt lat="24.0" lon="114.0"><ele>28</ele><time>2026-09-30T02:00:00Z</time></trkpt></trkseg></trk><wpt lat="23.1" lon="113.2"><name>起点</name><desc>集合地点</desc><ele>12</ele><time>2026-09-30T01:00:00Z</time></wpt></gpx>')
    expect(kml.document).toMatchObject({ sourceFormat: 'kml', routeCount: 1 })
    expect(gpx.document).toMatchObject({ sourceFormat: 'gpx', routeCount: 1 })
    expect(kml.document?.geojson.features[0].properties).toMatchObject({ description: '沿江路线' })
    expect(gpx.document?.geojson.features[0].properties).toMatchObject({ startTime: '2026-09-30T01:00:00Z', endTime: '2026-09-30T02:00:00Z' })
    expect(gpx.document?.geojson.features[1].properties).toMatchObject({ description: '集合地点', elevation: 12 })
    expect(gpx.document?.geojson.features[1].geometry).toMatchObject({ coordinates: [113.2, 23.1, 12] })
  })

  it('过滤越界和损坏坐标，保留其余有效要素', () => {
    const result = parseArtifactMap('mixed.geojson', JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [300, 95] }, properties: { name: '错误点' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [121.47, 31.23] }, properties: { name: '有效点' } },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[121.47, 31.23], ['bad', 31.5], [120.15, 30.27]] }, properties: { name: '有效路线' } },
      ],
    }))
    expect(result.error).toBeNull()
    expect(result.document).toMatchObject({ pointCount: 3, uniquePointCount: 2, routeCount: 1 })
    expect(result.document?.geojson.features).toHaveLength(2)
  })

  it('普通 JSON 不误判为地图，错误 GeoJSON 给出原因', () => {
    expect(parseArtifactMap('data.json', '{"items":[1,2]}')).toEqual({ document: null, error: null })
    expect(parseArtifactMap('broken.geojson', '{"type":"FeatureCollection"}').error).toBe('文件不是有效的 GeoJSON 对象')
  })

  it('把普通 POI 数组和带外壳的路线 JSON 转换为地图', () => {
    const points = parseArtifactMap('pois.json', JSON.stringify([
      { name: '车站', lng: 115.42, lat: 22.81, category: '交通' },
      { name: '酒店', lng: 115.36, lat: 22.77, photos: ['https://example.test/hotel.jpg'] },
    ]))
    const wrapped = parseArtifactMap('travel.json', JSON.stringify({
      meta: { title: '旅行数据' },
      pois: [
        { name: '起点', lng: 113.26, lat: 23.13, group: '首日路线' },
        { name: '终点', lng: 113.27, lat: 23.14, group: '首日路线' },
      ],
      routes: [{ routeName: '首日路线', coords: [[113.26, 23.13], [113.27, 23.14]], isRealRoadTrack: false }],
    }))
    expect(points.document).toMatchObject({ sourceFormat: 'json', uniquePointCount: 2, routeCount: 0 })
    expect(points.document?.geojson.features[1].properties).toMatchObject({ name: '酒店', photos: ['https://example.test/hotel.jpg'] })
    expect(wrapped.document).toMatchObject({ sourceFormat: 'json', uniquePointCount: 2, routeCount: 1 })
    expect(wrapped.document?.geojson.features.find((feature) => feature.geometry.type === 'LineString')?.properties).toMatchObject({
      name: '首日路线', isRealRoadTrack: false,
    })
  })

  it('图表和普通配置 JSON 保持结构化文档，不误判为地图', () => {
    expect(parseArtifactMap('chart.json', JSON.stringify({ type: 'bar3d', categories: ['D1'], series: [{ name: '预算', data: [320] }] }))).toEqual({ document: null, error: null })
    expect(parseArtifactMap('config.json', JSON.stringify({ name: '设置', data: { theme: 'light' }, items: [{ key: 'mode', value: 'demo' }] }))).toEqual({ document: null, error: null })
  })

  it('安全提取 HTML 中的静态路线和点位数组', () => {
    const result = parseArtifactMap('trip.html', `<!doctype html><script>
      const DAYS = [{ name: '第一天', color: '#e53935', stops: [
        { n: '车站', lat: 23.13, lng: 113.26, t: '抵达', note: '集合' },
        { n: '酒店', lat: 23.14, lng: 113.27, t: '入住', note: '休息' }
      ] }]
      const FOOD = [{ name: '夜市', lat: 23.15, lng: 113.28, price: '人均 50 元' }]
      window.__unsafe = true
    </script>`)
    expect(result.error).toBeNull()
    expect(result.document).toMatchObject({ sourceFormat: 'html', pointCount: 5, uniquePointCount: 3, routeCount: 1 })
    expect(result.document?.geojson.features[0].properties).toMatchObject({ name: '车站', group: '第一天', t: '抵达', note: '集合' })
    expect(result.document?.geojson.features.some((feature) => feature.properties?.name === '夜市')).toBe(true)
    expect(result.document?.geojson.features.filter((feature) => feature.geometry.type === 'LineString')).toHaveLength(1)
    expect(result.document?.geojson.features.find((feature) => feature.geometry.type === 'LineString')?.properties).toMatchObject({ name: '第一天', color: '#e53935' })
  })

  it('通用识别独立点位数组与坐标路线数组并保留分组', () => {
    const result = parseArtifactMap('plan.html', `<!doctype html><script>
      const POIS = [
        { name: '车站', lat: 23.13, lng: 113.26, group: '首日抵达' },
        { name: '酒店', lat: 23.14, lng: 113.27, group: '首日抵达' },
        { name: '公园', lat: 23.15, lng: 113.28, group: '次日游览' }
      ]
      const ROUTES = [
        { routeName: '首日抵达', day: 1, isRealRoadTrack: false, coords: [[113.26, 23.13], [113.27, 23.14]] },
        { route_name: '次日游览', day: 2, path: [[113.27, 23.14], [113.28, 23.15]] }
      ]
    </script>`)
    expect(result.error).toBeNull()
    expect(result.document).toMatchObject({ sourceFormat: 'html', routeCount: 2, uniquePointCount: 3 })
    expect(result.document?.geojson.features.filter((feature) => feature.geometry.type === 'Point').map((feature) => feature.properties?.group)).toEqual([
      '首日抵达', '首日抵达', '次日游览',
    ])
    expect(result.document?.geojson.features.filter((feature) => feature.geometry.type === 'LineString').map((feature) => feature.properties)).toEqual([
      expect.objectContaining({ name: '首日抵达', day: 1, isRealRoadTrack: false }),
      expect.objectContaining({ name: '次日游览', day: 2 }),
    ])
  })

  it('支持标准内嵌 GeoJSON 且不执行 HTML 表达式', () => {
    const embedded = parseArtifactMap('map.html', `<script type="application/json" data-ai-office-map>{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[113.26,23.13]},"properties":{"name":"起点"}}]}</script>`)
    const executable = parseArtifactMap('unsafe.html', '<script>const points = buildPoints(); window.__unsafe = true</script>')
    expect(embedded.document).toMatchObject({ sourceFormat: 'html', pointCount: 1, routeCount: 0 })
    expect(executable).toEqual({ document: null, error: null })
  })

  it('按显式坐标系把 GCJ-02 和 BD-09 归一为 WGS84', () => {
    const gcj = parseArtifactMap('gcj.geojson', JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [116.404, 39.915] }, properties: { name: 'GCJ 点位', coordinateSystem: 'gcj-02' } }],
    }))
    const bd = parseArtifactMap('bd.geojson', JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [116.410369, 39.921336] }, properties: { name: 'BD 点位', coordinateSystem: 'bd09' } }],
    }))
    const gcjPosition = gcj.document?.geojson.features[0].geometry
    const bdPosition = bd.document?.geojson.features[0].geometry
    expect(gcjPosition).toMatchObject({ type: 'Point' })
    expect(bdPosition).toMatchObject({ type: 'Point' })
    if (gcjPosition?.type !== 'Point' || bdPosition?.type !== 'Point') throw new Error('预期点位几何')
    expect(gcjPosition.coordinates[0]).toBeCloseTo(116.3978, 3)
    expect(gcjPosition.coordinates[1]).toBeCloseTo(39.9136, 3)
    expect(bdPosition.coordinates[0]).toBeCloseTo(116.3978, 3)
    expect(bdPosition.coordinates[1]).toBeCloseTo(39.9136, 3)
    expect(gcj.document?.geojson.features[0].properties).toMatchObject({ sourceCoordinateSystem: 'gcj02', coordinateSystem: 'wgs84' })
  })

  it('保留 HTML 点位的照片数组、评分和来源信息', () => {
    const result = parseArtifactMap('poi.html', `<script>const PLACES=[{
      name:'示例餐厅',lat:23.1,lng:113.2,rating:4.8,ratingCount:321,
      photos:['https://example.test/a.jpg','https://example.test/b.jpg'],sourceUrl:'https://example.test/place'
    }]</script>`)
    expect(result.document?.geojson.features[0].properties).toMatchObject({
      name: '示例餐厅', rating: 4.8, ratingCount: 321,
      photos: ['https://example.test/a.jpg', 'https://example.test/b.jpg'],
      sourceUrl: 'https://example.test/place',
    })
  })
})
