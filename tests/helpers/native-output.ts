import {join} from 'node:path';
/** Model the vendor CLI: outputdir prefixes the export name, not the caller cwd. */
export function nativeOutput(args:string[]){const name=args[args.indexOf('--export-3mf')+1],at=args.indexOf('--outputdir');return at<0?name:join(args[at+1],name);}
