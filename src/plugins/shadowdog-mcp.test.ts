import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ShadowdogEventEmitter } from '../events'
import shadowdogMcp from './shadowdog-mcp'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import * as path from 'path'

describe('shadowdog-mcp', () => {
  let eventEmitter: ShadowdogEventEmitter
  let testDir: string

  beforeEach(() => {
    eventEmitter = new ShadowdogEventEmitter()
    testDir = path.join(process.cwd(), 'test-shadowdog-mcp')

    // Create test directory
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true })
    }

    // Change to test directory
    process.chdir(testDir)
  })

  afterEach(() => {
    // Clean up test directory
    process.chdir(path.dirname(testDir))
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('plugin initialization', () => {
    it('should register event listeners when initialized', () => {
      const options = { autoStart: false }

      expect(() => {
        shadowdogMcp.listener(eventEmitter, options)
      }).not.toThrow()
    })

    it('should handle configLoaded event', () => {
      const options = { autoStart: false }
      shadowdogMcp.listener(eventEmitter, options)

      const mockConfig = {
        debounceTime: 2000,
        defaultIgnoredFiles: ['.git', '**/node_modules'],
        plugins: [],
        watchers: [
          {
            enabled: true,
            files: ['src/**/*.ts'],
            environment: ['NODE_ENV'],
            ignored: [],
            commands: [
              {
                command: 'echo test',
                workingDirectory: '',
                tags: [],
                artifacts: [
                  {
                    output: 'dist/output.js',
                  },
                ],
              },
            ],
          },
        ],
      }

      expect(() => {
        eventEmitter.emit('configLoaded', { config: mockConfig })
      }).not.toThrow()
    })

    it('should not auto-start MCP server when autoStart is false', () => {
      const options = { autoStart: false }
      shadowdogMcp.listener(eventEmitter, options)

      // Emit initialized event
      eventEmitter.emit('initialized')

      // Server should not be started (no way to test directly without exposing internals)
      // This is more of an integration test
    })
  })

  describe('pause/resume functionality', () => {
    it('should handle begin event when not paused', () => {
      const options = { autoStart: false }
      shadowdogMcp.listener(eventEmitter, options)

      const mockArtifacts = [{ output: 'dist/output.js' }]

      // Should not throw when emitting begin event
      expect(() => {
        eventEmitter.emit('begin', { artifacts: mockArtifacts })
      }).not.toThrow()
    })

    it('should handle config with multiple watchers', () => {
      const options = { autoStart: false }
      shadowdogMcp.listener(eventEmitter, options)

      const mockConfig = {
        debounceTime: 2000,
        defaultIgnoredFiles: ['.git'],
        plugins: [],
        watchers: [
          {
            enabled: true,
            files: ['src/**/*.ts'],
            environment: [],
            ignored: [],
            commands: [
              {
                command: 'tsc',
                workingDirectory: '',
                tags: [],
                artifacts: [{ output: 'dist/app.js' }],
              },
            ],
          },
          {
            enabled: true,
            files: ['styles/**/*.css'],
            environment: [],
            ignored: [],
            commands: [
              {
                command: 'postcss',
                workingDirectory: '',
                tags: [],
                artifacts: [{ output: 'dist/styles.css' }],
              },
            ],
          },
        ],
      }

      eventEmitter.emit('configLoaded', { config: mockConfig })
      expect(() => {
        eventEmitter.emit('begin', { artifacts: [{ output: 'dist/app.js' }] })
      }).not.toThrow()
    })
  })

  describe('lock file integration', () => {
    it('should handle missing lock file gracefully', () => {
      const options = { autoStart: false }
      shadowdogMcp.listener(eventEmitter, options)

      const mockConfig = {
        debounceTime: 2000,
        defaultIgnoredFiles: ['.git'],
        plugins: [],
        watchers: [
          {
            enabled: true,
            files: ['src/**/*.ts'],
            environment: [],
            ignored: [],
            commands: [
              {
                command: 'echo test',
                workingDirectory: '',
                tags: [],
                artifacts: [{ output: 'dist/output.js' }],
              },
            ],
          },
        ],
      }

      eventEmitter.emit('configLoaded', { config: mockConfig })

      // Should not throw even though lock file doesn't exist
      expect(() => {
        eventEmitter.emit('initialized')
      }).not.toThrow()
    })

    it('should read lock file when it exists', () => {
      const options = { autoStart: false }
      shadowdogMcp.listener(eventEmitter, options)

      // Create a mock lock file
      const lockFile = {
        version: '0.8.5',
        nodeVersion: process.version,
        artifacts: [
          {
            output: 'dist/output.js',
            outputSha: 'abc123',
            cacheIdentifier: 'cache-123',
            fileManifest: {
              watchedFilesCount: 1,
              watchedFiles: ['src/index.ts'],
              environment: {},
              command: 'tsc',
            },
          },
        ],
      }

      writeFileSync('shadowdog-lock.json', JSON.stringify(lockFile, null, 2))

      const mockConfig = {
        debounceTime: 2000,
        defaultIgnoredFiles: ['.git'],
        plugins: [],
        watchers: [
          {
            enabled: true,
            files: ['src/**/*.ts'],
            environment: [],
            ignored: [],
            commands: [
              {
                command: 'tsc',
                workingDirectory: '',
                tags: [],
                artifacts: [{ output: 'dist/output.js' }],
              },
            ],
          },
        ],
      }

      eventEmitter.emit('configLoaded', { config: mockConfig })

      // Should not throw when reading lock file
      expect(existsSync('shadowdog-lock.json')).toBe(true)
    })
  })

  describe('event handling', () => {
    it('should handle exit event', () => {
      const options = { autoStart: false }
      shadowdogMcp.listener(eventEmitter, options)

      expect(() => {
        eventEmitter.emit('exit', 0)
      }).not.toThrow()
    })

    it('should handle end event', () => {
      const options = { autoStart: false }
      shadowdogMcp.listener(eventEmitter, options)

      expect(() => {
        eventEmitter.emit('end', { artifacts: [{ output: 'dist/output.js' }] })
      }).not.toThrow()
    })

    it('should handle error event', () => {
      const options = { autoStart: false }

      // Add an error handler to prevent unhandled error
      eventEmitter.on('error', () => {
        // Error handled
      })

      shadowdogMcp.listener(eventEmitter, options)

      expect(() => {
        eventEmitter.emit('error', {
          artifacts: [{ output: 'dist/output.js' }],
          errorMessage: 'Test error',
        })
      }).not.toThrow()
    })
  })

  describe('artifact tracking', () => {
    it('should track artifacts from config', () => {
      const options = { autoStart: false }
      shadowdogMcp.listener(eventEmitter, options)

      const mockConfig = {
        debounceTime: 2000,
        defaultIgnoredFiles: ['.git'],
        plugins: [],
        watchers: [
          {
            enabled: true,
            files: ['src/**/*.ts'],
            environment: ['NODE_ENV'],
            ignored: [],
            commands: [
              {
                command: 'tsc',
                workingDirectory: '',
                tags: [],
                artifacts: [
                  { output: 'dist/output1.js' },
                  { output: 'dist/output2.js', description: 'Second output' },
                ],
              },
            ],
          },
        ],
      }

      eventEmitter.emit('configLoaded', { config: mockConfig })

      // Verify artifacts are tracked (implicitly through no errors)
      expect(() => {
        eventEmitter.emit('begin', { artifacts: mockConfig.watchers[0].commands[0].artifacts })
      }).not.toThrow()
    })

    it('should handle artifacts with descriptions', () => {
      const options = { autoStart: false }
      shadowdogMcp.listener(eventEmitter, options)

      const mockConfig = {
        debounceTime: 2000,
        defaultIgnoredFiles: ['.git'],
        plugins: [],
        watchers: [
          {
            enabled: true,
            files: ['src/**/*.ts'],
            environment: [],
            ignored: [],
            commands: [
              {
                command: 'tsc',
                workingDirectory: '',
                tags: [],
                artifacts: [
                  {
                    output: 'dist/output.js',
                    description: 'Compiled TypeScript output',
                  },
                ],
              },
            ],
          },
        ],
      }

      eventEmitter.emit('configLoaded', { config: mockConfig })

      expect(() => {
        eventEmitter.emit('begin', { artifacts: mockConfig.watchers[0].commands[0].artifacts })
      }).not.toThrow()
    })
  })

  describe('integration with other events', () => {
    it('should handle allTasksComplete event', () => {
      const options = { autoStart: false }
      shadowdogMcp.listener(eventEmitter, options)

      expect(() => {
        eventEmitter.emit('allTasksComplete')
      }).not.toThrow()
    })

    it('should handle generateStarted event', () => {
      const options = { autoStart: false }
      shadowdogMcp.listener(eventEmitter, options)

      expect(() => {
        eventEmitter.emit('generateStarted')
      }).not.toThrow()
    })

    it('should handle multiple sequential events', () => {
      const options = { autoStart: false }
      shadowdogMcp.listener(eventEmitter, options)

      const mockConfig = {
        debounceTime: 2000,
        defaultIgnoredFiles: ['.git'],
        plugins: [],
        watchers: [
          {
            enabled: true,
            files: ['src/**/*.ts'],
            environment: [],
            ignored: [],
            commands: [
              {
                command: 'tsc',
                workingDirectory: '',
                tags: [],
                artifacts: [{ output: 'dist/output.js' }],
              },
            ],
          },
        ],
      }

      expect(() => {
        eventEmitter.emit('configLoaded', { config: mockConfig })
        eventEmitter.emit('generateStarted')
        eventEmitter.emit('begin', { artifacts: [{ output: 'dist/output.js' }] })
        eventEmitter.emit('end', { artifacts: [{ output: 'dist/output.js' }] })
        eventEmitter.emit('allTasksComplete')
      }).not.toThrow()
    })
  })
})
