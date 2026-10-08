import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { extractFile } from '@electron/asar'

// Static inspection only: never launch an EXE or claim a native Windows test.
const directory = path.resolve(process.argv[2] || 'release/ciiya-sync-domain-20261007/windows')
const source = path.resolve('desktop/ciiya-sync')

function machine(bytes: Buffer) {
  assert.equal(bytes.subarray(0, 2).toString(), 'MZ')
  const offset = bytes.readUInt32LE(0x3c)
  assert.equal(bytes.readUInt32LE(offset), 0x4550)
  return bytes.readUInt16LE(offset + 4)
}

async function main() {
  const icon = await readFile(path.join(source, 'assets/app-icon.ico'))
  const iconImages = Array.from({ length: icon.readUInt16LE(4) }, (_, index) => {
    const entry = 6 + index * 16
    const size = icon.readUInt32LE(entry + 8)
    const offset = icon.readUInt32LE(entry + 12)
    return icon.subarray(offset, offset + size)
  })
  for (const [folder, expectedMachine] of [['win-unpacked', 0x8664], ['win-arm64-unpacked', 0xaa64]] as const) {
    const root = path.join(directory, folder)
    const executable = await readFile(path.join(root, 'Ciiya Sync.exe'))
    assert.equal(machine(executable), expectedMachine, `${folder}: PE architecture`)
    for (const image of iconImages) assert.ok(executable.includes(image), `${folder}: embedded logo resolution`)
    const asar = path.join(root, 'resources/app.asar')
    const main = extractFile(asar, 'main.cjs').toString('utf8')
    assert.match(main, /https:\/\/www\.ciiya\.app/)
    assert.match(main, /releaseChannel\s*:\s*["']canary["']/)
    assert.match(main, /contextIsolation: true/)
    assert.match(main, /nodeIntegration: false/)
    assert.match(main, /sandbox: true/)
    assert.match(main, /safeStorage\.encryptString/)
    assert.doesNotMatch(main, /(?:sk_live_|rk_live_|whsec_)[A-Za-z0-9]{16,}/)
    assert.deepEqual(extractFile(asar, 'native-icons/app-icon.ico'), icon)
    for (const name of ['index.html', 'renderer.js', 'styles.css']) {
      assert.deepEqual(extractFile(asar, `renderer/${name}`), await readFile(path.join(source, 'renderer', name)))
    }
    const plugin = 'lightroom/CiiyaSync.lrplugin'
    for (const name of await readdir(path.join(source, plugin))) {
      assert.deepEqual(await readFile(path.join(root, 'resources', plugin, name)), await readFile(path.join(source, plugin, name)))
    }
    console.log(`${folder}: architecture, bundled renderer, secure shell, canonical domain, icons and external Lightroom plugin verified`)
  }
  for (const name of ['Ciiya-Sync-0.1.0-win.exe', 'Ciiya-Sync-0.1.0-win-x64.exe', 'Ciiya-Sync-0.1.0-win-arm64.exe']) {
    const installer = await readFile(path.join(directory, name))
    machine(installer)
    for (const image of iconImages) assert.ok(installer.includes(image), `${name}: installer logo resolution`)
    console.log(`${name}: PE installer and embedded logo verified`)
  }
  console.log('Static Windows package audit passed. This static audit does not validate native installation, SmartScreen or Lightroom end-to-end behavior.')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
