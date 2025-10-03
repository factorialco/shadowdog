import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generate } from './generate'
import { ShadowdogEventEmitter } from './events'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { ConfigFile, WatcherConfig } from './config'

// Helper function to create a minimal watcher config
const createWatcher = (overrides: Partial<WatcherConfig> = {}): WatcherConfig => ({
  enabled: true,
  files: [],
  environment: [],
  ignored: [],
  commands: [],
  ...overrides,
})

// Helper function to create a minimal config
const createConfig = (overrides: Partial<ConfigFile> = {}): ConfigFile => ({
  debounceTime: 100,
  plugins: [],
  defaultIgnoredFiles: [],
  watchers: [],
  ...overrides,
})

describe('generate', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'shadowdog-test-'))
    process.chdir(testDir)
  })

  afterEach(async () => {
    if (testDir && fs.existsSync(testDir)) {
      await fs.promises.rm(testDir, { recursive: true, force: true })
    }
  })

  describe('artifact cleanup and verification', () => {
    it('should clean up existing artifacts before running tasks', async () => {
      // Create an existing artifact
      await fs.promises.writeFile('output.txt', 'old content')
      expect(fs.existsSync('output.txt')).toBe(true)

      const config = createConfig({
        watchers: [
          createWatcher({
            files: ['input.txt'],
            commands: [
              {
                command: "node -e \"require('fs').writeFileSync('output.txt', 'fresh content')\"",
                workingDirectory: '',
                tags: [],
                artifacts: [{ output: 'output.txt' }],
              },
            ],
          }),
        ],
      })

      // Create input file
      await fs.promises.writeFile('input.txt', 'test input')

      await generate(config, new ShadowdogEventEmitter(), { continueOnError: false })

      // Verify the artifact was recreated with new content
      const content = await fs.promises.readFile('output.txt', 'utf-8')
      expect(content).toBe('fresh content')
    }, 10000)

    it('should clean up existing artifact directories before running tasks', async () => {
      // Create an existing artifact directory
      await fs.promises.mkdir('output-dir', { recursive: true })
      await fs.promises.writeFile('output-dir/old.txt', 'old content')
      expect(fs.existsSync('output-dir/old.txt')).toBe(true)

      const config = createConfig({
        watchers: [
          createWatcher({
            files: ['input.txt'],
            commands: [
              {
                command:
                  "node -e \"require('fs').mkdirSync('output-dir', {recursive: true}); require('fs').writeFileSync('output-dir/fresh.txt', 'fresh')\"",
                workingDirectory: '',
                tags: [],
                artifacts: [{ output: 'output-dir' }],
              },
            ],
          }),
        ],
      })

      // Create input file
      await fs.promises.writeFile('input.txt', 'test input')

      await generate(config, new ShadowdogEventEmitter(), { continueOnError: false })

      // Verify the old file is gone and new file exists
      expect(fs.existsSync('output-dir/old.txt')).toBe(false)
      expect(fs.existsSync('output-dir/fresh.txt')).toBe(true)
      const content = await fs.promises.readFile('output-dir/fresh.txt', 'utf-8')
      expect(content).toBe('fresh')
    }, 10000)

    it('should wait for artifacts to be created and readable', async () => {
      const config = createConfig({
        watchers: [
          createWatcher({
            files: ['input.txt'],
            commands: [
              {
                command:
                  "node -e \"setTimeout(() => require('fs').writeFileSync('output.txt', 'delayed content'), 200)\"",
                workingDirectory: '',
                tags: [],
                artifacts: [{ output: 'output.txt' }],
              },
            ],
          }),
        ],
      })

      // Create input file
      await fs.promises.writeFile('input.txt', 'test input')

      await generate(config, new ShadowdogEventEmitter(), { continueOnError: false })

      // Verify the artifact was created
      expect(fs.existsSync('output.txt')).toBe(true)
      const content = await fs.promises.readFile('output.txt', 'utf-8')
      expect(content).toBe('delayed content')
    }, 10000)

    it('should throw error if artifact is not created after max retries', async () => {
      // Set a very low retry count for this test
      const originalEnv = process.env.SHADOWDOG_ARTIFACT_WAIT_MAX_RETRIES
      process.env.SHADOWDOG_ARTIFACT_WAIT_MAX_RETRIES = '5'

      try {
        const config = createConfig({
          watchers: [
            createWatcher({
              files: ['input.txt'],
              commands: [
                {
                  command: 'node -e "console.log(\'Command completed but no artifact created\')"',
                  workingDirectory: '',
                  tags: [],
                  artifacts: [{ output: 'output.txt' }],
                },
              ],
            }),
          ],
        })

        // Create input file
        await fs.promises.writeFile('input.txt', 'test input')

        await expect(
          generate(config, new ShadowdogEventEmitter(), { continueOnError: false }),
        ).rejects.toThrow(
          /Artifact 'output\.txt' was not created or is not readable after task completion/,
        )
      } finally {
        if (originalEnv !== undefined) {
          process.env.SHADOWDOG_ARTIFACT_WAIT_MAX_RETRIES = originalEnv
        } else {
          delete process.env.SHADOWDOG_ARTIFACT_WAIT_MAX_RETRIES
        }
      }
    }, 10000)

    it('should handle dependency chains correctly with artifact cleanup and verification', async () => {
      // Create source file
      await fs.promises.writeFile('source.rb', 'permissions updated')

      const config = createConfig({
        watchers: [
          createWatcher({
            files: ['source.rb'],
            commands: [
              {
                command:
                  "node -e \"const fs = require('fs'); const content = fs.readFileSync('source.rb', 'utf-8'); fs.writeFileSync('intermediate.json', 'generated from ' + content.trim())\"",
                workingDirectory: '',
                tags: [],
                artifacts: [{ output: 'intermediate.json' }],
              },
            ],
          }),
        ],
      })

      await generate(config, new ShadowdogEventEmitter(), { continueOnError: false })

      // Verify the first artifact was created
      expect(fs.existsSync('intermediate.json')).toBe(true)
      const intermediateContent = await fs.promises.readFile('intermediate.json', 'utf-8')
      expect(intermediateContent).toBe('generated from permissions updated')

      // Now test that a dependent task can run after the first one completes
      const config2 = createConfig({
        watchers: [
          createWatcher({
            files: ['intermediate.json'],
            commands: [
              {
                command:
                  "node -e \"const fs = require('fs'); const content = fs.readFileSync('intermediate.json', 'utf-8'); fs.writeFileSync('final.graphql', 'schema from ' + content)\"",
                workingDirectory: '',
                tags: [],
                artifacts: [{ output: 'final.graphql' }],
              },
            ],
          }),
        ],
      })

      await generate(config2, new ShadowdogEventEmitter(), { continueOnError: false })

      // Verify the final artifact was created
      expect(fs.existsSync('final.graphql')).toBe(true)
      const finalContent = await fs.promises.readFile('final.graphql', 'utf-8')
      expect(finalContent).toBe('schema from generated from permissions updated')
    }, 10000)

    it('should not fail if artifact to cleanup does not exist', async () => {
      const config = createConfig({
        watchers: [
          createWatcher({
            files: ['input.txt'],
            commands: [
              {
                command: "node -e \"require('fs').writeFileSync('output.txt', 'content')\"",
                workingDirectory: '',
                tags: [],
                artifacts: [{ output: 'output.txt' }],
              },
            ],
          }),
        ],
      })

      // Create input file but no existing artifact
      await fs.promises.writeFile('input.txt', 'test input')

      // Should not throw an error
      await expect(
        generate(config, new ShadowdogEventEmitter(), { continueOnError: false }),
      ).resolves.not.toThrow()

      // Verify the artifact was created
      expect(fs.existsSync('output.txt')).toBe(true)
      const content = await fs.promises.readFile('output.txt', 'utf-8')
      expect(content).toBe('content')
    }, 10000)

    it('should reject empty files during verification', async () => {
      // Set a very low retry count for this test
      const originalEnv = process.env.SHADOWDOG_ARTIFACT_WAIT_MAX_RETRIES
      process.env.SHADOWDOG_ARTIFACT_WAIT_MAX_RETRIES = '5'

      try {
        const config = createConfig({
          watchers: [
            createWatcher({
              files: ['input.txt'],
              commands: [
                {
                  command: "node -e \"require('fs').writeFileSync('empty-output.txt', '')\"",
                  workingDirectory: '',
                  tags: [],
                  artifacts: [{ output: 'empty-output.txt' }],
                },
              ],
            }),
          ],
        })

        // Create input file
        await fs.promises.writeFile('input.txt', 'test input')

        await expect(
          generate(config, new ShadowdogEventEmitter(), { continueOnError: false }),
        ).rejects.toThrow(
          /Artifact 'empty-output\.txt' was not created or is not readable after task completion/,
        )
      } finally {
        if (originalEnv !== undefined) {
          process.env.SHADOWDOG_ARTIFACT_WAIT_MAX_RETRIES = originalEnv
        } else {
          delete process.env.SHADOWDOG_ARTIFACT_WAIT_MAX_RETRIES
        }
      }
    }, 10000)
  })
})
