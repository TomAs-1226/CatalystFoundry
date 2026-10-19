import tls from 'node:tls';
import {createHash,randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import {parseAmsSnapshot,type PrinterSnapshot} from '../src/domain/printer-status';
export interface LanCredentials {host:string;serial:string;accessCode:string;fingerprint:string;}
const MAX_PACKET=1024*1024;
export function validateLanHost(host:string){
 if(isIP(host)!==4)throw Error('Enter the printer’s private IPv4 address.');
 const p=host.split('.').map(Number);if(!(p[0]===10||p[0]===192&&p[1]===168||p[0]===172&&p[1]>=16&&p[1]<=31)||p[3]===0||p[3]===255)throw Error('Use a private LAN printer address.');
 return host;
}
function string(value:string){const bytes=Buffer.from(value,'utf8');if(bytes.length>65535)throw Error('MQTT field too large');const size=Buffer.alloc(2);size.writeUInt16BE(bytes.length);return Buffer.concat([size,bytes]);}
export function mqttPacket(header:number,body:Buffer){if(body.length>MAX_PACKET)throw Error('Status packet exceeds limit');let n=body.length;const length=[];do{let byte=n%128;n=Math.floor(n/128);if(n)byte|=128;length.push(byte);}while(n);return Buffer.concat([Buffer.from([header,...length]),body]);}
export function readMqttPacket(buffer:Buffer):{header:number;body:Buffer;bytes:number}|undefined{
 if(buffer.length<2)return;let length=0,multiplier=1,at=1,byte=0;do{if(at>=buffer.length)return;if(at>4)throw Error('Malformed MQTT packet length');byte=buffer[at++];length+=(byte&127)*multiplier;multiplier*=128;}while(byte&128);
 if(length>MAX_PACKET)throw Error('Printer status packet exceeds limit');if(buffer.length<at+length)return;return {header:buffer[0],body:buffer.subarray(at,at+length),bytes:at+length};
}
type SocketFactory=(host:string)=>tls.TLSSocket;
const socketFactory:SocketFactory=host=>tls.connect({host:validateLanHost(host),port:8883,rejectUnauthorized:false,minVersion:'TLSv1.2'});
function certificate(socket:tls.TLSSocket){const raw=socket.getPeerCertificate()?.raw;if(!raw?.length)throw Error('Printer did not provide a TLS certificate');return createHash('sha256').update(raw).digest('hex');}
/** Probe sends no access code or MQTT data. Pairing pins this exact certificate. */
export function probeLanPrinter(host:string,connect:SocketFactory=socketFactory):Promise<string>{
 validateLanHost(host);return new Promise((resolve,reject)=>{const socket=connect(host),timer=setTimeout(()=>done(Error('Printer certificate check timed out')),7000);let settled=false;function done(error?:Error,value?:string){if(settled)return;settled=true;clearTimeout(timer);socket.destroy();if(error)reject(error);else resolve(value!);}socket.once('error',()=>done(Error('Cannot reach the printer’s LAN status service')));socket.once('close',()=>done(Error('Printer closed the status connection')));socket.once('secureConnect',()=>{try{done(undefined,certificate(socket));}catch(e){done(e as Error);}});});
}
/** Bounded MQTT 3.1.1 snapshot client. The sole publish is a status request.
 * No arbitrary payload, file upload, printer control or AMS movement is exposed. */
export function readLanSnapshot(value:LanCredentials,connect:SocketFactory=socketFactory):Promise<PrinterSnapshot>{
 validateLanHost(value.host);if(!/^[a-z\d]{8,32}$/i.test(value.serial)||!/^\S{8}$/.test(value.accessCode)||!/^([a-f\d]{64})$/i.test(value.fingerprint))throw Error('Check the serial, eight-character access code and certificate fingerprint.');
 return new Promise((resolve,reject)=>{
  const socket=connect(value.host),timer=setTimeout(()=>done(Error('No complete AMS report received. Check LAN status access in the printer’s settings.')),12000);let settled=false,buffer=Buffer.alloc(0),stage=0;const reportTopic=`device/${value.serial}/report`;
  function done(error?:Error,snapshot?:PrinterSnapshot){if(settled)return;settled=true;clearTimeout(timer);socket.destroy();if(error)reject(error);else resolve(snapshot!);}
  socket.once('error',()=>done(Error('Printer status connection failed. Check the address and LAN access.')));socket.once('close',()=>done(Error('Printer closed the status connection. Check the access code.')));
  socket.once('secureConnect',()=>{try{
   // Validate the pin before the access code leaves this process. This is
   // connection-local certificate pinning, never a global TLS override.
   if(certificate(socket)!==value.fingerprint.toLowerCase())throw Error('Printer certificate changed. Re-pair before sending an access code.');
   const variable=Buffer.concat([string('MQTT'),Buffer.from([4,0xc2,0,20])]);
   socket.write(mqttPacket(0x10,Buffer.concat([variable,string('foundry-status-'+randomUUID().slice(0,8)),string('bblp'),string(value.accessCode)])));
  }catch(e){done(e as Error);}});
  socket.on('data',(chunk:Buffer)=>{try{
   buffer=Buffer.concat([buffer,chunk]);if(buffer.length>MAX_PACKET+5)throw Error('Printer status buffer exceeds limit');
   for(let packet;!settled&&(packet=readMqttPacket(buffer));){buffer=buffer.subarray(packet.bytes);const type=packet.header>>4,body=packet.body;
    if(type===2&&stage===0){if(body.length!==2||body[1]!==0)throw Error('Printer rejected the LAN access code');stage=1;socket.write(mqttPacket(0x82,Buffer.concat([Buffer.from([0,1]),string(reportTopic),Buffer.from([0])])));}
    else if(type===9&&stage===1){if(body.length!==3||body.readUInt16BE(0)!==1||body[2]>1)throw Error('Printer denied status subscription');stage=2;socket.write(mqttPacket(0x30,Buffer.concat([string(`device/${value.serial}/request`),Buffer.from(JSON.stringify({pushing:{sequence_id:'1',command:'pushall',version:1,push_target:1}}))])));}
    else if(type===3&&stage>=1){if(body.length<2)throw Error('Malformed status topic');const topicSize=body.readUInt16BE(0),qos=(packet.header>>1)&3;if(qos>1||body.length<2+topicSize+(qos?2:0))throw Error('Unsupported status packet');const topic=body.subarray(2,2+topicSize).toString('utf8');if(qos)socket.write(mqttPacket(0x40,body.subarray(2+topicSize,4+topicSize)));if(topic!==reportTopic)continue;
     const message=JSON.parse(body.subarray(2+topicSize+(qos?2:0)).toString('utf8'));const snapshot=parseAmsSnapshot(message);if(snapshot)done(undefined,snapshot);
    }
   }
  }catch{done(Error('Malformed or unsupported printer status packet'));}});
 });
}
