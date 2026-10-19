export interface AmsSlot {id:string;amsId:string;trayId:string;label:string;type:string;color:string;colors:string[];active:boolean;}
export interface PrinterSnapshot {at:string;slots:AmsSlot[];}
export interface PrinterConnection {id:string;name:string;model:'X1'|'X2D';host:string;serial:string;fingerprint:string;}
export interface PrinterStatus {available:boolean;connection?:PrinterConnection;snapshot?:PrinterSnapshot;error?:string;}
export function snapshotFresh(snapshot:PrinterSnapshot|undefined,now=Date.now()){return !!snapshot&&Number.isFinite(Date.parse(snapshot.at))&&now-Date.parse(snapshot.at)>=0&&now-Date.parse(snapshot.at)<90_000;}
export function recommendedSlot(snapshot:PrinterSnapshot|undefined,type:string,now=Date.now()){
 if(!snapshotFresh(snapshot,now))return undefined;
 const matching=snapshot!.slots.filter(slot=>slot.type.toUpperCase()===type.toUpperCase());
 return matching.find(slot=>slot.active)??matching[0];
}
/** Bambu Studio's AMS report fields; absent presence data is never invented. */
export function parseAmsSnapshot(message:unknown,now=new Date()):PrinterSnapshot|undefined{
 const print=(message as any)?.print,ams=print?.ams;if(!ams||!Array.isArray(ams.ams)||typeof ams.tray_exist_bits!=='string'||! /^[a-f\d]{1,16}$/i.test(ams.tray_exist_bits))return undefined;
 let present:bigint;try{present=BigInt('0x'+(ams.tray_exist_bits||'0'));}catch{return undefined;}
 const slots:AmsSlot[]=[],current=String(ams.tray_now??'');
 const add=(tray:any,amsId:string,trayId:string,id:string,label:string)=>{
  if(!tray||typeof tray.tray_type!=='string'||!tray.tray_type.trim()||typeof tray.tray_color!=='string'||!/^[a-f\d]{8}$/i.test(tray.tray_color))return;
  const colors=Array.isArray(tray.cols)?tray.cols.filter((v:unknown)=>typeof v==='string'&&/^[a-f\d]{8}$/i.test(v)).slice(0,8).map((v:string)=>'#'+v.slice(0,6).toUpperCase()):[];
  slots.push({id,amsId,trayId,label,type:tray.tray_type.slice(0,40),color:'#'+tray.tray_color.slice(0,6).toUpperCase(),colors,active:current===id});
 };
 for(const unit of ams.ams.slice(0,16)){const a=Number(unit.id);if(!Number.isInteger(a)||a<0||a>3||!Array.isArray(unit.tray))continue;for(const tray of unit.tray.slice(0,4)){const t=Number(tray.id),index=a*4+t;if(!Number.isInteger(t)||t<0||t>3||!(present&(1n<<BigInt(index))))continue;add(tray,String(a),String(t),String(index),`AMS ${String.fromCharCode(65+a)}${t+1}`);}}
 if(print.vt_tray)add(print.vt_tray,'external','254','255','External spool');
 if(Array.isArray(print.vir_slot)){const tray=print.vir_slot.find((v:any)=>String(v.id)==='254')??print.vir_slot[0];if(tray)add(tray,'external',String(tray.id??'254'),'255','External spool');}
 return {at:now.toISOString(),slots};
}
