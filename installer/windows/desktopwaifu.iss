#define MyAppName "DesktopWaifu"
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
  #define OutputBaseFilename "DesktopWaifu-Setup"
#endif

[Setup]
AppId={{6F99D0F2-29A0-49D8-9E9E-0BDFE129C818}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2/max
DefaultDirName={localappdata}\Programs\DesktopWaifu
DisableProgramGroupPage=yes
LicenseFile=
OutputDir={#OutputDir}
OutputBaseFilename={#OutputBaseFilename}
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
SolidCompression=yes
UninstallDisplayIcon={app}\bin\launcher.exe
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\DesktopWaifu"; Filename: "{app}\bin\launcher.exe"
Name: "{autodesktop}\DesktopWaifu"; Filename: "{app}\bin\launcher.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\bin\launcher.exe"; Description: "{cm:LaunchProgram,DesktopWaifu}"; Flags: nowait postinstall skipifsilent
