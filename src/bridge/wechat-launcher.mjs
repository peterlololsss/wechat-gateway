import { existsSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);
const REGISTRY_KEYS = [
  'HKCU\\Software\\Tencent\\WeChat',
  'HKLM\\SOFTWARE\\Tencent\\WeChat',
  'HKLM\\SOFTWARE\\WOW6432Node\\Tencent\\WeChat',
];
const EXECUTABLE_NAMES = ['WeChat.exe', 'WechatAppLauncher.exe'];

function isWindows() {
  return process.platform === 'win32';
}

function resolveExecutableCandidates(config = {}) {
  const candidates = [];

  if (typeof config.wechatExecutablePath === 'string' && config.wechatExecutablePath.trim()) {
    candidates.push(config.wechatExecutablePath.trim());
  }

  const envCandidates = [
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Tencent', 'WeChat', 'WeChat.exe') : '',
    process.env['ProgramFiles'] ? join(process.env['ProgramFiles'], 'Tencent', 'WeChat', 'WeChat.exe') : '',
    process.env['ProgramFiles(x86)'] ? join(process.env['ProgramFiles(x86)'], 'Tencent', 'WeChat', 'WeChat.exe') : '',
  ];
  for (const candidate of envCandidates) {
    if (candidate) {
      candidates.push(candidate);
    }
  }

  return [...new Set(candidates)];
}

async function isWeChatRunning() {
  if (!isWindows()) {
    return false;
  }

  const names = ['WeChat.exe', 'WechatAppLauncher.exe'];
  for (const imageName of names) {
    try {
      const { stdout } = await execFileAsync('tasklist', [
        '/FI',
        `IMAGENAME eq ${imageName}`,
        '/FO',
        'CSV',
        '/NH',
      ]);
      if (String(stdout).trim().startsWith(`"${imageName}"`)) {
        return true;
      }
    } catch {
      // Ignore tasklist lookup failures and continue with the next image name.
    }
  }

  return false;
}

async function queryRegistryInstallPath() {
  const diagnostics = {
    checkedKeys: [...REGISTRY_KEYS],
    matchedInstallPath: '',
  };

  for (const key of REGISTRY_KEYS) {
    try {
      const { stdout } = await execFileAsync('reg', ['query', key, '/v', 'InstallPath']);
      const lines = String(stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const installLine = lines.find((line) => line.startsWith('InstallPath'));
      if (!installLine) {
        continue;
      }

      const match = installLine.match(/^InstallPath\s+REG_\w+\s+(.+)$/i);
      if (!match?.[1]) {
        continue;
      }

      const installPath = match[1].trim();
      for (const executableName of EXECUTABLE_NAMES) {
        const executablePath = join(installPath, executableName);
        if (existsSync(executablePath)) {
          diagnostics.matchedInstallPath = installPath;
          return {
            executablePath,
            diagnostics,
          };
        }
      }
    } catch {
      // Ignore missing registry keys.
    }
  }

  return {
    executablePath: '',
    diagnostics,
  };
}

async function resolveWeChatExecutablePath(config = {}) {
  const candidatePaths = resolveExecutableCandidates(config);
  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) {
      return {
        executablePath: candidate,
        diagnostics: {
          candidatePaths,
          checkedKeys: [...REGISTRY_KEYS],
          matchedInstallPath: '',
        },
      };
    }
  }

  const registryResult = await queryRegistryInstallPath();
  return {
    executablePath: registryResult.executablePath,
    diagnostics: {
      candidatePaths,
      checkedKeys: registryResult.diagnostics.checkedKeys,
      matchedInstallPath: registryResult.diagnostics.matchedInstallPath,
    },
  };
}

async function waitForWeChatProcess(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isWeChatRunning()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

async function readExecutableVersion(executablePath) {
  if (!isWindows() || !executablePath) {
    return '';
  }

  const escapedPath = executablePath.replace(/'/g, "''");
  try {
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile',
      '-Command',
      `[System.Diagnostics.FileVersionInfo]::GetVersionInfo('${escapedPath}').FileVersion`,
    ]);
    return String(stdout).trim();
  } catch {
    return '';
  }
}

export async function ensureWeChatRunning(config = {}) {
  const launchTimeoutMs = Number.isFinite(Number(config.wechatLaunchTimeoutMs))
    ? Math.max(Number(config.wechatLaunchTimeoutMs), 1000)
    : 10_000;

  if (!isWindows()) {
    return {
      started: false,
      skipped: true,
      reason: 'non_windows',
      diagnostics: {
        candidatePaths: [],
        checkedKeys: [...REGISTRY_KEYS],
        launchTimeoutMs,
      },
    };
  }

  if (config.autoLaunchWeChat === false) {
    return {
      started: false,
      skipped: true,
      reason: 'disabled',
      diagnostics: {
        candidatePaths: resolveExecutableCandidates(config),
        checkedKeys: [...REGISTRY_KEYS],
        launchTimeoutMs,
      },
    };
  }

  if (await isWeChatRunning()) {
    return {
      started: false,
      skipped: true,
      reason: 'already_running',
      diagnostics: {
        candidatePaths: resolveExecutableCandidates(config),
        checkedKeys: [...REGISTRY_KEYS],
        launchTimeoutMs,
      },
    };
  }

  const resolution = await resolveWeChatExecutablePath(config);
  const executablePath = resolution.executablePath;
  if (!executablePath) {
    return {
      started: false,
      skipped: true,
      reason: 'not_found',
      diagnostics: {
        ...resolution.diagnostics,
        launchTimeoutMs,
      },
    };
  }

  const child = spawn(executablePath, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();

  const running = await waitForWeChatProcess(launchTimeoutMs);
  const detectedVersion = await readExecutableVersion(executablePath);
  const supportedVersionPrefix = typeof config.supportedWeChatVersionPrefix === 'string'
    ? config.supportedWeChatVersionPrefix.trim()
    : '';
  const versionSupported = !supportedVersionPrefix || detectedVersion.startsWith(supportedVersionPrefix);

  return {
    started: running,
    skipped: false,
    reason: running ? 'launched' : 'launch_timeout',
    executablePath,
    diagnostics: {
      ...resolution.diagnostics,
      childPid: child.pid,
      launchTimeoutMs,
      detectedVersion,
      supportedVersionPrefix,
      versionSupported,
    },
  };
}
