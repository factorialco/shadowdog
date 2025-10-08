# Shadowdog Development Rules

## Overview

This project uses **Shadowdog** for artifact generation with MCP (Model Context Protocol) integration for AI tool interaction.

## Key Workflow

### Before Making Changes

1. **Check artifacts**: Use `get-artifacts` to see current artifact status
2. **Pause shadowdog**: Use `pause-shadowdog` before massive changes to prevent automatic regeneration
3. **Make changes**: Implement code changes while shadowdog is paused
4. **Resume or compute**: Use `resume-shadowdog` to resume automatic generation or `compute-artifact` for specific artifacts

### Available MCP Tools

- `pause-shadowdog` - Pauses artifact generation during code changes
- `resume-shadowdog` - Resumes artifact generation after changes
- `get-artifacts` - Query artifact status and information
- `compute-artifact` - Generate specific artifacts on demand
- `get-shadowdog-status` - Check shadowdog's current state and daemon availability

## Configuration

- `shadowdog.json` - Main configuration file defining watchers and commands
- `shadowdog-lock.json` - Lock file tracking artifact metadata and dependencies
- MCP server runs on `http://localhost:8473/mcp` by default

## Environment Variables

- `SHADOWDOG_MCP_PORT` - MCP server port (default: 8473)
- `SHADOWDOG_MCP_HOST` - MCP server host (default: localhost)
- `SHADOWDOG_DISABLE_LOCAL_CACHE` - Disable local cache
- `SHADOWDOG_LOCAL_CACHE_READ/WRITE` - Cache read/write overrides
- `SHADOWDOG_TAG` - Filter commands by tag

## Important Notes

- File changes are tracked and replayed when resuming
- Cache invalidation based on file contents, paths, environment variables, and commands
- Plugin order matters in configuration
- Always use absolute paths when possible for consistency
