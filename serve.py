#!/usr/bin/env python3
"""Zero-build dev server for UNASSIMILATED.

Serves the project folder with HTTP caching disabled so edited ES modules are
always re-fetched. Python's stdlib ``http.server`` sends no ``Cache-Control``,
which lets browsers apply heuristic freshness and serve stale modules -- code
changes then appear to have no effect until a hard reload.

Usage:
    python serve.py [port]      # default 8000
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class NoCacheHandler(SimpleHTTPRequestHandler):
    # Explicit types so ES modules are always served as JavaScript.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write('%s - %s\n' % (self.address_string(), fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(NoCacheHandler, directory=str(ROOT))
    with ThreadingHTTPServer(('127.0.0.1', port), handler) as httpd:
        print(f'UNASSIMILATED dev server -> http://127.0.0.1:{port}')
        print('Caching disabled; press Ctrl+C to stop.')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nStopped.')


if __name__ == '__main__':
    main()
