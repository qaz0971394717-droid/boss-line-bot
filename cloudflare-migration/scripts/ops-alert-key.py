import os,json,secrets,hashlib,urllib.request,boto3
s=boto3.client('s3',endpoint_url=os.environ['R2_ENDPOINT'].rstrip('/'),aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],region_name='auto')
try:
 key=s.get_object(Bucket='hit2-neon-backup',Key='ops-private/line-alert-key')['Body'].read().decode()
except s.exceptions.NoSuchKey:
 if os.environ.get('PROVISION_OPS')!='true':raise
 key=secrets.token_hex(32)
 s.put_object(Bucket='hit2-neon-backup',Key='ops-private/line-alert-key',Body=key.encode(),ContentType='text/plain')
if os.environ.get('PROVISION_OPS')=='true':
 base='https://api.cloudflare.com/client/v4/accounts/'+os.environ['CLOUDFLARE_ACCOUNT_ID']
 def api(path,data):
  req=urllib.request.Request(base+path,data=json.dumps(data).encode(),headers={'Authorization':'Bearer '+os.environ['CLOUDFLARE_API_TOKEN'],'Content-Type':'application/json'},method='PUT' if path.endswith('/secrets') else 'POST')
  with urllib.request.urlopen(req) as r:result=json.load(r)
  assert result['success']
  return result
 api('/workers/scripts/hit2-boss-staging/secrets',{'name':'OPS_ALERT_KEY','text':key,'type':'secret_text'})
 api('/d1/database/dfe1d761-05b1-4a72-b7b6-cd8255b9e7f5/query',{'sql':'CREATE TABLE IF NOT EXISTS ops_destination(id INTEGER PRIMARY KEY CHECK(id=1),chat_id TEXT NOT NULL); CREATE TABLE IF NOT EXISTS ops_deliveries(id TEXT PRIMARY KEY,status TEXT NOT NULL,updated_at INTEGER NOT NULL,created_at INTEGER NOT NULL,message TEXT NOT NULL);'})
 columns=api('/d1/database/dfe1d761-05b1-4a72-b7b6-cd8255b9e7f5/query',{'sql':'PRAGMA table_info(ops_deliveries)'})['result'][0]['results']
 for name,definition in [('created_at','INTEGER NOT NULL DEFAULT 0'),('message',"TEXT NOT NULL DEFAULT ''")]:
  if not any(c['name']==name for c in columns):api('/d1/database/dfe1d761-05b1-4a72-b7b6-cd8255b9e7f5/query',{'sql':f'ALTER TABLE ops_deliveries ADD COLUMN {name} {definition}'})
 print('Private notification relay provisioned; destination requires explicit opt-in in an existing test conversation.')
else:
 # Mask before exporting; no key is written to repository or logs.
 print('::add-mask::'+key)
 with open(os.environ['GITHUB_ENV'],'a') as f:f.write('OPS_ALERT_KEY='+key+'\n')
