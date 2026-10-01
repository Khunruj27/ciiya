// Regenerate all native icons from the supplied public/logo-mark.svg.
// PNG/ICO work on all hosts; ICNS uses the macOS iconutil supplied by Apple.
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets')
const logo = (await readFile(path.resolve(assets, '../../../public/logo-mark.svg'), 'utf8'))
  .replace(/<\?xml[^>]*\?>\s*/, '')
const frame = await readFile(path.join(assets, 'app-icon.svg'), 'utf8')
const artwork = logo.replace(/<svg[^>]*>/,
  '<svg x="230" y="270" width="564" height="430" viewBox="0 0 1012.02 755.34">')
const svg = Buffer.from(frame.replace(/<g fill="#1d1d1f"><svg[\s\S]*?<\/svg><\/g>/,
  '<g fill="#1d1d1f">' + artwork + '</g>'))
await writeFile(path.join(assets, 'app-icon.svg'), svg)
await sharp(svg).resize(1024, 1024).png().toFile(path.join(assets, 'app-icon.png'))
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
const images = await Promise.all(sizes.map(size => sharp(svg).resize(size, size).png().toBuffer()))
const header = Buffer.alloc(6 + sizes.length * 16)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(sizes.length, 4)
let offset = header.length
images.forEach((image, index) => {
  const entry = 6 + index * 16
  header[entry] = header[entry + 1] = sizes[index] === 256 ? 0 : sizes[index]
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(image.length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += image.length
})
await writeFile(path.join(assets, 'app-icon.ico'), Buffer.concat([header, ...images]))
// nativeImage does not load SVG: bundle real PNGs for macOS/Linux trays.
const tray = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  logo.replace(/<svg[^>]*>/, '<svg x="2" y="4" width="28" height="24" viewBox="0 0 1012.02 755.34">') +
  '</svg>')
await sharp(tray).resize(16, 16).png().toFile(path.join(assets, 'trayTemplate.png'))
await sharp(tray).resize(32, 32).png().toFile(path.join(assets, 'trayTemplate@2x.png'))
if (process.platform === 'darwin') {
  const temporary = await mkdtemp(path.join(tmpdir(), 'ciiya-icons-'))
  try {
    const iconset = path.join(temporary, 'Ciiya.iconset')
    await mkdir(iconset)
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        await sharp(svg).resize(size * scale, size * scale).png()
          .toFile(path.join(iconset, 'icon_' + size + 'x' + size + (scale === 2 ? '@2x' : '') + '.png'))
      }
    }
    execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(assets, 'app-icon.icns')])
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
console.log('Ciiya Sync native icons generated.')
