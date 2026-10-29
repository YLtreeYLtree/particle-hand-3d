# -*- coding: utf-8 -*-
"""极简静态服务器（Python 备用方案）
用法: py -3 serve.py [端口]
"""
import sys
import os
import socket
import webbrowser
import http.server

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = dict(
        http.server.SimpleHTTPRequestHandler.extensions_map,
        **{
            ".wasm": "application/wasm",
            ".task": "application/octet-stream",
            ".mjs": "text/javascript; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".html": "text/html; charset=utf-8",
            ".json": "application/json; charset=utf-8",
        }
    )

    def log_message(self, fmt, *args):
        pass


url = "http://127.0.0.1:%d/index.html" % PORT


def already_running(port):
    """Windows 上允许端口复用，重复 bind 不会报错，所以先探测一下。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.4)
        return s.connect_ex(("127.0.0.1", port)) == 0


if already_running(PORT):
    # 上次的窗口还开着：不再起第二个服务，直接把页面打开
    print("\n  服务已经在运行了，直接打开：\n  %s\n" % url)
    try:
        webbrowser.open(url)
    except Exception:
        pass
    sys.exit(0)

httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
print("\n  3D 粒子手势交互已启动：\n  %s\n\n  用完关掉这个黑窗口即可（或按 Ctrl+C）\n" % url)
try:
    webbrowser.open(url)
except Exception:
    pass
try:
    httpd.serve_forever()
except KeyboardInterrupt:
    pass
