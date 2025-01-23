import * as fs from 'fs'

import chalk from 'chalk'
import { Listener, Middleware } from '.'
import { PluginConfig } from '../pluginTypes'
import { logMessage } from '../utils'
import debounce from 'lodash/debounce'

const lockExists = (path: string) => {
  return fs.existsSync(path)
}

const isLockOwner = (path: string) => {
  return fs.readFileSync(path, 'utf-8') === process.pid.toString()
}

const reportLock = debounce((path: string) => {
  logMessage(`🔒 Lock file ${chalk.blue(path)} exists. Aborting...`)
}, 500)

const middleware: Middleware<PluginConfig<'shadowdog-lock'>> = async ({ next, abort, options }) => {
  const lockFile = options.path

  if (lockExists(lockFile) && !isLockOwner(lockFile)) {
    reportLock(lockFile)
    return abort()
  }

  return next()
}

let counter = 0

const handleCounterDecrement = (lockFile: string) => {
  if (!lockExists(lockFile)) {
    return
  }

  if (isLockOwner(lockFile)) {
    counter -= 1

    if (counter === 0) {
      fs.unlinkSync(lockFile)
    }
  }
}

const listener: Listener<PluginConfig<'shadowdog-lock'>> = (eventEmitter, options) => {
  const lockFile = options.path

  eventEmitter.on('begin', () => {
    if (!lockExists(lockFile)) {
      fs.writeFileSync(lockFile, process.pid.toString())
    }

    if (isLockOwner(lockFile)) {
      counter += 1
    }
  })

  eventEmitter.on('end', () => handleCounterDecrement(lockFile))
  eventEmitter.on('error', () => handleCounterDecrement(lockFile))

  eventEmitter.on('exit', () => {
    if (lockExists(lockFile) && isLockOwner(lockFile)) {
      fs.unlinkSync(lockFile)
    }
  })
}

export default {
  middleware,
  listener,
}
