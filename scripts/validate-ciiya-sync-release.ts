import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { CiiyaSyncReleaseManifest } from './build-ciiya-sync-release-manifest'

const execFile = promisify(execFileCallback)

async function sha256(filePath: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function validateStaticConfiguration(projectRoot: string) {
  const [builder, entitlements, workflow] = await Promise.all([
    readFile(
      path.join(projectRoot, 'desktop/ciiya-sync/electron-builder.yml'),
      'utf8'
    ),
    readFile(
      path.join(projectRoot, 'desktop/ciiya-sync/entitlements.mac.plist'),
      'utf8'
    ),
    readFile(
      path.join(projectRoot, '.github/workflows/ciiya-sync-release.yml'),
      'utf8'
    ),
  ])

  assert.match(builder, /entitlements:/)
  assert.match(builder, /entitlementsInherit:/)
  assert.match(builder, /notarize: true/)
  assert.match(builder, /signingHashAlgorithms:[\s\S]*sha256/)
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/)
  assert.match(workflow, /APPLE_APP_SPECIFIC_PASSWORD/)
  assert.match(workflow, /WIN_CSC_LINK/)
  assert.match(workflow, /validate:ciiya-sync:release/)
}

async function validateManifest(releaseDirectory: string) {
  const manifestPath = path.join(releaseDirectory, 'release-manifest.json')
  const manifest = JSON.parse(
    await readFile(manifestPath, 'utf8')
  ) as CiiyaSyncReleaseManifest

  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.product, 'Ciiya Sync')
  assert.ok(['canary', 'stable'].includes(manifest.channel))
  assert.ok(manifest.artifacts.length > 0)

  for (const artifact of manifest.artifacts) {
    assert.match(artifact.path, /\.(?:dmg|exe|msi|zip)$/i)
    assert.doesNotMatch(artifact.path, /\.\.|^\//)
    const filePath = path.resolve(releaseDirectory, artifact.path)
    assert.ok(filePath.startsWith(`${path.resolve(releaseDirectory)}${path.sep}`))
    assert.equal(await sha256(filePath), artifact.sha256)
  }

  return manifest
}

async function validateMacSigning(releaseDirectory: string) {
  const manifest = await validateManifest(releaseDirectory)
  const diskImages = manifest.artifacts.filter((artifact) =>
    artifact.path.toLowerCase().endsWith('.dmg')
  )
  assert.ok(diskImages.length > 0, 'No macOS DMG artifact found')

  for (const artifact of diskImages) {
    const filePath = path.join(releaseDirectory, artifact.path)
    await execFile('codesign', ['--verify', '--strict', '--verbose=2', filePath])
    await execFile('spctl', [
      '--assess',
      '--type',
      'open',
      '--context',
      'context:primary-signature',
      '--verbose=2',
      filePath,
    ])
    await execFile('xcrun', ['stapler', 'validate', filePath])
  }
}

async function validateWindowsSigning(releaseDirectory: string) {
  const manifest = await validateManifest(releaseDirectory)
  const installers = manifest.artifacts.filter((artifact) =>
    /\.(?:exe|msi)$/i.test(artifact.path)
  )
  assert.ok(installers.length > 0, 'No Windows installer artifact found')

  for (const artifact of installers) {
    const filePath = path.join(releaseDirectory, artifact.path)
    const escapedPath = filePath.replaceAll("'", "''")
    await execFile('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$signature = Get-AuthenticodeSignature -LiteralPath '${escapedPath}'; if ($signature.Status -ne 'Valid') { throw \"Invalid Authenticode signature: $($signature.Status)\" }`,
    ])
  }
}

async function main() {
  const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..'
  )
  const directoryIndex = process.argv.indexOf('--release-dir')
  const releaseDirectory = path.resolve(
    projectRoot,
    directoryIndex >= 0 && process.argv[directoryIndex + 1]
      ? process.argv[directoryIndex + 1]
      : process.env.CIIYA_SYNC_RELEASE_DIRECTORY || 'release/ciiya-sync'
  )
  const requireSigning = process.argv.includes('--require-signing')

  await validateStaticConfiguration(projectRoot)
  if (requireSigning) {
    if (process.platform === 'darwin') {
      await validateMacSigning(releaseDirectory)
    } else if (process.platform === 'win32') {
      await validateWindowsSigning(releaseDirectory)
    } else {
      throw new Error('Signed release validation requires macOS or Windows')
    }
  }

  console.log(
    requireSigning
      ? 'Ciiya Sync release checksums and platform signatures are valid.'
      : 'Ciiya Sync release signing configuration is valid.'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
