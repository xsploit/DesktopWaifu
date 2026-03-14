#define MyAppName "DesktopWaifu Genie Compat"
#define MyAppPublisher "xsploit"
#define MyAppURL "https://github.com/xsploit/DesktopWaifu"
#ifndef MyAppVersion
  #define MyAppVersion "0.0.1"
#endif
#ifndef SourceDir
  #error SourceDir is required
#endif
#ifndef OutputDir
  #error OutputDir is required
#endif
#ifndef OutputBaseFilename
  #define OutputBaseFilename "DesktopWaifu-GenieCompat-Setup"
#endif

[Setup]
AppId={{7A75D6CF-5E43-4EE5-8A2F-0AEE2DF4C012}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2/max
DefaultDirName={localappdata}\Programs\DesktopWaifu Genie Compat
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename={#OutputBaseFilename}
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
SolidCompression=yes
UninstallDisplayIcon={app}\DesktopWaifu-GenieCompat.exe
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\DesktopWaifu Genie Compat"; Filename: "{app}\DesktopWaifu-GenieCompat.exe"
Name: "{autodesktop}\DesktopWaifu Genie Compat"; Filename: "{app}\DesktopWaifu-GenieCompat.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\DesktopWaifu-GenieCompat.exe"; Description: "{cm:LaunchProgram,DesktopWaifu Genie Compat}"; Flags: nowait postinstall skipifsilent
