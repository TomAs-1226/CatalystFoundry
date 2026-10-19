import {describe,it,expect} from 'vitest';
import {createProject} from '../src/domain/model';
import {recoverProject} from '../src/adapters/project-recovery';

describe('project startup recovery',()=>{
 it('retains a newer unsaved draft instead of silently loading an older explicit save',async()=>{const p=createProject('Saved batch');p.updatedAt='2026-10-17T10:00:00Z';const draft=structuredClone(p);draft.updatedAt='2026-10-17T10:10:00Z';draft.jobs[0].settings.walls=6;const result=await recoverProject(JSON.stringify(p),JSON.stringify(draft));expect(result.origin).toBe('draft');expect(result.project?.jobs[0].settings.walls).toBe(6)});
 it('prefers a newer workspace save over an older browser snapshot',async()=>{const p=createProject();p.updatedAt='2026-10-17T10:10:00Z';const draft=structuredClone(p);draft.updatedAt='2026-10-17T10:00:00Z';const result=await recoverProject(JSON.stringify(p),JSON.stringify(draft));expect(result.origin).toBe('saved');expect(result.warnings).toEqual([])});
 it('recovers a validated browser draft when the service has no readable saved project',async()=>{const p=createProject('Recover me');const result=await recoverProject(null,JSON.stringify(p));expect(result.origin).toBe('draft');expect(result.project).toEqual(p)});
 it('surfaces corrupt drafts and keeps a valid saved project rather than opening malformed data',async()=>{const p=createProject('Good disk save');const result=await recoverProject(JSON.stringify(p),'{broken');expect(result.project?.name).toBe('Good disk save');expect(result.origin).toBe('saved');expect(result.warnings[0]).toMatch(/Browser draft.*not valid JSON/);expect((await recoverProject(null,'{broken')).project).toBeUndefined()});
});
