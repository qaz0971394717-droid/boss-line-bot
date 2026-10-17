import {backupD1} from './backup-d1.mjs';
try{backupD1('staging');}catch(error){console.error('Staging backup failed:',error.name);process.exitCode=1;}
