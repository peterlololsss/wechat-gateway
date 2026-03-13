const DEFAULT_MAX_BODY_BYTES = 1 * 1024 * 1024;

export function writeJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export function readJsonBody(req, { maxBodyBytes = DEFAULT_MAX_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBodyBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });

    req.on('error', reject);
  });
}

export function getRequestUrl(req) {
  const host = req.headers.host || 'localhost';
  return new URL(req.url || '/', `http://${host}`);
}

export function getPathname(req) {
  return getRequestUrl(req).pathname;
}

export function isJsonRequest(req) {
  if (req.method === 'GET') {
    return true;
  }
  const contentType = String(req.headers['content-type'] || '');
  return !contentType || contentType.includes('application/json');
}
