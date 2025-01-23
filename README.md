# Shadowdog 🐾

<img src="https://raw.githubusercontent.com/factorialco/shadowdog/refs/heads/main/logo.png" alt="drawing" width="100"/>

**Shadowdog** is a Node.js package for generating artifacts as derivative processes of files in your project. Whether you need to generate static assets, precompiled resources, or any other transformations, Shadowdog makes it easy and powerful with its supercharged feature set.

## Features 🚀

- **Flexible Input Detection:** Automatically detects changes in files and processes only the updated ones.
- **Configurable Pipelines:** Define artifact generation workflows using an intuitive JSON configuration file.
- **Plugin Support:** Extend functionality with custom or community-built plugins.
- **Blazing Fast Performance:** Optimized for speed, even with large repositories.
- **Watch Mode:** Automatically regenerate artifacts when source files change.

---

## Installation

Install Shadowdog via npm:

```bash
npm install shadowdog --save-dev
```

---

## Getting started 🐕

Shadowdog uses a configuration file (`shadowdog.json`) to define workflows for generating artifacts. Here’s an example:

```json
{
  "$schema": "https://raw.githubusercontent.com/factorialco/shadowdog/refs/heads/main/schema.json",
  "plugins": [],
  "watchers": [
    {
      "files": ["example.txt"],
      "commands": [
        {
          "artifacts": [
            {
              "output": "example.output.txt"
            }
          ],
          "command": "cp example.txt example.output.txt"
        }
      ]
    }
  ]
}
```

### Key fields

- **`$schema`**: Provides schema validation for the configuration.
- **`plugins`**: An array of plugin names to extend Shadowdog's functionality.
- **`watchers`**: Defines file watchers that trigger artifact generation commands.
  - `files`: An array of file paths or glob patterns to watch.
  - `commands`: Commands to execute when changes are detected.
    - `artifacts`: Specifies the output files generated by the command.
    - `command`: The shell command to run.

---

## CLI commands

Shadowdog provides a variety of commands to simplify your workflows:

- **Generate artifacts**:
  ```bash
  npx shadowdog
  ```
- **Watch mode**:
  ```bash
  npx shadowdog --watch
  ```

---

## Available plugins 🧩

Enhance Shadowdog with these powerful plugins:

- **`shadowdog-local-cache`**
  Implements a local caching mechanism to speed up repeated artifact generation.

  Environment variables:

  - `SHADOWDOG_DISABLE_LOCAL_CACHE`: When `true`, disables local cache completely
  - `SHADOWDOG_LOCAL_CACHE_READ`: When set, overrides the plugin's read cache configuration (`true`/`false`)
  - `SHADOWDOG_LOCAL_CACHE_WRITE`: When set, overrides the plugin's write cache configuration (`true`/`false`)
  - `SHADOWDOG_LOCAL_CACHE_PATH`: When set, overrides the plugin's cache directory path

- **`shadowdog-remote-aws-s3-cache`**
  Enables remote caching with AWS S3 for distributed workflows.

  Environment variables:

  - `SHADOWDOG_DISABLE_REMOTE_CACHE`: When `true`, disables remote cache completely
  - `SHADOWDOG_REMOTE_CACHE_READ`: When set, overrides the plugin's read cache configuration (`true`/`false`)
  - `SHADOWDOG_REMOTE_CACHE_WRITE`: When set, overrides the plugin's write cache configuration (`true`/`false`)
  - `AWS_PROFILE`: AWS profile to use for authentication (optional)
  - `AWS_ACCESS_KEY_ID`: AWS access key ID (required if AWS_PROFILE not set)
  - `AWS_SECRET_ACCESS_KEY`: AWS secret access key (required if AWS_PROFILE not set)
  - `AWS_REGION`: AWS region (required if AWS_PROFILE not set)

- **`shadowdog-tag`**
  Adds tagging capabilities to filter specific commands.

  Environment variables:

  - `SHADOWDOG_TAG`: When set, only runs commands with matching tag

- **`shadowdog-lock`**
  Prevents multiple instances of Shadowdog from running simultaneously by implementing file-based locking.

- **`shadowdog-git`**
  Handles git rebases and merges smoothly pausing the watcher and resuming it after the rebase is done.

  Internal configuration:

  - Checks for rebase every 2000ms (INTERVAL_TIME)
  - Uses `.git/rebase-merge` to detect rebase state

- **`shadowdog-socket`**
  Provides an external communication channel for interacting with Shadowdog.

  No configurable environment variables. Uses socket events:

  - `CHANGED_FILE`: Emitted when a file changes
  - `ERROR`: Emitted on errors
  - `INITIALIZED`: Emitted on startup
  - `CLEAR`: Emitted on cleanup

- **`shadowdog-tree`**
  Generate a dependency tree structure between commands to run different commands that depend on each other.

  No configurable environment variables. Uses internal dependency graph algorithm.

- **`shadowdog-rake`**
  Optimize multiple `bundle exec rake` commands into a single command.

  No configurable environment variables. Automatically detects and combines rake tasks.

### Using plugins

To use a plugin, add it to the `plugins` section of your `shadowdog.json` configuration file. For example:

Update your configuration:

```json
{
  ...
  "plugins": [
    {
      "name": "shadowdog-local-cache",
    },
    {
     "name" : "shadowdog-tree"
    }
  ]
  ...
}
```

Take into account that the order of plugins is important. The plugins will be executed in the order they are defined in the configuration file.

---

## License 📄

Shadowdog is open source and available under the [MIT License](./LICENSE).

---

## Feedback & Support ❤️

If you encounter any issues, have questions, or want to suggest features, please open an issue or join the discussions.

---

Enjoy artifact generation, **supercharged**! 🐾
