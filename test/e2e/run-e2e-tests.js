#!/usr/bin/env node

/**
 * E2E Test Runner
 *
 * Runs all end-to-end tests and reports results
 */

import { runUserWorkflowTest } from './user-workflow.test.js'
import { runMCPIntegrationTest } from '../integration/mcp-integration.test.js'

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green')
}

function logError(message) {
  log(`❌ ${message}`, 'red')
}

async function runAllE2ETests() {
  log('🚀 Running All E2E Tests', 'cyan')
  log('========================', 'cyan')

  const tests = [
    { name: 'User Workflow', fn: runUserWorkflowTest },
    { name: 'MCP Integration', fn: runMCPIntegrationTest },
  ]

  const results = []

  for (const test of tests) {
    log(`\n🧪 Running ${test.name}...`, 'yellow')
    try {
      const success = await test.fn()
      results.push({ name: test.name, success })
      if (success) {
        logSuccess(`${test.name}: PASSED`)
      } else {
        logError(`${test.name}: FAILED`)
      }
    } catch (error) {
      logError(`${test.name}: ERROR - ${error.message}`)
      results.push({ name: test.name, success: false, error: error.message })
    }
  }

  // Summary
  log('\n📊 E2E Test Summary:', 'cyan')
  log('====================', 'cyan')

  const passed = results.filter((r) => r.success).length
  const total = results.length

  results.forEach(({ name, success, error }) => {
    if (success) {
      logSuccess(`${name}: PASSED`)
    } else {
      logError(`${name}: FAILED${error ? ` - ${error}` : ''}`)
    }
  })

  log(`\nResults: ${passed}/${total} tests passed`, passed === total ? 'green' : 'red')

  if (passed === total) {
    log('\n🎉 All E2E tests passed!', 'green')
    return true
  } else {
    log('\n💥 Some E2E tests failed.', 'red')
    return false
  }
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllE2ETests()
    .then((success) => process.exit(success ? 0 : 1))
    .catch((error) => {
      console.error('E2E test runner failed:', error)
      process.exit(1)
    })
}

export { runAllE2ETests }
