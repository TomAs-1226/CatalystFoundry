import {preparePlateModel} from '../domain/prepare-plate';
import {layFlatOrientation} from '../domain/plate-orientation';
import type {Job,Project,Part,JobItem,Vec3} from '../domain/model';
self.onmessage=async(event:MessageEvent<{project:Project;job:Job;arrange:boolean;orient:boolean;part?:Part;item?:JobItem;volume?:Vec3}>)=>{
  try{const {project,job,arrange,orient,part,item,volume}=event.data;self.postMessage({result:part&&item&&volume?await layFlatOrientation(part,item,volume):await preparePlateModel(project,job,arrange,orient)});}
  catch(error){self.postMessage({error:(error as Error).message});}
};
