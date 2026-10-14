/* global __dirname, Buffer, process, console */
// Deterministic raster exports of Ciiya's existing vector mark; no new design.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../node_modules/sharp');
const source = fs.readFileSync(path.resolve(__dirname, '../../public/logo-mark.svg'));
const mark = `data:image/svg+xml;base64,${source.toString('base64')}`;
const destination = path.resolve(__dirname, '../assets/images');

function artwork(size, width, background) {
  const height = width * 755.34 / 1012.02;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    ${background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : ''}
    <image href="${mark}" x="${(size - width) / 2}" y="${(size - height) / 2}" width="${width}" height="${height}"/>
  </svg>`);
}

async function render() {
  for (const [name, size, width, background] of [
    ['ciiya-icon.png', 1024, 680, '#f8f6f1'],
    ['ciiya-adaptive-foreground.png', 1024, 590, null],
    ['ciiya-monochrome.png', 1024, 590, null],
    ['ciiya-splash.png', 512, 460, null],
    ['ciiya-favicon.png', 64, 52, '#f8f6f1'],
  ]) {
    await sharp(artwork(size, width, background)).png().toFile(path.join(destination, name));
  }
  console.log('Rendered five Ciiya assets from public/logo-mark.svg');
}
render().catch((error) => { console.error(error.message); process.exitCode = 1; });
