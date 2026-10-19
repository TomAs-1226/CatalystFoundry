/** Optional official companion setup. No Bambu credentials or printer commands. */
const path=require('node:path');
const fs=require('node:fs/promises');
const {createHash}=require('node:crypto');
const {execFile,spawn}=require('node:child_process');
const {promisify}=require('node:util');
const {connectUrl}=require('./bambu-connect.cjs');
const execute=promisify(execFile);
const CONNECT=Object.freeze({version:'2.5.0-beta.15',url:'https://public-cdn.bblmw.com/upgrade/bambu-connect/updates/versions/2.5.0-beta.15/bambu-connect-v2.5.0-beta.15-win32-x64.exe',sha256:'60008eeaf2ccafc4767c3e510fa3b79326633c905f17512ee6c7137dcb35bb8f',maxBytes:150*1024*1024,guide:'https://wiki.bambulab.com/en/software/bambu-connect'});
const trustedPublisher=signature=>signature?.status==='Valid'&&/(?:^|,)\s*O="Shanghai Lunkuo Technology Co\., Ltd"\s*(?:,|$)/.test(signature.publisher??'');
async function signature(file){
 // A launcher using PowerShell 7 can inherit its module path into Windows
 // PowerShell 5. Load the OS security module explicitly, without changing policy.
 const script="$ErrorActionPreference='Stop'; Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop; $f=Get-Item -LiteralPath $env:FOUNDRY_CONNECT_FILE; $s=Get-AuthenticodeSignature -LiteralPath $f.FullName; @{status=$s.Status.ToString();publisher=$s.SignerCertificate.Subject;version=$f.VersionInfo.ProductVersion}|ConvertTo-Json -Compress";
 const {stdout}=await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:60000,maxBuffer:32768,env:{...process.env,FOUNDRY_CONNECT_FILE:file}});
 return JSON.parse(stdout.replace(/^\uFEFF/,''));
}
async function registeredProgram(){
 for(const key of ['HKCU\\Software\\Classes\\bambu-connect\\shell\\open\\command','HKCR\\bambu-connect\\shell\\open\\command']){
  try{const {stdout}=await execute('reg.exe',['query',key,'/ve'],{windowsHide:true,timeout:10000,maxBuffer:32768});const match=stdout.match(/REG_SZ\s+"([^"]+\.exe)"/i);if(match&&path.isAbsolute(match[1]))return match[1];}catch{}
 }
}
async function launch(file,args=[]){await new Promise((resolve,reject)=>{const child=spawn(file,args,{detached:true,stdio:'ignore',windowsHide:false});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});}
async function download(file,progress,request=fetch){
 let url=CONNECT.url,response;
 for(let redirects=0;redirects<4;redirects++){
  const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.hostname!=='public-cdn.bblmw.com')throw Error('Connect setup only downloads from Bambu’s pinned HTTPS distribution host.');
  response=await request(url,{redirect:'manual',signal:AbortSignal.timeout(240000)});
  if(response.status>=300&&response.status<400){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('Missing official download redirect.');url=new URL(location,url).href;continue;}
  break;
 }
 if(!response?.ok||!response.body)throw Error('The official Connect download is unavailable. Try again or open the Bambu guide.');
 const total=Number(response.headers.get('content-length'))||undefined;if(total&&total>CONNECT.maxBytes)throw Error('Connect installer exceeds the pinned download limit.');
 const partial=file+'.partial',handle=await fs.open(partial,'w',0o600),reader=response.body.getReader();let bytes=0;
 try{for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>CONNECT.maxBytes)throw Error('Connect installer exceeds the download limit.');await handle.writeFile(chunk.value);progress(bytes,total);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{await handle.close();}
 await fs.rename(partial,file);
}
async function hash(file){return createHash('sha256').update(await fs.readFile(file)).digest('hex');}
/** Dependency injection is for native-free regression tests; renderer input never supplies paths or URLs. */
function createConnectHost(options){
 const platform=options.platform??process.platform,directory=path.resolve(options.programDirectory),cache=path.resolve(options.downloadDirectory);
 const verify=options.signature??signature,registered=options.registeredProgram??registeredProgram,openApp=options.launch??launch,transfer=options.download??download;
 let state={phase:'idle',message:''},pending;
 async function program(){
  const candidates=[await registered(),path.join(directory,'Bambu Connect.exe')];
  for(const file of candidates){if(!file||!path.isAbsolute(file)||path.basename(file).toLowerCase()!=='bambu connect.exe')continue;try{const signed=await verify(file);if(trustedPublisher(signed))return{file,version:signed.version};}catch{}}
 }
 async function capability(){
  if(platform!=='win32')return{available:false,reason:'Official companion setup is currently available on Windows x64.'};
  const installed=await program();return{available:!!installed,version:installed?.version,reason:installed?'Bambu Connect is installed. Sign in or use Discover for LAN-only pairing inside Connect.':'Install the official Bambu Connect companion here, then sign in or pair a LAN printer. Accounts and printer selection stay in Connect.'};
 }
 return{
  capability,status:()=>({...state,guide:CONNECT.guide,installerVersion:CONNECT.version,source:'official-vendor-download'}),
  async install(){
   if(platform!=='win32')throw Error('Connect setup requires Windows.');if(pending)return;
   state={phase:'downloading',message:'Downloading the official Bambu Connect installer…'};
   pending=(async()=>{
    try{
     const existing=await program();if(existing){await openApp(existing.file);state={phase:'installed',message:'Connect is open. Sign in with your account or use Discover for LAN-only pairing.'};return;}
     await fs.mkdir(cache,{recursive:true});const file=path.join(cache,`BambuConnect-${CONNECT.version}-Setup.exe`);
     if(await hash(file).catch(()=>null)!==CONNECT.sha256)await transfer(file,(bytes,total)=>{state={phase:'downloading',message:'Downloading the official Bambu Connect installer…',bytes,total};});
     if(await hash(file)!==CONNECT.sha256||!trustedPublisher(await verify(file)))throw Error('The official Connect installer did not pass the pinned hash and publisher checks. It was not run.');
     state={phase:'installing',message:'Installing the official Bambu Connect companion for this Windows user…'};
     if(options.runInstaller)await options.runInstaller(file,directory);else await execute(file,['/S','/currentuser','/D='+directory],{windowsHide:true,windowsVerbatimArguments:true,timeout:240000,maxBuffer:32768});
     const installed=await program();if(!installed)throw Error('Connect did not produce a publisher-verified application. Open the official guide to repair setup.');
     await openApp(installed.file);state={phase:'installed',message:'Connect is open. Sign in with your account or use Discover for LAN-only pairing.'};
    }catch(error){state={phase:'error',message:error.message};}finally{pending=undefined;}
   })();
  },
  async launch(){const installed=await program();if(!installed)throw Error('Install the official Connect companion first.');await openApp(installed.file);},
  async open(file,name){const installed=await program();if(!installed)throw Error('Install the official Connect companion first.');await openApp(installed.file,[connectUrl(file,name)]);},
 };
}
module.exports={CONNECT,createConnectHost,trustedPublisher,download};
