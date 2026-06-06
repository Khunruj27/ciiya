import { exec } from 'child_process'

function run(command: string) {
  return new Promise<void>((resolve) => {
    console.log(`\n[AutoMaintenance] ${command}`)

    exec(command, (error, stdout, stderr) => {
      if (stdout) console.log(stdout)
      if (stderr) console.error(stderr)

      if (error) {
        console.error(error)
      }

      resolve()
    })
  })
}

async function main() {
  console.log('=================================')
  console.log('CIIYA AUTO MAINTENANCE START')
  console.log('=================================')

  await run('tsx scripts/reset-stuck-jobs.ts')

  await run('tsx scripts/retry-failed-jobs.ts')

  await run('tsx scripts/cleanup-orphan-files.ts')

  await run('tsx scripts/system-health-check.ts')

  console.log('=================================')
  console.log('CIIYA AUTO MAINTENANCE DONE')
  console.log('=================================')
}

main().catch(console.error)