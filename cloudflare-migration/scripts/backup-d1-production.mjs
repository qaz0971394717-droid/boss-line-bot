import {backupD1} from './backup-d1.mjs';
try{backupD1('production');}catch(error){console.error('Production backup failed:',error.name);process.exitCode=1;}
