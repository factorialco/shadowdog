import * as fs from 'fs-extra'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ShadowdogEventEmitter } from '../events'

vi.mock('fs-extra', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    mkdirpSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirpSync: vi.fn(),
}))

describe('shadowdog-lock', () => {
  const mockFs = vi.mocked(fs)
  const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  const lockPath = '/tmp/shadowdog/lock'
  const options = { path: lockPath }
  const eventEmitter = new ShadowdogEventEmitter()
  let shadowdogLock: typeof import('./shadowdog-lock').default

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    shadowdogLock = (await import('./shadowdog-lock')).default
  })

  describe('middleware', () => {
    it('should abort if lock exists and is not owned by current process', async () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue('other-pid')

      const next = vi.fn()
      const abort = vi.fn()

      await shadowdogLock.middleware({
        next,
        abort,
        options,
        files: [],
        invalidators: { files: [], environment: [] },
        config: { command: '', workingDirectory: '', tags: [], artifacts: [] },
        eventEmitter,
      })

      expect(mockExit).toHaveBeenCalledWith(1)
      expect(next).not.toHaveBeenCalled()
    })

    it('should continue if lock exists but is owned by current process', async () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(process.pid.toString())

      const next = vi.fn()
      const abort = vi.fn()

      await shadowdogLock.middleware({
        next,
        abort,
        options,
        files: [],
        invalidators: { files: [], environment: [] },
        config: { command: '', workingDirectory: '', tags: [], artifacts: [] },
        eventEmitter,
      })

      expect(abort).not.toHaveBeenCalled()
      expect(next).toHaveBeenCalled()
    })

    it('should continue if lock does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false)

      const next = vi.fn()
      const abort = vi.fn()

      await shadowdogLock.middleware({
        next,
        abort,
        options,
        files: [],
        invalidators: { files: [], environment: [] },
        config: { command: '', workingDirectory: '', tags: [], artifacts: [] },
        eventEmitter,
      })

      expect(abort).not.toHaveBeenCalled()
      expect(next).toHaveBeenCalled()
    })
  })

  describe('listener', () => {
    it('should create lock file on begin event if it does not exist', () => {
      mockFs.existsSync.mockReturnValue(false)
      shadowdogLock.listener(eventEmitter, options)

      eventEmitter.emit('begin', { artifacts: [] })

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(lockPath, process.pid.toString())
    })

    it('should remove lock file on exit event if owned by current process', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(process.pid.toString())
      shadowdogLock.listener(eventEmitter, options)

      eventEmitter.emit('exit')

      expect(mockFs.unlinkSync).toHaveBeenCalledWith(lockPath)
    })

    it('should not remove lock file on exit event if not owned by current process', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue('other-pid')
      shadowdogLock.listener(eventEmitter, options)

      eventEmitter.emit('exit')

      expect(mockFs.unlinkSync).not.toHaveBeenCalled()
    })

    it('should remove lock file on end event when counter reaches zero', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(process.pid.toString())
      shadowdogLock.listener(eventEmitter, options)

      eventEmitter.emit('begin', { artifacts: [] })
      eventEmitter.emit('end', { artifacts: [] })

      expect(mockFs.unlinkSync).toHaveBeenCalledWith(lockPath)
    })

    it('should not remove lock file on end event when counter is greater than zero', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(process.pid.toString())
      shadowdogLock.listener(eventEmitter, options)

      eventEmitter.emit('begin', { artifacts: [] })
      eventEmitter.emit('begin', { artifacts: [] })
      eventEmitter.emit('end', { artifacts: [] })

      expect(mockFs.unlinkSync).not.toHaveBeenCalled()
    })
  })

  describe('shadowdog-lock error handling', () => {
    beforeEach(() => {
      shadowdogLock.listener(eventEmitter, options)
    })

    it('should decrement counter and remove lock file on error when counter reaches 0', () => {
      // Simulate two begin events
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(process.pid.toString())
      eventEmitter.emit('begin', { artifacts: [] })
      eventEmitter.emit('begin', { artifacts: [] })
      expect(mockFs.unlinkSync).not.toHaveBeenCalled()

      // Simulate error events
      eventEmitter.emit('error', { artifacts: [], errorMessage: 'test error' })
      expect(mockFs.unlinkSync).not.toHaveBeenCalled() // Lock file should still exist when counter > 0

      eventEmitter.emit('error', { artifacts: [], errorMessage: 'test error' })
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(lockPath) // Lock file should be removed when counter reaches 0
    })

    it('should not remove lock file on error if not lock owner', () => {
      // Create lock file with different PID
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue('99999')

      eventEmitter.emit('begin', { artifacts: [] })
      eventEmitter.emit('error', { artifacts: [], errorMessage: 'test error' })

      expect(mockFs.unlinkSync).not.toHaveBeenCalled()
      expect(mockFs.readFileSync(lockPath, 'utf-8')).toBe('99999')
    })
  })
})
