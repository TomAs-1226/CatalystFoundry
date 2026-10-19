import { mkdtemp, readdir, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { canonicalWorkDirectory } from '../server/work-directory';

it('resolves a write-verified work directory without leaving probes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'foundry-work-'));
 try{expect(await canonicalWorkDirectory(dir)).toBe(await realpath(dir));expect(await readdir(dir)).toEqual([]);}finally{await rm(dir,{recursive:true,force:true});}
});
it('uses the actual target of a configured directory junction rather than a lexical alias',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'foundry-work-alias-')),target=join(dir,'actual'),alias=join(dir,'alias');
 try{await canonicalWorkDirectory(target);await symlink(target,alias,process.platform==='win32'?'junction':'dir');expect(await canonicalWorkDirectory(alias)).toBe(await realpath(target));expect(await readdir(target)).toEqual([]);}finally{await rm(dir,{recursive:true,force:true});}
});
