import { startUI } from './ui'
import { loadConfig } from './config'
import path from 'path'

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'shadowdog.json')

async function main(): Promise<void> {
  try {
    const config = await loadConfig(DEFAULT_CONFIG_PATH)
    await startUI(config)
  } catch (error: unknown) {
    console.error('Failed to start UI:', error)
    process.exit(1)
  }
}

main()
