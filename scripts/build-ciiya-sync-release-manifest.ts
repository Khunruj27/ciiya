import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export type CiiyaSyncReleaseChannel = 'canary' | 'stable'

export type CiiyaSyncReleaseArtifact = {
  path: string
  sizeBytes: number
  sha256: string
}

export type CiiyaSyncReleaseManifest = {
  schemaVersion: 1
  product: 'Ciiya Sync'
  version: string
  channel: CiiyaSyncReleaseChannel
  generatedAt: string
  artifacts: CiiyaSyncReleaseArtifact[]
}

const RELEASE_ARTIFACT_PATTERN = /\.(?:dmg|exe|msi|zip)$/i

async function filesIn(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await filesIn(absolutePath)))
    } else if (entry.isFile() && RELEASE_ARTIFACT_PATTERN.test(entry.name)) {
      files.push(absolutePath)
    }
  }

  return files
}

async function sha256(filePath: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

function releaseChannel(value: string | undefined): CiiyaSyncReleaseChannel {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'canary' || normalized === 'stable') return normalized
  throw new Error(
    'CIIYA_SYNC_RELEASE_CHANNEL must be canary or stable for a release build'
  )
}

export async function buildCiiyaSyncReleaseManifest(options: {
  projectRoot: string
  releaseDirectory: string
  channel?: string
  generatedAt?: string
}) {
  const packageJson = JSON.parse(
    await readFile(path.join(options.projectRoot, 'package.json'), 'utf8')
  ) as { version?: string }
  const version = String(packageJson.version || '').trim()
  if (!version) throw new Error('Ciiya Sync release version is missing')

  const files = (await filesIn(options.releaseDirectory)).sort()
  if (files.length === 0) {
    throw new Error(`No Ciiya Sync release artifacts found in ${options.releaseDirectory}`)
  }

  const artifacts: CiiyaSyncReleaseArtifact[] = []
  for (const filePath of files) {
    const metadata = await stat(filePath)
    artifacts.push({
      path: path
        .relative(options.releaseDirectory, filePath)
        .split(path.sep)
        .join('/'),
      sizeBytes: metadata.size,
      sha256: await sha256(filePath),
    })
  }

  const manifest: CiiyaSyncReleaseManifest = {
    schemaVersion: 1,
    product: 'Ciiya Sync',
    version,
    channel: releaseChannel(options.channel),
    generatedAt: options.generatedAt || new Date().toISOString(),
    artifacts,
  }
  const manifestPath = path.join(
    options.releaseDirectory,
    'release-manifest.json'
  )
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o644,
  })
  return { manifest, manifestPath }
}

async function main() {
  const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..'
  )
  const releaseDirectory = path.resolve(
    projectRoot,
    process.env.CIIYA_SYNC_RELEASE_DIRECTORY || 'release/ciiya-sync'
  )
  const result = await buildCiiyaSyncReleaseManifest({
    projectRoot,
    releaseDirectory,
    channel: process.env.CIIYA_SYNC_RELEASE_CHANNEL,
  })
  console.log(
    `Created ${result.manifest.channel} release manifest for ${result.manifest.artifacts.length} artifact(s): ${result.manifestPath}`
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
