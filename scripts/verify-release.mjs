import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = join(root, 'apps', 'vscode-extension');
const manifest = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8'));
const publicRelease = process.argv.includes('--public');
const expectedVsix = `god-view-${manifest.version}.vsix`;
const listed = execFileSync(
  'pnpm',
  ['--filter', './apps/vscode-extension', 'exec', 'vsce', 'ls', '--no-dependencies'],
  {
    cwd: root,
    encoding: 'utf8',
  },
);
const files = listed.trim().split(/\r?\n/u).filter(Boolean);
const forbidden = files.filter((path) =>
  /(^|\/)(src|node_modules|\.godview)(\/|$)|\.(?:map|ts|tsx)$/u.test(path),
);
const licenses = JSON.parse(
  execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
    cwd: root,
    encoding: 'utf8',
  }),
);
const allowedLicenses = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause']);
const rejectedLicenses = Object.keys(licenses).filter((license) => !allowedLicenses.has(license));

assert(manifest.icon === 'media/god-view.png', 'Marketplace icon must be media/god-view.png');
assert(
  manifest.capabilities?.untrustedWorkspaces?.supported === false,
  'untrusted workspaces must be disabled',
);
assert(
  manifest.capabilities?.virtualWorkspaces?.supported === false,
  'virtual workspaces must be disabled',
);
assert(files.includes(manifest.icon), 'Marketplace icon is missing from VSIX contents');
assert(files.includes('LICENSE'), 'LICENSE is missing from VSIX contents');
assert(files.includes('PRIVACY.md'), 'PRIVACY.md is missing from VSIX contents');
assert(files.includes('SECURITY.md'), 'SECURITY.md is missing from VSIX contents');
assert(forbidden.length === 0, `forbidden VSIX files: ${forbidden.join(', ')}`);
assert(
  rejectedLicenses.length === 0,
  `unapproved production licenses: ${rejectedLicenses.join(', ')}`,
);
if (publicRelease) {
  assert(
    typeof manifest.repository?.url === 'string' && manifest.repository.url !== '',
    'public release requires a repository URL',
  );
  assert(
    typeof manifest.homepage === 'string' && manifest.homepage !== '',
    'public release requires a homepage URL',
  );
  assert(
    typeof manifest.bugs?.url === 'string' && manifest.bugs.url !== '',
    'public release requires a support/issues URL',
  );
}

const webview = readFileSync(join(extensionRoot, 'dist', 'webview', 'index.js'));
const gzipBytes = gzipSync(webview, { level: 9 }).byteLength;
assert(gzipBytes <= 300_000, `Webview gzip size ${gzipBytes} exceeds 300000 bytes`);

const packageFiles = ['README.md', 'CHANGELOG.md', 'PRIVACY.md', 'SECURITY.md'];
for (const file of packageFiles) {
  assert(files.includes(file), `${file} is missing from VSIX contents`);
}

console.log(`release manifest ok: ${manifest.publisher}.${manifest.name}@${manifest.version}`);
console.log(`expected VSIX: ${expectedVsix}`);
console.log(`VSIX contents: ${files.length} files; Webview gzip: ${gzipBytes} bytes`);
console.log(`production licenses: ${Object.keys(licenses).sort().join(', ')}`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
