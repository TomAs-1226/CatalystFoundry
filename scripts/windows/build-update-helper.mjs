import {spawnSync} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export async function buildUpdateHelper(output){
 if(process.platform!=='win32')throw Error('Build the native updater on Windows.');
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
 const compiler=path.join(process.env.SystemRoot,'Microsoft.NET','Framework64','v4.0.30319','csc.exe');
 await mkdir(path.dirname(output),{recursive:true});
 const compiled=spawnSync(compiler,['/nologo','/target:winexe','/platform:x64','/optimize+','/reference:System.Runtime.Serialization.dll','/out:'+output,path.join(root,'electron/UpdateRunner.cs')],{encoding:'utf8',windowsHide:true});
 if(compiled.error||compiled.status!==0)throw Error('Native updater compilation failed: '+(compiled.error?.message??compiled.stdout+compiled.stderr));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildUpdateHelper(path.resolve(process.argv[2]??'desktop-dist/update-runner.exe'));
