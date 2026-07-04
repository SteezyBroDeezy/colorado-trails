import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { loadTrailsGeoJSON } from '../lib/trails'

// Free vector tiles, no API key required
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

const COLORADO_CENTER = [-105.55, 39.0]
// Keep users roughly over Colorado (with a little margin for context)
const MAX_BOUNDS = [
  [-112.5, 34.5],
  [-98.5, 43.5],
]

const DIFFICULTY_COLORS = [
  'match',
  ['get', 'difficulty'],
  'easy',
  '#059669',
  'moderate',
  '#d97706',
  '#dc2626', // hard
]

function TrailMap({ trailsVersion }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
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
        return
      }
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
    })

    return () => {
      cancelled = true
    }
  }, [mapReady, trailsVersion])

  return <div ref={containerRef} className="h-full w-full" />
}

export default TrailMap
