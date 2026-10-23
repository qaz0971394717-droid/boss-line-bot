import {reportBackup} from '../../scripts/service-backup-status.mjs';
await reportBackup({target:'memo',title:'個人備忘機器人：備份或容量警示',status:process.env.BACKUP_STATUS});
