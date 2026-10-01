import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const desktopRoot = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(desktopRoot, '../..')
const outputRoot = path.join(projectRoot, 'dist/ciiya-sync')
const requestedReleaseChannel = String(
  process.env.CIIYA_SYNC_RELEASE_CHANNEL || 'development'
)
  .trim()
  .toLowerCase()
const releaseChannel = ['development', 'canary', 'stable'].includes(
  requestedReleaseChannel
)
  ? requestedReleaseChannel
  : 'development'

await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: true,
  external: ['electron'],
  logLevel: 'info',
  define: {
    CIIYA_SYNC_RELEASE_CHANNEL: JSON.stringify(releaseChannel),
  },
}

await Promise.all([
  build({
    ...shared,
    entryPoints: [path.join(desktopRoot, 'src/main.ts')],
    outfile: path.join(outputRoot, 'main.cjs'),
  }),
  build({
    ...shared,
    entryPoints: [path.join(desktopRoot, 'src/preload.ts')],
    outfile: path.join(outputRoot, 'preload.cjs'),
  }),
])

await cp(path.join(desktopRoot, 'renderer'), path.join(outputRoot, 'renderer'), {
  recursive: true,
})
// Bundle the supplied vector artwork locally; the renderer needs no network.
await Promise.all(['logo-mark.svg', 'logo-usage.svg'].map((name) =>
  cp(path.join(projectRoot, 'public', name), path.join(outputRoot, 'renderer', name))
))
const nativeIconsRoot = path.join(outputRoot, 'native-icons')
await mkdir(nativeIconsRoot, { recursive: true })
await Promise.all(['app-icon.ico', 'app-icon.png', 'trayTemplate.png', 'trayTemplate@2x.png'].map((name) =>
  cp(path.join(desktopRoot, 'assets', name), path.join(nativeIconsRoot, name))
))
const rendererFontsRoot = path.join(outputRoot, 'renderer/fonts')
await mkdir(rendererFontsRoot, { recursive: true })
await Promise.all(
  ['Regular', 'Medium', 'SemiBold', 'Bold'].map((weight) =>
    cp(
      path.join(projectRoot, `src/app/fonts/FCMittraphap-${weight}.ttf`),
      path.join(rendererFontsRoot, `FCMittraphap-${weight}.ttf`)
    )
  )
)
await cp(path.join(desktopRoot, 'lightroom'), path.join(outputRoot, 'lightroom'), {
  recursive: true,
})

const projectPackage = JSON.parse(
  await readFile(path.join(projectRoot, 'package.json'), 'utf8')
)
await writeFile(
  path.join(outputRoot, 'package.json'),
  `${JSON.stringify(
    {
      name: 'ciiya-sync-desktop',
      productName: 'Ciiya Sync',
      version: projectPackage.version,
      description: 'Automatic Lightroom export delivery for Ciiya galleries',
      author: 'Ciiya',
      private: true,
      main: 'main.cjs',
    },
    null,
    2
  )}\n`
)

console.log(
  `Ciiya Sync desktop ${releaseChannel} bundle created at ${outputRoot}`
)
