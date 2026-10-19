export interface ImportProgress {phase:'queued'|'resolving'|'translating'|'downloading'|'validating'|'cached'|'done'|'cancelled'|'failed';percent:number;message:string;partId?:string;}
