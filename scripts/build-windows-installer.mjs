import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const projectRoot = process.cwd();
const stableRoot = join(projectRoot, 'build', 'stable-win-x64', 'webwaifu3-electrobun');
const outputDir = join(projectRoot, 'build', 'stable-win-x64');
const resourcesDir = join(stableRoot, 'Resources');
const installerScriptPath = join(projectRoot, 'installer', 'windows', 'desktopwaifu.iss');
const packageJsonPath = join(projectRoot, 'package.json');

function fail(message) {
	console.error(`[windows-installer] ${message}`);
	process.exit(1);
}

function resolveVersion() {
	const tag = process.env.DESKTOPWAIFU_VERSION ?? process.env.GITHUB_REF_NAME ?? '';
	if (tag) {
		return tag.startsWith('v') ? tag.slice(1) : tag;
	}

	if (!existsSync(packageJsonPath)) {
		return '0.0.1';
	}

	const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
	return pkg.version || '0.0.1';
}

function resolveIsccPath() {
	const candidates = [
		process.env.INNO_SETUP_COMPILER,
		join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
		'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
		'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
	].filter(Boolean);

	return candidates.find((candidate) => existsSync(candidate));
}

function extractStablePayload() {
	if (!existsSync(resourcesDir)) {
		fail(`Stable resources directory not found at ${resourcesDir}`);
	}

	const archiveName = readdirSync(resourcesDir).find((entry) => entry.endsWith('.tar.zst'));
	if (!archiveName) {
		fail(`No stable payload archive found in ${resourcesDir}`);
	}

	const archivePath = join(resourcesDir, archiveName);
	const tempRoot = mkdtempSync(join(tmpdir(), 'desktopwaifu-installer-'));
	const proc = Bun.spawnSync(['tar', '-xf', archivePath, '-C', tempRoot], {
		cwd: projectRoot,
		stdio: ['ignore', 'inherit', 'inherit'],
	});

	if (proc.exitCode !== 0) {
		rmSync(tempRoot, { recursive: true, force: true });
		fail(`Failed to extract stable payload archive ${archivePath}`);
	}

	const extractedRoots = readdirSync(tempRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
	if (extractedRoots.length !== 1) {
		rmSync(tempRoot, { recursive: true, force: true });
		fail(`Expected exactly one extracted app root in ${tempRoot}`);
	}

	return {
		tempRoot,
		sourceDir: join(tempRoot, extractedRoots[0].name),
	};
}

if (!existsSync(stableRoot)) {
	fail(`Stable bundle not found at ${stableRoot}. Run bun run build:stable first.`);
}

const isccPath = resolveIsccPath();
if (!isccPath) {
	fail('Inno Setup compiler not found. Install Inno Setup 6 or set INNO_SETUP_COMPILER.');
}

const version = resolveVersion();
const outputBaseFilename = 'DesktopWaifu-Setup';
const extracted = extractStablePayload();
const extractedLauncherPath = join(extracted.sourceDir, 'bin', 'launcher');
const extractedLauncherExePath = join(extracted.sourceDir, 'bin', 'launcher.exe');

if (!existsSync(extractedLauncherExePath) && existsSync(extractedLauncherPath)) {
	copyFileSync(extractedLauncherPath, extractedLauncherExePath);
	console.log('[windows-installer] Copied extracted launcher to launcher.exe for shortcut/uninstall integration');
}

if (!existsSync(extractedLauncherExePath)) {
	rmSync(extracted.tempRoot, { recursive: true, force: true });
	fail(`launcher.exe not found in extracted bundle ${join(extracted.sourceDir, 'bin')}`);
}

const proc = Bun.spawnSync(
	[
		isccPath,
		`/DMyAppVersion=${version}`,
		`/DSourceDir=${extracted.sourceDir}`,
		`/DOutputDir=${outputDir}`,
		`/DOutputBaseFilename=${outputBaseFilename}`,
		installerScriptPath,
	],
	{
		cwd: projectRoot,
		stdio: ['ignore', 'inherit', 'inherit'],
	},
);

if (proc.exitCode !== 0) {
	rmSync(extracted.tempRoot, { recursive: true, force: true });
	fail(`Inno Setup failed with exit code ${proc.exitCode}`);
}

rmSync(extracted.tempRoot, { recursive: true, force: true });
console.log(`[windows-installer] Built ${join(outputDir, `${outputBaseFilename}.exe`)}`);
