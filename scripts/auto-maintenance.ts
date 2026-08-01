import { spawn } from 'node:child_process'

type Step = {
  name: string
  command: string
  args: string[]
  optional?: boolean
}

const steps: Step[] = [
  {
    name: 'System Health Check',
    command: 'npm',
    args: ['run', 'health:check'],
  },
  {
    name: 'Retry Failed Jobs',
    command: 'npm',
    args: ['run', 'retry:failed'],
  },
  {
    name: 'Storage Cleanup Dry Run',
    command: 'npm',
    args: ['run', 'storage:cleanup'],
  },
  {
    name: 'Maintenance Cleanup Dry Run',
    command: 'npm',
    args: ['run', 'maintenance:cleanup'],
  },
]

function runStep(step: Step) {
  return new Promise<void>((resolve, reject) => {
    console.log('\n==============================')
    console.log(step.name)
    console.log('==============================')

    const child = spawn(step.command, step.args, {
      stdio: 'inherit',
      shell: true,
      env: {
        ...process.env,
      },
    })

    child.on('exit', (code) => {
      if (code === 0 || step.optional) {
        resolve()
        return
      }

      reject(new Error(`${step.name} failed with exit code ${code}`))
    })

    child.on('error', (error) => {
      if (step.optional) {
        console.warn(`[maintenance] optional step failed: ${error.message}`)
        resolve()
        return
      }

      reject(error)
    })
  })
}

async function main() {
  console.log('\nCIIYA AUTO MAINTENANCE STARTED')

  for (const step of steps) {
    await runStep(step)
  }

  console.log('\n==============================')
  console.log('CIIYA AUTO MAINTENANCE DONE')
  console.log('==============================')
}

main().catch((error) => {
  console.error('\n[maintenance] failed:', error)
  process.exit(1)
})