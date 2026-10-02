/**
 * Build a ready-to-run PRISM for one platform: node scripts/package.mjs win32
 *
 * Packages the app into an asar archive with @electron/packager, then flips
 * Electron's fuses — switches compiled into the binary — so the shipped app
 * can't be turned into a general-purpose Node runtime:
 *
 *   RunAsNode off                          ELECTRON_RUN_AS_NODE is ignored
 *   NODE_OPTIONS off                       no injecting code through the environment
 *   --inspect arguments off                no attaching a debugger from the command line
 *   only load the app from its asar        loose files next to the exe are ignored
 *   extra file:// privileges off           the app never loads pages over file://
 *
 * ASAR integrity validation is deliberately left off: it needs integrity data
 * embedded in the executable, and a build that refuses to start can't be checked
 * from here. Only the English UI locale is kept (Electron falls back to it; the
 * others only translate built-in menus). Finally the folder is zipped, symlinks
 * preserved, unless --no-zip is given (CI uploads the folder as an artifact).
 */

import { packager } from '@electron/packager';
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const platform = args[0] ?? process.platform;
const arch = args[1] ?? 'x64';
const zipIt = !process.argv.includes('--no-zip');

const [appDir] = await packager({
  dir: root,
  out: dist,
  name: 'PRISM',
  executableName: platform === 'win32' ? 'PRISM' : 'prism',
  platform,
  arch,
  overwrite: true,
  asar: true,
  prune: true,
  icon: path.join(root, 'build', 'icon'),
  appVersion: pkg.version,
  appCopyright: '0xlightsec',
  win32metadata: {
    CompanyName: '0xlightsec',
    FileDescription: 'PRISM — synesthesia mapping engine',
    ProductName: 'PRISM',
    InternalName: 'PRISM'
  },
  // Only what the app needs at runtime.
  ignore: [/^\/(tests|scripts|dist|node_modules)(\/|$)/, /^\/\.gitignore$/, /^\/build\/icon\.ico$/]
});

const binary = {
  win32: path.join(appDir, 'PRISM.exe'),
  linux: path.join(appDir, 'prism'),
  darwin: path.join(appDir, 'PRISM.app')
}[platform];

await flipFuses(binary, {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false
});

const locales = path.join(appDir, 'locales');
if (platform !== 'darwin' && existsSync(locales)) {
  for (const f of readdirSync(locales)) if (f !== 'en-US.pak') rmSync(path.join(locales, f));
}

console.log(`built ${path.relative(root, appDir)}`);
if (zipIt) {
  const zip = `${appDir}.zip`;
  if (existsSync(zip)) rmSync(zip);
  execFileSync('zip', ['-r', '-y', '-q', '-9', path.basename(zip), path.basename(appDir)], { cwd: dist });
  console.log(`zipped ${path.relative(root, zip)}`);
}
