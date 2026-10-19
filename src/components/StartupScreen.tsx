import './startup-screen.css';
import {startupMarkup} from './startup-design';

export default function StartupScreen({animate=true,ready=false}:{animate?:boolean;ready?:boolean}) {
  return <main className="foundry-startup" data-static={!animate} data-stage={ready?'ready':'workspace'} role="status" aria-live="polite" aria-busy={!ready} dangerouslySetInnerHTML={{__html:startupMarkup}}/>;
}
