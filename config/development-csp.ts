import type { Plugin } from 'vite'

/** Vite injects a refresh preamble in development; release HTML keeps a strict script policy. */
export function developmentCsp(): Plugin {
  return {
    name: 'questbranch-development-csp',
    transformIndexHtml(html, context) {
      if (!context.server) return html
      return html
        .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
        .replace(
          "connect-src 'self'",
          "connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*",
        )
    },
  }
}
