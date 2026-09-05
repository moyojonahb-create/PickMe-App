const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/**
 * Metro has to be told about `packages/core`, because it lives outside this
 * app's directory and Metro does not follow imports past the project root by
 * default — it would resolve `@cruixe/core` to nothing and fail at bundle time.
 *
 * This is the "alongside, copy core" arrangement from the migration plan: the
 * web app at the repo root is untouched and still owns its own copy in
 * `src/lib/`, while mobile consumes the ported package directly from source.
 * No build step, so an edit in core is picked up by fast refresh here.
 */
const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '../..');
const corePath = path.resolve(repoRoot, 'packages/core');

const config = getDefaultConfig(projectRoot);

// Watch core for changes so fast refresh works across the package boundary.
config.watchFolders = [corePath];

// Resolve this app's own node_modules first, then fall back to the repo root.
// Order matters: react/react-native must come from the app, or a second copy
// resolved through the package would produce the classic duplicate-React
// "invalid hook call" failure.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(repoRoot, 'node_modules'),
];

config.resolver.extraNodeModules = {
  '@cruixe/core': corePath,
};

module.exports = config;
