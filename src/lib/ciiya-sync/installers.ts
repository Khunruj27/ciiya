// Immutable, verified desktop artifacts. Never accept storage keys from a request.
export const CIIYA_SYNC_INSTALLERS = [
  {
    id: 'mac-arm64',
    platform: 'macOS',
    version: '0.1.0',
    build: '2026-10-01',
    filename: 'Ciiya-Sync-0.1.0-macOS-style-arm64.dmg',
    bytes: 118232756,
    sha256: 'b159345436d41c1ecfe9d7703e0f2993d4ef87d6c5093036a2db2f5d63ac8f7f',
  },
  {
    id: 'windows',
    platform: 'Windows',
    version: '0.1.0',
    build: '2026-10-01',
    filename: 'Ciiya-Sync-0.1.0-win.exe',
    bytes: 234984074,
    sha256: 'db7760c9c4e124f2f52291d26d8b6729faf4d7fe16377c4b57141dc8d553ce57',
  },
] as const

export type CiiyaSyncInstaller = (typeof CIIYA_SYNC_INSTALLERS)[number]

export function findCiiyaSyncInstaller(id: string | null) {
  return CIIYA_SYNC_INSTALLERS.find((installer) => installer.id === id)
}

export function ciiyaSyncInstallerKey(installer: CiiyaSyncInstaller) {
  return `releases/ciiya-sync/${installer.version}/${installer.sha256}/${installer.filename}`
}
