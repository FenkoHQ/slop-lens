#!/usr/bin/env python3
"""Static server for the browser harnesses, with caching off.

The browser will happily serve a stale `src/*.js` from memory cache while you
iterate, which reads as "the fix did nothing". This server makes that
impossible.

    python3 tools/serve.py [port]
"""

import functools
import http.server
import pathlib
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8731
ROOT = pathlib.Path(__file__).resolve().parent.parent


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, *args):
        pass


handler = functools.partial(NoCacheHandler, directory=str(ROOT))
print(f"serving {ROOT} on http://127.0.0.1:{PORT}")
http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler).serve_forever()
