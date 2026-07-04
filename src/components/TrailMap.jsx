import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { loadTrailsGeoJSON } from '../lib/trails'
import { registerOfmProtocol } from '../lib/tileCache'
import { conditionsGeoJSON } from '../lib/conditions'

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

const FIRE_LAYERS = ['fires-fill', 'fires-outline', 'fires-pts']

function TrailMap({ trailsVersion, selected, onSelectId, conditionsOn, conditionsVersion }) {
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
        // gold casing under 14er routes so they pop at every zoom
        map.addLayer({
          id: 'trails-14er',
          type: 'line',
          source: 'trails',
          filter: ['==', ['get', 'is14er'], true],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#facc15',
            'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 12, 7, 16, 12],
            'line-opacity': 0.7,
          },
        })
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
        // invisible fat hit-target so trails are easy to tap on a phone,
        // including switching directly from one selected trail to another
        map.addLayer({
          id: 'trails-hit',
          type: 'line',
          source: 'trails',
          paint: {
            'line-color': 'rgba(0,0,0,0.001)',
            'line-width': 18,
          },
        })
        map.on('click', 'trails-hit', (e) => {
          const id = e.features?.[0]?.properties?.id
          if (id != null) onSelectIdRef.current?.(id)
        })
        map.on('mouseenter', 'trails-hit', () => {
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', 'trails-hit', () => {
          map.getCanvas().style.cursor = ''
        })
      }
      ensureSelectedLayers(map)
    })

    return () => {
      cancelled = true
    }
  }, [mapReady, trailsVersion])

  // wildfire overlay — strictly opt-in, drawn under the trail layers
  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map) return
    if (!conditionsOn) {
      for (const l of FIRE_LAYERS) {
        if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', 'none')
      }
      return
    }
    let cancelled = false
    conditionsGeoJSON().then(({ perimeters, incidents }) => {
      if (cancelled || !mapRef.current) return
      const beforeId = map.getLayer('trails-14er') ? 'trails-14er' : undefined
      if (!map.getSource('fires-peri')) {
        map.addSource('fires-peri', { type: 'geojson', data: perimeters })
        map.addSource('fires-pts', { type: 'geojson', data: incidents })
        map.addLayer(
          {
            id: 'fires-fill',
            type: 'fill',
            source: 'fires-peri',
            paint: { 'fill-color': '#dc2626', 'fill-opacity': 0.18 },
          },
          beforeId,
        )
        map.addLayer(
          {
            id: 'fires-outline',
            type: 'line',
            source: 'fires-peri',
            paint: {
              'line-color': '#dc2626',
              'line-width': 1.5,
              'line-dasharray': [2, 1],
            },
          },
          beforeId,
        )
        map.addLayer(
          {
            id: 'fires-pts',
            type: 'circle',
            source: 'fires-pts',
            paint: {
              'circle-color': '#dc2626',
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 4, 12, 8],
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 1.5,
              'circle-opacity': 0.9,
            },
          },
          beforeId,
        )
      } else {
        map.getSource('fires-peri').setData(perimeters)
        map.getSource('fires-pts').setData(incidents)
      }
      for (const l of FIRE_LAYERS) {
        map.setLayoutProperty(l, 'visibility', 'visible')
      }
    })
    return () => {
      cancelled = true
    }
  }, [mapReady, conditionsOn, conditionsVersion])

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
