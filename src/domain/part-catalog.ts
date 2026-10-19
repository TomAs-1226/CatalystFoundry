import type { AssemblyMembership, Part } from './model';
export function catalogGroups(parts:readonly {assemblyMemberships?:AssemblyMembership[]}[]) {
 const groups=new Map<string,{id:string;label:string;quantity:number;path:string[]}>();
 for(const part of parts)for(const membership of part.assemblyMemberships??[]){
  const id=JSON.stringify(membership.path);const existing=groups.get(id);
  if(existing)existing.quantity+=membership.quantity;
  else groups.set(id,{id,label:membership.names.join(' / '),quantity:membership.quantity,path:membership.path});
 }
 return [...groups.values()].sort((a,b)=>a.label.localeCompare(b.label)||a.id.localeCompare(b.id));
}
export function matchesPartSearch(part:{name:string;partId?:string;materialHint?:string;assemblyMemberships?:AssemblyMembership[]},query:string) {
 const tokens=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
 const text=[part.name,part.partId,part.materialHint,...(part.assemblyMemberships??[]).flatMap(entry=>entry.names)].join(' ').toLocaleLowerCase();
 return tokens.every(token=>text.includes(token));
}
function workspaceGroupId(part:Part,path:string[]){return JSON.stringify([part.source.originDocumentId??part.source.documentId,part.source.originVersionId??part.source.versionId,part.source.originElementId??part.source.elementId,part.source.originConfiguration??part.source.configuration,path]);}
export function workspaceGroups(parts:Part[]){
 const groups=new Map<string,{id:string;label:string}>();
 for(const part of parts)for(const membership of part.source.assemblyMemberships??[]){const id=workspaceGroupId(part,membership.path);groups.set(id,{id,label:[part.source.originElementName??part.source.documentName,...membership.names].filter(Boolean).join(' / ')});}
 return [...groups.values()].sort((a,b)=>a.label.localeCompare(b.label)||a.id.localeCompare(b.id));
}
export function workspaceCatalog(parts:Part[],query:string,group:string) {
 return parts.filter(part=>matchesPartSearch({...part,partId:part.source.partId,assemblyMemberships:part.source.assemblyMemberships},query)&&(!group||part.source.assemblyMemberships?.some(entry=>workspaceGroupId(part,entry.path)===group)));
}
