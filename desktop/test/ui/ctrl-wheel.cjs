const { execFileSync } = require('node:child_process');

// sendInputEvent 的滚轮跳过 Chromium 原生 Ctrl+wheel 路径；只在隔离 Xvfb 内使用 XTest。
module.exports = (win, direction) => {
  const bounds = win.getContentBounds();
  execFileSync('python3', ['-c', `
import ctypes as c, sys
x = c.CDLL('libX11.so.6'); t = c.CDLL('libXtst.so.6')
x.XOpenDisplay.restype = c.c_void_p
d = x.XOpenDisplay(None)
if not d: raise RuntimeError('No X11 display')
x.XKeysymToKeycode.argtypes = [c.c_void_p, c.c_ulong]
x.XFlush.argtypes = [c.c_void_p]; x.XCloseDisplay.argtypes = [c.c_void_p]
t.XTestFakeMotionEvent.argtypes = [c.c_void_p, c.c_int, c.c_int, c.c_int, c.c_ulong]
t.XTestFakeKeyEvent.argtypes = [c.c_void_p, c.c_uint, c.c_int, c.c_ulong]
t.XTestFakeButtonEvent.argtypes = [c.c_void_p, c.c_uint, c.c_int, c.c_ulong]
control = x.XKeysymToKeycode(d, 0xffe3)
t.XTestFakeMotionEvent(d, -1, int(sys.argv[1]), int(sys.argv[2]), 0)
t.XTestFakeKeyEvent(d, control, 1, 0)
t.XTestFakeButtonEvent(d, int(sys.argv[3]), 1, 0)
t.XTestFakeButtonEvent(d, int(sys.argv[3]), 0, 0)
t.XTestFakeKeyEvent(d, control, 0, 0)
x.XFlush(d); x.XCloseDisplay(d)
`, String(bounds.x + 200), String(bounds.y + 200), direction === 'in' ? '4' : '5']);
};
