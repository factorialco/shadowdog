#!/usr/bin/env node

/**
 * End-to-End Test: Complete User Workflow
 *
 * This test simulates a real user workflow:
 * 1. User creates a shadowdog.json config
 * 2. User runs shadowdog in watch mode
 * 3. User modifies files and sees artifacts generated
 * 4. User uses MCP to compute specific artifacts
 * 5. User stops shadowdog
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
const SOURCE_FILE = path.join(TEST_DIR, 'src/app.js')
const ARTIFACT_FILE = path.join(TEST_DIR, 'dist/app.js')

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

// Realistic user configuration
const userConfig = {
  watchers: [
    {
      files: ['src/**/*.js'],
      commands: [
        {
          command:
            'mkdir -p dist && cp src/app.js dist/app.js && echo "Built: $(date)" >> dist/app.js',
          workingDirectory: '.',
          artifacts: [{ output: 'dist/app.js' }],
        },
      ],
      ignored: ['node_modules/**'],
      environment: ['NODE_ENV=development'],
    },
  ],
  defaultIgnoredFiles: ['node_modules/**', '.git/**', 'dist/**'],
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
async function setupUserEnvironment() {
  logStep('SETUP', 'Setting up user environment...')

  try {
    // Create test directory structure
    await fs.mkdir(TEST_DIR, { recursive: true })
    await fs.mkdir(path.join(TEST_DIR, 'src'), { recursive: true })

    // Create shadowdog config (what user would create)
    await fs.writeFile(CONFIG_FILE, JSON.stringify(userConfig, null, 2))

    // Create initial source file (what user would have)
    await fs.writeFile(SOURCE_FILE, 'console.log("Hello, World!");')

    logSuccess('User environment created')
  } catch (error) {
    logError(`Failed to setup user environment: ${error.message}`)
    throw error
  }
}

async function cleanupUserEnvironment() {
  logStep('CLEANUP', 'Cleaning up user environment...')

  try {
    await fs.rm(TEST_DIR, { recursive: true, force: true })
    logSuccess('User environment cleaned up')
  } catch (error) {
    logWarning(`Failed to cleanup user environment: ${error.message}`)
  }
}

function startShadowdog() {
  logStep('SHADOWDOG', 'Starting shadowdog daemon...')

  return new Promise((resolve, reject) => {
    const daemon = spawn(
      'node',
      [path.join(PROJECT_ROOT, 'dist/src/cli.js'), '--watch', '--config', CONFIG_FILE],
      {
        cwd: TEST_DIR,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )

    let daemonReady = false
    let mcpReady = false

    daemon.stdout.on('data', (data) => {
      const output = data.toString()
      log(`[SHADOWDOG] ${output.trim()}`, 'blue')

      if (output.includes('Shadowdog') && output.includes('ready to watch')) {
        daemonReady = true
        if (daemonReady && mcpReady) {
          resolve(daemon)
        }
      }
    })

    daemon.stderr.on('data', (data) => {
      const output = data.toString()
      log(`[SHADOWDOG ERROR] ${output.trim()}`, 'red')
    })

    daemon.on('error', (error) => {
      logError(`Failed to start shadowdog: ${error.message}`)
      reject(error)
    })

    // Give daemon time to start MCP server
    setTimeout(() => {
      mcpReady = true
      if (daemonReady && mcpReady) {
        resolve(daemon)
      }
    }, 3000)
  })
}

async function testFileWatchingWorkflow(daemon) {
  logStep('WORKFLOW 1', 'Testing file watching workflow...')

  try {
    // User modifies source file
    log('User modifies src/app.js...', 'yellow')
    await fs.writeFile(SOURCE_FILE, 'console.log("Hello, Updated World!");')

    // Wait for shadowdog to process the change
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Check if artifact was created
    const artifactExists = await fs
      .access(ARTIFACT_FILE)
      .then(() => true)
      .catch(() => false)

    if (artifactExists) {
      const content = await fs.readFile(ARTIFACT_FILE, 'utf8')
      logSuccess('File watching workflow works - artifact created')
      log(`Artifact content: ${content.trim()}`, 'blue')
      return true
    } else {
      logError('File watching workflow failed - artifact not created')
      return false
    }
  } catch (error) {
    logError(`File watching workflow failed: ${error.message}`)
    return false
  }
}

async function testMCPWorkflow() {
  logStep('WORKFLOW 2', 'Testing MCP workflow...')

  try {
    // User uses MCP to compute artifact
    log('User uses MCP to compute artifact...', 'yellow')
    const response = await fetch('http://localhost:8473/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'compute-artifact',
          arguments: { artifactOutput: 'dist/app.js' },
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

    // Check if artifact was updated
    const artifactExists = await fs
      .access(ARTIFACT_FILE)
      .then(() => true)
      .catch(() => false)

    if (artifactExists) {
      const content = await fs.readFile(ARTIFACT_FILE, 'utf8')
      logSuccess('MCP workflow works - artifact computed')
      log(`Updated artifact content: ${content.trim()}`, 'blue')
      return true
    } else {
      logError('MCP workflow failed - artifact not found')
      return false
    }
  } catch (error) {
    logError(`MCP workflow failed: ${error.message}`)
    return false
  }
}

async function testCompleteUserJourney(daemon) {
  logStep('WORKFLOW 3', 'Testing complete user journey...')

  try {
    // User makes multiple changes
    log('User makes multiple file changes...', 'yellow')

    const changes = [
      'console.log("Change 1");',
      'console.log("Change 2");',
      'console.log("Change 3");',
    ]

    for (let i = 0; i < changes.length; i++) {
      await fs.writeFile(SOURCE_FILE, changes[i])
      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    // Wait for final processing
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Check final artifact state
    const artifactExists = await fs
      .access(ARTIFACT_FILE)
      .then(() => true)
      .catch(() => false)

    if (artifactExists) {
      const content = await fs.readFile(ARTIFACT_FILE, 'utf8')
      logSuccess('Complete user journey works')
      log(`Final artifact content: ${content.trim()}`, 'blue')
      return true
    } else {
      logError('Complete user journey failed - artifact not found')
      return false
    }
  } catch (error) {
    logError(`Complete user journey failed: ${error.message}`)
    return false
  }
}

export async function runUserWorkflowTest() {
  log('🚀 Starting E2E User Workflow Test', 'green')
  log('===================================', 'green')

  let daemon = null
  let testResults = []

  try {
    // Setup
    await setupUserEnvironment()

    // Start shadowdog
    daemon = await startShadowdog()

    // Run workflows
    log('\n🧪 Running User Workflows...', 'yellow')
    log('============================', 'yellow')

    const workflow1 = await testFileWatchingWorkflow(daemon)
    testResults.push({ name: 'File Watching Workflow', passed: workflow1 })

    const workflow2 = await testMCPWorkflow()
    testResults.push({ name: 'MCP Workflow', passed: workflow2 })

    const workflow3 = await testCompleteUserJourney(daemon)
    testResults.push({ name: 'Complete User Journey', passed: workflow3 })

    // Results
    log('\n📊 Workflow Results:', 'yellow')
    log('===================', 'yellow')

    let allPassed = true
    testResults.forEach(({ name, passed }) => {
      if (passed) {
        logSuccess(`${name}: PASSED`)
      } else {
        logError(`${name}: FAILED`)
        allPassed = false
      }
    })

    if (allPassed) {
      log('\n🎉 All user workflows passed! E2E test successful.', 'green')
    } else {
      log('\n💥 Some workflows failed. Check the output above for details.', 'red')
    }

    return allPassed
  } catch (error) {
    logError(`E2E user workflow test failed: ${error.message}`)
    return false
  } finally {
    // Cleanup
    if (daemon) {
      logStep('CLEANUP', 'Stopping shadowdog...')
      daemon.kill('SIGTERM')
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    await cleanupUserEnvironment()
  }
}

// Run the test if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runUserWorkflowTest().catch(console.error)
}
