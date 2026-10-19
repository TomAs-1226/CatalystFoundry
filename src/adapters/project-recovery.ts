import type { Project } from '../domain/model';
import { deserializeProject } from '../domain/persistence';
/** Choose only validated artifacts. A newer browser draft must not be replaced by an older explicit save. */
export async function recoverProject(savedJson:string|null,draftJson:string|null):Promise<{project?:Project;origin?:'saved'|'draft';warnings:string[]}>{
 const warnings:string[]=[];let saved:Project|undefined,draft:Project|undefined;
 if(savedJson)try{saved=await deserializeProject(savedJson)}catch(e){warnings.push(`Saved project could not be opened: ${(e as Error).message}`)}
 if(draftJson)try{draft=await deserializeProject(draftJson)}catch(e){warnings.push(`Browser draft could not be opened: ${(e as Error).message}`)}
 const timestamp=(p:Project)=>Number.isFinite(Date.parse(p.updatedAt))?Date.parse(p.updatedAt):0;
 if(draft&&(!saved||timestamp(draft)>timestamp(saved)))return {project:draft,origin:'draft',warnings};
 if(saved)return {project:saved,origin:'saved',warnings};
 return {warnings};
}
