const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = fs.existsSync(path.join(__dirname, 'dist'))
  ? path.join(__dirname, 'dist')
  : __dirname;

const MIME_TYPES = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.map': 'application/json',
  '.xml': 'application/xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.wasm': 'application/wasm',
};

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, 'http://localhost');
  const decodedPath = decodeURIComponent(requestUrl.pathname);
  const absolutePath = path.join(ROOT, decodedPath);

  if (!absolutePath.startsWith(ROOT + path.sep)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  const getStats = async (filePath) => {
    try {
      const stats = await fs.promises.stat(filePath);
      return stats.isFile() ? stats : null;
    } catch {
      return null;
    }
  };

  const serveFile = (filePath, stats, statusCode = 200) => {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const mtime = stats.mtime.toUTCString();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Last-Modified', mtime);

    if (req.headers['if-modified-since'] === mtime) {
      res.statusCode = 304;
      res.end();
      return;
    }

    if (ext === '.html' || ext === '.htm') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }

    res.statusCode = statusCode;

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      res.statusCode = 500;
      res.end();
    });
    stream.pipe(res);
  };

  try {
    let stats = await getStats(absolutePath);
    if (stats) {
      serveFile(absolutePath, stats);
      return;
    }

    const htmlPath = absolutePath + '.html';
    stats = await getStats(htmlPath);
    if (stats) {
      serveFile(htmlPath, stats);
      return;
    }

    const dirIndexPath = path.join(absolutePath, 'index.html');
    stats = await getStats(dirIndexPath);
    if (stats) {
      serveFile(dirIndexPath, stats);
      return;
    }

    if (path.extname(absolutePath)) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    const custom404Path = path.join(ROOT, '404.html');
    stats = await getStats(custom404Path);
    if (stats) {
      serveFile(custom404Path, stats, 404);
      return;
    }

    const spaIndexPath = path.join(ROOT, 'index.html');
    stats = await getStats(spaIndexPath);
    if (stats) {
      serveFile(spaIndexPath, stats);
      return;
    }

    res.statusCode = 404;
    res.end('Not Found');
  } catch {
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`Static Shim running on http://localhost:${PORT}`);
});
