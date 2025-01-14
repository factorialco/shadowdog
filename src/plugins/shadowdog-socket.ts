import * as net from 'net'
import { Listener } from '.'
import { logMessage } from '../utils'
import chalk from 'chalk'
import { PluginConfig } from '../pluginTypes'

type Event =
  | {
      type: 'CHANGED_FILE'
      payload: {
        file: string
        ready: boolean
      }
    }
  | {
      type: 'ERROR'
      payload: {
        file: string
        errorMessage: string
      }
    }
  | {
      type: 'INITIALIZED'
    }
  | {
      type: 'CLEAR'
    }

const notifyState = (socketPath: string, event: Event) => {
  return new Promise<void>((resolve) => {
    const socket = new net.Socket()

    socket.on('error', () => {
      logMessage(
        `🚫 Could not emit event ${chalk.cyan(event.type)} to socket at ${chalk.blue(socketPath)}`,
      )
      // NOTE: We don't want to restart shadowdog when this fails. This is a fire and forget notification.
      resolve()
    })

    socket.connect(socketPath, () => {
      socket.write(JSON.stringify(event))
      socket.destroy()
      resolve()
    })
  })
}

const listener: Listener<PluginConfig<'shadowdog-socket'>> = (eventEmitter, options) => {
  eventEmitter.on('initialized', () => {
    notifyState(options.path, {
      type: 'INITIALIZED',
    })
  })

  eventEmitter.on('exit', () => {
    notifyState(options.path, {
      type: 'CLEAR',
    })
  })

  eventEmitter.on('begin', (payload) => {
    notifyState(options.path, {
      type: 'CHANGED_FILE',
      payload: {
        file: payload.artifacts.map((artifact) => artifact.output).join(', '),
        ready: false,
      },
    })
  })

  eventEmitter.on('end', (payload) => {
    notifyState(options.path, {
      type: 'CHANGED_FILE',
      payload: {
        file: payload.artifacts.map((artifact) => artifact.output).join(', '),
        ready: true,
      },
    })
  })

  eventEmitter.on('error', (payload) => {
    notifyState(options.path, {
      type: 'ERROR',
      payload: {
        file: payload.artifacts.map((artifact) => artifact.output).join(', '),
        errorMessage: payload.errorMessage,
      },
    })
  })
}

export default {
  listener,
}
