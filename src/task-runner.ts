import { CommandConfig } from './config'
import { ShadowdogEventEmitter } from './events'
import { Middleware } from './plugins'

interface Options {
  files: string[]
  environment: string[]
  config: CommandConfig
  eventEmitter: ShadowdogEventEmitter
  changedFilePath?: string
}
export class TaskRunner {
  middlewares: Array<{ middleware: Middleware; options: unknown; changedFilePath?: string }>

  constructor(private runnerOptions: Options) {
    this.middlewares = []
  }

  use(middleware: Middleware, options: unknown = {}) {
    this.middlewares.push({ middleware, options })
  }

  async execute() {
    let result: unknown = null
    let index = -1
    let isAborted = false

    const abort = () => {
      isAborted = true
    }

    const next = async () => {
      if (isAborted || ++index >= this.middlewares.length) return result
      const current = this.middlewares[index]
      return current.middleware({
        files: this.runnerOptions.files,
        environment: this.runnerOptions.environment,
        config: this.runnerOptions.config,
        eventEmitter: this.runnerOptions.eventEmitter,
        changedFilePath: this.runnerOptions.changedFilePath,
        options: current.options,
        next,
        abort,
      })
    }

    result = await next()
    return result
  }
}
