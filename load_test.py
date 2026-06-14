#!/usr/bin/env python3
"""
n8n Load Test + Slow Query Inspector
- Logs in as a given user
- Times individual API endpoints
- Fires parallel burst and monitors readiness
- Connects to RDS and captures slow/active queries during burst
- Summarises DB-level findings so you can decide if further query
  optimisation is needed or if the issue is purely app-layer
"""

import time
import json
import statistics
import concurrent.futures
import urllib.request
import urllib.error
import urllib.parse
import sys
import threading

try:
    import psycopg2
    HAS_PSYCOPG2 = True
except ImportError:
    HAS_PSYCOPG2 = False

# ── CONFIG ──────────────────────────────────────────────────────────────────
BASE_URL   = "https://workflow.ccbp.in"
EMAIL      = "vinayskumarshetty25507@gmail.com"
PASSWORD   = "rxZ06%7r@s"
# EMAIL      = "rajesh.lalam@nxtwave.co.in"
# PASSWORD   = "DvPAgKvUa7"
BROWSER_ID = "ad80d018-5139-4199-8d9d-080b50210542"

# RDS connection (optional — leave blank to skip DB monitoring)
RDS_HOST   = "nw-prod-pg.cluster-cut2bhbr4qjj.ap-south-1.rds.amazonaws.com"
RDS_DB     = "n8n_production"
RDS_USER   = "n8n_admin"
RDS_PASS   = "M3nP6qR9sT2uV5w"
RDS_PORT   = 5432

ENDPOINTS = [
    "rest/workflows?limit=50&includeScopes=true",
    "rest/executions?limit=20",
    "rest/projects/personal",
    "rest/active-workflows",
]

PARALLEL_COUNT = 1000   # requests per endpoint in burst test
TIMEOUT        = 20   # seconds per request


# ── HELPERS ─────────────────────────────────────────────────────────────────
def make_request(url, cookie, browser_id, timeout=TIMEOUT):
    req = urllib.request.Request(url)
    req.add_header("Cookie", f"n8n-auth={cookie}")
    req.add_header("browser-id", browser_id)
    req.add_header("Accept", "application/json")

    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            elapsed = time.time() - start
            return resp.status, elapsed
    except urllib.error.HTTPError as e:
        elapsed = time.time() - start
        return e.code, elapsed
    except Exception:
        elapsed = time.time() - start
        return 0, elapsed  # 0 = timeout/network error


# ── STEP 1: LOGIN ────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("STEP 1 — Login")
print("=" * 60)

login_url  = f"{BASE_URL}/rest/login"
login_data = json.dumps({"emailOrLdapLoginId": EMAIL, "password": PASSWORD}).encode()
login_req  = urllib.request.Request(login_url, data=login_data, method="POST")
login_req.add_header("Content-Type", "application/json")
login_req.add_header("browser-id", BROWSER_ID)

try:
    with urllib.request.urlopen(login_req, timeout=15) as resp:
        raw_cookie = resp.headers.get("Set-Cookie", "")
        body       = json.loads(resp.read())

    # Extract n8n-auth value from Set-Cookie header
    cookie = ""
    for part in raw_cookie.split(";"):
        part = part.strip()
        if part.startswith("n8n-auth="):
            cookie = part.split("=", 1)[1]
            break

    if not cookie:
        print("❌ Login succeeded but could not extract cookie.")
        print(f"   Set-Cookie header: {raw_cookie}")
        sys.exit(1)

    user_id   = body.get("data", {}).get("id", "unknown")
    user_role = body.get("data", {}).get("role", "unknown")
    print(f"✅ Logged in as:  {EMAIL}")
    print(f"   User ID:       {user_id}")
    print(f"   Role:          {user_role}")
    print(f"   Cookie:        {cookie[:40]}...")

except urllib.error.HTTPError as e:
    print(f"❌ Login failed: HTTP {e.code}")
    sys.exit(1)
except Exception as e:
    print(f"❌ Login error: {e}")
    sys.exit(1)


# ── STEP 2: SINGLE REQUEST TIMING ────────────────────────────────────────────
print("\n" + "=" * 60)
print("STEP 2 — Single request timing per endpoint")
print("=" * 60)

single_results = {}
for ep in ENDPOINTS:
    url    = f"{BASE_URL}/{ep}"
    status, elapsed = make_request(url, cookie, BROWSER_ID)
    symbol = "✅" if status == 200 else ("⏱️" if status == 0 else "❌")
    label  = f"{elapsed:.3f}s"
    print(f"{symbol}  {ep[:55]:<55} {status}  {label}")
    single_results[ep] = (status, elapsed)


# ── STEP 3: READINESS CHECK ──────────────────────────────────────────────────
def check_readiness():
    url = f"{BASE_URL}/healthz/readiness"
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0


# ── DB MONITORING ────────────────────────────────────────────────────────────
db_snapshots = []   # list of (timestamp, rows) collected during burst

SLOW_QUERY_SQL = """
SELECT
    pid,
    usename,
    state,
    round(extract(epoch from (now() - query_start))::numeric, 2) AS running_sec,
    left(query, 200) AS query_snippet
FROM pg_stat_activity
WHERE state IN ('active', 'idle in transaction')
  AND query NOT LIKE '%%pg_stat_activity%%'
  AND query_start IS NOT NULL
  AND now() - query_start > interval '1 second'
ORDER BY running_sec DESC
LIMIT 20;
"""

def db_monitor_loop(stop_event):
    """Poll pg_stat_activity every 2s during the burst."""
    if not HAS_PSYCOPG2 or not RDS_PASS:
        return
    try:
        conn = psycopg2.connect(
            host=RDS_HOST, port=RDS_PORT, dbname=RDS_DB,
            user=RDS_USER, password=RDS_PASS,
            sslmode="require", connect_timeout=10,
        )
        conn.autocommit = True
        cur = conn.cursor()
        while not stop_event.is_set():
            ts = time.strftime("%H:%M:%S", time.gmtime())
            cur.execute(SLOW_QUERY_SQL)
            rows = cur.fetchall()
            if rows:
                db_snapshots.append((ts, rows))
            time.sleep(2)
        cur.close()
        conn.close()
    except Exception as e:
        db_snapshots.append(("ERROR", [(str(e),)]))


# ── STEP 4: PARALLEL BURST TEST ──────────────────────────────────────────────
print("\n" + "=" * 60)
print(f"STEP 3 — Parallel burst: {PARALLEL_COUNT} × {len(ENDPOINTS)} endpoints = {PARALLEL_COUNT * len(ENDPOINTS)} total requests")
print("=" * 60)

if not HAS_PSYCOPG2:
    print("ℹ️  psycopg2 not installed — DB monitoring skipped")
    print("   Install with: pip install psycopg2-binary")
elif not RDS_PASS:
    print("ℹ️  RDS password not provided — DB monitoring skipped")
else:
    print("✅ DB monitoring active — capturing slow queries during burst")

print("Monitoring readiness during burst...\n")
readiness_log = []

def burst_task(ep):
    url = f"{BASE_URL}/{ep}"
    return ep, *make_request(url, cookie, BROWSER_ID)

def readiness_task():
    results = []
    for _ in range(25):
        ts   = time.strftime("%H:%M:%S", time.gmtime())
        code = check_readiness()
        results.append((ts, code))
        time.sleep(1)
    return results

all_tasks = [(ep,) for ep in ENDPOINTS for _ in range(PARALLEL_COUNT)]

stop_event = threading.Event()
db_thread  = threading.Thread(target=db_monitor_loop, args=(stop_event,), daemon=True)
db_thread.start()

with concurrent.futures.ThreadPoolExecutor(max_workers=50) as executor:
    readiness_future = executor.submit(readiness_task)
    burst_futures    = [executor.submit(burst_task, ep) for ep, in all_tasks]
    burst_results    = [f.result() for f in concurrent.futures.as_completed(burst_futures)]
    readiness_log    = readiness_future.result()

stop_event.set()
db_thread.join(timeout=5)

# Summarise burst
from collections import defaultdict
by_endpoint = defaultdict(list)
for ep, status, elapsed in burst_results:
    by_endpoint[ep].append((status, elapsed))

print(f"\n{'Endpoint':<55} {'200':>5} {'503':>5} {'000':>5} {'avg':>8} {'max':>8}")
print("-" * 90)
for ep in ENDPOINTS:
    rows    = by_endpoint[ep]
    ok      = sum(1 for s, _ in rows if s == 200)
    err503  = sum(1 for s, _ in rows if s == 503)
    timeout = sum(1 for s, _ in rows if s == 0)
    times   = [t for _, t in rows]
    avg_t   = statistics.mean(times)
    max_t   = max(times)
    print(f"{ep[:55]:<55} {ok:>5} {err503:>5} {timeout:>5} {avg_t:>7.2f}s {max_t:>7.2f}s")


# ── STEP 5: READINESS SUMMARY ────────────────────────────────────────────────
print("\n" + "=" * 60)
print("STEP 4 — Readiness monitor during burst")
print("=" * 60)

failures = [(ts, code) for ts, code in readiness_log if code != 200]
for ts, code in readiness_log:
    marker = " ← FAIL" if code != 200 else ""
    print(f"  {ts}  readiness={code}{marker}")

print()
if failures:
    print(f"❌ Readiness dropped {len(failures)} time(s) during burst")
    print("   503/502 means DB ping timed out — pool still being exhausted")
else:
    print("✅ Readiness stayed 200 throughout — no DB ping failures")


# ── STEP 6: DB SLOW QUERY REPORT ─────────────────────────────────────────────
print("\n" + "=" * 60)
print("STEP 5 — DB slow query snapshots during burst")
print("=" * 60)

if not db_snapshots:
    print("  ✅ No queries running > 1s captured during burst")
    print("     (DB monitoring skipped or no slow queries found)")
else:
    # Deduplicate by query snippet
    seen = {}
    for ts, rows in db_snapshots:
        for pid, usename, state, running_sec, snippet in rows:
            key = snippet[:80]
            if key not in seen or seen[key][0] < running_sec:
                seen[key] = (running_sec, ts, usename, state, snippet)

    print(f"  Found {len(seen)} distinct slow query pattern(s):\n")
    for i, (key, (max_sec, ts, user, state, snippet)) in enumerate(
        sorted(seen.items(), key=lambda x: -x[1][0]), 1
    ):
        print(f"  [{i}] Max duration: {max_sec}s  State: {state}  User: {user}")
        print(f"       First seen at: {ts}")
        print(f"       Query: {snippet[:150]}")
        print()

    print("  ── Verdict ──")
    max_slow = max(v[0] for v in seen.values())
    if max_slow > 5:
        print(f"  ❌ Queries taking {max_slow}s+ found — index/query optimisation needed")
        print("     Run EXPLAIN ANALYZE on the queries above to find missing indexes")
    elif max_slow > 1:
        print(f"  ⚠️  Queries taking {max_slow}s — borderline, monitor under higher load")
    else:
        print("  ✅ All captured queries under 1s — DB is not the bottleneck")

print()

# ── STEP 7: INDEX CHECK ───────────────────────────────────────────────────────
if HAS_PSYCOPG2 and RDS_PASS:
    print("=" * 60)
    print("STEP 6 — Key index verification")
    print("=" * 60)

    INDEX_CHECK_SQL = """
    SELECT
        t.relname  AS table_name,
        i.relname  AS index_name,
        pg_get_indexdef(ix.indexrelid) AS index_def
    FROM pg_class t
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i  ON i.oid = ix.indexrelid
    WHERE t.relname IN (
        'workflow_entity', 'execution_entity',
        'shared_workflow', 'project_relation'
    )
    ORDER BY t.relname, i.relname;
    """

    IMPORTANT_INDEXES = {
        "workflow_entity":  ['"updatedAt"', '"createdAt"', '"active"'],
        "execution_entity": ['"startedAt"', '"workflowId"', '"status"'],
        "shared_workflow":  ['"workflowId"', '"projectId"'],
        "project_relation": ['"projectId"', '"userId"'],
    }

    try:
        conn = psycopg2.connect(
            host=RDS_HOST, port=RDS_PORT, dbname=RDS_DB,
            user=RDS_USER, password=RDS_PASS,
            sslmode="require", connect_timeout=10,
        )
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute(INDEX_CHECK_SQL)
        rows = cur.fetchall()
        cur.close()
        conn.close()

        existing = {}
        for table, index, index_def in rows:
            existing.setdefault(table, []).append((index, index_def))

        for table, wanted in IMPORTANT_INDEXES.items():
            table_indexes = existing.get(table, [])
            all_defs = " ".join(d for _, d in table_indexes).lower()
            print(f"\n  {table}:")
            for w in wanted:
                col_clean = w.strip('"').lower()
                found = col_clean in all_defs
                mark  = "✅" if found else "❌ MISSING"
                print(f"    {mark}  index on {w}")
            for iname, idef in table_indexes:
                print(f"         → {iname}")

    except Exception as e:
        print(f"  ⚠️  Could not fetch indexes: {e}")

print()

# ── STEP 7: FINAL VERDICT ─────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("SUMMARY")
print("=" * 60)
print(f"  User:            {EMAIL}  ({user_role})")
print(f"  Total requests:  {len(burst_results)}")
total_ok      = sum(1 for _, s, _ in burst_results if s == 200)
total_timeout = sum(1 for _, s, _ in burst_results if s == 0)
total_503     = sum(1 for _, s, _ in burst_results if s == 503)
print(f"  200 OK:          {total_ok}")
print(f"  503 DB errors:   {total_503}")
print(f"  000 Timeouts:    {total_timeout}")

slow = [(ep, t) for ep, s, t in burst_results if t > 5]
if slow:
    print(f"\n  ⚠️  {len(slow)} requests took > 5s:")
    for ep, t in sorted(slow, key=lambda x: -x[1])[:5]:
        print(f"     {ep[:55]}  {t:.2f}s")

print()
