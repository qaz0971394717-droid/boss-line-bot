"""Read-only parts backup: R2 round-trip and SQLite integrity before retention."""
import os, json, urllib.request, tempfile, pathlib, subprocess, datetime, hashlib, sqlite3
import boto3
account=os.environ['CLOUDFLARE_ACCOUNT_ID']
headers={'Authorization':'Bearer '+os.environ['CLOUDFLARE_API_TOKEN'],'Content-Type':'application/json'}
url='https://api.cloudflare.com/client/v4/accounts/'+account+'/d1/database/d3db3412-32d5-4a51-9078-97f565ec5dcb'
with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=30) as r: result=json.load(r)
if not result.get('success') or result['result']['name']!='server-parts': raise RuntimeError('Parts database identity check failed')
size=result['result'].get('file_size',0)
with tempfile.TemporaryDirectory() as tmp:
 config=pathlib.Path(tmp)/'wrangler.json';file=pathlib.Path(tmp)/'parts.sql'
 config.write_text(json.dumps({'name':'parts-backup','compatibility_date':'2026-10-01','d1_databases':[{'binding':'DB','database_name':'server-parts','database_id':'d3db3412-32d5-4a51-9078-97f565ec5dcb'}]}))
 subprocess.run([str(pathlib.Path('cloudflare-migration/node_modules/.bin/wrangler').resolve()),'d1','export','DB','--remote','--config',str(config),'--output',str(file)],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180)
 s=boto3.client('s3',endpoint_url=os.environ['R2_ENDPOINT'].rstrip('/'),aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],region_name='auto')
 now=datetime.datetime.now(datetime.timezone.utc);prefix='server-parts/daily/';key=prefix+now.strftime('%Y%m%dT%H%M%SZ')+'.sql';bucket='hit2-neon-backup'
 s.upload_file(str(file),bucket,key);download=pathlib.Path(tmp)/'verified.sql';s.download_file(bucket,key,str(download))
 if hashlib.sha256(file.read_bytes()).digest()!=hashlib.sha256(download.read_bytes()).digest():raise RuntimeError('Parts backup hash mismatch')
 db=sqlite3.connect(':memory:');db.executescript(download.read_text())
 if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise RuntimeError('Parts restore integrity check failed')
 count=db.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").fetchone()[0]
 if count<1:raise RuntimeError('Parts backup schema missing')
 db.close()
 # Only this backup prefix is pruned; no live database data is deleted.
 for page in s.get_paginator('list_objects_v2').paginate(Bucket=bucket,Prefix=prefix):
  for obj in page.get('Contents',[]):
   if obj['Key'].endswith('.sql') and obj['LastModified']<now-datetime.timedelta(days=30):s.delete_object(Bucket=bucket,Key=obj['Key'])
 print('PASS: parts D1 backup uploaded, downloaded, SHA verified, locally restored and integrity checked; live data untouched.')
 print('Parts database allocated bytes: '+str(size))
 if size>=250*1024*1024:raise RuntimeError('Parts database above 250 MiB capacity warning')
