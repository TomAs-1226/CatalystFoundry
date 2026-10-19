import {ShapeUtils,Vector2,Vector3} from 'three';import{writeFile}from'node:fs/promises';
const polygon=[[-3,0],[3,0],[3,12],[15,12],[15,16],[-15,16],[-15,12],[-3,12]].map(([x,z])=>new Vector2(x,z));
const faces=ShapeUtils.triangulateShape(polygon,[]),triangles=[];
const p=(index,y)=>[polygon[index].x,y,polygon[index].y];
for(const [a,b,c]of faces){triangles.push([p(a,-5),p(b,-5),p(c,-5)]);triangles.push([p(c,5),p(b,5),p(a,5)]);}
for(let a=0;a<polygon.length;a++){const b=(a+1)%polygon.length;triangles.push([p(a,-5),p(b,5),p(b,-5)],[p(a,-5),p(a,5),p(b,5)]);}
let stl='solid CATALYST_NON_MANUFACTURABLE_SUPPORT_FIXTURE\n';for(const triangle of triangles){const [a,b,c]=triangle.map(p=>new Vector3(...p)),n=b.clone().sub(a).cross(c.clone().sub(a)).normalize();stl+=`facet normal ${n.x} ${n.y} ${n.z}\nouter loop\n${triangle.map(p=>'vertex '+p.join(' ')).join('\n')}\nendloop\nendfacet\n`;}stl+='endsolid CATALYST_NON_MANUFACTURABLE_SUPPORT_FIXTURE\n';await writeFile('public/fixtures/support-test.stl',stl);
