# Colorado Trails - Offline PWA Trail Guide

## What this is
An offline-first PWA for browsing Colorado hiking trails.
Modeled on the architecture of mtg-card-search (same author):
download data once → store in IndexedDB → all queries run locally.

## Stack
- React + Vite + Tailwind
- vite-plugin-pwa with useRegisterSW "Update Available" banner
- Dexie.js (IndexedDB) for trail data storage
- MapLibre GL JS for the map
- Offline tile caching (Cache Storage), downloadable by region

## Core features (v1)
1. "Download Trails" button: fetch Colorado trail GeoJSON → IndexedDB
2. Search/filter trails by name, length, difficulty — offline via Dexie
3. Trail detail view: map line, distance, elevation, trailhead coords
4. "Directions" button: deep-link to Google Maps
   (https://www.google.com/maps/dir/?api=1&destination=LAT,LNG)
5. Show user GPS position on map (works offline)
6. Region-based offline tile downloads (e.g. Front Range, San Juans)

## Data source
COTREX (Colorado Trail Explorer) open data / OSM Overpass —
research and pick the most practical free source first.

## Build order (work in phases, one at a time)
1. Scaffold + map of Colorado renders + PWA installable
2. Trail data pipeline: fetch GeoJSON → Dexie → draw trails on map
3. Search/filter UI against IndexedDB
4. Trail detail page + Google Maps deep link
5. Offline tile caching by region (hardest — use Plan Mode)
6. Update banner via useRegisterSW

## Conventions
- Mobile-first UI (this is used on phones on trails)
- No backend for v1 — static hosting + client-side everything
- Commit to git after each working phase
