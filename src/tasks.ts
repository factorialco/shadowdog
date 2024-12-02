import * as childProcess from 'child_process'
import { logMessage } from './utils'
import chalk from 'chalk'

interface Options {
  command: string
  workingDirectory: string
  changedFilePath?: string
  onSpawn?: (task: childProcess.ChildProcess) => void
}

export const runTask = ({ command, workingDirectory, changedFilePath, onSpawn }: Options) => {
  return new Promise<void>((resolve, reject) => {
    const fullCommand = changedFilePath ? command.replace('$FILE', changedFilePath) : command
    let errorMessage = ''

    const start = Date.now()

    const task = childProcess.spawn(fullCommand, {
      detached: true,
      shell: true,
      cwd: workingDirectory,
    })

    logMessage(`🏭️ Running command (PID: ${chalk.magenta(task.pid)}) '${chalk.blue(command)}'`)

    if (onSpawn) {
      onSpawn(task)
    }

    task.stderr.on('data', (data) => (errorMessage += data.toString()))

    task.on('exit', async (exitCode) => {
      if (exitCode === 0) {
        const seconds = ((Date.now() - start) / 1000).toFixed(2)

        logMessage(
          `✅ Command (PID: ${chalk.magenta(task.pid)}) '${chalk.blue(
            command,
          )}' has exited successfully ${chalk.cyan(`(${seconds}s)`)}`,
        )

        return resolve()
      }

      logMessage(
        `🚫 Command (PID: ${chalk.magenta(task.pid)}) '${chalk.blue(command)}' has failed.`,
      )

      if (errorMessage) {
        logMessage(errorMessage)
      }

      return reject(new Error(errorMessage))
    })
  })
}
