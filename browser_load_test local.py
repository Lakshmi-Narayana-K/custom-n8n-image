"""
browser_load_test local.py — Browser load test against local n8n + seeded prod simulation.

Uses registered seed users (seeduser00001@loadtest.local …) and each user's own
workflows from the Postgres seed. Output format matches prod runs for easy comparison.

Install:
    pip install playwright psycopg2-binary
    playwright install chromium

Usage:
    # 1 user smoke test
    python3 "browser_load_test local.py"

    # 100 users (same as prod baseline run)
    NUM_USERS=100 python3 "browser_load_test local.py"

    # Compare summary against prod CSV when done
    COMPARE_BASELINE=browser_results_100users_173302.csv NUM_USERS=100 \\
      python3 "browser_load_test local.py"

Env:
    BASE_URL=http://localhost:5678
    NUM_USERS=1
    RAMP_UP_S=0.5
    SEED_MANIFEST=seed_manifest_20260614_170055.json   # optional; auto-picks latest
    SEED_DEFAULT_PASSWORD=Test@12345
    DB_POSTGRESDB_*  — used to resolve workflow IDs per seed user
    WAIT_FOR_EXECUTION=true   # false = fire-and-forget after trigger
    BYPASS_CACHE=true
    HEADLESS=true
    TIMEOUT_MS=90000
"""

from __future__ import annotations

import asyncio
import csv
import glob
import json
import os
import re
import secrets
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime

from playwright.async_api import Browser, BrowserContext, async_playwright

try:
    import psycopg2
except ImportError:
    psycopg2 = None

# ─── CONFIG ───────────────────────────────────────────────────────────────────
BASE_URL = os.environ.get("BASE_URL", "http://localhost:5678").rstrip("/")
EMAIL_DOMAIN = os.environ.get("SEED_EMAIL_DOMAIN", "loadtest.local")
DEFAULT_PASSWORD = os.environ.get("SEED_DEFAULT_PASSWORD", "Test@12345")
TRIGGER_NODE = "Schedule Trigger"

NUM_USERS = int(os.environ.get("NUM_USERS", "1"))
HEADLESS = os.environ.get("HEADLESS", "true").lower() != "false"
TIMEOUT_MS = int(os.environ.get("TIMEOUT_MS", "90000"))
RAMP_UP_S = float(os.environ.get("RAMP_UP_S", "0.5"))
BYPASS_CACHE = os.environ.get("BYPASS_CACHE", "true").lower() != "false"
WAIT_FOR_EXECUTION = os.environ.get("WAIT_FOR_EXECUTION", "true").lower() != "false"
COMPARE_BASELINE = os.environ.get("COMPARE_BASELINE", "browser_results_100users_173302.csv")

EXEC_POLL_INTERVAL_S = 1
EXEC_TIMEOUT_S = 120

OUTPUT_CSV = os.environ.get(
    "OUTPUT_CSV",
    f"browser_results_local_{NUM_USERS}users_{datetime.now().strftime('%H%M%S')}.csv",
)
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class TestAccount:
    user_index: int
    email: str
    password: str
    workflow_id: str


def _push_ref() -> str:
    return secrets.token_hex(6)


def _normalize_url(url: str) -> str:
    path = url.replace(BASE_URL, "")
    path = path.split("?")[0]
    path = re.sub(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
        ":id",
        path,
        flags=re.IGNORECASE,
    )
    return path


def _find_manifest() -> str | None:
    explicit = os.environ.get("SEED_MANIFEST")
    if explicit and os.path.isfile(explicit):
        return explicit
    matches = sorted(glob.glob("seed_manifest_*.json"), reverse=True)
    return matches[0] if matches else None


def _registered_user_count_from_manifest() -> int:
    manifest_path = _find_manifest()
    if not manifest_path:
        return 100
    with open(manifest_path, encoding="utf-8") as handle:
        data = json.load(handle)
    return int(data.get("config", {}).get("registered_user_count", 100))


def _load_workflow_map(num_users: int) -> dict[str, str]:
    """email -> first workflow id (prefer active) for each seed user."""
    if psycopg2 is None:
        print("❌ psycopg2-binary required to resolve workflow IDs. Run: pip install psycopg2-binary")
        sys.exit(1)

    host = os.environ.get("DB_POSTGRESDB_HOST", "localhost")
    port = int(os.environ.get("DB_POSTGRESDB_PORT", "5432"))
    dbname = os.environ.get("DB_POSTGRESDB_DATABASE", "n8n")
    user = os.environ.get("DB_POSTGRESDB_USER", "postgres")
    password = os.environ.get("DB_POSTGRESDB_PASSWORD", "postgres")

    emails = [f"seeduser{idx:05d}@{EMAIL_DOMAIN}" for idx in range(1, num_users + 1)]
    conn = psycopg2.connect(
        host=host,
        port=port,
        dbname=dbname,
        user=user,
        password=password,
    )
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT u.email, w.id
                FROM "user" u
                JOIN project_relation pr
                  ON pr."userId" = u.id AND pr.role = 'project:personalOwner'
                JOIN shared_workflow sw
                  ON sw."projectId" = pr."projectId" AND sw.role = 'workflow:owner'
                JOIN workflow_entity w ON w.id = sw."workflowId"
                WHERE u.email = ANY(%s)
                  AND w.name LIKE 'Seed WF %%'
                ORDER BY u.email,
                         (w."activeVersionId" IS NOT NULL) DESC,
                         w.name
                """,
                (emails,),
            )
            workflow_map: dict[str, str] = {}
            for email, workflow_id in cur.fetchall():
                if email not in workflow_map:
                    workflow_map[email] = workflow_id
            return workflow_map
    finally:
        conn.close()


def load_test_accounts(num_users: int) -> list[TestAccount]:
    registered_limit = _registered_user_count_from_manifest()
    if num_users > registered_limit:
        print(
            f"❌ NUM_USERS={num_users} exceeds {registered_limit} registered seed users. "
            f"Re-seed with higher SEED_REGISTERED_USER_COUNT or lower NUM_USERS."
        )
        sys.exit(1)

    workflow_map = _load_workflow_map(num_users)
    accounts: list[TestAccount] = []
    missing: list[str] = []

    for idx in range(1, num_users + 1):
        email = f"seeduser{idx:05d}@{EMAIL_DOMAIN}"
        workflow_id = workflow_map.get(email)
        if not workflow_id:
            missing.append(email)
            continue
        accounts.append(
            TestAccount(
                user_index=idx,
                email=email,
                password=DEFAULT_PASSWORD,
                workflow_id=workflow_id,
            )
        )

    if missing:
        print(f"❌ No workflows found for {len(missing)} seed user(s), e.g. {missing[0]}")
        print("   Is n8n pointed at the seeded Postgres DB?")
        sys.exit(1)

    return accounts


async def run_user_session(
    browser: Browser,
    account: TestAccount,
    results: list,
) -> None:
    user_id = account.user_index
    try:
        await _user_session_impl(browser, account, results)
    except Exception as exc:
        print(f"  User {user_id} | ❌ Session failed: {type(exc).__name__}: {str(exc)[:120]}")


async def _user_session_impl(
    browser: Browser,
    account: TestAccount,
    results: list,
) -> None:
    user_id = account.user_index
    if RAMP_UP_S > 0 and user_id > 1:
        await asyncio.sleep(RAMP_UP_S * (user_id - 1))

    extra_headers = (
        {"Cache-Control": "no-cache, no-store", "Pragma": "no-cache"}
        if BYPASS_CACHE
        else {}
    )
    context: BrowserContext = await browser.new_context(
        ignore_https_errors=True,
        bypass_csp=BYPASS_CACHE,
        extra_http_headers=extra_headers,
        user_agent=(
            f"Mozilla/5.0 (X11; Linux x86_64) "
            f"AppleWebKit/537.36 (KHTML, like Gecko) "
            f"Chrome/12{user_id}.0.0.0 Safari/537.36"
        ),
    )
    page = await context.new_page()
    page.set_default_timeout(TIMEOUT_MS)

    async def on_request_finished(request):
        if "/rest/" not in request.url:
            return
        try:
            timing = request.timing
            ttfb_ms = timing["responseStart"] - timing["requestStart"]
            body_ms = timing["responseEnd"] - timing["responseStart"]
            total_ms = timing["responseEnd"] - timing["requestStart"]
            resp = await request.response()
            status = resp.status if resp else 0
        except Exception:
            ttfb_ms = body_ms = total_ms = 0.0
            status = 0

        results.append(
            {
                "user_id": user_id,
                "type": "api",
                "page": _normalize_url(page.url),
                "url": _normalize_url(request.url),
                "method": request.method,
                "status": status,
                "duration_ms": round(total_ms, 1),
                "dom_interactive": round(ttfb_ms, 1),
                "dom_complete": round(body_ms, 1),
                "timestamp": datetime.now().isoformat(),
            }
        )

    page.on("requestfinished", on_request_finished)

    pages_to_visit = [
        ("/home/workflows", "Workflows List"),
        ("/home/credentials", "Credentials"),
        (f"/workflow/{account.workflow_id}", "Workflow Editor"),
    ]
    workflows_to_execute = [(account.workflow_id, TRIGGER_NODE)]

    session_start = time.perf_counter()
    browser_id = ""

    # ── STEP 1 — Sign in ─────────────────────────────────────────────────────
    t0 = time.perf_counter()
    await page.goto(f"{BASE_URL}/signin", wait_until="domcontentloaded")
    await page.wait_for_selector('input[type="email"]', state="visible", timeout=TIMEOUT_MS)
    await page.fill('input[type="email"]', account.email)
    await page.fill('input[type="password"]', account.password)
    await page.get_by_role("button", name="Sign in").click()

    for attempt in range(3):
        try:
            await page.wait_for_url(lambda url: "/signin" not in url, timeout=TIMEOUT_MS)
            break
        except Exception:
            if attempt == 2:
                raise
            print(f"  User {user_id} | Login redirect slow, retrying (attempt {attempt + 2}/3)...")
            try:
                await page.get_by_role("button", name="Sign in").click(timeout=5000)
            except Exception:
                pass

    await page.wait_for_load_state("networkidle")
    browser_id = await page.evaluate(
        "() => localStorage.getItem('n8n-browserId') "
        "   || localStorage.getItem('browserId') "
        "   || localStorage.getItem('browser-id') "
        "   || ''"
    )

    login_ms = (time.perf_counter() - t0) * 1000
    print(
        f"  User {user_id} | Login {account.email}  "
        f"browser-id={'found' if browser_id else 'NOT FOUND'}  | {login_ms:>7.0f} ms"
    )
    results.append(
        {
            "user_id": user_id,
            "type": "page",
            "page": "Login",
            "url": "/signin → /home",
            "method": "GET",
            "status": 200,
            "duration_ms": round(login_ms, 1),
            "dom_interactive": "",
            "dom_complete": "",
            "timestamp": datetime.now().isoformat(),
        }
    )

    # ── STEP 2 — Visit pages ─────────────────────────────────────────────────
    for path, label in pages_to_visit:
        t0 = time.perf_counter()
        await page.goto(f"{BASE_URL}{path}", wait_until="networkidle")
        wall_ms = (time.perf_counter() - t0) * 1000
        timing = await page.evaluate(
            """() => {
            const t = performance.timing;
            return {
                dom_interactive: t.domInteractive - t.navigationStart,
                dom_complete:    t.domComplete    - t.navigationStart,
            };
        }"""
        )
        print(
            f"  User {user_id} | {label:<25} | "
            f"wall={wall_ms:>7.0f}ms  "
            f"dom_interactive={timing['dom_interactive']}ms  "
            f"dom_complete={timing['dom_complete']}ms"
        )
        results.append(
            {
                "user_id": user_id,
                "type": "page",
                "page": label,
                "url": path,
                "method": "GET",
                "status": 200,
                "duration_ms": round(wall_ms, 1),
                "dom_interactive": timing["dom_interactive"],
                "dom_complete": timing["dom_complete"],
                "timestamp": datetime.now().isoformat(),
            }
        )
        await asyncio.sleep(1)

    # ── STEP 3 — Trigger workflow ────────────────────────────────────────────
    if workflows_to_execute:
        print(f"  User {user_id} | Triggering {len(workflows_to_execute)} workflow(s)...")

    for wf_id, trigger_node in workflows_to_execute:
        trigger_start = time.perf_counter()
        extra = {"browser-id": browser_id} if browser_id else {}
        trigger_resp = await context.request.post(
            f"{BASE_URL}/rest/workflows/{wf_id}/run",
            headers={
                "accept": "application/json, text/plain, */*",
                "content-type": "application/json",
                "push-ref": _push_ref(),
                **extra,
            },
            data={
                "workflowId": wf_id,
                "startNodes": [],
                "triggerToStartFrom": {"name": trigger_node},
            },
        )
        trigger_ms = (time.perf_counter() - trigger_start) * 1000
        trigger_body = await trigger_resp.json()
        exec_id = trigger_body.get("data", {}).get("executionId") or trigger_body.get("executionId")

        print(
            f"  User {user_id} | Trigger wf={wf_id}  status={trigger_resp.status}  "
            f"trigger_ms={trigger_ms:.0f}  exec_id={exec_id}"
        )
        results.append(
            {
                "user_id": user_id,
                "type": "execution_trigger",
                "page": f"wf:{wf_id}",
                "url": f"/rest/workflows/{wf_id}/run",
                "method": "POST",
                "status": trigger_resp.status,
                "duration_ms": round(trigger_ms, 1),
                "dom_interactive": "",
                "dom_complete": "",
                "timestamp": datetime.now().isoformat(),
            }
        )

        if not exec_id or not WAIT_FOR_EXECUTION:
            continue

        poll_start = time.perf_counter()
        final_status = "unknown"
        polls = 0
        while (time.perf_counter() - poll_start) < EXEC_TIMEOUT_S:
            await asyncio.sleep(EXEC_POLL_INTERVAL_S)
            polls += 1
            poll_resp = await context.request.get(
                f"{BASE_URL}/rest/executions/{exec_id}",
                headers={"accept": "application/json", **extra},
            )
            poll_body = await poll_resp.json()
            exec_data = poll_body.get("data", poll_body)
            finished = exec_data.get("finished", False)
            status = exec_data.get("status", "")
            if finished or status in ("success", "error", "crashed"):
                final_status = status or ("success" if finished else "unknown")
                break

        exec_total_ms = (time.perf_counter() - poll_start) * 1000
        icon = "✅" if final_status == "success" else "❌"
        print(
            f"  User {user_id} | {icon} Execution done  "
            f"status={final_status}  total_ms={exec_total_ms:.0f}  polls={polls}"
        )
        results.append(
            {
                "user_id": user_id,
                "type": "execution_complete",
                "page": f"wf:{wf_id}",
                "url": f"/rest/executions/{exec_id}",
                "method": "GET",
                "status": 200 if final_status == "success" else 500,
                "duration_ms": round(exec_total_ms, 1),
                "dom_interactive": final_status,
                "dom_complete": polls,
                "timestamp": datetime.now().isoformat(),
            }
        )

    total_ms = (time.perf_counter() - session_start) * 1000
    api_count = sum(1 for r in results if r["user_id"] == user_id and r["type"] == "api")
    print(f"  User {user_id} | Session done in {total_ms:.0f}ms | {api_count} API calls captured")
    await context.close()


def _page_stats(results: list) -> dict[str, dict[str, float]]:
    by_page: dict[str, list[float]] = defaultdict(list)
    for row in results:
        if row["type"] == "page":
            by_page[row["page"]].append(float(row["duration_ms"]))
    stats: dict[str, dict[str, float]] = {}
    for page, times in by_page.items():
        stats[page] = {
            "n": len(times),
            "avg": sum(times) / len(times),
            "max": max(times),
        }
    return stats


def _api_stats(results: list) -> dict[str, dict[str, float]]:
    by_url: dict[str, dict[str, list[float]]] = defaultdict(lambda: {"total": [], "ttfb": []})
    for row in results:
        if row["type"] != "api":
            continue
        by_url[row["url"]]["total"].append(float(row["duration_ms"]))
        if isinstance(row.get("dom_interactive"), (int, float)):
            by_url[row["url"]]["ttfb"].append(float(row["dom_interactive"]))
    stats: dict[str, dict[str, float]] = {}
    for url, data in by_url.items():
        stats[url] = {
            "n": len(data["total"]),
            "total_avg": sum(data["total"]) / len(data["total"]),
            "total_max": max(data["total"]),
            "ttfb_avg": sum(data["ttfb"]) / len(data["ttfb"]) if data["ttfb"] else 0.0,
        }
    return stats


def _load_csv_stats(path: str) -> tuple[dict[str, dict[str, float]], dict[str, dict[str, float]]]:
    rows: list[dict] = []
    with open(path, newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    return _page_stats(rows), _api_stats(rows)


def print_summary(results: list) -> None:
    sep = "=" * 75
    print(f"\n{sep}")
    print("SUMMARY  (local)")
    print(sep)

    pages = [r for r in results if r["type"] == "page"]
    apis = [r for r in results if r["type"] == "api"]
    execs = [r for r in results if r["type"] == "execution_complete"]
    triggers = [r for r in results if r["type"] == "execution_trigger"]

    print("\n  PAGE LOADS")
    print(f"  {'Page':<25}  {'N':>4}  {'Avg (ms)':>10}  {'Max (ms)':>10}")
    print(f"  {'-' * 25}  {'-' * 4}  {'-' * 10}  {'-' * 10}")
    page_stats = _page_stats(results)
    for pg, data in page_stats.items():
        flag = "  ⚠️" if data["avg"] > 5000 else ""
        print(
            f"  {pg:<25}  {int(data['n']):>4}  {data['avg']:>10.0f}  {data['max']:>10.0f}{flag}"
        )

    if triggers or execs:
        print("\n  WORKFLOW EXECUTIONS")
        print(f"  {'Metric':<35}  {'N':>4}  {'Avg (ms)':>10}  {'Max (ms)':>10}")
        print(f"  {'-' * 35}  {'-' * 4}  {'-' * 10}  {'-' * 10}")
        if triggers:
            t_times = [float(r["duration_ms"]) for r in triggers]
            print(
                f"  {'Trigger latency (POST /run)':<35}  {len(t_times):>4}"
                f"  {sum(t_times) / len(t_times):>10.0f}  {max(t_times):>10.0f}"
            )
        if execs:
            e_times = [float(r["duration_ms"]) for r in execs]
            success = sum(1 for r in execs if r["status"] == 200)
            failed = len(execs) - success
            print(
                f"  {'Total execution time (wall)':<35}  {len(e_times):>4}"
                f"  {sum(e_times) / len(e_times):>10.0f}  {max(e_times):>10.0f}"
            )
            print(f"  Outcomes — success={success}  failed/timeout={failed}")

    print("\n  BROWSER API CALLS  (TTFB = server processing proxy; excludes network travel)")
    print(f"  {'Endpoint':<50}  {'N':>4}  {'Total avg':>10}  {'TTFB avg':>10}  {'Total max':>10}")
    print(f"  {'-' * 50}  {'-' * 4}  {'-' * 10}  {'-' * 10}  {'-' * 10}")
    api_stats = _api_stats(results)
    for url, data in sorted(api_stats.items(), key=lambda item: -item[1]["total_avg"])[:20]:
        flag = "  ⚠️" if data["total_avg"] > 2000 else ""
        print(
            f"  {url:<50}  {int(data['n']):>4}  {data['total_avg']:>10.0f}  "
            f"{data['ttfb_avg']:>10.0f}  {data['total_max']:>10.0f}{flag}"
        )
    print()


def print_baseline_comparison(results: list, baseline_csv: str) -> None:
    if not baseline_csv or not os.path.isfile(baseline_csv):
        return

    local_pages, local_apis = _page_stats(results), _api_stats(results)
    base_pages, base_apis = _load_csv_stats(baseline_csv)

    sep = "=" * 75
    print(sep)
    print(f"COMPARISON  local vs prod baseline ({os.path.basename(baseline_csv)})")
    print(sep)

    print(f"\n  {'Page':<22}  {'Prod avg':>10}  {'Local avg':>10}  {'Delta':>10}")
    print(f"  {'-' * 22}  {'-' * 10}  {'-' * 10}  {'-' * 10}")
    for page in ("Login", "Workflows List", "Credentials", "Workflow Editor"):
        prod = base_pages.get(page, {}).get("avg")
        local = local_pages.get(page, {}).get("avg")
        if prod is None or local is None:
            continue
        delta = local - prod
        sign = "+" if delta >= 0 else ""
        print(f"  {page:<22}  {prod:>10.0f}  {local:>10.0f}  {sign}{delta:>9.0f}")

    key_apis = (
        "/rest/workflows",
        "/rest/active-workflows",
        "/rest/credentials",
        "/rest/license",
    )
    print(f"\n  {'Endpoint':<32}  {'Prod TTFB':>10}  {'Local TTFB':>10}  {'Delta':>10}")
    print(f"  {'-' * 32}  {'-' * 10}  {'-' * 10}  {'-' * 10}")
    for endpoint in key_apis:
        prod = base_apis.get(endpoint, {}).get("ttfb_avg")
        local = local_apis.get(endpoint, {}).get("ttfb_avg")
        if prod is None or local is None:
            continue
        delta = local - prod
        sign = "+" if delta >= 0 else ""
        print(f"  {endpoint:<32}  {prod:>10.0f}  {local:>10.0f}  {sign}{delta:>9.0f}")
    print()


async def main() -> None:
    accounts = load_test_accounts(NUM_USERS)
    manifest = _find_manifest() or "(generated emails)"

    print(f"\n{'=' * 75}")
    print(f"  Browser Load Test — LOCAL — {NUM_USERS} concurrent user(s)")
    print(f"  Target     : {BASE_URL}")
    print(f"  Users      : seeduser00001 … seeduser{NUM_USERS:05d}@{EMAIL_DOMAIN}")
    print(f"  Manifest   : {manifest}")
    print(f"  Pages      : Workflows List, Credentials, Workflow Editor (per user)")
    print(f"  Execution  : each user triggers own Schedule Trigger workflow")
    print(f"  Wait exec  : {WAIT_FOR_EXECUTION}")
    print(f"  Output     : {OUTPUT_CSV}")
    if COMPARE_BASELINE and os.path.isfile(COMPARE_BASELINE):
        print(f"  Baseline   : {COMPARE_BASELINE}")
    print(f"{'=' * 75}\n")

    results: list[dict] = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=HEADLESS)
        await asyncio.gather(
            *[run_user_session(browser, account, results) for account in accounts],
            return_exceptions=True,
        )
        await browser.close()

    fieldnames = [
        "user_id",
        "type",
        "page",
        "url",
        "method",
        "status",
        "duration_ms",
        "dom_interactive",
        "dom_complete",
        "timestamp",
    ]
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(results)

    print_summary(results)
    print_baseline_comparison(results, COMPARE_BASELINE)
    print(f"✅  Full results saved to: {OUTPUT_CSV}\n")


if __name__ == "__main__":
    asyncio.run(main())
