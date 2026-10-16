// Read Chromium's actual accessibility tree; keep DOM objects out of assertions.
module.exports = async win => {
  const debuggerApi = win.webContents.debugger;
  const attached = debuggerApi.isAttached();
  if (!attached) debuggerApi.attach('1.3');
  try {
    const { nodes } = await debuggerApi.sendCommand('Accessibility.getFullAXTree');
    return nodes.filter(node => !node.ignored).map(node => ({
      role: node.role?.value, name: node.name?.value ?? '',
      level: node.properties?.find(property => property.name === 'level')?.value.value
    }));
  } finally { if (!attached) debuggerApi.detach(); }
};
