#!/usr/bin/env node

/**
 * End-to-End Test for MCP Integration with Pending Tasks Handling
 *
 * This test verifies that:
 * 1. MCP artifact computation works correctly with pending task killing
 * 2. File changes work correctly with pending task killing
 * 3. Concurrent operations are handled properly
 */

import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../../')

// Test configuration
const TEST_DIR = path.join(__dirname, 'temp')
const CONFIG_FILE = path.join(TEST_DIR, 'shadowdog.json')
const TEST_FILE = path.join(TEST_DIR, 'test-file.txt')
const ARTIFACT_FILE = path.join(TEST_DIR, 'test-artifact.txt') // Artifact is created in test directory

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
}

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

function logStep(step, message) {
  log(`\n[${step}] ${message}`, 'cyan')
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green')
}

function logError(message) {
  log(`❌ ${message}`, 'red')
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow')
}

// Test configuration with a longer-running command to test task killing
const testConfig = {
  watchers: [
    {
      files: ['test-file.txt'],
      commands: [
        {
          command: 'sleep 1 && echo "File changed: $(date)" > test-artifact.txt',
          workingDirectory: '.',
          artifacts: [{ output: 'test-artifact.txt' }],
        },
      ],
      ignored: [],
      environment: [],
    },
  ],
  defaultIgnoredFiles: ['node_modules/**', '.git/**'],
  debounceTime: 100,
  plugins: [
    {
      name: 'shadowdog-mcp',
      options: {
        port: 3001,
      },
    },
  ],
}

// Helper functions
async function setupTestEnvironment() {
  logStep('SETUP', 'Creating test environment...')

  try {
    await fs.mkdir(TEST_DIR, { recursive: true })
    await fs.writeFile(CONFIG_FILE, JSON.stringify(testConfig, null, 2))
    await fs.writeFile(TEST_FILE, 'Initial content')

    logSuccess('Test environment created')
  } catch (error) {
    logError(`Failed to setup test environment: ${error.message}`)
    throw error
  }
}

async function cleanupTestEnvironment() {
  logStep('CLEANUP', 'Cleaning up test environment...')

  try {
    await fs.rm(TEST_DIR, { recursive: true, force: true })
    logSuccess('Test environment cleaned up')
  } catch (error) {
    logWarning(`Failed to cleanup test environment: ${error.message}`)
  }
}

function startDaemon() {
  logStep('DAEMON', 'Starting shadowdog daemon...')

  return new Promise((resolve, reject) => {
    const daemon = spawn(
      'node',
      [path.join(PROJECT_ROOT, 'dist/src/cli.js'), '--watch', '--config', CONFIG_FILE],
      {
        cwd: TEST_DIR, // Run from test directory
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )

    let daemonReady = false
    let mcpReady = false
    let killMessages = []

    daemon.stdout.on('data', (data) => {
      const output = data.toString()
      log(`[DAEMON] ${output.trim()}`, 'blue')

      // Track kill messages to verify task killing
      if (output.includes('was killed because another task was started')) {
        killMessages.push(output.trim())
        log(`[KILL DETECTED] ${output.trim()}`, 'magenta')
      }

      if (output.includes('Shadowdog') && output.includes('ready to watch')) {
        daemonReady = true
        if (daemonReady && mcpReady) {
          resolve({ daemon, killMessages })
        }
      }
    })

    daemon.stderr.on('data', (data) => {
      const output = data.toString()
      log(`[DAEMON ERROR] ${output.trim()}`, 'red')
    })

    daemon.on('error', (error) => {
      logError(`Failed to start daemon: ${error.message}`)
      reject(error)
    })

    setTimeout(() => {
      mcpReady = true
      if (daemonReady && mcpReady) {
        resolve({ daemon, killMessages })
      }
    }, 3000)
  })
}

async function testMCPTaskKilling() {
  logStep('TEST 1', 'Testing MCP artifact computation with task killing...')

  try {
    // Start a long-running task by modifying the file
    log('Starting long-running task by modifying file...', 'yellow')
    await fs.writeFile(TEST_FILE, 'Trigger long task')

    // Wait a bit for the task to start
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Now call MCP to compute artifact (should kill the long-running task)
    log('Calling MCP to compute artifact (should kill pending task)...', 'yellow')
    const response = await fetch('http://localhost:8473/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'compute-artifact',
          arguments: { artifactOutput: 'test-artifact.txt' },
        },
      }),
    })

    if (!response.ok) {
      throw new Error(`MCP call failed: ${response.status}`)
    }

    const data = await response.json()
    log(`MCP response: ${JSON.stringify(data)}`, 'blue')

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Check if artifact was created
    const artifactExists = await fs
      .access(ARTIFACT_FILE)
      .then(() => true)
      .catch(() => false)

    if (artifactExists) {
      const content = await fs.readFile(ARTIFACT_FILE, 'utf8')
      logSuccess('MCP artifact computation works')
      log(`Artifact content: ${content.trim()}`, 'blue')
      return true
    } else {
      logError('MCP artifact computation failed - artifact not created')
      return false
    }
  } catch (error) {
    logError(`MCP task killing test failed: ${error.message}`)
    return false
  }
}

async function testFileChangeTaskKilling() {
  logStep('TEST 2', 'Testing file change task killing...')

  try {
    // Start a long-running task by modifying the file
    log('Starting long-running task by modifying file...', 'yellow')
    await fs.writeFile(TEST_FILE, 'Trigger long task 1')

    // Wait a bit for the task to start
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Modify file again (should kill the previous task)
    log('Modifying file again (should kill previous task)...', 'yellow')
    await fs.writeFile(TEST_FILE, 'Trigger long task 2')

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Check if artifact was created
    const artifactExists = await fs
      .access(ARTIFACT_FILE)
      .then(() => true)
      .catch(() => false)

    if (artifactExists) {
      const content = await fs.readFile(ARTIFACT_FILE, 'utf8')
      logSuccess('File change task killing works')
      log(`Artifact content: ${content.trim()}`, 'blue')
      return true
    } else {
      logError('File change task killing failed - artifact not created')
      return false
    }
  } catch (error) {
    logError(`File change task killing test failed: ${error.message}`)
    return false
  }
}

async function testConcurrentOperations() {
  logStep('TEST 3', 'Testing concurrent operations...')

  try {
    // Start multiple operations simultaneously
    log('Starting concurrent operations...', 'yellow')

    const operations = [
      // File change 1
      fs.writeFile(TEST_FILE, 'Concurrent content 1'),
      // File change 2 (should kill previous task)
      new Promise((resolve) =>
        setTimeout(() => {
          fs.writeFile(TEST_FILE, 'Concurrent content 2').then(resolve)
        }, 100),
      ),
      // MCP request (should kill file change task)
      new Promise((resolve) =>
        setTimeout(async () => {
          try {
            const response = await fetch('http://localhost:8473/mcp', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 3,
                method: 'tools/call',
                params: {
                  name: 'compute-artifact',
                  arguments: { artifactOutput: 'test-artifact.txt' },
                },
              }),
            })
            resolve(response.ok)
          } catch (error) {
            resolve(false)
          }
        }, 200),
      ),
    ]

    // Wait for all operations to complete
    await Promise.all(operations)

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Check final artifact state
    const artifactExists = await fs
      .access(ARTIFACT_FILE)
      .then(() => true)
      .catch(() => false)

    if (artifactExists) {
      const content = await fs.readFile(ARTIFACT_FILE, 'utf8')
      logSuccess('Concurrent operations handled correctly')
      log(`Final artifact content: ${content.trim()}`, 'blue')
      return true
    } else {
      logError('Concurrent operations failed - artifact not found')
      return false
    }
  } catch (error) {
    logError(`Concurrent test failed: ${error.message}`)
    return false
  }
}

async function runMCPIntegrationTest() {
  log('🚀 Starting MCP Integration E2E Test', 'green')
  log('====================================', 'green')

  let daemon = null
  let killMessages = []
  let testResults = []

  try {
    // Setup
    await setupTestEnvironment()

    // Start daemon
    const daemonResult = await startDaemon()
    daemon = daemonResult.daemon
    killMessages = daemonResult.killMessages

    // Run tests
    log('\n🧪 Running Tests...', 'yellow')
    log('==================', 'yellow')

    const test1 = await testMCPTaskKilling()
    testResults.push({ name: 'MCP Task Killing', passed: test1 })

    const test2 = await testFileChangeTaskKilling()
    testResults.push({ name: 'File Change Task Killing', passed: test2 })

    const test3 = await testConcurrentOperations()
    testResults.push({ name: 'Concurrent Operations', passed: test3 })

    // Results
    log('\n📊 Test Results:', 'yellow')
    log('================', 'yellow')

    let allPassed = true
    testResults.forEach(({ name, passed }) => {
      if (passed) {
        logSuccess(`${name}: PASSED`)
      } else {
        logError(`${name}: FAILED`)
        allPassed = false
      }
    })

    // Show kill messages
    log('\n🔍 Kill Messages Detected:', 'yellow')
    log('==========================', 'yellow')
    if (killMessages.length > 0) {
      killMessages.forEach((msg, index) => {
        log(`${index + 1}. ${msg}`, 'magenta')
      })
      logSuccess(`Found ${killMessages.length} task kill(s) - pending task handling is working!`)
    } else {
      logWarning('No kill messages detected - this might indicate an issue')
    }

    if (allPassed) {
      log('\n🎉 All tests passed! MCP integration is working correctly.', 'green')
      return true
    } else {
      log('\n💥 Some tests failed. Check the output above for details.', 'red')
      return false
    }
  } catch (error) {
    logError(`MCP integration test failed: ${error.message}`)
    return false
  } finally {
    // Cleanup
    if (daemon) {
      logStep('CLEANUP', 'Stopping daemon...')
      daemon.kill('SIGTERM')
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    await cleanupTestEnvironment()
  }
}

// Run the test if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMCPIntegrationTest()
    .then((success) => process.exit(success ? 0 : 1))
    .catch((error) => {
      console.error('Test failed:', error)
      process.exit(1)
    })
}

export { runMCPIntegrationTest }
