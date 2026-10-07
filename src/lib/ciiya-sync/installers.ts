// Immutable, verified desktop artifacts. Never accept storage keys from a request.
export const CIIYA_SYNC_INSTALLERS = [
  {
    id: 'mac-arm64',
    platform: 'macOS',
    version: '0.1.0',
    build: '2026-10-07',
    filename: 'Ciiya-Sync-0.1.0-mac-arm64.dmg',
    bytes: 118338039,
    sha256: '620959905717eb7cfc108c831e08bd26dea1911cb08fa0a74b2b33a3f9d9e278',
  },
  {
    id: 'windows',
    platform: 'Windows',
    version: '0.1.0',
    build: '2026-10-07',
    filename: 'Ciiya-Sync-0.1.0-win.exe',
    bytes: 234984129,
    sha256: '35c527e9135c888e12849f0805d1d985b674153c2a7a6cacb1f899fd7f9ac3aa',
  },
] as const

export type CiiyaSyncInstaller = (typeof CIIYA_SYNC_INSTALLERS)[number]

export function findCiiyaSyncInstaller(id: string | null) {
  return CIIYA_SYNC_INSTALLERS.find((installer) => installer.id === id)
}

export function ciiyaSyncInstallerKey(installer: CiiyaSyncInstaller) {
  return `releases/ciiya-sync/${installer.version}/${installer.sha256}/${installer.filename}`
}
