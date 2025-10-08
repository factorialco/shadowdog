# Tests

This directory contains all test files for the Shadowdog project.

## Directory Structure

```
test/
├── e2e/                    # End-to-end tests
│   ├── user-workflow.test.js      # Complete user workflow E2E tests
│   └── run-e2e-tests.js           # E2E test runner
├── integration/            # Integration tests
│   └── mcp-integration.test.js    # MCP plugin integration tests
└── README.md              # This file

src/                       # Unit tests (co-located with source)
├── *.test.ts             # Unit tests for core modules
└── plugins/
    └── *.test.ts         # Unit tests for plugins
```

## Running Tests

### Unit Tests
```bash
npm test                    # Run all unit tests
npm run test:watch         # Run unit tests in watch mode
npm run coverage           # Run tests with coverage
```

### Integration Tests
```bash
npm run test:integration   # Run integration tests (if available)
```

### E2E Tests
```bash
npm run test:e2e           # Run all E2E tests
```

### All Tests
```bash
npm run test:all           # Run unit, integration, and E2E tests
npm run all                # Run build, lint, format, generate, and all tests
```

## Test Types

### Unit Tests
Located in `src/` directory alongside source code. Test individual functions, classes, and modules in isolation.

### Integration Tests
Located in `test/integration/`. Test the interaction between multiple components:
- **MCP Integration**: Tests the Model Context Protocol plugin integration with the daemon
- **Pending Task Handling**: Verifies that pending tasks are properly killed between different execution paths
- **Plugin Integration**: Tests how different plugins work together

### E2E Tests
Located in `test/e2e/`. Test complete user workflows from start to finish:
- **User Workflow**: Complete user journey from creating config to getting artifacts
- **File Watching**: Tests file change detection and processing in real scenarios
- **MCP Usage**: Tests MCP client-server communication in realistic scenarios

## Test Structure

### E2E Test Structure
Each E2E test:
1. Sets up a temporary test environment
2. Starts the Shadowdog daemon
3. Performs various operations
4. Verifies expected behavior
5. Cleans up the test environment

### Integration Test Structure
Each integration test:
1. Sets up test environment with specific components
2. Tests component interactions
3. Verifies expected behavior
4. Cleans up test environment

### Adding New Tests

#### Unit Tests
1. Create a new test file in `src/` alongside the source file
2. Follow the naming convention: `*.test.ts`
3. Use Vitest testing framework
4. Test individual functions/classes in isolation

#### Integration Tests
1. Create a new test file in `test/integration/`
2. Follow the naming convention: `*.test.js`
3. Export a test function that returns a boolean (true for success)
4. Test component interactions

#### E2E Tests
1. Create a new test file in `test/e2e/`
2. Follow the naming convention: `*.test.js`
3. Export a test function that returns a boolean (true for success)
4. Add the test to `test/e2e/run-e2e-tests.js`
5. Test complete user workflows

## CI Integration

All tests are automatically run in the CI pipeline:
- Unit tests run on every push and pull request
- Integration tests run on every push and pull request
- E2E tests run on every push and pull request
- Tests must pass before code can be merged

## Test Environment

- **Unit Tests**: Run in isolation with mocked dependencies
- **Integration Tests**: Use temporary directories and real component interactions
- **E2E Tests**: Use complete temporary environments with real file system operations

All tests clean up after themselves and don't pollute the project root directory.
