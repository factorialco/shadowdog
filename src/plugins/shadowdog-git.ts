import * as fs from 'fs'
import uniq from 'lodash/uniq'
import * as path from 'path'

import chalk from 'chalk'
import { Middleware } from '.'
import { chalkFiles, logMessage } from '../utils'

const INTERVAL_TIME = 2000

let timeoutId: NodeJS.Timeout | null = null
let pendingChangedFiles: string[] = []

const middleware: Middleware = async ({ next, abort, changedFilePath }) => {
  const lockFile = path.join(process.cwd(), '.git/rebase-merge')

  if (changedFilePath && fs.existsSync(lockFile)) {
    logMessage(`✋ Git is rebasing. Skipping file change for '${chalk.blue(changedFilePath)}'...`)
    pendingChangedFiles = uniq([...pendingChangedFiles, changedFilePath])

    if (!timeoutId) {
      timeoutId = setInterval(async () => {
        if (!fs.existsSync(lockFile)) {
          logMessage(
            `🔄 Git rebase was completed. Resuming file watchers for ${chalk.cyan(pendingChangedFiles.length)} files. (Ex: ${chalkFiles(pendingChangedFiles.slice(0, 3))})`,
          )

          const now = new Date()

          pendingChangedFiles.forEach((filePath) => {
            fs.utimesSync(filePath, now, now)
          })

          pendingChangedFiles = []
          if (timeoutId) {
            clearInterval(timeoutId)
          }
          timeoutId = null
        }
      }, INTERVAL_TIME)
    }

    return abort()
  }

  return next()
}

export default {
  middleware,
}
