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
const localDevExtractorPath = join(
	projectRoot,
	'../../QWENSTUDIO/electrobun/package/src/extractor/zig-out/bin/extractor.exe',
);

// In CI, use ELECTROBUN_EXTRACTOR_PATH (e.g. node_modules/electrobun/bin/extractor.exe).
// In dev, use the local QWENSTUDIO repo path.
// If neither exists, exit gracefully — the released electrobun package
// should already embed the correct extractor for stable builds.
const envExtractorPath = process.env.ELECTROBUN_EXTRACTOR_PATH ?? null;

let debugExtractorPath = null;

if (envExtractorPath && existsSync(envExtractorPath)) {
	debugExtractorPath = envExtractorPath;
	console.log(`[postPackage] Using extractor from ELECTROBUN_EXTRACTOR_PATH: ${debugExtractorPath}`);
} else if (existsSync(localDevExtractorPath)) {
	debugExtractorPath = localDevExtractorPath;
	console.log(`[postPackage] Using local dev extractor: ${debugExtractorPath}`);
} else {
	console.log('[postPackage] No extractor found (ELECTROBUN_EXTRACTOR_PATH not set, local dev path missing).');
	console.log('[postPackage] Skipping Setup.exe replacement — assuming released electrobun already embeds the correct extractor.');
	process.exit(0);
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
