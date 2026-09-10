import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const sourceEntries = [
  'src',
  'workers',
  'scripts',
  'e2e',
  'next.config.ts',
  'playwright.config.ts',
]

const platformManaged = new Set([
  'CI',
  'NODE_ENV',
  'RAILWAY_REPLICA_ID',
  'VERCEL_ENV',
  'VERCEL_PROJECT_PRODUCTION_URL',
  'VERCEL_URL',
])

// These are intentionally read through process.env[name] helper functions.
const dynamicallyRead = [
  'MAINTENANCE_CLEANUP_DRY_RUN',
  'MAINTENANCE_CLEANUP_LIMIT',
  'MAINTENANCE_HEARTBEAT_KEEP_HOURS',
  'MAINTENANCE_LOG_KEEP_DAYS',
  'STORAGE_CLEANUP_DRY_RUN',
  'STORAGE_CLEANUP_LIMIT',
]

function sourceFiles(entry) {
  const absolute = path.join(root, entry)
  if (!existsSync(absolute)) return []
  if (!statSync(absolute).isDirectory()) return [absolute]

  return readdirSync(absolute, { withFileTypes: true }).flatMap((item) => {
    const child = path.join(absolute, item.name)
    if (item.isDirectory()) return sourceFiles(path.relative(root, child))
    return /\.(?:c|m)?(?:j|t)sx?$/.test(item.name) ? [child] : []
  })
}

const referenced = new Set(dynamicallyRead)
const directReference = /process\.env\.([A-Z][A-Z0-9_]*)/g

for (const file of sourceEntries.flatMap(sourceFiles)) {
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(directReference)) {
    referenced.add(match[1])
  }
}

for (const name of platformManaged) referenced.delete(name)

const examplePath = path.join(root, '.env.example')
const example = readFileSync(examplePath, 'utf8')
const documented = new Set(
  [...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1])
)

const missing = [...referenced]
  .filter((name) => !documented.has(name))
  .sort()

if (missing.length > 0) {
  console.error(
    `.env.example is missing ${missing.length} referenced variable(s):\n${missing
      .map((name) => `- ${name}`)
      .join('\n')}`
  )
  process.exit(1)
}

console.log(
  `.env.example covers all ${referenced.size} application environment variables.`
)
