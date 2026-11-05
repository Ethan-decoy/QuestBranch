import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Reuse the C2 paths on a transparent canvas. The executable uses deep jade;
// native windows can use bright jade on dark system surfaces.
const output = new URL('../build/', import.meta.url)
const mask = readFileSync(new URL('../src/ui/assets/c2-mark.svg', import.meta.url), 'utf8')
const svg = mask
  .replace(/^<!--[^]*?-->\s*/, '')
  .replace('<svg ', '<svg width="1024" height="1024" ')
  .replaceAll('fill="#000000"', 'fill="#156146"')
mkdirSync(output, { recursive: true })
writeFileSync(new URL('icon.svg', output), svg)

if (process.argv.includes('--render')) {
  // Raster exports are checked in; ordinary builds do not need sharp. Brand
  // maintainers may supply a Node package directory containing sharp.
  const require = createRequire(
    process.env.QUESTBRANCH_ICON_NODE_MODULES
      ? resolve(process.env.QUESTBRANCH_ICON_NODE_MODULES, '../package.json')
      : import.meta.url,
  )
  const sharp = require('sharp')
  await sharp(Buffer.from(svg))
    .png()
    .toFile(fileURLToPath(new URL('icon.png', output)))
  await sharp(Buffer.from(svg.replaceAll('#156146', '#55e9b0')))
    .png()
    .toFile(fileURLToPath(new URL('icon-dark.png', output)))
  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
  const images = await Promise.all(
    sizes.map((size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer()),
  )
  const header = Buffer.alloc(6 + sizes.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  for (const [index, size] of sizes.entries()) {
    const entry = 6 + index * 16
    header[entry] = header[entry + 1] = size === 256 ? 0 : size
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(images[index].length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += images[index].length
  }
  writeFileSync(new URL('icon.ico', output), Buffer.concat([header, ...images]))
}
console.log(`Exported C2 application icon: ${fileURLToPath(output)}`)
