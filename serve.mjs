// 极简静态服务器（零依赖）—— 用于本地打开这个 demo
// 用法: node serve.mjs [端口] [--no-open]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { spawn } from 'node:child_process';

const PORT = Number(process.argv[2] || 8765);
const OPEN = !process.argv.includes('--no-open');
const ROOT = path.dirname(url.fileURLToPath(import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon'
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, path.normalize(p).replace(/^([/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    const u = `http://127.0.0.1:${PORT}/index.html`;
    console.log(`\n  服务已经在运行了，直接打开：\n  ${u}\n`);
    const cmd = process.platform === 'win32' ? `start "" "${u}"`
      : process.platform === 'darwin' ? `open "${u}"` : `xdg-open "${u}"`;
    spawn(cmd, { shell: true, detached: true, stdio: 'ignore' }).unref();
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const addr = `http://127.0.0.1:${PORT}/index.html`;
  console.log(`\n  3D 粒子手势交互已启动：\n  ${addr}\n\n  关闭本窗口即停止服务\n`);
  if (OPEN) {
    try {
      spawn('cmd', ['/c', 'start', '', addr], { detached: true, stdio: 'ignore' }).unref();
    } catch { /* 忽略：用户可以手动打开 */ }
  }
});
