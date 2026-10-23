"""Read-only diagnostics of the existing reminder transport. Never outputs secret values."""
import os,json,re,email,urllib.request,urllib.error
account=os.environ["CLOUDFLARE_ACCOUNT_ID"];token=os.environ["CLOUDFLARE_API_TOKEN"]
root="https://api.cloudflare.com/client/v4/accounts/"+account
def emit(kind,**data):print("REMINDER_DIAG "+json.dumps({"section":kind,**data},ensure_ascii=False),flush=True)
def get(path):
 request=urllib.request.Request(root+path,headers={"Authorization":"Bearer "+token})
 with urllib.request.urlopen(request,timeout=30) as r:return r.headers.get("Content-Type",""),r.read()
def api(path):
 _,raw=get(path);data=json.loads(raw)
 if not data.get("success"):raise RuntimeError("Cloudflare request rejected")
 return data.get("result")
def scrub(text):
 for value in [token,account,*[os.environ.get(k,"") for k in ["R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY","R2_ENDPOINT"]]]:
  if value:text=text.replace(value,"[secret]")
 text=re.sub(r"https?://[^\s\"'<>]+",lambda m:"https://"+urllib.parse.urlparse(m[0]).hostname+"/[redacted]",text)
 text=re.sub(r"(?<![A-Za-z0-9_])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_])","[long-literal-redacted]",text)
 return text
for worker in ["hit2-boss-production","hit2-boss-reminder","hit2-boss-reminder-v2"]:
 try:
  settings=api("/workers/scripts/"+worker+"/settings")
  bindings=[{"name":b.get("name"),"type":b.get("type"),**({"namespace_id":b.get("namespace_id")} if b.get("type")=="kv_namespace" else {}),**({"class_name":b.get("class_name"),"script_name":b.get("script_name")} if b.get("type")=="durable_object_namespace" else {})} for b in settings.get("bindings",[])]
  emit("settings",worker=worker,bindings=bindings,has_line_endpoint_literal=False)
  emit("schedules",worker=worker,result=api("/workers/scripts/"+worker+"/schedules"))
  if worker=="hit2-boss-production":continue
  mime,raw=get("/workers/scripts/"+worker)
  if mime.startswith("multipart/"):
   msg=email.message_from_bytes(("Content-Type: "+mime+"\r\nMIME-Version: 1.0\r\n\r\n").encode()+raw)
   modules=[(part.get_filename(),part.get_payload(decode=True).decode("utf-8")) for part in msg.walk() if part.get_content_maintype()!="multipart" and part.get_payload(decode=True)]
  else:modules=[("worker.js",raw.decode("utf-8"))]
  for name,source in modules:
   if not name or name.endswith((".js",".mjs")):
    emit("source",worker=worker,module=name,contains_line_push="api.line.me" in source,source=scrub(source)[:40000])
 except Exception as e:emit("error",worker=worker,type=type(e).__name__,message=scrub(str(e))[:150])
