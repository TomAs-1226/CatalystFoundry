export type ProfileDocument=Record<string,unknown>;
/** Resolve one explicit vendor/release tree. Ambiguous names must be rejected by the caller's index. */
export function resolveProfile(name:string,lookup:(name:string)=>ProfileDocument|undefined,stack:string[]=[]):ProfileDocument {
 if(stack.includes(name))throw new Error(`Profile inheritance/include cycle: ${[...stack,name].join(' → ')}`);
 const source=lookup(name);if(!source)throw new Error(`Referenced profile or template is unavailable: ${name}`);
 let result:ProfileDocument={};const next=[...stack,name];
 if(source.inherits){if(typeof source.inherits!=='string')throw new Error(`Invalid inheritance in ${name}`);result=resolveProfile(source.inherits,lookup,next);}
 if(source.include){if(!Array.isArray(source.include)||source.include.some(v=>typeof v!=='string'))throw new Error(`Invalid includes in ${name}`);for(const included of source.include)result={...result,...resolveProfile(included as string,lookup,next)};}
 result={...result,...structuredClone(source)};delete result.inherits;delete result.include;return result;
}
