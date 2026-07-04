// Regenerate PWA PNG icons from public/favicon.svg: node scripts/generate-icons.mjs
import sharp from 'sharp'
import { readFile } from 'node:fs/promises'

const svg = await readFile(new URL('../public/favicon.svg', import.meta.url))

const targets = [
  { file: 'public/pwa-192x192.png', size: 192 },
  { file: 'public/pwa-512x512.png', size: 512 },
  { file: 'public/apple-touch-icon.png', size: 180 },
]

for (const { file, size } of targets) {
  await sharp(svg).resize(size, size).png().toFile(file)
  console.log(`wrote ${file}`)
}

// Maskable icon: same art scaled to ~70% inside a full-bleed background,
// so OS mask shapes (circle, squircle) don't clip the mountains
const inner = await sharp(svg).resize(358, 358).png().toBuffer()
await sharp({
  create: {
    width: 512,
    height: 512,
    channels: 4,
    background: '#022c22',
  },
})
  .composite([{ input: inner, gravity: 'center' }])
  .png()
  .toFile('public/pwa-maskable-512x512.png')
console.log('wrote public/pwa-maskable-512x512.png')
