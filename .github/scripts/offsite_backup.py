"""Daily offsite backup: export D1 databases + public repo bundles, verify, write to ./out.

Never prints secrets. Exit code 1 if anything failed (so the workflow can alert).
"""
import datetime, json, os, re, shutil, sqlite3, subprocess, sys

OUT = "out"
D1 = {
    "boss-line-bot": [("hit2-boss-d1-production-38984686581", "boss-production.sql"),
                      ("hit2-boss-d1-staging-38984107626", "boss-staging.sql")],
    "memo-bot": [("hongzhe-personal-memo", "memo-d1.sql")],
    "server-parts-line-bot": [("server-parts", "server-parts-d1.sql")],
    "drive-finder": [("drive-finder-meta", "drive-finder-meta.sql")],
}
PUBLIC_REPOS = ["boss-line-bot", "hit2-boss-reminder", "image-trigger-updates"]
PRIVATE_REPOS = ["drive-finder", "server-parts-line-bot"]  # need the GH_BACKUP_TOKEN secret
OWNER = "qaz0971394717-droid"
problems = []


def sh(args):
    return subprocess.run(args, capture_output=True, text=True, errors="replace")


def fail(msg):
    print("FAIL:", msg)
    problems.append(msg)


def live_counts(db, tabs):
    res = {}
    for i in range(0, len(tabs), 4):  # D1 allows at most 5 compound SELECT terms
        q = " UNION ALL ".join(f"SELECT '{t}' AS t, count(*) AS n FROM [{t}]" for t in tabs[i:i + 4])
        out = sh(["npx", "wrangler", "d1", "execute", db, "--remote", "--json", "--command", q]).stdout
        m = re.search(r"^\[\s*$", out, re.M)
        if not m:
            return None
        res.update({r["t"]: r["n"] for r in json.loads(out[m.start():])[0]["results"]})
    return res


for proj, items in D1.items():
    os.makedirs(f"{OUT}/{proj}", exist_ok=True)
    for db, fname in items:
        path = f"{OUT}/{proj}/{fname}"
        sh(["npx", "wrangler", "d1", "export", db, "--remote", "--output", path])
        if not os.path.exists(path) or os.path.getsize(path) == 0:
            fail(f"{fname}: export failed")
            continue
        con = sqlite3.connect(":memory:")
        try:
            con.executescript(open(path, encoding="utf-8").read())
        except Exception as e:  # noqa: BLE001
            fail(f"{fname}: cannot be loaded back ({type(e).__name__})")
            continue
        tabs = [r[0] for r in con.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '_cf_%'")]
        local = {t: con.execute(f'select count(*) from "{t}"').fetchone()[0] for t in tabs}
        if not tabs:
            fail(f"{fname}: no tables")
            continue
        live = live_counts(db, tabs)
        diff = {} if live is None else {t: (local[t], live.get(t)) for t in tabs if local[t] != live.get(t)}
        # A few rows may change between export and count; only a big drop is a failure.
        big = {t: v for t, v in diff.items() if v[1] is None or v[0] < v[1] * 0.9 - 2}
        print(f"ok {fname}: {len(tabs)} tables, {sum(local.values())} rows" + (f", drift {diff}" if diff else ""))
        if live is None:
            fail(f"{fname}: could not read live counts")
        elif big:
            fail(f"{fname}: backup has far fewer rows than live {big}")

os.makedirs(f"{OUT}/repos", exist_ok=True)
import base64
token = os.environ.get("GH_BACKUP_TOKEN", "")
auth = ["-c", "http.extraheader=Authorization: Basic " + base64.b64encode(f"x-access-token:{token}".encode()).decode()] if token else []
for r in PUBLIC_REPOS + PRIVATE_REPOS:
    private = r in PRIVATE_REPOS
    if private and not token:
        print(f"skip {r}: GH_BACKUP_TOKEN not set")
        continue
    d = f"/tmp/{r}.git"
    sh(["git", *(auth if private else []), "clone", "--mirror", "-q", f"https://github.com/{OWNER}/{r}.git", d])
    b = f"{OUT}/repos/{r}.bundle"
    sh(["git", "--git-dir", d, "bundle", "create", b, "--all"])
    v = sh(["git", "bundle", "verify", b])
    if v.returncode != 0:
        fail(f"{r}: bundle missing or invalid")  # never print git output: it could echo the token header
    else:
        print(f"ok {r}.bundle")

# ---- extras that are not in D1/git: KV, R2, release asset ----
KV_RATE, KV_RANK, R2 = "f5264b329f964823a299f71c734d56f8", "f1be507e9af341e297556e70880bf972", "drive-finder-backup"
PARTS_TABLES = ["schema.sql", "part_records.json", "machine_models.json", "write_version.json", "bot_users.json", "audit_log.json"]
STATIC = "static"


def wr(*a):
    return subprocess.run(["npx", "wrangler", *a], capture_output=True)


os.makedirs(f"{OUT}/ranking-bot", exist_ok=True)
rk = wr("kv", "key", "get", "latest", "--namespace-id", KV_RANK, "--remote").stdout
try:
    json.loads(rk)
    open(f"{OUT}/ranking-bot/ranking-latest.json", "wb").write(rk)
    print("ok ranking-bot KV")
except Exception:  # noqa: BLE001
    fail("ranking-bot KV: empty or invalid")

r2d = f"{OUT}/drive-finder/r2-latest"
os.makedirs(r2d, exist_ok=True)
found = None
for back in range(4):
    day = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=back)).date().isoformat()
    f = f"{r2d}/server-parts-part_records.json"
    wr("r2", "object", "get", f"{R2}/d1/server-parts/{day}/part_records.json", "--remote", "--file", f)
    if os.path.exists(f) and os.path.getsize(f) > 0:
        found = day
        break
if not found:
    fail("drive-finder R2 backup of the last 4 days not found")
else:
    for t in PARTS_TABLES:
        wr("r2", "object", "get", f"{R2}/d1/server-parts/{found}/{t}", "--remote", "--file", f"{r2d}/server-parts-{t}")
    wr("r2", "object", "get", f"{R2}/d1/drive-finder-meta/{found}/kv.json", "--remote", "--file", f"{r2d}/drive-finder-meta-kv.json")
    open(f"{r2d}/BACKUP_DAY.txt", "w").write(found)
    for t in PARTS_TABLES[1:]:
        try:
            json.load(open(f"{r2d}/server-parts-{t}", encoding="utf-8"))
        except Exception:  # noqa: BLE001
            fail(f"R2 {t}: missing or corrupt")
    print(f"ok drive-finder R2 backup day {found}")

gz = f"{r2d}/catalog.json.gz"
open(gz, "wb").write(wr("kv", "key", "get", "catalog:gz", "--namespace-id", KV_RATE, "--remote").stdout)
try:
    import gzip
    json.loads(gzip.open(gz).read())
    print("ok drive-finder catalog")
except Exception:  # noqa: BLE001
    fail("drive-finder catalog: missing or corrupt")

# Large, rarely changing release file: kept outside the dated folders, uploaded with --size-only
os.makedirs(f"{STATIC}/image-trigger-updates", exist_ok=True)
sh(["gh", "release", "download", "v1.0.0", "-R", f"{OWNER}/image-trigger-updates", "-D", f"{STATIC}/image-trigger-updates", "--clobber"])
exe = f"{STATIC}/image-trigger-updates/default.exe"
if os.path.exists(exe) and os.path.getsize(exe) > 0:
    print("ok image-trigger-updates release file")
else:
    fail("image-trigger-updates release file: download failed")
if os.path.exists(".github/backup-static/deleted-branches-sha.txt"):
    shutil.copy(".github/backup-static/deleted-branches-sha.txt", f"{STATIC}/deleted-branches-sha.txt")

open(f"{OUT}/MANIFEST.json", "w").write(json.dumps({"at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "problems": problems}, indent=1))
sys.exit(1 if problems else 0)
