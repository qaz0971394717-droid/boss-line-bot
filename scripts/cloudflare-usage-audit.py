"""Read-only account usage audit. No deployments, database queries or object downloads."""
import os,json,datetime,urllib.request,urllib.error,concurrent.futures,collections
UTC=datetime.timezone.utc
now=datetime.datetime.now(UTC)
account=os.environ["CLOUDFLARE_ACCOUNT_ID"]
token=os.environ["CLOUDFLARE_API_TOKEN"]
root="https://api.cloudflare.com/client/v4"
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs): return None
opener=urllib.request.build_opener(NoRedirect)
def safe(value):
 text=str(value)
 for key in ["CLOUDFLARE_API_TOKEN","CLOUDFLARE_ACCOUNT_ID","R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY","R2_ENDPOINT"]:
  if os.environ.get(key):text=text.replace(os.environ[key],"[redacted]")
 return text[:500]
def emit(section,**data):print("USAGE_AUDIT "+json.dumps({"section":section,**data},ensure_ascii=False),flush=True)
def request(path,body=None):
 data=json.dumps(body).encode() if body is not None else None
 req=urllib.request.Request(root+path,data=data,headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})
 try:
  with opener.open(req,timeout=30) as res:return json.load(res)
 except urllib.error.HTTPError as error:
  try:
   details=json.loads(error.read()).get("errors",[])
   raise RuntimeError("HTTP "+str(error.code)+" "+safe(details)) from None
  except json.JSONDecodeError:raise RuntimeError("HTTP "+str(error.code)) from None
def rest(path):
 data=request("/accounts/"+account+path)
 if not data.get("success"):raise RuntimeError(safe(data.get("errors")))
 return data.get("result"),data.get("result_info",{})
def gql(node):
 query="query { viewer { accounts(filter:{accountTag:"+json.dumps(account)+"}) { "+node+" } } }"
 data=request("/graphql",{"query":query})
 if data.get("errors"):raise RuntimeError(safe([e.get("message") for e in data["errors"]]))
 accounts=data.get("data",{}).get("viewer",{}).get("accounts",[])
 if not accounts:raise RuntimeError("No accessible account analytics")
 return accounts[0]
def attempt(section,fn):
 try:fn()
 except Exception as error:emit(section,status="unavailable",reason=safe(error))
iso=lambda date:date.isoformat(timespec="seconds").replace("+00:00","Z")
emit("window",status="ok",as_of_utc=iso(now),as_of_taipei=now.astimezone(datetime.timezone(datetime.timedelta(hours=8))).isoformat(timespec="seconds"),quota_day_utc=now.date().isoformat(),month_start=now.replace(day=1).date().isoformat())
def inventory():
 databases=[];page=1
 while True:
  rows,info=rest("/d1/database?per_page=100&page="+str(page))
  databases.extend(rows)
  if len(rows)<100 or page>=int(info.get("total_pages",page)):break
  page+=1
 output=[]
 for db in databases:
  size=db.get("file_size")
  if size is None:
   details,_=rest("/d1/database/"+db["uuid"]);size=details.get("file_size")
  output.append({"name":db.get("name"),"id":db.get("uuid"),"bytes":size})
 emit("d1_storage",status="ok",databases=output,total_bytes=sum(int(d["bytes"] or 0) for d in output),all_sizes_known=all(d["bytes"] is not None for d in output))
 workers,_=rest("/workers/scripts")
 emit("workers_inventory",status="ok",scripts=[w.get("id") for w in workers])
attempt("inventory",inventory)
def subscriptions():
 rows,_=rest("/subscriptions")
 emit("subscriptions",status="ok",subscriptions=[{"product":r.get("rate_plan",{}).get("public_name") or r.get("rate_plan",{}).get("id"),"state":r.get("state")} for r in rows])
attempt("subscriptions",subscriptions)
def worker_day(day):
 start=datetime.datetime.combine(day,datetime.time(),UTC)
 end=min(start+datetime.timedelta(days=1)-datetime.timedelta(seconds=1),now)
 node="workersInvocationsAdaptive(limit:1000,filter:{datetime_geq:"+json.dumps(iso(start))+",datetime_leq:"+json.dumps(iso(end))+"}){dimensions{scriptName} sum{requests errors subrequests}}"
 rows=gql(node)["workersInvocationsAdaptive"]
 emit("workers_day",status="ok",date_utc=str(day),start_utc=iso(start),end_utc=iso(end),rows=rows,total_requests=sum(r.get("sum",{}).get("requests",0) for r in rows),total_errors=sum(r.get("sum",{}).get("errors",0) for r in rows),row_limit_reached=len(rows)>=1000)
for days in range(now.day-1,-1,-1):
 day=now.date()-datetime.timedelta(days=days)
 attempt("workers_day_"+str(day),lambda day=day:worker_day(day))
def d1_usage():
 start=now.replace(day=1).date().isoformat();end=now.date().isoformat()
 node="d1AnalyticsAdaptiveGroups(limit:10000,filter:{date_geq:"+json.dumps(start)+",date_leq:"+json.dumps(end)+"}){dimensions{date databaseId} sum{rowsRead rowsWritten readQueries writeQueries}}"
 rows=gql(node)["d1AnalyticsAdaptiveGroups"]
 daily={}
 for row in rows:
  date=row["dimensions"]["date"];sums=daily.setdefault(date,{"rowsRead":0,"rowsWritten":0,"readQueries":0,"writeQueries":0})
  for metric in sums:sums[metric]+=row.get("sum",{}).get(metric,0)
 emit("d1_usage",status="ok",start_date_utc=start,end_date_utc=end,daily=daily,per_database=rows,row_limit_reached=len(rows)>=10000)
attempt("d1_usage",d1_usage)

def d1_query_usage():
 start=now.replace(day=1).date().isoformat();end=now.date().isoformat()
 node="d1QueriesAdaptiveGroups(limit:10000,filter:{date_geq:"+json.dumps(start)+",date_leq:"+json.dumps(end)+"}){dimensions{date databaseId} sum{rowsRead rowsWritten}}"
 rows=gql(node)["d1QueriesAdaptiveGroups"]
 daily={}
 for row in rows:
  date=row["dimensions"]["date"];sums=daily.setdefault(date,{"rowsRead":0,"rowsWritten":0})
  for metric in sums:sums[metric]+=row.get("sum",{}).get(metric,0)
 emit("d1_query_usage_crosscheck",status="ok",daily=daily,per_database=rows,row_limit_reached=len(rows)>=10000)
attempt("d1_query_usage_crosscheck",d1_query_usage)

def r2_operations():
 start=now.replace(day=1,hour=0,minute=0,second=0,microsecond=0)
 node="r2OperationsAdaptiveGroups(limit:10000,filter:{datetime_geq:"+json.dumps(iso(start))+",datetime_leq:"+json.dumps(iso(now))+"}){dimensions{bucketName actionType actionStatus} sum{requests}}"
 rows=gql(node)["r2OperationsAdaptiveGroups"]
 emit("r2_month_operations",status="ok",start_utc=iso(start),end_utc=iso(now),rows=rows,row_limit_reached=len(rows)>=10000)
attempt("r2_month_operations",r2_operations)
def r2_storage():
 start=now.replace(day=1,hour=0,minute=0,second=0,microsecond=0)
 node="r2StorageAdaptiveGroups(limit:10000,filter:{datetime_geq:"+json.dumps(iso(start))+",datetime_leq:"+json.dumps(iso(now))+"}){dimensions{datetime bucketName} max{payloadSize metadataSize objectCount}}"
 rows=gql(node)["r2StorageAdaptiveGroups"]
 daily={};latest={}
 for row in rows:
  bucket=row["dimensions"]["bucketName"];stamp=row["dimensions"]["datetime"];values=row["max"]
  if bucket not in latest or stamp>latest[bucket]["timestamp"]:latest[bucket]={"timestamp":stamp,**values}
  date=stamp[:10];peak=daily.setdefault(date,{});peak[bucket]=max(peak.get(bucket,0),values.get("payloadSize",0)+values.get("metadataSize",0))
 emit("r2_storage_analytics",status="ok",latest_per_bucket=latest,daily_peak_bytes={day:sum(b.values()) for day,b in daily.items()},row_limit_reached=len(rows)>=10000)
attempt("r2_storage_analytics",r2_storage)
def r2_s3():
 import boto3
 from botocore.config import Config
 endpoint=os.environ.get("R2_ENDPOINT","").rstrip("/")
 if not endpoint.startswith("https://") or not urllib.parse.urlparse(endpoint).hostname.endswith(".r2.cloudflarestorage.com"):raise RuntimeError("R2 endpoint unavailable")
 client=boto3.client("s3",endpoint_url=endpoint,aws_access_key_id=os.environ.get("R2_ACCESS_KEY_ID"),aws_secret_access_key=os.environ.get("R2_SECRET_ACCESS_KEY"),region_name="auto",config=Config(connect_timeout=10,read_timeout=20,retries={"max_attempts":2}))
 complete=True
 try:buckets=[b["Name"] for b in client.list_buckets().get("Buckets",[])]
 except Exception:buckets=["hit2-neon-backup"];complete=False
 for bucket in buckets:
  count=0;size=0;classes=collections.Counter()
  for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket):
   for obj in page.get("Contents",[]):
    count+=1;size+=obj["Size"];classes[obj.get("StorageClass","STANDARD")]+=1
  emit("r2_current_objects",status="ok",bucket=bucket,object_count=count,payload_bytes=size,storage_class_counts=dict(classes),account_bucket_inventory_complete=complete)
attempt("r2_current_objects",r2_s3)
emit("finished",status="ok",note="Unavailable metrics are unknown, never zero; analytics can lag. Audit made no application data changes.")
