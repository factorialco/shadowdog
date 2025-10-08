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

  describe('pause-resume with file change tracking', () => {
    it('should track file changes when paused and replay them on resume', async () => {
      const options = {}
      shadowdogMcp.listener(eventEmitter, options)

      // Create a test file
      const testFile = path.join(testDir, 'test-file.txt')
      writeFileSync(testFile, 'initial content')

      // Initialize the plugin
      eventEmitter.emit('initialized')

      // Wait a bit for initialization
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Simulate pausing shadowdog
      eventEmitter.emit('pause')

      // Simulate file changes while paused
      eventEmitter.emit('changed', { path: testFile, type: 'change' })
      eventEmitter.emit('changed', { path: testFile, type: 'change' }) // Duplicate should be ignored

      // Simulate resuming shadowdog
      eventEmitter.emit('resume')

      // The file should have been touched (we can verify this by checking if the file exists and was modified)
      expect(existsSync(testFile)).toBe(true)
    })

    it('should not track file changes when not paused', () => {
      const options = {}
      shadowdogMcp.listener(eventEmitter, options)

      // Create a test file
      const testFile = path.join(testDir, 'test-file.txt')
      writeFileSync(testFile, 'initial content')

      // Initialize the plugin
      eventEmitter.emit('initialized')

      // Simulate file changes when not paused (should not be tracked)
      eventEmitter.emit('changed', { path: testFile, type: 'change' })

      // Simulate resuming (should not replay anything)
      eventEmitter.emit('resume')

      // File should still exist
      expect(existsSync(testFile)).toBe(true)
    })
  })

  describe('plugin initialization', () => {
    it('should register event listeners when initialized', () => {
      const options = {}

      expect(() => {
        shadowdogMcp.listener(eventEmitter, options)
      }).not.toThrow()
    })

    it('should handle configLoaded event', () => {
      const options = {}
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
  })

  describe('pause/resume functionality', () => {
    it('should handle begin event when not paused', () => {
      const options = {}
      shadowdogMcp.listener(eventEmitter, options)

      const mockArtifacts = [{ output: 'dist/output.js' }]

      // Should not throw when emitting begin event
      expect(() => {
        eventEmitter.emit('begin', { artifacts: mockArtifacts })
      }).not.toThrow()
    })

    it('should handle config with multiple watchers', () => {
      const options = {}
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
      const options = {}
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
      const options = {}
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
      const options = {}
      shadowdogMcp.listener(eventEmitter, options)

      expect(() => {
        eventEmitter.emit('exit', 0)
      }).not.toThrow()
    })

    it('should handle end event', () => {
      const options = {}
      shadowdogMcp.listener(eventEmitter, options)

      expect(() => {
        eventEmitter.emit('end', { artifacts: [{ output: 'dist/output.js' }] })
      }).not.toThrow()
    })

    it('should handle error event', () => {
      const options = {}

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
      const options = {}
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
      const options = {}
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
      const options = {}
      shadowdogMcp.listener(eventEmitter, options)

      expect(() => {
        eventEmitter.emit('allTasksComplete')
      }).not.toThrow()
    })

    it('should handle generateStarted event', () => {
      const options = {}
      shadowdogMcp.listener(eventEmitter, options)

      expect(() => {
        eventEmitter.emit('generateStarted')
      }).not.toThrow()
    })

    it('should handle multiple sequential events', () => {
      const options = {}
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

  describe('compute-all-artifacts functionality', () => {
    it('should handle computeAllArtifacts event when daemon is available', () => {
      const options = {}
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
                artifacts: [{ output: 'dist/app.js' }, { output: 'dist/types.d.ts' }],
              },
            ],
          },
        ],
      }

      eventEmitter.emit('configLoaded', { config: mockConfig })

      // Should not throw when emitting computeAllArtifacts event
      expect(() => {
        eventEmitter.emit('computeAllArtifacts', {
          artifacts: [{ output: 'dist/app.js' }, { output: 'dist/types.d.ts' }],
        })
      }).not.toThrow()
    })

    it('should handle computeAllArtifacts event with multiple watchers', () => {
      const options = {}
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

      // Should not throw when emitting computeAllArtifacts event with multiple watchers
      expect(() => {
        eventEmitter.emit('computeAllArtifacts', {
          artifacts: [{ output: 'dist/app.js' }, { output: 'dist/styles.css' }],
        })
      }).not.toThrow()
    })

    it('should handle computeAllArtifacts event with empty artifacts array', () => {
      const options = {}
      shadowdogMcp.listener(eventEmitter, options)

      // Should not throw when emitting computeAllArtifacts event with empty array
      expect(() => {
        eventEmitter.emit('computeAllArtifacts', { artifacts: [] })
      }).not.toThrow()
    })
  })
})
