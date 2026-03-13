import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';

const MIME_BY_EXTENSION = {
  '.amr': 'audio/amr',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.m4a': 'audio/mp4',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.silk': 'audio/silk',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
};

function sanitizeHeaderFileName(value) {
  return String(value || '')
    .replace(/[\r\n"]/g, '_')
    .replace(/[^\x20-\x7e]/g, '_')
    .trim() || 'download.bin';
}

function resolveContentType(fileName, mediaKind) {
  const extension = extname(String(fileName || '')).toLowerCase();
  if (MIME_BY_EXTENSION[extension]) {
    return MIME_BY_EXTENSION[extension];
  }

  switch (mediaKind) {
    case 'image':
      return 'image/jpeg';
    case 'voice':
      return 'audio/amr';
    case 'video':
      return 'video/mp4';
    default:
      return 'application/octet-stream';
  }
}

function buildContentDisposition(fileName) {
  const fallbackName = sanitizeHeaderFileName(fileName);
  return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(fileName || fallbackName)}`;
}

export async function streamLocalFileResponse(res, { filePath, fileName, mediaKind = '', messageId = '' }) {
  const stats = await stat(filePath);
  const downloadName = fileName || basename(filePath);

  res.statusCode = 200;
  res.setHeader('content-type', resolveContentType(downloadName, mediaKind));
  res.setHeader('content-length', String(stats.size));
  res.setHeader('content-disposition', buildContentDisposition(downloadName));
  if (mediaKind) {
    res.setHeader('x-bridge-media-kind', mediaKind);
  }
  if (messageId) {
    res.setHeader('x-bridge-message-id', String(messageId));
  }

  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    let settled = false;

    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    const fail = (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    stream.on('error', fail);
    res.on('error', fail);
    res.on('finish', finish);
    stream.pipe(res);
  });
}
