"""Test web server: serves the pages in a directory, plus /headers, which returns the
request headers it received as JSON (lower-cased names).
usage: serve.py <directory> <port>"""
import functools
import http.server
import json
import sys
import time


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        path, _, query = self.path.partition("?")
        if path == "/slow":
            # Responds after ?ms=<n> milliseconds; lets a page hold its load event.
            ms = int(dict(p.split("=") for p in query.split("&") if "=" in p).get("ms", "1000"))
            time.sleep(min(ms, 20000) / 1000)
            self.send_response(204)
            self.end_headers()
            return
        if path != "/headers":
            return super().do_GET()
        body = json.dumps({k.lower(): v for k, v in self.headers.items()}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


directory, port = sys.argv[1], int(sys.argv[2])
http.server.ThreadingHTTPServer(
    ("127.0.0.1", port), functools.partial(Handler, directory=directory)
).serve_forever()
