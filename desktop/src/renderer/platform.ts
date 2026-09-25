export type DesktopPlatform = 'darwin' | 'win32' | 'linux';

// 仅用于外观与操作顺序，不作为权限或 IPC 校验依据。
export function desktopPlatform(userAgent: string): DesktopPlatform {
  if (/Macintosh|Mac OS X/.test(userAgent)) return 'darwin';
  if (/Windows/.test(userAgent)) return 'win32';
  return 'linux';
}

export const currentPlatform = desktopPlatform(typeof navigator === 'undefined' ? '' : navigator.userAgent);
export const isMac = currentPlatform === 'darwin';
