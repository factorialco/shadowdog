# Shadowdog Project Cursor Rules

## Project Overview

This is the **Shadowdog** project - a Node.js package for generating artifacts as derivative processes of files. This project includes a comprehensive plugin system, MCP server integration, and sophisticated caching mechanisms.

## Code Structure

### Core Components

- `src/cli.ts` - Command line interface
- `src/daemon.ts` - Watch mode daemon
- `src/config.ts` - Configuration management
- `src/generate.ts` - Artifact generation logic
- `src/events.ts` - Event system for plugins

### Plugin System

- `src/plugins/` - Plugin implementations
- `src/pluginTypes.ts` - Plugin type definitions
- Key plugins:
  - `shadowdog-mcp` - MCP server integration
  - `shadowdog-local-cache` - Local caching
  - `shadowdog-lock` - Lock file generation
  - `shadowdog-tree` - Dependency tree management

### Testing

- Unit tests in `src/**/*.test.ts`
- Integration tests in `test/integration/`
- E2E tests in `test/e2e/`
- Use `npm run test:all` for comprehensive testing

## Development Guidelines

### Code Quality

- Follow TypeScript best practices
- Use proper error handling with chalk for colored output
- Implement comprehensive tests for new features
- Maintain plugin compatibility and event system integration

### Performance Considerations

- Understand cache key computation for optimal performance
- Use appropriate file patterns in watchers
- Consider plugin execution order in configuration
- Leverage local and remote caching when appropriate

## Commands

- `npm run build` - Build TypeScript
- `npm run watch` - Start in watch mode with MCP server
- `npm run generate` - Generate artifacts once
- `npm run test:all` - Run all tests
- `npm run build-schema` - Generate JSON schema

## Shadowdog-Specific Rules

For detailed shadowdog workflow and MCP integration, see `.cursorrules/shadowdog.md` file.
