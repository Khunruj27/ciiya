import dotenv from 'dotenv'
import WebSocket from 'ws'
import { createClient } from '@supabase/supabase-js'

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import fs from 'node:fs/promises'
import path from 'node:path'

dotenv.config({
  path: '.env.local',
})

Object.defineProperty(globalThis, 'WebSocket', {
  value: WebSocket,
  configurable: true,
  writable: true,
})

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const execFileAsync = promisify(execFile)
const GPHOTO_BIN = process.env.GPHOTO_BIN || 'gphoto2'
const CAMERA_IMPORT_TEMP_DIR =
  process.env.CAMERA_IMPORT_TEMP_DIR || '.ciiya-camera-imports'

const POLL_INTERVAL_MS = 1500

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase environment variables')
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

type CameraUploadSession = {
  id: string
  album_id: string
  owner_id: string
  preset_path: string | null
  resize_mode: string | null
  auto_face_scan: boolean | null
  auto_publish: boolean | null
  status: string
  last_activity_at?: string | null
}

type DetectedCamera = {
  model: string
  port: string
}

 type CameraFile = {
  cameraFileId: string
  filename: string
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function expireInactiveSessions() {
  const timeoutAt = new Date(
    Date.now() - 30 * 60 * 1000
  ).toISOString()

  const { error } = await supabase
    .from('camera_upload_sessions')
    .update({
      status: 'stopped',
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'active')
    .lt('last_activity_at', timeoutAt)

  if (error) {
    console.error(
      '[camera-live-import-worker] expire sessions:',
      error.message
    )
  }
}

async function loadActiveSessions() {
  const { data, error } = await supabase
    .from('camera_upload_sessions')
    .select(
      `
      id,
      album_id,
      owner_id,
      preset_path,
      resize_mode,
      auto_face_scan,
      auto_publish,
      status,
      last_activity_at

`)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(10)

  if (error) {
    console.error('[camera-live-import-worker] load sessions failed:', error.message)
    return []
  }

  return (data || []) as CameraUploadSession[]
}

async function detectCamera(): Promise<DetectedCamera | null> {
  try {
    const { stdout } = await execFileAsync(GPHOTO_BIN, ['--auto-detect'], {
      timeout: 5000,
    })

    
    const lines = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    const cameraLine = lines.find(
      (line) =>
        !line.startsWith('Model') &&
        !line.startsWith('-') &&
        line.includes('usb:')
    )

    if (!cameraLine) return null

    const parts = cameraLine.split(/\s{2,}/)

    return {
      model: parts[0]?.trim() || cameraLine,
      port: parts[1]?.trim() || '',
    }
  } catch (error) {
    console.error(
      '[camera-live-import-worker] detect camera failed:',
      error instanceof Error ? error.message : error
    )

    return null
  }
}

function parseCameraFiles(stdout: string): CameraFile[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^#\d+\s+/.test(line))
    .map((line) => {
      const match = line.match(/^#(\d+)\s+(.+)$/)

      if (!match) return null

      const cameraFileId = match[1]
      const filename = match[2].trim()
      const lower = filename.toLowerCase()

      if (!lower.endsWith('.jpg') && !lower.endsWith('.jpeg')) {
        return null
      }

      return {
        cameraFileId,
        filename,
      }
    })
    .filter((file): file is CameraFile => Boolean(file))
}

async function listCameraJpgFiles(): Promise<CameraFile[]> {
  try {
    const { stdout } = await execFileAsync(GPHOTO_BIN, ['--list-files'], {
      timeout: 10000,
    })

    return parseCameraFiles(stdout)
  } catch (error) {
    console.error(
      '[camera-live-import-worker] list camera files failed:',
      error instanceof Error ? error.message : error
    )

    return []
  }
}

async function queueCameraFile(
  session: CameraUploadSession,
  file: CameraFile
) {
  const { error } = await supabase.from('camera_live_imports').upsert(
    {
      session_id: session.id,
      album_id: session.album_id,
      owner_id: session.owner_id,
      camera_file_id: file.cameraFileId,
      filename: file.filename,
      status: 'pending',
      progress: 0,
      detected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: 'album_id,camera_file_id',
      ignoreDuplicates: true,
    }
  )

  if (error) {
    console.error(
      `[camera-live-import-worker] queue file failed filename=${file.filename}:`,
      error.message
    )
  }
}

async function filterNewCameraFiles(
  session: CameraUploadSession,
  files: CameraFile[]
) {
  if (files.length === 0) return []

  const cameraFileIds = files.map((file) => file.cameraFileId)

  const { data, error } = await supabase
    .from('camera_live_imports')
    .select('camera_file_id')
    .eq('album_id', session.album_id)
    .in('camera_file_id', cameraFileIds)

  if (error) {
    console.error(
      '[camera-live-import-worker] filter existing files failed:',
      error.message
    )

    return files
  }

  const existingIds = new Set(
    (data || [])
      .map((item) => item.camera_file_id)
      .filter(Boolean)
  )

  return files.filter(
    (file) => !existingIds.has(file.cameraFileId)
  )
}

async function ensureTempDir() {
  await fs.mkdir(CAMERA_IMPORT_TEMP_DIR, {
    recursive: true,
  })
}

function getSafeLocalFileName(filename: string) {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120)
}

async function downloadCameraFile(
  session: CameraUploadSession,
  file: CameraFile
) {
  await ensureTempDir()

  const albumDir = path.join(
    CAMERA_IMPORT_TEMP_DIR,
    session.album_id
  )

  await fs.mkdir(albumDir, {
    recursive: true,
  })

  const safeName = getSafeLocalFileName(file.filename)
  const localPath = path.join(albumDir, safeName)

  try {
    await execFileAsync(
      GPHOTO_BIN,
      [
        '--get-file',
        file.cameraFileId,
        '--filename',
        localPath,
      ],
      {
        timeout: 30000,
      }
    )

    const stat = await fs.stat(localPath)

    await supabase
      .from('camera_live_imports')
      .update({
        local_path: localPath,
        file_size_bytes: stat.size,
        status: 'imported',
        progress: 50,
        imported_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('album_id', session.album_id)
      .eq('camera_file_id', file.cameraFileId)

    console.log(
      `[camera-live-import-worker] downloaded ${file.filename} -> ${localPath}`
    )
  } catch (error) {
    await supabase
      .from('camera_live_imports')
      .update({
        status: 'failed',
        error:
          error instanceof Error
            ? error.message
            : 'Download failed',
        updated_at: new Date().toISOString(),
      })
      .eq('album_id', session.album_id)
      .eq('camera_file_id', file.cameraFileId)

    console.error(
      `[camera-live-import-worker] download failed filename=${file.filename}:`,
      error instanceof Error ? error.message : error
    )
  }
}

function getUploadSafeFileName(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() || 'jpg'
  const baseName = filename.replace(/\.[^/.]+$/, '')

  const safeBaseName = baseName
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)

  return `${Date.now()}-${crypto.randomUUID()}-${safeBaseName || 'photo'}.${ext}`
}

function getQuickFileHash(filename: string, size: number, cameraFileId: string) {
  return `${filename}-${size}-${cameraFileId}`
}

function isStorageLimitError(error: unknown) {
  const message =
    error instanceof Error ? error.message : String(error || '')

  return (
    message.toLowerCase().includes('storage full') ||
    message.toLowerCase().includes('storage limit') ||
    message.toLowerCase().includes('quota')
  )
}

async function finalizeCameraUpload(params: {
  session: CameraUploadSession
  file: CameraFile
  storagePath: string
  fileSizeBytes: number
}) {
  const { session, file, storagePath, fileSizeBytes } = params

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

  const res = await fetch(`${siteUrl}/api/photos/finalize-upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-secret': process.env.WORKER_SECRET || '',
    },
    body: JSON.stringify({
      albumId: session.album_id,
      storagePath,
      fileName: file.filename,
      fileHash: getQuickFileHash(
        file.filename,
        fileSizeBytes,
        file.cameraFileId
      ),
      fileSizeBytes,
      size: session.resize_mode || 'original',
      categoryId: null,
      presetPath: session.preset_path,
      autoFaceScan: session.auto_face_scan ?? true,
      autoPublish: session.auto_publish ?? false,
    }),
  })

  const json = await res.json().catch(() => null)

  if (!res.ok || !json?.success) {
    throw new Error(json?.error || json?.jobError || 'Finalize upload failed')
  }

  return json
}

async function uploadLocalCameraFile(
  session: CameraUploadSession,
  file: CameraFile
) {
  const { data: importRow, error: importError } = await supabase
    .from('camera_live_imports')
    .select('id, local_path, file_size_bytes, status')
    .eq('album_id', session.album_id)
    .eq('camera_file_id', file.cameraFileId)
    .maybeSingle()

  if (importError || !importRow?.local_path) {
    console.error(
      `[camera-live-import-worker] missing local file row filename=${file.filename}:`,
      importError?.message || 'No local_path'
    )
    return
  }

  if (
  importRow.status === 'uploading' ||
  importRow.status === 'finalizing' ||
  importRow.status === 'uploaded' ||
  importRow.status === 'done'
) {
  return
}

  try {
    await supabase
      .from('camera_live_imports')
      .update({
        status: 'uploading',
        progress: 70,
        updated_at: new Date().toISOString(),
      })
      .eq('id', importRow.id)

    const fileBuffer = await fs.readFile(importRow.local_path)
    const fileSizeBytes = Number(importRow.file_size_bytes || fileBuffer.length)

    const safeFileName = getUploadSafeFileName(file.filename)
    const storagePath = `${session.owner_id}/${session.album_id}/original/${safeFileName}`

    const { error: uploadError } = await supabase.storage
      .from('albums')
      .upload(storagePath, fileBuffer, {
        contentType: 'image/jpeg',
        upsert: false,
      })

    if (uploadError) {
      throw new Error(uploadError.message)
    }

    await supabase
      .from('camera_live_imports')
      .update({
        storage_path: storagePath,
        status: 'finalizing',
        progress: 85,
        updated_at: new Date().toISOString(),
      })
      .eq('id', importRow.id)

    await finalizeCameraUpload({
      session,
      file,
      storagePath,
      fileSizeBytes,
    })

    await supabase
      .from('camera_live_imports')
      .update({
        status: 'done',
        progress: 100,
        uploaded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', importRow.id)

    console.log(
  `[camera-live-import-worker] DONE album=${session.album_id} file=${file.filename}`
)
    } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Upload/finalize failed'

    const { data: failedRow } = await supabase
      .from('camera_live_imports')
      .select('storage_path')
      .eq('album_id', session.album_id)
      .eq('camera_file_id', file.cameraFileId)
      .maybeSingle()

    if (failedRow?.storage_path) {
      const { error: removeError } = await supabase.storage
        .from('albums')
        .remove([failedRow.storage_path])

      if (removeError) {
        console.error(
          `[camera-live-import-worker] cleanup uploaded file failed path=${failedRow.storage_path}:`,
          removeError.message
        )
      }
    }

    await supabase
      .from('camera_live_imports')
      .update({
        status: 'failed',
        error: isStorageLimitError(error)
          ? 'Storage full. Please upgrade plan or free up space.'
          : message,
        updated_at: new Date().toISOString(),
      })
      .eq('album_id', session.album_id)
      .eq('camera_file_id', file.cameraFileId)

    console.error(
      `[camera-live-import-worker] upload/finalize failed album=${session.album_id} filename=${file.filename}:`,
      message
    )
  }
}

async function processSession(session: CameraUploadSession) {
  const camera = await detectCamera()

  if (!camera) {
    console.log(
      `[camera-live-import-worker] no camera detected for album=${session.album_id}`
    )
    return
  }

  console.log(
    `[camera-live-import-worker] camera connected model="${camera.model}" port="${camera.port}" album=${session.album_id}`
  )

  const files = await listCameraJpgFiles()

  if (files.length === 0) {
    console.log(
      `[camera-live-import-worker] no JPG files found album=${session.album_id}`
    )
    return
  }

  console.log(
    `[camera-live-import-worker] found ${files.length} JPG file(s): ${files
      .slice(0, 5)
      .map((file) => file.filename)
      .join(', ')}`
  )
  
  const newFiles = await filterNewCameraFiles(session, files)

  if (newFiles.length > 0) {
  await supabase
    .from('camera_upload_sessions')
    .update({
      last_activity_at: new Date().toISOString(),
    })
    .eq('id', session.id)
}

if (newFiles.length === 0) {
  console.log(
    `[camera-live-import-worker] no new JPG files album=${session.album_id}`
  )
  return
}

console.log(
  `[camera-live-import-worker] album=${session.album_id} queueing ${newFiles.length} new JPG file(s)`
)

for (const file of newFiles) {
  await queueCameraFile(session, file)
}

for (const file of newFiles) {
  await downloadCameraFile(session, file)
  await uploadLocalCameraFile(session, file)
}
}

async function main() {
  console.log('[camera-live-import-worker] started')

  while (true) {
    try {
      await expireInactiveSessions()

      const sessions = await loadActiveSessions()

      if (sessions.length === 0) {
        console.log('[camera-live-import-worker] no active sessions')
      }

      for (const session of sessions) {
        await processSession(session)
      }
    } catch (error) {
      console.error('[camera-live-import-worker] loop error:', error)
    }

    await sleep(POLL_INTERVAL_MS)
  }
}

main().catch((error) => {
  console.error('[camera-live-import-worker] fatal:', error)
  process.exit(1)
})