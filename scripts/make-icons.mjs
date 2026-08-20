#!/usr/bin/env node
/**
 * Generates the PWA icon set: a typographic "W" drawn as a stroked polyline,
 * rasterised with anti-aliasing and written as PNG.
 *
 * Written from scratch on purpose — an icon generator is not worth a
 * dependency, and zlib (all a PNG needs) ships with Node.
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

const BG = [61, 90, 254]      // --accent
const FG = [255, 255, 255]

/** The W, in unit coordinates. */
const STROKE = [
  [0.180, 0.270], [0.340, 0.735], [0.500, 0.430], [0.660, 0.735], [0.820, 0.270],
]

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  const cx = ax + t * dx, cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * @param size   pixel size
 * @param inset  0 for a normal icon; ~0.1 for maskable (safe-zone padding)
 * @param round  corner radius as a fraction of size (0 = square, maskable)
 */
function drawIcon(size, { inset = 0, round = 0.22 } = {}) {
  const px = Buffer.alloc(size * size * 4)
  const thickness = 0.075 * (1 - inset * 2)
  const radius = round * size
  const scale = 1 - inset * 2

  const AA = 2 // supersampling factor
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgCover = 0, fgCover = 0
      for (let sy = 0; sy < AA; sy++) {
        for (let sx = 0; sx < AA; sx++) {
          const fx = (x + (sx + 0.5) / AA) / size
          const fy = (y + (sy + 0.5) / AA) / size

          // rounded-rect coverage
          const ax = Math.abs(fx * size - size / 2) - (size / 2 - radius)
          const ay = Math.abs(fy * size - size / 2) - (size / 2 - radius)
          const inside = ax <= 0 || ay <= 0
            ? true
            : Math.hypot(ax, ay) <= radius
          if (!inside) continue
          bgCover++

          // W coverage, in the inset sub-square
          const ux = (fx - inset) / scale
          const uy = (fy - inset) / scale
          let d = Infinity
          for (let i = 0; i < STROKE.length - 1; i++) {
            d = Math.min(d, distToSegment(ux, uy, STROKE[i], STROKE[i + 1]))
          }
          if (d <= thickness / scale / 2) fgCover++
        }
      }
      const total = AA * AA
      const o = (y * size + x) * 4
      if (!bgCover) { px[o + 3] = 0; continue }
      const fgRatio = fgCover / bgCover
      for (let c = 0; c < 3; c++) {
        px[o + c] = Math.round(BG[c] * (1 - fgRatio) + FG[c] * fgRatio)
      }
      px[o + 3] = Math.round((bgCover / total) * 255)
    }
  }
  return encodePng(size, size, px)
}

mkdirSync(OUT, { recursive: true })

const targets = [
  ['icon-192.png', 192, { round: 0.22 }],
  ['icon-512.png', 512, { round: 0.22 }],
  ['icon-maskable-192.png', 192, { round: 0, inset: 0.1 }],
  ['icon-maskable-512.png', 512, { round: 0, inset: 0.1 }],
  ['apple-touch-icon.png', 180, { round: 0 }],
]

for (const [name, size, opts] of targets) {
  const png = drawIcon(size, opts)
  writeFileSync(join(OUT, name), png)
  console.log(`  ${name.padEnd(26)} ${String(size).padStart(3)}px  ${(png.length / 1024).toFixed(1)} kB`)
}

// Scalable favicon — same shape, as SVG.
const path = STROKE.map(([x, y], i) => `${i ? 'L' : 'M'}${(x * 100).toFixed(1)} ${(y * 100).toFixed(1)}`).join(' ')
writeFileSync(
  join(OUT, '..', 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="rgb(${BG})"/>
  <path d="${path}" fill="none" stroke="rgb(${FG})" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>\n`,
)
console.log('  favicon.svg')
