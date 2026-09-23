import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function main() {
  const [photoWorker, faceWorker] = await Promise.all([
    readFile(new URL('../workers/photo-worker.ts', import.meta.url), 'utf8'),
    readFile(new URL('../workers/face-worker.ts', import.meta.url), 'utf8'),
  ])

  for (const [name, source] of [
    ['Photo Worker', photoWorker],
    ['Face Worker', faceWorker],
  ] as const) {
    assert.match(
      source,
      /while \(!isShuttingDown\)/,
      `${name} must stop polling after a shutdown signal`
    )
    assert.match(
      source,
      /allowDuringShutdown: true/,
      `${name} must be able to mark its heartbeat offline during shutdown`
    )
    assert.doesNotMatch(
      source,
      /if \(isShuttingDown\) \{\s*continue/,
      `${name} must not busy-loop while shutting down`
    )
    assert.doesNotMatch(
      source,
      /process\.exit\(0\)/,
      `${name} should let the event loop drain after cleanup`
    )
  }

  assert.doesNotMatch(
    faceWorker,
    /no pending face jobs/,
    'Face Worker must not emit an idle log on every poll'
  )

  console.log('Worker graceful-shutdown checks passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
