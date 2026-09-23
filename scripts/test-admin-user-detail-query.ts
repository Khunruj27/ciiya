import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function main() {
  const route = await readFile(
    new URL('../src/app/api/admin/users/[id]/route.ts', import.meta.url),
    'utf8'
  )

  assert.match(
    route,
    /photos!photos_album_id_fkey\(count\)/,
    'Admin user detail must select the album-to-photos relationship explicitly'
  )
  assert.doesNotMatch(
    route,
    /\bphotos\(count\)/,
    'An unqualified photos embed is ambiguous when albums also reference a cover photo'
  )

  console.log('Admin user detail relationship checks passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
