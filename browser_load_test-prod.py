"""
browser_load_test.py — Real browser simulation for n8n using Playwright.

Simulates full user sessions:
  1. Sign in via the real login page
  2. Visit pages (Workflows List, Credentials, Workflow Editor)
  3. Trigger real workflow executions and poll until they finish

Installs:
    pip install playwright
    playwright install chromium

Usage:
    python3 browser_load_test.py              # 1 user (default)
    NUM_USERS=5  python3 browser_load_test.py # 5 concurrent users
    NUM_USERS=20 python3 browser_load_test.py # 20 concurrent users
"""

import asyncio
import csv
import os
import re
import secrets
import time
from collections import defaultdict
from datetime import datetime

from playwright.async_api import async_playwright, Browser, BrowserContext

# ─── CONFIG ───────────────────────────────────────────────────────────────────
BASE_URL    = "https://workflow.ccbp.in"
LOGIN_EMAIL = "vinayskumarshetty25507@gmail.com"
LOGIN_PASS  = "rxZ06%7r@s"

PAGES_TO_VISIT = [
    ("/home/workflows",              "Workflows List"),
    ("/home/credentials",           "Credentials"),
    ("/workflow/RKe9sTfN8g6Zk5Z4", "Workflow Editor"),
]

# ── Workflows to execute (add as many as needed) ──────────────────────────────
# Each entry: (workflow_id, trigger_node_name)
# workflow_id      → from the URL: /workflow/<id>
# trigger_node_name → the node name shown in the curl --data-raw body
WORKFLOWS_TO_EXECUTE = [
    ("ejP0fEH64yDip1bB", "Schedule Trigger"),
    # ("anotherWorkflowId", "Webhook"),   ← add more here
]

EXEC_POLL_INTERVAL_S = 1      # how often to check if execution finished
EXEC_TIMEOUT_S       = 120    # give up polling after 2 minutes

NUM_USERS      = int(os.environ.get("NUM_USERS", 1))
HEADLESS       = True         # set False to watch the browser live
TIMEOUT_MS     = 90_000       # 90s per page navigation / element wait
# Stagger user launches so they don't all slam the server at t=0.
# Each user waits RAMP_UP_S × user_index seconds before starting.
# E.g. 10 users with 0.5s ramp = users start at 0s,0.5s,1s...4.5s
RAMP_UP_S      = float(os.environ.get("RAMP_UP_S", 0.5))

# ── Cache simulation ──────────────────────────────────────────────────────────
# True  = sends Cache-Control: no-cache on every request (simulates a user
#         hitting Ctrl+Shift+R or opening a brand-new incognito tab).
#         Best for worst-case / cold-cache load testing.
# False = allows normal browser caching (closer to a returning user).
BYPASS_CACHE = True
OUTPUT_CSV  = f"browser_results_{NUM_USERS}users_{datetime.now().strftime('%H%M%S')}.csv"
# ──────────────────────────────────────────────────────────────────────────────


def _push_ref() -> str:
    """Generate a random push-ref header value (like the browser does)."""
    return secrets.token_hex(6)


def _normalize_url(url: str) -> str:
    """Strip base URL, query params, and UUIDs for grouping."""
    path = url.replace(BASE_URL, "")
    path = path.split("?")[0]
    path = re.sub(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
        ":id",
        path,
        flags=re.IGNORECASE,
    )
    return path


async def run_user_session(browser: Browser, user_id: int, results: list) -> None:
    """Full sign-in → browse flow for one simulated user. Never raises — logs failures inline."""
    try:
        await _user_session_impl(browser, user_id, results)
    except Exception as exc:
        print(f"  User {user_id} | ❌ Session failed: {type(exc).__name__}: {str(exc)[:120]}")


async def _user_session_impl(browser: Browser, user_id: int, results: list) -> None:
    """Inner implementation — raises on unrecoverable error."""
    # Stagger start: user N waits N×RAMP_UP_S before launching.
    # Prevents all browser instances from hitting the login page simultaneously.
    if RAMP_UP_S > 0 and user_id > 1:
        await asyncio.sleep(RAMP_UP_S * (user_id - 1))
    # Each context is fully isolated — separate cookies, localStorage, and
    # browser cache. No sharing between simulated users.
    extra_headers = (
        {"Cache-Control": "no-cache, no-store", "Pragma": "no-cache"}
        if BYPASS_CACHE else {}
    )
    context: BrowserContext = await browser.new_context(
        ignore_https_errors=True,
        bypass_csp=BYPASS_CACHE,
        extra_http_headers=extra_headers,
        user_agent=(
            # Vary the User-Agent per user so server-side per-UA caches don't
            # conflate requests from different simulated users.
            f"Mozilla/5.0 (X11; Linux x86_64) "
            f"AppleWebKit/537.36 (KHTML, like Gecko) "
            f"Chrome/12{user_id}.0.0.0 Safari/537.36"
        ),
    )
    page = await context.new_page()
    page.set_default_timeout(TIMEOUT_MS)

    # ── Capture every finished REST request with Playwright's built-in timing ──
    # request.timing breakdown (all values in ms, relative to navigation start):
    #   requestStart   → when browser sent the request bytes
    #   responseStart  → when first byte of response arrived  (TTFB)
    #   responseEnd    → when last byte of response arrived
    #
    # TTFB = responseStart − requestStart  ← best proxy for SERVER processing time
    # Body  = responseEnd  − responseStart ← depends on payload size
    # Total = responseEnd  − requestStart  ← what the user's browser waited
    async def on_request_finished(request):
        if "/rest/" not in request.url:
            return
        try:
            t            = request.timing
            ttfb_ms      = t["responseStart"] - t["requestStart"]   # server time proxy
            body_ms      = t["responseEnd"]   - t["responseStart"]  # download
            total_ms     = t["responseEnd"]   - t["requestStart"]   # wall clock
            resp         = await request.response()
            status       = resp.status if resp else 0
        except Exception:
            ttfb_ms = body_ms = total_ms = 0.0
            status = 0

        results.append({
            "user_id":         user_id,
            "type":            "api",
            "page":            _normalize_url(page.url),
            "url":             _normalize_url(request.url),
            "method":          request.method,
            "status":          status,
            "duration_ms":     round(total_ms, 1),   # total wall time
            "dom_interactive": round(ttfb_ms, 1),    # re-used column → TTFB (server)
            "dom_complete":    round(body_ms, 1),    # re-used column → body download
            "timestamp":       datetime.now().isoformat(),
        })

    page.on("requestfinished", on_request_finished)

    session_start = time.perf_counter()
    browser_id: str = ""  # populated after login from localStorage

    # ─────────────────────────────────────────────
    # STEP 1 — Sign in
    # ─────────────────────────────────────────────
    t0 = time.perf_counter()
    await page.goto(f"{BASE_URL}/signin", wait_until="domcontentloaded")

    # Wait explicitly for the form to render before typing.
    # Under high concurrency the page may be slow to paint even after goto().
    await page.wait_for_selector('input[type="email"]', state="visible", timeout=TIMEOUT_MS)
    await page.fill('input[type="email"]',    LOGIN_EMAIL)
    await page.fill('input[type="password"]', LOGIN_PASS)
    await page.get_by_role("button", name="Sign in").click()

    # Wait for redirect away from /signin with retry — under concurrent load
    # the server can take longer than normal to process the login POST.
    for attempt in range(3):
        try:
            await page.wait_for_url(
                lambda url: "/signin" not in url,
                timeout=TIMEOUT_MS,
            )
            break
        except Exception:
            if attempt == 2:
                raise
            print(f"  User {user_id} | Login redirect slow, retrying (attempt {attempt + 2}/3)...")
            # Re-click submit in case the first click was swallowed
            try:
                await page.get_by_role("button", name="Sign in").click(timeout=5000)
            except Exception:
                pass

    await page.wait_for_load_state("networkidle")

    # Read browser-id that n8n's JS stores in localStorage after login.
    # This header is required on every REST call; without it n8n returns 401.
    browser_id = await page.evaluate(
        "() => localStorage.getItem('n8n-browserId') "
        "   || localStorage.getItem('browserId') "
        "   || localStorage.getItem('browser-id') "
        "   || ''"
    )

    login_ms = (time.perf_counter() - t0) * 1000
    print(f"  User {user_id} | Login complete  browser-id={'found' if browser_id else 'NOT FOUND'}  | {login_ms:>7.0f} ms")

    results.append({
        "user_id":         user_id,
        "type":            "page",
        "page":            "Login",
        "url":             "/signin → /home",
        "method":          "GET",
        "status":          200,
        "duration_ms":     round(login_ms, 1),
        "dom_interactive": "",
        "dom_complete":    "",
        "timestamp":       datetime.now().isoformat(),
    })

    # ─────────────────────────────────────────────
    # STEP 2 — Visit each page, collect timings
    # ─────────────────────────────────────────────
    for path, label in PAGES_TO_VISIT:
        t0 = time.perf_counter()
        await page.goto(f"{BASE_URL}{path}", wait_until="networkidle")
        wall_ms = (time.perf_counter() - t0) * 1000

        # Browser's own Navigation Timing API
        timing = await page.evaluate("""() => {
            const t = performance.timing;
            return {
                dom_interactive: t.domInteractive - t.navigationStart,
                dom_complete:    t.domComplete    - t.navigationStart,
            };
        }""")

        print(
            f"  User {user_id} | {label:<25} | "
            f"wall={wall_ms:>7.0f}ms  "
            f"dom_interactive={timing['dom_interactive']}ms  "
            f"dom_complete={timing['dom_complete']}ms"
        )

        results.append({
            "user_id":         user_id,
            "type":            "page",
            "page":            label,
            "url":             path,
            "method":          "GET",
            "status":          200,
            "duration_ms":     round(wall_ms, 1),
            "dom_interactive": timing["dom_interactive"],
            "dom_complete":    timing["dom_complete"],
            "timestamp":       datetime.now().isoformat(),
        })

        # Small pause between pages (like a real user)
        await asyncio.sleep(1)

    # ─────────────────────────────────────────────
    # STEP 3 — Trigger workflow executions
    # Each workflow is triggered, then polled until
    # it finishes (success / error / timeout).
    # ─────────────────────────────────────────────
    if WORKFLOWS_TO_EXECUTE:
        print(f"  User {user_id} | Triggering {len(WORKFLOWS_TO_EXECUTE)} workflow(s)...")

    for wf_id, trigger_node in WORKFLOWS_TO_EXECUTE:
        # ── Trigger ──────────────────────────────
        trigger_start = time.perf_counter()
        extra_headers = {"browser-id": browser_id} if browser_id else {}
        trigger_resp = await context.request.post(
            f"{BASE_URL}/rest/workflows/{wf_id}/run",
            headers={
                "accept":       "application/json, text/plain, */*",
                "content-type": "application/json",
                "push-ref":     _push_ref(),
                **extra_headers,
            },
            data={
                "workflowId":        wf_id,
                "startNodes":        [],
                "triggerToStartFrom": {"name": trigger_node},
            },
        )
        trigger_ms = (time.perf_counter() - trigger_start) * 1000

        trigger_body = await trigger_resp.json()
        exec_id = (
            trigger_body.get("data", {}).get("executionId")
            or trigger_body.get("executionId")
        )

        print(
            f"  User {user_id} | Trigger wf={wf_id}  status={trigger_resp.status}  "
            f"trigger_ms={trigger_ms:.0f}  exec_id={exec_id}"
        )

        results.append({
            "user_id":         user_id,
            "type":            "execution_trigger",
            "page":            f"wf:{wf_id}",
            "url":             f"/rest/workflows/{wf_id}/run",
            "method":          "POST",
            "status":          trigger_resp.status,
            "duration_ms":     round(trigger_ms, 1),
            "dom_interactive": "",
            "dom_complete":    "",
            "timestamp":       datetime.now().isoformat(),
        })

        if not exec_id:
            print(f"  User {user_id} | No execution ID returned — skipping poll")
            continue

        # ── Poll until finished ───────────────────
        poll_start  = time.perf_counter()
        final_status = "unknown"
        polls        = 0

        while (time.perf_counter() - poll_start) < EXEC_TIMEOUT_S:
            await asyncio.sleep(EXEC_POLL_INTERVAL_S)
            polls += 1

            poll_resp = await context.request.get(
                f"{BASE_URL}/rest/executions/{exec_id}",
                headers={"accept": "application/json", **extra_headers},
            )
            poll_body = await poll_resp.json()
            exec_data = poll_body.get("data", poll_body)

            finished  = exec_data.get("finished", False)
            status    = exec_data.get("status", "")

            if finished or status in ("success", "error", "crashed"):
                final_status = status or ("success" if finished else "unknown")
                break

        exec_total_ms = (time.perf_counter() - poll_start) * 1000

        icon = "✅" if final_status == "success" else "❌"
        print(
            f"  User {user_id} | {icon} Execution done  "
            f"status={final_status}  total_ms={exec_total_ms:.0f}  polls={polls}"
        )

        results.append({
            "user_id":         user_id,
            "type":            "execution_complete",
            "page":            f"wf:{wf_id}",
            "url":             f"/rest/executions/{exec_id}",
            "method":          "GET",
            "status":          200 if final_status == "success" else 500,
            "duration_ms":     round(exec_total_ms, 1),
            "dom_interactive": final_status,
            "dom_complete":    polls,
            "timestamp":       datetime.now().isoformat(),
        })

    total_ms = (time.perf_counter() - session_start) * 1000
    api_count = sum(1 for r in results if r["user_id"] == user_id and r["type"] == "api")
    print(f"  User {user_id} | Session done in {total_ms:.0f}ms | {api_count} API calls captured")

    await context.close()


def print_summary(results: list) -> None:
    sep = "=" * 75
    print(f"\n{sep}")
    print("SUMMARY")
    print(sep)

    pages   = [r for r in results if r["type"] == "page"]
    apis    = [r for r in results if r["type"] == "api"]
    execs   = [r for r in results if r["type"] == "execution_complete"]
    triggers= [r for r in results if r["type"] == "execution_trigger"]

    # ── Page load timings ──
    print(f"\n  PAGE LOADS")
    print(f"  {'Page':<25}  {'N':>4}  {'Avg (ms)':>10}  {'Max (ms)':>10}")
    print(f"  {'-'*25}  {'-'*4}  {'-'*10}  {'-'*10}")
    by_page = defaultdict(list)
    for r in pages:
        by_page[r["page"]].append(r["duration_ms"])
    for pg, times in by_page.items():
        avg = sum(times) / len(times)
        mx  = max(times)
        flag = "  ⚠️" if avg > 5000 else ""
        print(f"  {pg:<25}  {len(times):>4}  {avg:>10.0f}  {mx:>10.0f}{flag}")

    # ── Workflow execution timings ──
    if triggers or execs:
        print(f"\n  WORKFLOW EXECUTIONS")
        print(f"  {'Metric':<35}  {'N':>4}  {'Avg (ms)':>10}  {'Max (ms)':>10}")
        print(f"  {'-'*35}  {'-'*4}  {'-'*10}  {'-'*10}")

        if triggers:
            t_times = [r["duration_ms"] for r in triggers]
            print(
                f"  {'Trigger latency (POST /run)':<35}  {len(t_times):>4}"
                f"  {sum(t_times)/len(t_times):>10.0f}  {max(t_times):>10.0f}"
            )
        if execs:
            e_times  = [r["duration_ms"] for r in execs]
            success  = sum(1 for r in execs if r["status"] == 200)
            failed   = len(execs) - success
            print(
                f"  {'Total execution time (wall)':<35}  {len(e_times):>4}"
                f"  {sum(e_times)/len(e_times):>10.0f}  {max(e_times):>10.0f}"
            )
            print(f"  Outcomes — success={success}  failed/timeout={failed}")

    # ── Browser-captured API calls ──
    # dom_interactive column holds TTFB (server processing proxy)
    # dom_complete    column holds body download time
    print(f"\n  BROWSER API CALLS  (TTFB = server processing proxy; excludes network travel)")
    print(f"  {'Endpoint':<50}  {'N':>4}  {'Total avg':>10}  {'TTFB avg':>10}  {'Total max':>10}")
    print(f"  {'-'*50}  {'-'*4}  {'-'*10}  {'-'*10}  {'-'*10}")
    by_url: dict[str, dict] = defaultdict(lambda: {"total": [], "ttfb": []})
    for r in apis:
        by_url[r["url"]]["total"].append(r["duration_ms"])
        if isinstance(r.get("dom_interactive"), (int, float)):
            by_url[r["url"]]["ttfb"].append(r["dom_interactive"])
    for url, data in sorted(by_url.items(), key=lambda x: -max(x[1]["total"])):
        total_avg = sum(data["total"]) / len(data["total"])
        total_max = max(data["total"])
        ttfb_avg  = sum(data["ttfb"]) / len(data["ttfb"]) if data["ttfb"] else 0
        flag = "  ⚠️" if total_avg > 2000 else ""
        n = len(data["total"])
        print(f"  {url:<50}  {n:>4}  {total_avg:>10.0f}  {ttfb_avg:>10.0f}  {total_max:>10.0f}{flag}")

    print()


async def main() -> None:
    wf_ids = ", ".join(wid for wid, _ in WORKFLOWS_TO_EXECUTE) or "none"
    print(f"\n{'='*75}")
    print(f"  Browser Load Test — {NUM_USERS} concurrent user(s)")
    print(f"  Target    : {BASE_URL}")
    print(f"  Pages     : {', '.join(label for _, label in PAGES_TO_VISIT)}")
    print(f"  Workflows : {wf_ids}  (each user triggers all)")
    print(f"  Output    : {OUTPUT_CSV}")
    print(f"{'='*75}\n")

    if not LOGIN_PASS:
        print("❌  LOGIN_PASS is empty — set it in the CONFIG block at the top of the script.")
        return

    results: list[dict] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=HEADLESS)

        # All users run truly in parallel.
        # return_exceptions=True means one failing user never crashes the others.
        await asyncio.gather(
            *[run_user_session(browser, i + 1, results) for i in range(NUM_USERS)],
            return_exceptions=True,
        )

        await browser.close()

    # ── Write CSV ──
    fieldnames = [
        "user_id", "type", "page", "url", "method",
        "status", "duration_ms", "dom_interactive", "dom_complete", "timestamp",
    ]
    with open(OUTPUT_CSV, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(results)

    print_summary(results)
    print(f"✅  Full results saved to: {OUTPUT_CSV}\n")


if __name__ == "__main__":
    asyncio.run(main())
