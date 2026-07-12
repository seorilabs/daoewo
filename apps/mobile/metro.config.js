const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const fs = require('fs');
const path = require('path');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const workspaceRoot = path.resolve(__dirname, '../..');

/**
 * Workspace packages are authored as NodeNext TypeScript and therefore keep
 * `.js` specifiers in source. Metro follows the symlink to that source, so map
 * a missing relative `.js` file back to its TypeScript source counterpart.
 */
function resolveWorkspaceTypeScript(context, moduleName, platform) {
  if (
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js') &&
    context.originModulePath.startsWith(`${workspaceRoot}${path.sep}`) &&
    !context.originModulePath.includes(`${path.sep}node_modules${path.sep}`)
  ) {
    const sourceBase = path.resolve(
      path.dirname(context.originModulePath),
      moduleName.slice(0, -3),
    );

    for (const extension of ['.ts', '.tsx']) {
      const filePath = `${sourceBase}${extension}`;
      if (fs.existsSync(filePath)) {
        return {type: 'sourceFile', filePath};
      }
    }
  }

  return context.resolveRequest(context, moduleName, platform);
}

const config = {
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    resolveRequest: resolveWorkspaceTypeScript,
    unstable_enableSymlinks: true,
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
