const {spawn}=require('node:child_process');
const path=require('node:path');

function spawnUpdateHelper({helperPath,installer,application,parentPid,sha256,resultFile,readyFile,probeOnly=false}){
 if(!path.isAbsolute(helperPath))throw Error('Use the trusted native updater path.');
 // The windowless native executable needs no console and survives app shutdown.
 return spawn(helperPath,[],{
  detached:true,stdio:'ignore',windowsHide:true,
  env:{...process.env,CATALYST_UPDATE_INSTALLER:installer,CATALYST_UPDATE_APPLICATION:application,CATALYST_UPDATE_PARENT:String(parentPid),CATALYST_UPDATE_SHA256:sha256,CATALYST_UPDATE_RESULT:resultFile,CATALYST_UPDATE_READY:readyFile,CATALYST_UPDATE_PROBE_ONLY:probeOnly?'1':''},
 });
}
module.exports={spawnUpdateHelper};
