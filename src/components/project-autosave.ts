/** Serialize writes and retain only the newest waiting snapshot. A slow old
 * write can never arrive after a newer save. Failed writes stay retryable. */
export class ProjectAutosave {
 private next?:string;private running?:Promise<void>;private saved?:string;private failure?:Error;
 constructor(private write:(json:string)=>Promise<void>,private changed:(state:'saving'|'saved'|'error',error?:Error)=>void){}
 save(json:string):Promise<void>{
  this.next=json;this.failure=undefined;
  if(!this.running){
   this.running=this.pump().finally(()=>{this.running=undefined;});
  }
  return this.running.then(()=>{if(this.failure)throw this.failure;});
 }
 private async pump(){
  while(this.next!==undefined){
   const json=this.next;this.next=undefined;
   if(json===this.saved)continue;
   this.changed('saving');
   try{await this.write(json);this.saved=json;this.failure=undefined;if(this.next===undefined)this.changed('saved');}
   catch(error){this.failure=error instanceof Error?error:Error(String(error));if(this.next===undefined)this.changed('error',this.failure);}
  }
 }
}
