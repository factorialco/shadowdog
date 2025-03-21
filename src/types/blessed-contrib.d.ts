import * as blessed from 'blessed'

declare module 'blessed-contrib' {
  namespace Widgets {
    interface GridOptions {
      rows: number
      cols: number
      screen: blessed.Widgets.Screen
    }

    interface GridElement {
      set<T extends blessed.Widgets.BoxElement>(
        row: number,
        col: number,
        rowSpan: number,
        colSpan: number,
        type: any,
        options: any,
      ): T
    }

    interface GaugeOptions extends blessed.Widgets.BoxOptions {
      label?: string
      percent?: number[]
      style?: {
        fg?: string
        bg?: string
      }
    }

    interface GaugeElement extends blessed.Widgets.BoxElement {
      setPercent(percent: number): void
    }
  }

  interface BlessedContrib {
    grid(options: Widgets.GridOptions): Widgets.GridElement
    gauge(options: Widgets.GaugeOptions): Widgets.GaugeElement
  }

  const contrib: BlessedContrib
  export = contrib
}
