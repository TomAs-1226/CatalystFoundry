/** Keep editing locked after a saved restart is accepted. Only a failed
 * native-install request unlocks the current workspace again. */
export async function restartUpdate(options:{canRestart:boolean;save:()=>Promise<boolean>;lock:(locked:boolean)=>void;install:()=>Promise<void>}){
 if(!options.canRestart||!await options.save())throw Error('Save the current project before restarting. Resolve any save error and retry.');
 options.lock(true);
 try{await options.install();}catch(error){options.lock(false);throw error;}
}
