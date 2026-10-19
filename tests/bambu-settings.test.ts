import {expect,it} from 'vitest';
import {bambuOptions,nativeAliases,nativeOverrides,processSettingKey,nativeValue} from '../src/domain/bambu-settings';
import {resolveProcessSettings} from '../server/slicing-config';
import {defaultSettings,createProject,createJob,type Part} from '../src/domain/model';
import {preparePlateModel} from '../src/domain/prepare-plate';
import {parseSTL} from '../src/adapters/geometry';
import {syntheticProcess} from './fixtures/slicing-profile-fixtures';
it('maps every exposed native process option with its native type/range and rejects scripts and unknown parameters',()=>{
  expect(bambuOptions.length).toBeGreaterThan(250);const keys=new Set<string>();
  for(const field of bambuOptions){expect(keys.has(field.key)).toBe(false);keys.add(field.key);if(nativeAliases[field.key])continue;
    const value=field.options?.[0]??(/^coBools?$/.test(field.type)?true:Math.max(0,field.min??0)),settings={...defaultSettings,[processSettingKey(field)]:value};
    expect(resolveProcessSettings(syntheticProcess,settings)[field.key]).toEqual(nativeValue(field,value));
  }
  for(const key of ['machine_start_gcode','post_process','filename_format','filament_type','support_filament','unknown'])expect(()=>nativeOverrides({...defaultSettings,['bambu.'+key]:'anything'})).toThrow(/unsupported/);
  expect(()=>nativeOverrides({...defaultSettings,'bambu.top_shell_layers':2.5})).toThrow(/whole/);
  expect(()=>nativeOverrides({...defaultSettings,'bambu.sparse_infill_pattern':'invented'})).toThrow(/supported/);
  expect(()=>nativeOverrides({...defaultSettings,'bambu.support_top_z_distance':-1})).toThrow(/range/);
});
it('maps wall/skin/support/brim/individual-speed choices into the actual profile and retains percent/vector formats',()=>{
  const p=resolveProcessSettings(syntheticProcess,{...defaultSettings,'bambu.top_shell_layers':6,'bambu.bottom_shell_layers':5,'bambu.brim_type':'outer_and_inner','bambu.sparse_infill_pattern':'adaptivecubic','bambu.infill_wall_overlap':'18%','bambu.outer_wall_speed':75,'bambu.support_interface_top_layers':3});
  expect(p).toMatchObject({top_shell_layers:'6',bottom_shell_layers:'5',brim_type:'outer_and_inner',sparse_infill_pattern:'adaptivecubic',infill_wall_overlap:'18%',outer_wall_speed:['75'],support_interface_top_layers:'3'});
});
it('automatically selects native adaptive infill while retaining density, walls and explicit manual patterns',async()=>{
  const p=createProject(),geometry=await parseSTL('solid software\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 40 0 0\nvertex 0 40 10\nendloop\nendfacet\nendsolid','mm');
  const part:Part={id:'software',name:'SOFTWARE ONLY',source:{kind:'local'},geometry,quantity:1,spareQuantity:0,category:'custom',classification:'make'};p.parts=[part];const j=createJob([part]);j.settings={...defaultSettings,supports:false};
  const prepared=await preparePlateModel(p,j,false,false);expect(prepared.settings.infillResolvedPattern).toBe('adaptivecubic');expect(prepared.settings.infill).toBe(j.settings.infill);expect(prepared.settings.walls).toBe(j.settings.walls);expect(j.settings.infillResolvedPattern).toBeUndefined();
  j.settings.infill=100;expect((await preparePlateModel(p,j,false,false)).settings.infillResolvedPattern).toBe('zig-zag');
  j.settings['bambu.sparse_infill_pattern']='honeycomb';expect((await preparePlateModel(p,j,false,false)).settings['bambu.sparse_infill_pattern']).toBe('honeycomb');
});
