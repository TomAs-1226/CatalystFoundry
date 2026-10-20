/** Local native Mac preparation. Nothing publishes or runs the installed app. */
const {win,nsis,...desktop}=require('./electron-builder.cjs');
function macConfiguration(arch, unsignedLocal=false){
 if(!['arm64','x64'].includes(arch))throw Error('Choose exactly arm64 or x64 for the Mac package.');
 return {...desktop,
  artifactName:'Catalyst-Foundry-${version}-mac-${arch}.${ext}',
  directories:{...desktop.directories,output:`release/mac-${arch}`},
  extraResources:[{from:`vendor/bambu-macos-${arch}`,to:'slicer'},{from:'vendor/licenses-macos',to:'licenses'}],
  forceCodeSigning:!unsignedLocal,
  mac:{target:[{target:'dmg',arch:[arch]},{target:'zip',arch:[arch]}],category:'public.app-category.productivity',
   minimumSystemVersion:'13.5',icon:'packaging/assets/foundry.icns',
   hardenedRuntime:!unsignedLocal,notarize:false,
   ...(unsignedLocal?{identity:null}:{}),
   // Preserve the original vendor app's code signatures and the pinned bytes.
   signIgnore:['/slicer/BambuStudio\\.app(?:/|$)'],
  },
  dmg:{writeUpdateInfo:false},
 };
}
module.exports={macConfiguration};
