import { copyFile, mkdir } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyWechatMediaKind } from '../messages/contract.mjs';

const BRIDGE_ROOT_DIR = fileURLToPath(new URL('../..', import.meta.url));
const DEFAULT_DOWNLOAD_DIR = fileURLToPath(new URL('../../downloads', import.meta.url));

function sanitizeFileName(value, fallback = 'download') {
  const trimmed = String(value || '').trim();
  const baseName = basename(trimmed);
  const sanitized = baseName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  return sanitized || fallback;
}

function resolveDownloadDir(config) {
  const configuredDir = typeof config?.mediaDownloadDir === 'string'
    ? config.mediaDownloadDir.trim()
    : '';
  if (!configuredDir) {
    return DEFAULT_DOWNLOAD_DIR;
  }

  return isAbsolute(configuredDir)
    ? configuredDir
    : resolve(BRIDGE_ROOT_DIR, configuredDir);
}

export function resolveMediaStorageDir(config, subdir = '') {
  const baseDir = resolveDownloadDir(config);
  return subdir ? join(baseDir, subdir) : baseDir;
}

export async function ensureMediaStorageDir(config, subdir = '') {
  const downloadDir = resolveMediaStorageDir(config, subdir);
  await mkdir(downloadDir, { recursive: true });
  return downloadDir;
}

function resolveExtension(preferredName, rawMessage) {
  const candidates = [
    preferredName,
    rawMessage?.extra,
    rawMessage?.thumb,
  ];

  for (const candidate of candidates) {
    const ext = extname(String(candidate || '').split('?')[0]);
    if (ext) {
      return ext.toLowerCase();
    }
  }

  return '';
}

function buildDownloadFileName(rawMessage, preferredName) {
  const sanitizedPreferredName = sanitizeFileName(preferredName, '');
  if (sanitizedPreferredName) {
    return sanitizedPreferredName;
  }

  const mediaKind = classifyWechatMediaKind(rawMessage?.type) || 'media';
  const messageId = sanitizeFileName(rawMessage?.id, 'unknown');
  const extension = resolveExtension(preferredName, rawMessage);
  return `${mediaKind}-${messageId}${extension}`;
}

export async function saveDownloadedFileBox(fileBox, rawMessage, config) {
  const downloadDir = await ensureMediaStorageDir(config);
  const fileName = buildDownloadFileName(rawMessage, fileBox?.name);
  const savedPath = join(downloadDir, fileName);

  await fileBox.toFile(savedPath, true);

  return {
    download_dir: downloadDir,
    file_name: fileName,
    saved_path: savedPath,
  };
}

export async function saveGeneratedLocalFile(sourcePath, rawMessage, config, options = {}) {
  const preferredName = typeof options.preferredName === 'string' ? options.preferredName : '';
  const subdir = typeof options.subdir === 'string' ? options.subdir : '';
  const downloadDir = await ensureMediaStorageDir(config, subdir);
  const fileName = buildDownloadFileName(rawMessage, preferredName || sourcePath);
  const savedPath = join(downloadDir, fileName);

  if (resolve(sourcePath) !== resolve(savedPath)) {
    await copyFile(sourcePath, savedPath);
  }

  return {
    download_dir: downloadDir,
    file_name: fileName,
    saved_path: savedPath,
  };
}
