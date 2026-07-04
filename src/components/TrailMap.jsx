import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { loadTrailsGeoJSON } from '../lib/trails'
import { registerOfmProtocol } from '../lib/tileCache'

// Local snapshot of the OpenFreeMap liberty style; its vector source
// uses our ofm:// protocol so tiles are cached offline by z/x/y
// (regen with: node scripts/fetch-map-style.mjs)
const MAP_STYLE = `${import.meta.env?.BASE_URL ?? '/'}map-style/liberty.json`

const COLORADO_CENTER = [-105.55, 39.0]
// Keep users roughly over Colorado (with a little margin for context)
const MAX_BOUNDS = [
  [-112.5, 34.5],
  [-98.5, 43.5],
]

const EMPTY_FC = { type: 'FeatureCollection', features: [] }

const DIFFICULTY_COLORS = [
  'match',
  ['get', 'difficulty'],
  'easy',
  '#059669',
  'moderate',
  '#d97706',
  '#dc2626', // hard
]

function geometryBounds(geometry) {
  const lines =
    geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates
  const bounds = new maplibregl.LngLatBounds()
  for (const line of lines) {
    for (const coord of line) bounds.extend(coord)
  }
  return bounds
}

function ensureSelectedLayers(map) {
  if (!map.getSource('selected')) {
    map.addSource('selected', { type: 'geojson', data: EMPTY_FC })
    map.addLayer({
      id: 'selected-halo',
      type: 'line',
      source: 'selected',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 5, 14, 9],
      },
    })
    map.addLayer({
      id: 'selected-line',
      type: 'line',
      source: 'selected',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#2563eb',
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 14, 5],
      },
    })
  } else {
    // keep selection above the trails layer after it (re)loads
    map.moveLayer('selected-halo')
    map.moveLayer('selected-line')
  }
}

function TrailMap({ trailsVersion, selected, onSelectId }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)
  const onSelectIdRef = useRef(onSelectId)
  onSelectIdRef.current = onSelectId

  useEffect(() => {
    registerOfmProtocol()
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: COLORADO_CENTER,
      zoom: 6,
      maxBounds: MAX_BOUNDS,
      attributionControl: { compact: true },
    })

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      'top-right',
    )
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      'top-right',
    )

    map.on('load', () => setMapReady(true))
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !trailsVersion || !map) return
    let cancelled = false

    loadTrailsGeoJSON().then((fc) => {
      if (cancelled || !mapRef.current) return
      const source = map.getSource('trails')
      if (source) {
        source.setData(fc)
      } else {
        map.addSource('trails', { type: 'geojson', data: fc })
        map.addLayer({
          id: 'trails-line',
          type: 'line',
          source: 'trails',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': DIFFICULTY_COLORS,
            'line-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              8,
              0.75,
              12,
              2,
              16,
              4,
            ],
            'line-opacity': 0.85,
          },
        })
        map.on('click', 'trails-line', (e) => {
          const id = e.features?.[0]?.properties?.id
          if (id != null) onSelectIdRef.current?.(id)
        })
        map.on('mouseenter', 'trails-line', () => {
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', 'trails-line', () => {
          map.getCanvas().style.cursor = ''
        })
      }
      ensureSelectedLayers(map)
    })

    return () => {
      cancelled = true
    }
  }, [mapReady, trailsVersion])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map) return
    ensureSelectedLayers(map)
    const source = map.getSource('selected')
    if (!selected) {
      source.setData(EMPTY_FC)
      return
    }
    source.setData({
      type: 'Feature',
      geometry: selected.geometry,
      properties: {},
    })
    // leave room for the detail sheet at the bottom
    const h = containerRef.current?.clientHeight ?? 600
    map.fitBounds(geometryBounds(selected.geometry), {
      padding: {
        top: 40,
        left: 40,
        right: 40,
        bottom: Math.min(320, Math.round(h * 0.45)),
      },
      maxZoom: 14,
      duration: 800,
    })
  }, [mapReady, selected])

  return <div ref={containerRef} className="h-full w-full" />
}

export default TrailMap
