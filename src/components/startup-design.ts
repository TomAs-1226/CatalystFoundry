/** Shared by the native splash and React recovery; no second animation on handoff. */
export const startupAnimationMs=1400;
export const startupReducedMs=400;
export const startupMarkup=`
<div class="foundry-startup__identity"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m16 2 12 7v14l-12 7L4 23V9Z"/><path d="M11 22V11h12M11 16h10"/></svg><span>Catalyst</span></div>
<h1>Foundry</h1>
<div class="foundry-startup__track" aria-hidden="true"><i></i></div>
<p class="foundry-startup__status"><span class="foundry-startup__phase-engine">Starting the local engine</span><span class="foundry-startup__phase-workspace">Opening your workspace</span><span class="foundry-startup__phase-ready">Workspace ready</span></p>
<div class="foundry-startup__steps" aria-hidden="true"><span class="foundry-startup__step-engine"><i></i><svg viewBox="0 0 16 16"><path d="m3 8 3 3 7-7"/></svg>Local engine</span><span class="foundry-startup__step-workspace"><i></i><svg viewBox="0 0 16 16"><path d="m3 8 3 3 7-7"/></svg>Workspace</span></div>`;
export async function waitForStartupPresentation(element:HTMLElement,presentedAt:number){
 const finite=element.getAnimations({subtree:true}).filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity);
 await Promise.allSettled(finite.map(animation=>animation.finished));
 const minimum=window.matchMedia('(prefers-reduced-motion: reduce)').matches?startupReducedMs:startupAnimationMs;
 const remaining=minimum-(performance.now()-presentedAt);
 if(remaining>0)await new Promise(resolve=>setTimeout(resolve,Math.ceil(remaining)));
}
