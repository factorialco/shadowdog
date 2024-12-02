import { z } from 'zod'
import { Listener } from '.'
import * as net from 'net'
import { logMessage } from '../utils'
import chalk from 'chalk'
import { ArtifactConfig } from '../config'

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

    socket.connect(socketPath, () => {
      socket.write(JSON.stringify(event))
      socket.destroy()
      resolve()
    })

    socket.on('error', () => {
      logMessage(
        `🚫 Could not emit event ${chalk.cyan(event.type)} to socket at ${chalk.blue(socketPath)}`,
      )
      // NOTE: We don't want to restart shadowdog when this fails. This is a fire and forget notification.
      resolve()
    })
  })
}

const pluginOptionsSchema = z.object({ path: z.string().default('/tmp/shadowdog.sock') }).strict()

type PluginOptions = z.infer<typeof pluginOptionsSchema>

const listener: Listener<PluginOptions> = (shadowdogEventListener, options) => {
  const mergedOptions = pluginOptionsSchema.parse(options)

  shadowdogEventListener.on('initialized', () => {
    notifyState(mergedOptions.path, {
      type: 'INITIALIZED',
    })
  })

  shadowdogEventListener.on('exit', () => {
    notifyState(mergedOptions.path, {
      type: 'CLEAR',
    })
  })

  shadowdogEventListener.on('begin', (payload) => {
    notifyState(mergedOptions.path, {
      type: 'CHANGED_FILE',
      payload: {
        file: payload.artifacts.map((artifact: ArtifactConfig) => artifact.output).join(', '),
        ready: false,
      },
    })
  })

  shadowdogEventListener.on('end', (payload) => {
    notifyState(mergedOptions.path, {
      type: 'CHANGED_FILE',
      payload: {
        file: payload.artifacts.map((artifact: ArtifactConfig) => artifact.output).join(', '),
        ready: true,
      },
    })
  })

  shadowdogEventListener.on('error', (payload) => {
    notifyState(mergedOptions.path, {
      type: 'ERROR',
      payload: {
        file: payload.artifacts.map((artifact: ArtifactConfig) => artifact.output).join(', '),
        errorMessage: payload.errorMessage,
      },
    })
  })
}

export default { listener }
