import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function fail(message) {
	console.error(`[postPackage] ${message}`);
	process.exit(1);
}

function runPowerShell(command, cwd) {
	const proc = Bun.spawnSync(['powershell', '-NoLogo', '-NoProfile', '-Command', command], {
		cwd,
		stdio: ['ignore', 'pipe', 'pipe'],
	});

	if (proc.exitCode !== 0) {
		const stderr = proc.stderr ? new TextDecoder().decode(proc.stderr).trim() : '';
		fail(`PowerShell failed (${proc.exitCode}): ${stderr}`);
	}
}

const buildEnv = process.env.ELECTROBUN_BUILD_ENV;
const targetOs = process.env.ELECTROBUN_OS;
const buildDir = process.env.ELECTROBUN_BUILD_DIR;
const artifactDir = process.env.ELECTROBUN_ARTIFACT_DIR;
const appName = process.env.ELECTROBUN_APP_NAME;

if (targetOs !== 'win' || buildEnv !== 'stable') {
	console.log('[postPackage] Skipping Windows setup patch for non-stable/non-win build');
	process.exit(0);
}

if (!buildDir || !artifactDir || !appName) {
	fail('Missing required Electrobun hook environment');
}

const projectRoot = process.cwd();
const debugExtractorPath = join(projectRoot, 'node_modules/electrobun/src/extractor/zig-out/bin/extractor.exe');

if (!existsSync(debugExtractorPath)) {
	fail(`Debug extractor not found: ${debugExtractorPath}`);
}

const setupExePath = join(buildDir, `${appName}-Setup.exe`);
const setupMetadataPath = join(buildDir, `${appName}-Setup.metadata.json`);
const setupArchivePath = join(buildDir, `${appName}-Setup.tar.zst`);
const artifactZipPath = join(artifactDir, `${buildEnv}-${targetOs}-x64-${appName}-Setup.zip`);

for (const requiredPath of [setupExePath, setupMetadataPath, setupArchivePath]) {
	if (!existsSync(requiredPath)) {
		fail(`Expected build artifact missing: ${requiredPath}`);
	}
}

console.log(`[postPackage] Replacing broken Setup.exe with debug extractor: ${debugExtractorPath}`);
	cpSync(debugExtractorPath, setupExePath, { force: true });

if (!existsSync(artifactDir)) {
	fail(`Artifact directory missing: ${artifactDir}`);
}

const tempRoot = mkdtempSync(join(tmpdir(), 'electrowaifu-setup-'));
const stagingDir = join(tempRoot, 'zip-root');
const installerDir = join(stagingDir, '.installer');
mkdirSync(installerDir, { recursive: true });

cpSync(setupExePath, join(stagingDir, `${appName}-Setup.exe`), { force: true });
cpSync(setupMetadataPath, join(installerDir, `${appName}-Setup.metadata.json`), { force: true });
cpSync(setupArchivePath, join(installerDir, `${appName}-Setup.tar.zst`), { force: true });

const quotedArtifactZipPath = artifactZipPath.replace(/'/g, "''");
const zipCommand = [
	`if (Test-Path '${quotedArtifactZipPath}') { Remove-Item '${quotedArtifactZipPath}' -Force }`,
	`Compress-Archive -Path '.\\*' -DestinationPath '${quotedArtifactZipPath}' -CompressionLevel Optimal`,
].join('; ');

runPowerShell(zipCommand, stagingDir);

rmSync(tempRoot, { recursive: true, force: true });

console.log('[postPackage] Repacked stable Windows Setup.zip with debug extractor');
