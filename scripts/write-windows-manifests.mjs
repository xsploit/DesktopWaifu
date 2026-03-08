import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const rootDir = process.cwd();
const buildDir = resolve(rootDir, 'build');

const manifest = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity version="1.0.0.0" processorArchitecture="*" name="webwaifu3.electrobun.local" type="win32" />
  <description>WEBWAIFU 3 Electrobun</description>
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*" />
    </dependentAssembly>
  </dependency>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2,PerMonitor</dpiAwareness>
      <gdiScaling xmlns="http://schemas.microsoft.com/SMI/2017/WindowsSettings">true</gdiScaling>
    </windowsSettings>
  </application>
</assembly>
`;

function walk(dir, found = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(fullPath, found);
			continue;
		}
		if (/^(launcher|bun)\.exe$/i.test(entry.name)) {
			found.push(fullPath);
		}
	}
	return found;
}

mkdirSync(buildDir, { recursive: true });

const exePaths = walk(buildDir);
for (const exePath of exePaths) {
	if (!statSync(exePath).isFile()) continue;
	const manifestPath = `${exePath}.manifest`;
	writeFileSync(manifestPath, manifest, 'utf8');
	console.log(`[dpi-manifest] Wrote ${manifestPath}`);
}

if (exePaths.length === 0) {
	console.log('[dpi-manifest] No Windows executables found under build/');
}
