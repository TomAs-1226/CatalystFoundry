import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {parseSTL} from '../src/adapters/geometry';
import {createJob,createProject,deserializeProject,serializeProject,type Part} from '../src/domain';
import {preparationStatus,proposePlacement} from '../src/domain/preparation';
async function batch(){const part:Part={id:'status-bracket',name:'Bracket',geometry:await parseSTL(readFileSync(new URL('../public/fixtures/bracket.stl',import.meta.url)),'mm'),source:{kind:'local',available:true},classification:'make',category:'bracket',quantity:2,spareQuantity:0};const project=createProject();project.parts=[part];const job=createJob([part]);job.items[0].position=[50,50,0];project.jobs=[job];project.activeJobId=job.id;return{project,job}}
describe('preparation status truth',()=>{
 it('needs review for invalid volume/settings, then becomes ready when explicit input errors are resolved',async()=>{const{project,job}=await batch();job.status='ready to slice';job.items[0].position=[0,0,0];expect(preparationStatus(project,job)).toBe('needs review');const suggestion=proposePlacement(project,job,project.parts[0].id);expect(suggestion.available).toBe(true);job.items[0].orientation=suggestion.orientation!;job.items[0].position=suggestion.position!;expect(preparationStatus(project,job)).toBe('ready to slice');job.settings.layerHeight=.01;expect(preparationStatus(project,job)).toBe('needs review');job.status='approved';expect(preparationStatus(project,job)).toBe('approved')});
 it('does not reopen a ready-to-slice claim with out-of-volume geometry as ready',async()=>{const{project,job}=await batch();job.status='ready to slice';job.items[0].position=[999,999,0];const reopened=await deserializeProject(serializeProject(project));expect(reopened.jobs[0].status).toBe('needs review');expect(reopened.jobs[0].items[0].position).toEqual([999,999,0])});
});
