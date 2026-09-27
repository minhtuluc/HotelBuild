const fs = require('node:fs');
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Monorepo: Metro phải theo dõi và tìm module ở gốc workspace (ADR-018).
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

/**
 * Các gói workspace dùng specifier `.js` theo NodeNext; Metro không tự ánh xạ sang nguồn TS.
 * Shim này chỉ can thiệp vào import tương đối kết thúc bằng .js/.jsx/.mjs và chỉ khi tồn tại tệp TS.
 */
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isRelativeJs = moduleName.startsWith('.') && /\.(?:js|jsx|mjs)$/.test(moduleName);
  if (isRelativeJs) {
    const directory = path.dirname(context.originModulePath);
    const stem = moduleName.replace(/\.(?:js|jsx|mjs)$/, '');
    for (const extension of ['.ts', '.tsx']) {
      const candidate = path.resolve(directory, `${stem}${extension}`);
      if (fs.existsSync(candidate)) return context.resolveRequest(context, candidate, platform);
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
