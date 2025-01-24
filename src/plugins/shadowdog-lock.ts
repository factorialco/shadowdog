import * as fs from 'fs-extra'

import chalk from 'chalk'
import { Listener, Middleware } from '.'
import { PluginConfig } from '../pluginTypes'
import { logMessage, exit } from '../utils'
import path from 'path'

const lockExists = (lockFile: string) => {
  return fs.existsSync(lockFile)
}

const isLockOwner = (lockFile: string) => {
  return fs.readFileSync(lockFile, 'utf-8') === process.pid.toString()
}

const middleware: Middleware<PluginConfig<'shadowdog-lock'>> = async ({
  eventEmitter,
  next,
  options,
}) => {
  const lockFile = options.path

  if (lockExists(lockFile) && !isLockOwner(lockFile)) {
    logMessage(`🔒 Lock file ${chalk.blue(lockFile)} exists. Aborting...`)
    return exit(eventEmitter, 1)
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
      fs.mkdirpSync(path.dirname(lockFile))
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
