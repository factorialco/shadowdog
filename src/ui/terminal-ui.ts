import blessed from 'blessed'
import { EventEmitter } from 'events'
import { Artifact } from '../types'
import path from 'path'

interface TerminalUIOptions {
  title?: string
  theme?: {
    primary: string
    secondary: string
    success: string
    error: string
    warning: string
  }
}

type View = 'artifacts' | 'logs'

export class TerminalUI extends EventEmitter {
  private screen: blessed.Widgets.Screen
  private artifactTable: blessed.Widgets.ListElement
  private logBox: blessed.Widgets.ListElement
  private artifacts: Artifact[] = []
  private logs: string[] = []
  private currentView: View = 'artifacts'
  private breadcrumb: blessed.Widgets.BoxElement
  private viewHistory: View[] = ['artifacts']

  constructor(options: TerminalUIOptions = {}) {
    super()

    // Initialize screen
    this.screen = blessed.screen({
      smartCSR: true,
      title: options.title || 'Shadowdog Terminal UI',
      fullUnicode: true,
      dockBorders: true,
    })

    const sharedBoxConfig = {
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
      border: 'line' as const,
      style: {
        fg: 'white',
        bg: '#1a1a1a',
        border: {
          fg: 'cyan',
          bg: '#1a1a1a',
        },
        scrollbar: {
          bg: 'blue',
          fg: 'white',
        },
      },
    }

    // Create a layout box to contain both panels
    const layout = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
    })

    // Create breadcrumb header
    this.breadcrumb = blessed.box({
      parent: layout,
      top: 0,
      left: 0,
      width: '100%',
      height: 1,
      content: 'Artifacts',
      style: {
        fg: 'white',
        bg: '#1a1a1a',
      },
    })

    // Initialize artifact table (main panel)
    this.artifactTable = blessed.list({
      parent: layout,
      top: 1,
      left: 0,
      width: '100%',
      height: '100%-1',
      ...sharedBoxConfig,
      padding: {
        left: 1,
        right: 1,
      },
      style: {
        ...sharedBoxConfig.style,
        item: {
          bg: '#1a1a1a',
          fg: 'white',
        },
      },
      items: [],
      interactive: false,
      mouse: false,
      keys: false,
      vi: false,
    })

    // Initialize log box
    this.logBox = blessed.list({
      parent: layout,
      top: 1,
      left: 0,
      width: '100%',
      height: '100%-1',
      ...sharedBoxConfig,
      padding: {
        left: 1,
        right: 1,
      },
      hidden: true,
      interactive: false,
      mouse: false,
      keys: false,
      vi: false,
    })

    // Set up key bindings
    this.screen.key(['q', 'C-c'], () => {
      this.emit('quit')
      process.exit(0)
    })

    this.screen.key('?', () => {
      this.showHelp()
    })

    this.screen.key('l', () => {
      this.switchView('logs')
    })

    this.screen.key('escape', () => {
      this.goBack()
    })

    // Initial render
    this.screen.render()
  }

  private updateBreadcrumb(): void {
    const breadcrumbMap: Record<View, string> = {
      artifacts: 'Artifacts',
      logs: 'Logs',
    }

    const breadcrumbPath = this.viewHistory.map((view) => breadcrumbMap[view]).join(' > ')

    this.breadcrumb.setContent(breadcrumbPath)
  }

  private switchView(view: View): void {
    // Don't switch if we're already on this view
    if (this.currentView === view) {
      return
    }

    this.currentView = view

    // Update view history
    if (view === 'artifacts') {
      this.viewHistory = ['artifacts']
    } else {
      this.viewHistory = ['artifacts', view]
    }

    this.updateBreadcrumb()

    // Hide all views
    this.artifactTable.hidden = true
    this.logBox.hidden = true

    // Show selected view
    switch (view) {
      case 'artifacts':
        this.artifactTable.hidden = false
        this.artifactTable.focus()
        break
      case 'logs':
        this.logBox.hidden = false
        this.logBox.focus()
        this.logBox.scrollTo(this.logs.length)
        break
    }

    // Force a full rerender
    this.screen.realloc()
    this.screen.render()
  }

  private goBack(): void {
    // Only go back if we're in a nested view
    if (this.currentView !== 'artifacts') {
      this.switchView('artifacts')
    }
  }

  public start(): void {
    // Clear any existing logs
    this.logs = []
    this.logBox.setItems([])
    this.screen.render()
  }

  public updateArtifacts(artifacts: Artifact[]): void {
    this.artifacts = artifacts

    // Define column widths
    const columnWidths = {
      status: 8, // Reduced since we don't need that much space
      name: 25,
      path: 35,
      updatedAt: 25,
      duration: 8,
    }

    // Create header with proper spacing
    const headers = ['Status', 'Name', 'Path', 'Updated At', 'Duration']
    const headerRow = [
      headers[0].padEnd(columnWidths.status),
      ' ' + headers[1].padEnd(columnWidths.name), // Add space before each column except first
      ' ' + headers[2].padEnd(columnWidths.path),
      ' ' + headers[3].padEnd(columnWidths.updatedAt),
      ' ' + headers[4].padEnd(columnWidths.duration),
    ].join('')

    // Create underline with the same spacing
    const underline = [
      '─'.repeat(columnWidths.status),
      '─'.repeat(columnWidths.name + 1), // +1 for the space we added
      '─'.repeat(columnWidths.path + 1),
      '─'.repeat(columnWidths.updatedAt + 1),
      '─'.repeat(columnWidths.duration + 1),
    ].join('')

    // Create rows with consistent spacing
    const rows = artifacts.map((artifact) => {
      const { icon, color } = this.getStatusIcon(artifact.status, artifact.fromCache)
      const columns = [
        `{${color}-fg}${icon.padEnd(7)}{/}`, // Fixed width of 7 for the status text
        ' ' +
          path
            .basename(artifact.output)
            .slice(0, columnWidths.name - 2)
            .padEnd(columnWidths.name),
        ' ' +
          path
            .relative(process.cwd(), artifact.output)
            .slice(0, columnWidths.path - 2)
            .padEnd(columnWidths.path),
        ' ' +
          (artifact.updatedAt ? new Date(artifact.updatedAt).toLocaleString() : 'Never').padEnd(
            columnWidths.updatedAt,
          ),
        ' ' + this.formatDuration(artifact.duration).padEnd(columnWidths.duration),
      ]
      return columns.join('')
    })

    // Set the header with underline and the data rows
    this.artifactTable.setItems([
      `{white-fg}{#1a1a1a-bg}${headerRow}{/}`,
      `{white-fg}{#1a1a1a-bg}${underline}{/}`,
      ...rows.map((row) => `{white-fg}${row}{/}`),
    ])

    if (this.currentView === 'artifacts') {
      this.artifactTable.focus()
    }

    this.screen.render()
  }

  private getStatusIcon(status: string, fromCache?: boolean): { icon: string; color: string } {
    switch (status.toLowerCase()) {
      case 'generating':
        return { icon: 'RUNNING', color: 'yellow' }
      case 'generated':
        return fromCache ? { icon: 'CACHED', color: 'magenta' } : { icon: 'READY', color: 'green' }
      case 'error':
        return { icon: 'ERROR', color: 'red' }
      case 'pending':
        return { icon: 'PENDING', color: 'gray' }
      default:
        return { icon: status.toUpperCase(), color: 'gray' }
    }
  }

  private formatDuration(duration: number | undefined): string {
    if (duration === undefined) return 'N/A'

    const seconds = duration / 1000
    if (seconds < 1) {
      return '<1s'
    }
    return `${seconds.toFixed(1)}s`
  }

  public log(message: string): void {
    // Split multi-line messages, strip emojis, and clean up spaces
    const lines = message
      .split('\n')
      .map((line) => this.stripEmojis(line))
      .filter((line) => line.length > 0) // Remove empty lines after emoji stripping

    this.logs.push(...lines)

    // Keep only the last 1000 lines to prevent memory issues
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(-1000)
    }

    // Update the log box
    this.logBox.setItems(this.logs)

    // Scroll to bottom
    this.logBox.scrollTo(this.logs.length)

    this.screen.render()
  }

  private stripEmojis(text: string): string {
    return text
      .replace(/[➜→]\s*/g, '> ') // Replace arrows with '>' and ensure exactly one space after
      .replace(
        /[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{2900}-\u{297F}\u{2B00}-\u{2BFF}]/gu,
        '',
      )
      .replace(/\s+/g, ' ') // Clean up any remaining multiple spaces
      .trim() // Remove leading/trailing spaces
  }

  private showHelp(): void {
    const helpText = `
      Shadowdog Terminal UI Help
      -------------------------
      q, Ctrl+C : Quit
      ?         : Show this help
      l         : Show logs
      Esc       : Go back
      `

    const helpBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: '50%',
      content: helpText,
      tags: true,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: '#f0f0f0',
        },
      },
    })

    this.screen.render()

    // Close help box on any key
    helpBox.key(['escape', 'q', 'enter'], () => {
      helpBox.destroy()
      this.screen.render()
    })

    helpBox.focus()
  }
}
