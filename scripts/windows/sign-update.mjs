import {readFile,stat,writeFile} from 'node:fs/promises';
import {createPrivateKey,sign,verify} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve,dirname,join} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),policy=require('../../electron/update-policy.cjs');
const {canonicalPayload,releaseUrl,fileDigest}=require('../../electron/updates.cjs');
const installer=resolve(process.argv[2]??''),pkg=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8'));
let encoded=process.env.FOUNDRY_UPDATE_PRIVATE_KEY;
const keyIndex=process.argv.indexOf('--protected-key');
if(!encoded&&keyIndex>=0){
 if(process.platform!=='win32')throw Error('The local protected release key requires Windows.');
 const keyFile=resolve(process.argv[keyIndex+1]);
 const command="$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$bytes=[IO.File]::ReadAllBytes($env:CATALYST_KEY_FILE);$key=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Text.Encoding]::UTF8.GetString($key))";
 const output=spawnSync('powershell.exe',['-NoProfile','-Command',command],{encoding:'utf8',windowsHide:true,env:{...process.env,CATALYST_KEY_FILE:keyFile}});
 if(output.status!==0)throw Error('The release key could not be unlocked for the current Windows user.');encoded=output.stdout.trim();
}
if(!encoded)throw Error('Provide FOUNDRY_UPDATE_PRIVATE_KEY or --protected-key; an unsigned update cannot be published.');
const privateKey=createPrivateKey(encoded.includes('BEGIN')?encoded:{key:Buffer.from(encoded,'base64'),type:'pkcs8',format:'der'});
const payload={schemaVersion:1,channel:policy.channel,version:pkg.version,platform:'win32',arch:'x64',url:releaseUrl(pkg.version,`Catalyst-Foundry-${pkg.version}-x64-Setup.exe`),size:(await stat(installer)).size,sha256:await fileDigest(installer),releasedAt:new Date().toISOString()};
const bytes=Buffer.from(canonicalPayload(payload)),signature=sign(null,bytes,privateKey);
if(!verify(null,bytes,policy.publicKey,signature))throw Error('Release signing key does not match the app verification key.');
const target=join(dirname(installer),'foundry-update.json');await writeFile(target,JSON.stringify({payload,signature:signature.toString('base64')},null,2)+'\n');
await writeFile(installer+'.sha256',payload.sha256+'  '+`Catalyst-Foundry-${pkg.version}-x64-Setup.exe`+'\n');
console.log(JSON.stringify({manifest:target,version:payload.version,sha256:payload.sha256,size:payload.size,signatureVerified:true},null,2));
