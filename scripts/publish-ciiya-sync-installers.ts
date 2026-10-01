import { config } from 'dotenv'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getR2Config } from '../src/lib/storage/config'
import { CIIYA_SYNC_INSTALLERS, ciiyaSyncInstallerKey } from '../src/lib/ciiya-sync/installers'

config({ path: '.env.local', quiet: true })
const files = {
  'mac-arm64': 'release/ciiya-sync-macos-style/Ciiya-Sync-0.1.0-macOS-style-arm64.dmg',
  windows: 'release/ciiya-sync-windows-style/Ciiya-Sync-0.1.0-win.exe',
}

async function main() {
  // Validate both local files before any remote writes.
  for (const installer of CIIYA_SYNC_INSTALLERS) {
    const file = files[installer.id]
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(file)) hash.update(chunk)
    if ((await stat(file)).size !== installer.bytes || hash.digest('hex') !== installer.sha256) {
      throw new Error(`LOCAL_ARTIFACT_MISMATCH: ${installer.id}`)
    }
    console.log(`${installer.id}: local SHA-256 verified`)
  }
  if (!process.argv.includes('--apply')) {
    console.log('Dry run: pass --apply to publish the two verified installers (no overwrite).')
    return
  }
  const r2 = getR2Config()
  const client = new S3Client({
    region: 'auto', endpoint: r2.endpoint,
    credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
  })
  try {
    for (const installer of CIIYA_SYNC_INSTALLERS) {
      const object = { Bucket: r2.bucketName, Key: ciiyaSyncInstallerKey(installer) }
      let exists = false
      try {
        const head = await client.send(new HeadObjectCommand(object))
        if (head.ContentLength !== installer.bytes || head.Metadata?.sha256 !== installer.sha256) {
          throw new Error(`REMOTE_ARTIFACT_MISMATCH: ${installer.id}`)
        }
        exists = true
      } catch (error) {
        if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw error
      }
      if (!exists) {
        console.log(`${installer.id}: uploading verified installer`)
        await client.send(new PutObjectCommand({
          ...object, Body: createReadStream(files[installer.id]), ContentLength: installer.bytes,
          ContentType: installer.id === 'mac-arm64' ? 'application/x-apple-diskimage' : 'application/octet-stream',
          ContentDisposition: `attachment; filename="${installer.filename}"`,
          CacheControl: 'private, max-age=0', Metadata: { sha256: installer.sha256 }, IfNoneMatch: '*',
        }))
      }
      // Verify browser-style signed delivery, including the full remote byte hash.
      const url = await getSignedUrl(client, new GetObjectCommand(object), { expiresIn: 900 })
      const response = await fetch(url)
      if (!response.ok || !response.body) throw new Error(`DOWNLOAD_FAILED: ${installer.id}`)
      const hash = createHash('sha256')
      let bytes = 0
      const reader = response.body.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          hash.update(value)
          bytes += value.length
        }
      } finally { reader.releaseLock() }
      if (bytes !== installer.bytes || hash.digest('hex') !== installer.sha256) {
        throw new Error(`REMOTE_CHECKSUM_FAILED: ${installer.id}`)
      }
      console.log(`${installer.id}: remote download + SHA-256 verified (${bytes} bytes)`)
    }
  } finally { client.destroy() }
}

main().catch((error) => {
  // Never print SDK requests, environment values, or signed URLs.
  console.error('Installer publication failed:', error?.name || 'Error', error?.$metadata?.httpStatusCode || '')
  process.exitCode = 1
})
