import type { UserConfig } from 'tsdown'

const config: UserConfig = {
  entry: { 'host-plugin': 'host-plugin.js' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  sourcemap: true,
  clean: true,
  deps: {
    neverBundle: specifier => /^node:/.test(specifier) || specifier.startsWith('@deepseek-ai/') || specifier === 'quickjs-emscripten',
    alwaysBundle: specifier => !specifier.startsWith('@deepseek-ai/'),
  },
}

export default config
