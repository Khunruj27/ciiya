import crypto from 'node:crypto'
import {
  cp,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export type CiiyaSyncLightroomPluginInstallationState =
  | 'not_installed'
  | 'ready'
  | 'update_available'
  | 'repair_required'

export type CiiyaSyncLightroomPluginStatus = {
  supported: boolean
  installed: boolean
  pluginPath: string | null
  version: string | null
  sourceVersion: string | null
  installationState: CiiyaSyncLightroomPluginInstallationState
}

const PLUGIN_FILES = [
  'Info.lua',
  'CiiyaBridge.lua',
  'CiiyaExportServiceProvider.lua',
] as const

type PluginMetadata = {
  version: string
  fingerprint: string
}

function pluginRoot(platform = process.platform) {
  if (platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Adobe',
      'Lightroom',
      'Modules'
    )
  }
  if (platform === 'win32') {
    const appData = process.env.APPDATA
    return appData
      ? path.join(appData, 'Adobe', 'Lightroom', 'Modules')
      : path.join(os.homedir(), 'AppData', 'Roaming', 'Adobe', 'Lightroom', 'Modules')
  }
  return null
}

async function atomicWrite(filePath: string, contents: string) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`
  await writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600 })
  const handle = await open(temporary, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, filePath)
}

function luaString(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function missingPath(error: unknown) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
  )
}

async function inspectPlugin(pluginPath: string): Promise<PluginMetadata> {
  const contents = await Promise.all(
    PLUGIN_FILES.map((fileName) => readFile(path.join(pluginPath, fileName), 'utf8'))
  )
  const info = contents[0]
  if (!/LrToolkitIdentifier\s*=\s*['"]co\.ciiya\.sync\.lightroom['"]/.test(info)) {
    throw new Error('ชุดปลั๊กอินไม่ใช่ Ciiya Sync')
  }
  if (!/LrExportServiceProvider/.test(info)) {
    throw new Error('ชุดปลั๊กอินไม่มี Export Service Provider')
  }
  const version = info.match(/display\s*=\s*['"]([^'"]+)['"]/)?.[1]
  if (!version) throw new Error('ชุดปลั๊กอินไม่มีหมายเลขเวอร์ชัน')

  return {
    version,
    fingerprint: crypto
      .createHash('sha256')
      .update(contents.join('\n-- CIIYA FILE BOUNDARY --\n'))
      .digest('hex'),
  }
}

export class CiiyaSyncBridgeSecretStore {
  private cached: string | null = null

  constructor(readonly filePath: string) {}

  async loadOrCreate() {
    if (this.cached) return this.cached
    try {
      const value = (await readFile(this.filePath, 'utf8')).trim()
      if (/^[A-Za-z0-9_-]{43}$/.test(value)) {
        this.cached = value
        return value
      }
    } catch {
      // A missing or invalid local-only secret is rotated below.
    }
    const value = crypto.randomBytes(32).toString('base64url')
    await atomicWrite(this.filePath, `${value}\n`)
    this.cached = value
    return value
  }
}

export class CiiyaSyncLightroomPluginInstaller {
  constructor(
    readonly sourcePath: string,
    private platform = process.platform,
    private destinationRootOverride?: string
  ) {}

  destinationPath() {
    const root = this.destinationRootOverride || pluginRoot(this.platform)
    return root ? path.join(root, 'CiiyaSync.lrplugin') : null
  }

  async status(): Promise<CiiyaSyncLightroomPluginStatus> {
    const destination = this.destinationPath()
    if (!destination) {
      return {
        supported: false,
        installed: false,
        pluginPath: null,
        version: null,
        sourceVersion: null,
        installationState: 'not_installed',
      }
    }

    let source: PluginMetadata | null = null
    try {
      source = await inspectPlugin(this.sourcePath)
    } catch {
      // A packaged source failure is surfaced as a repair state instead of
      // crashing Ciiya Sync during startup.
    }

    try {
      await stat(destination)
    } catch (error) {
      if (!missingPath(error)) throw error
      return {
        supported: true,
        installed: false,
        pluginPath: destination,
        version: null,
        sourceVersion: source?.version || null,
        installationState: source ? 'not_installed' : 'repair_required',
      }
    }

    try {
      const installed = await inspectPlugin(destination)
      const current = Boolean(
        source && installed.fingerprint === source.fingerprint
      )
      return {
        supported: true,
        installed: true,
        pluginPath: destination,
        version: installed.version,
        sourceVersion: source?.version || null,
        installationState: current ? 'ready' : 'update_available',
      }
    } catch {
      return {
        supported: true,
        installed: false,
        pluginPath: destination,
        version: null,
        sourceVersion: source?.version || null,
        installationState: 'repair_required',
      }
    }
  }

  async install(params: { port: number; secret: string }) {
    const destination = this.destinationPath()
    if (!destination) throw new Error('รองรับปลั๊กอินบน macOS และ Windows เท่านั้น')
    const sourceInfo = await stat(path.join(this.sourcePath, 'Info.lua'))
    if (!sourceInfo.isFile()) throw new Error('ไม่พบชุดติดตั้งปลั๊กอิน Lightroom')

    const source = await inspectPlugin(this.sourcePath)
    const parent = path.dirname(destination)
    const nonce = `${process.pid}-${crypto.randomUUID()}`
    const staging = `${destination}.install-${nonce}`
    const backup = `${destination}.backup-${nonce}`
    let previousMoved = false
    let installed = false

    await mkdir(parent, { recursive: true })
    try {
      await cp(this.sourcePath, staging, { recursive: true, force: true })
      await this.writeConfig(staging, params)
      const staged = await inspectPlugin(staging)
      if (staged.fingerprint !== source.fingerprint) {
        throw new Error('ตรวจสอบไฟล์ปลั๊กอินหลังติดตั้งไม่ผ่าน')
      }
      await stat(path.join(staging, 'BridgeConfig.lua'))

      try {
        await rename(destination, backup)
        previousMoved = true
      } catch (error) {
        if (!missingPath(error)) {
          throw new Error(
            'ไม่สามารถอัปเดตปลั๊กอินได้ กรุณาปิด Lightroom Classic แล้วลองอีกครั้ง'
          )
        }
      }

      try {
        await rename(staging, destination)
        installed = true
      } catch (error) {
        if (previousMoved) await rename(backup, destination).catch(() => undefined)
        throw error
      }
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined)
      if (installed && previousMoved) {
        await rm(backup, { recursive: true, force: true }).catch(() => undefined)
      }
    }

    const status = await this.status()
    if (status.installationState !== 'ready') {
      throw new Error('ติดตั้งปลั๊กอินแล้ว แต่การตรวจสอบความสมบูรณ์ไม่ผ่าน')
    }
    return status
  }

  async refreshConfig(params: { port: number; secret: string }) {
    const status = await this.status()
    if (!status.installed || !status.pluginPath) return status
    await this.writeConfig(status.pluginPath, params)
    return this.status()
  }

  private async writeConfig(
    pluginPath: string,
    params: { port: number; secret: string }
  ) {
    await atomicWrite(
      path.join(pluginPath, 'BridgeConfig.lua'),
      [
        '-- Generated by Ciiya Sync. Do not share this file.',
        'return {',
        `  endpoint = "http://127.0.0.1:${params.port}",`,
        `  secret = "${luaString(params.secret)}",`,
        '}',
        '',
      ].join('\n')
    )
  }
}
