import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));
const publicDir = join(rootDir, 'public');
const srcDir = join(rootDir, 'src');

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8']
]);

function parseArgs(argv) {
  const options = {
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || 4173)
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--host') {
      options.host = argv[index + 1] || options.host;
      index += 1;
    } else if (arg === '--port') {
      options.port = Number(argv[index + 1] || options.port);
      index += 1;
    }
  }

  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }

  return options;
}

function isInside(baseDir, targetPath) {
  const rel = relative(baseDir, targetPath);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}

function resolveFilePath(requestPath) {
  if (requestPath === '/') {
    return join(publicDir, 'index.html');
  }

  if (requestPath === '/tasks.json') {
    return join(publicDir, 'tasks.json');
  }

  if (requestPath.startsWith('/src/')) {
    const candidate = normalize(join(rootDir, requestPath.slice(1)));
    return isInside(srcDir, candidate) ? candidate : null;
  }

  const candidate = normalize(join(publicDir, requestPath));
  return isInside(publicDir, candidate) ? candidate : null;
}

async function serveFile(response, filePath, method) {
  if (!filePath) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    const headers = {
      'content-type': contentTypes.get(extname(filePath)) || 'application/octet-stream',
      'cache-control': 'no-store'
    };

    response.writeHead(200, headers);
    if (method === 'HEAD') {
      response.end();
      return;
    }

    response.end(await readFile(filePath));
  } catch (error) {
    if (error.code === 'ENOENT') {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Internal server error');
  }
}

export function createBenchmarkServer() {
  return createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { allow: 'GET, HEAD' });
      response.end();
      return;
    }

    let url;
    let requestPath;
    try {
      url = new URL(request.url, 'http://127.0.0.1');
      requestPath = decodeURIComponent(url.pathname);
    } catch {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Bad request');
      return;
    }

    const filePath = resolveFilePath(requestPath);
    await serveFile(response, filePath, request.method);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { host, port } = parseArgs(process.argv.slice(2));
  const server = createBenchmarkServer();

  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    console.log(`GUI Agent Benchmark listening on http://${host}:${actualPort}`);
  });
}
