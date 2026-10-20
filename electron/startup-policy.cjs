/** Decorative animation cannot indefinitely hold a ready local workspace. */
async function waitForPresentation({presentedAt,minimumMs,complete,finish,now=()=>performance.now(),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),graceMs=250}){
 if(!Number.isFinite(presentedAt)||!Number.isFinite(minimumMs)||minimumMs<0||minimumMs>5000)throw Error('Invalid startup presentation timing.');
 let remaining=minimumMs-(now()-presentedAt);if(remaining>0)await delay(Math.ceil(remaining));
 const deadline=now()+graceMs;
 while(!await complete()){
  remaining=deadline-now();if(remaining<=0){await finish();return{animationCompleted:true,animationForced:true};}
  await delay(Math.min(25,remaining));
 }
 return{animationCompleted:true,animationForced:false};
}
module.exports={waitForPresentation};
