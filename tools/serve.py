"""Local test server that disables browser caching (python3 tools/serve.py [port], from simulator/).

The plain `python3 -m http.server` sends no Cache-Control header, so browsers may reuse old copies of
some modules after an edit and mix two versions of the code.
"""
import functools
import http.server
import os
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    handler = functools.partial(NoCache, directory=root)
    print(f'Serving {root} at http://localhost:{port}/ (no caching); Ctrl+C to stop')
    http.server.ThreadingHTTPServer(('', port), handler).serve_forever()
