// scripts/bump-minor.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');

const pkgPath = path.join(projectRoot, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const parts = pkg.version.split('.').map(Number);

// Увеличиваем минорную версию и сбрасываем patch
parts[1] += 1;
parts[2] = 0;

const newVersion = parts.join('.');
pkg.version = newVersion;

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
console.log(`Version bumped to ${newVersion}`);

const outDir = path.join(projectRoot, 'build');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const outFile = path.join(outDir, `${pkg.name}-${newVersion}.vsix`);

execSync(`vsce package --out "${outFile}" --allow-missing-repository`, {
    stdio: 'inherit',
    cwd: projectRoot,
});
