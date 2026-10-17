import os,json,urllib.request,tempfile,pathlib,subprocess,datetime,hashlib,boto3
account=os.environ['CLOUDFLARE_ACCOUNT_ID'];token=os.environ['CLOUDFLARE_API_TOKEN']
def api(path,body=None):
 req=urllib.request.Request('https://api.cloudflare.com/client/v4/accounts/'+account+path,data=json.dumps(body).encode() if body else None,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=30) as r:result=json.load(r)
 if not result.get('success'):raise RuntimeError('Memo backup API failed')
 return result['result']
match=[d for d in api('/d1/database?per_page=100') if d['name']=='hongzhe-personal-memo']
if len(match)!=1:raise RuntimeError('Memo database missing or ambiguous')
id=match[0]['uuid']
with tempfile.TemporaryDirectory() as tmp:
 config=pathlib.Path(tmp)/'wrangler.toml';file=pathlib.Path(tmp)/'memo.sql'
 config.write_text(f'name="hongzhe-personal-memo"\ncompatibility_date="2026-10-01"\n[[d1_databases]]\nbinding="MEMO_DB"\ndatabase_name="hongzhe-personal-memo"\ndatabase_id="{id}"\n')
 subprocess.run([str(pathlib.Path('node_modules/.bin/wrangler').resolve()),'d1','export','MEMO_DB','--remote','--config',str(config),'--output',str(file)],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180)
 s=boto3.client('s3',endpoint_url=os.environ['R2_ENDPOINT'].rstrip('/'),aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],region_name='auto')
 now=datetime.datetime.now(datetime.timezone.utc);prefix='personal-memo/daily/';key=prefix+now.strftime('%Y%m%dT%H%M%SZ')+'.sql';bucket='hit2-neon-backup'
 s.upload_file(str(file),bucket,key);verified=str(file)+'.verified';s.download_file(bucket,key,verified)
 if hashlib.sha256(file.read_bytes()).digest()!=hashlib.sha256(pathlib.Path(verified).read_bytes()).digest():raise RuntimeError('Memo backup SHA verification failed')
 # Validate downloaded SQL by restoring into a private, temporary local SQLite DB.
 import sqlite3
 restore=sqlite3.connect(':memory:');restore.executescript(pathlib.Path(verified).read_text());tables={r[0] for r in restore.execute("SELECT name FROM sqlite_master WHERE type='table'")}
 if not {'memo_items','memo_events'}.issubset(tables):raise RuntimeError('Memo backup schema restore failed')
 if restore.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise RuntimeError('Memo backup integrity check failed')
 restore.close()
 # Only now may old bookkeeping and explicitly deleted notes be removed.
 cutoff=(now-datetime.timedelta(days=14)).isoformat(timespec='milliseconds').replace('+00:00','Z')
 deleted=(now-datetime.timedelta(days=30)).isoformat(timespec='milliseconds').replace('+00:00','Z')
 for sql,params in [("DELETE FROM memo_events WHERE event_id IN (SELECT event_id FROM memo_events WHERE state='delivered' AND updated_at<? LIMIT 250)",[cutoff]),("DELETE FROM memo_items WHERE id IN (SELECT id FROM memo_items WHERE owner_id=? AND deleted_at IS NOT NULL AND deleted_at<? LIMIT 250)",[os.environ.get('MEMO_OWNER_LINE_USER_ID','LOCKED'),deleted])]:
  result=api('/d1/database/'+id+'/query',{'sql':sql,'params':params})
  if any(not row.get('success') for row in result):raise RuntimeError('Memo retention failed')
 for page in s.get_paginator('list_objects_v2').paginate(Bucket=bucket,Prefix=prefix):
  for obj in page.get('Contents',[]):
   if obj['Key'].endswith('.sql') and obj['LastModified']<now-datetime.timedelta(days=30):s.delete_object(Bucket=bucket,Key=obj['Key'])
 size=api('/d1/database/'+id).get('file_size',0)
 print('PASS: private memo backup uploaded, hash verified, locally restored and checked; bounded retention completed.')
 print('Memo database allocated bytes: '+str(size))
 if size>=250*1024*1024:raise RuntimeError('Memo database above 250 MiB capacity warning')
