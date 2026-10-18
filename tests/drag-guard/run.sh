#!/usr/bin/env bash
# Headless verification of the macOS window-drag contract of lib/client.js.
# Requires python3 and a Chromium-family browser (Google Chrome, Chromium, or Edge).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"
# Pick a free loopback port unless the caller pins one.
port="${TBP_TEST_PORT:-$(python3 -c 'import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()')}"
server_pid=""

cleanup() {
  if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
  rm -rf "$tmp"
}
trap cleanup EXIT

cp "$root/lib/client.js" "$tmp/client.js"
cp "$here/harness.js" "$tmp/harness.js"
cp "$here/index.html" "$tmp/index.html"

cat > "$tmp/server.py" <<'PY'
import http.server
import os
import socketserver
import sys
import time

os.chdir(sys.argv[2])


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/slow'):
            # Hold the page's load event open so headless --dump-dom happens after the run.
            time.sleep(7)
            self.send_response(200)
            self.send_header('Content-Type', 'image/gif')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        return super().do_GET()

    def log_message(self, fmt, *args):
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


Server(('127.0.0.1', int(sys.argv[1])), Handler).serve_forever()
PY

python3 "$tmp/server.py" "$port" "$tmp" &
server_pid=$!
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$port/index.html" 2>/dev/null; then break; fi
  sleep 0.2
done

chrome=""
for candidate in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  "$(command -v google-chrome || true)" \
  "$(command -v chromium || true)"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then chrome="$candidate"; break; fi
done
if [ -z "$chrome" ]; then
  echo "no Chromium-family browser found" >&2
  exit 2
fi

"$chrome" --headless=new --disable-gpu --no-first-run --no-default-browser-check \
  --user-data-dir="$tmp/profile" --window-size=1200,800 --dump-dom \
  "http://127.0.0.1:$port/index.html" > "$tmp/dom.html" 2>/dev/null

python3 - "$tmp/dom.html" <<'PY'
import json
import re
import sys

html = open(sys.argv[1], encoding="utf-8").read()
match = re.search(r'<div id="result">(.*?)</div>', html, re.S)
if match is None:
    print("FAIL: no result block in the dumped DOM", file=sys.stderr)
    raise SystemExit(1)
try:
    result = json.loads(match.group(1))
except json.JSONDecodeError:
    print("FAIL: could not parse result:", match.group(1)[:400], file=sys.stderr)
    raise SystemExit(1)
print(json.dumps(result, indent=2, ensure_ascii=False))
raise SystemExit(0 if result.get("pass") else 1)
PY
