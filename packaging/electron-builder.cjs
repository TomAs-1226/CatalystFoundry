/** Windows x64; signed update manifests, explicit saved restart, no implicit publishing. */
module.exports = {
  appId: 'org.catalystrobotics.foundry',
  productName: 'Catalyst Foundry',
  artifactName: 'Catalyst-Foundry-${version}-${arch}-Setup.${ext}',
  directories: { output: 'release', buildResources: 'packaging/assets' },
  asar: true,
  npmRebuild: false,
  files: [
    'dist/**', 'desktop-dist/server.cjs', 'electron/main.cjs', 'electron/runtime.cjs', 'electron/bambu-connect.cjs', 'electron/bambu-setup.cjs', 'electron/startup.html', 'electron/updates.cjs', 'electron/update-policy.cjs', 'electron/update-process.cjs',
    'electron/startup-policy.cjs', 'package.json', '!node_modules/**', '!**/.env*', '!**/*.map', '!**/project.json',
  ],
  extraMetadata: { main: 'electron/main.cjs', productName: 'Catalyst Foundry' },
  extraResources: [
    { from: 'scripts/windows/Start-Foundry.ps1', to: 'setup/Start-Foundry.ps1' },
    { from: 'vendor/bambu', to: 'slicer' },
    { from: 'vendor/licenses', to: 'licenses' },
    { from: 'desktop-dist/update-runner.exe', to: 'setup/update-runner.exe' },
  ],
  publish: null,
  forceCodeSigning: false,
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'packaging/assets/foundry.ico' },
  nsis: {
    include: 'packaging/no-force-close.nsh',
    oneClick: false, perMachine: false, allowElevation: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true, createStartMenuShortcut: true,
    shortcutName: 'Catalyst Foundry',
    deleteAppDataOnUninstall: false,
    runAfterFinish: false,
  },
};
