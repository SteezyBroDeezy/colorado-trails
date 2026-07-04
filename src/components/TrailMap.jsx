import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

// Free vector tiles, no API key required
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

const COLORADO_CENTER = [-105.55, 39.0]
// Keep users roughly over Colorado (with a little margin for context)
const MAX_BOUNDS = [
  [-112.5, 34.5],
  [-98.5, 43.5],
]

function TrailMap() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)

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

    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  return <div ref={containerRef} className="h-full w-full" />
}

export default TrailMap
