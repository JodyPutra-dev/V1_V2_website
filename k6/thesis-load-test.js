/**
 * Thesis Load Test — U-Detect Prediction Endpoint
 *
 * !! WARNING !!
 * Jalankan script ini dari MESIN PENGUJI TERPISAH — BUKAN dari server aplikasi
 * yang menjalankan V1 atau V2. Menjalankan k6 di server yang sama akan
 * mengkonsumsi CPU/RAM bersama aplikasi dan menghasilkan data yang tidak valid
 * untuk keperluan perbandingan performa skripsi.
 * !! WARNING !!
 *
 * Research focus: Performance comparison of Node.js/Express backend
 *   V1 Baseline : Direct Node.js HTTPS, no NGINX, no PM2 (single process)
 *   V2 Proposed : Same backend + NGINX reverse proxy + PM2 clustering (9 workers)
 *
 * Executor: constant-arrival-rate
 *   Sends exactly TARGET_RPS requests per second regardless of server response time.
 *   This is the only fair way to compare two architectures: both receive identical
 *   load pressure. With constant-vus the achieved RPS drops as the server slows down,
 *   making comparisons misleading.
 *
 * Both architectures are accessed via the same external domain on port 443 (HTTPS).
 *   V1 Baseline : Node.js handles TLS on port 443 directly
 *   V2 Proposed : NGINX terminates TLS on port 443, proxies plain HTTP to Node.js
 *
 * Target URL: https://udetect.ebergroup.com  (port 443 implicit)
 * TLS verification disabled via insecureSkipTLSVerify: true
 *
 * Usage (jalankan dari dalam folder k6/ di mesin penguji):
 *
 *   Baseline (V1):
 *   k6 run \
 *     -e DEPLOYMENT=baseline \
 *     -e TARGET_RPS=10 \
 *     -e DURATION=2m30s \
 *     thesis-load-test.js
 *
 *   Proposed (V2):
 *   k6 run \
 *     -e DEPLOYMENT=proposed \
 *     -e TARGET_RPS=10 \
 *     -e DURATION=2m30s \
 *     thesis-load-test.js
 *
 * Untuk sweep otomatis di semua level RPS, gunakan sweep-rps.sh sebagai gantinya.
 *
 * Level RPS yang diuji (sesuai sweep-rps.sh): 10, 20, 30, 40, 50, 60, 70, 80
 * Jalankan setiap level identik antara baseline dan proposed agar hasil comparable.
 */

import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ============================================================
// CONFIGURATION — controlled entirely by environment variables
// ============================================================
const DEPLOYMENT  = __ENV.DEPLOYMENT  || 'baseline';   // label only — appears in output
// Both V1 (Node.js HTTPS direct) and V2 (NGINX HTTPS) listen on port 443 (standard HTTPS).
// For cloud/production testing use the domain with no port (443 is implicit):
//   -e BASE_URL=https://udetect.ebergroup.com
// For local/dev if Node.js is still on 7763 (no setcap):
//   -e BASE_URL=https://localhost:7763
const BASE_URL    = __ENV.BASE_URL    || 'https://10.77.0.2';  // internal IP — bypass DNS/internet routing
const TARGET_RPS  = parseInt(__ENV.TARGET_RPS  || '10');
const WARMUP_DUR  = __ENV.WARMUP_DUR  || '30s';        // short warmup at 25% load
const DURATION    = __ENV.DURATION    || '2m30s';       // steady-state measurement window
// K6 test accounts — created by create-k6-users.sh
// Each VU is assigned one account from this pool to distribute
// MongoDB user-lookup load across multiple documents.
const K6_ACCOUNTS = [
  { email: 'k6user01@udetectupnvj.com', password: 'K6test!01' },
  { email: 'k6user02@udetectupnvj.com', password: 'K6test!02' },
  { email: 'k6user03@udetectupnvj.com', password: 'K6test!03' },
  { email: 'k6user04@udetectupnvj.com', password: 'K6test!04' },
  { email: 'k6user05@udetectupnvj.com', password: 'K6test!05' },
  { email: 'k6user06@udetectupnvj.com', password: 'K6test!06' },
  { email: 'k6user07@udetectupnvj.com', password: 'K6test!07' },
  { email: 'k6user08@udetectupnvj.com', password: 'K6test!08' },
  { email: 'k6user09@udetectupnvj.com', password: 'K6test!09' },
  { email: 'k6user10@udetectupnvj.com', password: 'K6test!10' },
];

// VU sizing.
// The old 60-VU hard cap was set when Python was spawned per request (~200 MB each).
// The persistent worker pool eliminates that concern — there is now exactly ONE
// long-lived Python process regardless of concurrency.
// VUs are now capped only to prevent WSL OOM from k6 itself (each VU is a lightweight
// goroutine but thousands would still exhaust memory).
// Formula: enough VUs to sustain TARGET_RPS even if latency degrades to ~5 s,
// but never more than 300 (safe WSL ceiling).
const REQUEST_TIMEOUT = '10s';
const PRE_VUS         = Math.min(50, Math.max(10, TARGET_RPS * 2));
// Raised hard cap from 300 → 1000.
// At 75 RPS with P99 ~6000ms the harness needs up to 75×10=750 concurrent VUs
// (worst case: timeout seconds × target RPS). The old 300 cap was exhausted,
// making K6 itself the arrival-rate limiter rather than the server.
// K6 goroutines are ~8 KB each — 1000 VUs consumes only ~8 MB of K6 RAM.
// Override from outside with: -e MAX_VUS=500
const MAX_VUS = parseInt(__ENV.MAX_VUS || String(Math.min(TARGET_RPS * 15, 1000)));

// ============================================================
// K6 SCENARIO OPTIONS 
// ============================================================
export const options = {
  // Force k6 to compute p(50) and p(99) for all Trend metrics,
  // not just the default p(90)/p(95). Required for handleSummary to
  // read correct values.
  summaryTrendStats: ['med', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max', 'avg'],

  scenarios: {
    // Warmup: run at 25% of target RPS so the JIT, connection pools,
    // and MongoDB pool warm up before the measurement window starts.
    warmup: {    
      executor: 'constant-arrival-rate',
      rate: Math.max(1, Math.floor(TARGET_RPS / 4)),
      timeUnit: '1s',
      duration: WARMUP_DUR,
      preAllocatedVUs: PRE_VUS,
      maxVUs: MAX_VUS,
      tags: { phase: 'warmup' },
      exec: 'predictOnce',
    },
    // Steady state: the actual measurement window.
    // All thesis metrics are taken from this phase only.
    steady: {
      executor: 'constant-arrival-rate',
      rate: TARGET_RPS,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: PRE_VUS,
      maxVUs: MAX_VUS,
      startTime: WARMUP_DUR,
      tags: { phase: 'steady' },
      exec: 'predictOnce',
    },
  },

  // Thresholds apply across ALL phases; for your thesis, filter to
  // phase:steady in the JSON output or use the custom metrics below.
  thresholds: {
    // Raw k6 HTTP metrics (all phases combined)
    'http_req_duration':              ['p(95)<10000'],   // soft guard, not a pass/fail criterion
    'http_req_failed':                ['rate<0.10'],     // fail the run if >10% errors overall

    // Custom steady-state metrics (thesis primary metrics)
    'prediction_latency{phase:steady}': [
      'p(50)<5000',
      'p(95)<10000',
      'p(99)<15000',
    ],
    'error_rate{phase:steady}': ['rate<0.01'],           // thesis stability criterion: <1% errors
  },

  insecureSkipTLSVerify: true,   // needed for self-signed NGINX TLS cert
  noConnectionReuse: false,      // allow keep-alive — same behaviour as real browsers
};

// ============================================================
// CUSTOM METRICS 
// These are the primary numbers you will report in your thesis.
// ============================================================
// Latency of the prediction endpoint only, tagged by phase
const predictionLatency = new Trend('prediction_latency', true);

// Boolean: 1 = success, 0 = failure; tagged by phase for easy filtering
const errorRate = new Rate('error_rate');

// Count of fully successful predictions (HTTP 2xx + body check)
const successCount = new Counter('success_count');

// Count of failed predictions (any error)
const failureCount = new Counter('failure_count');

// ============================================================
// PREDICTION PAYLOAD POOL
// These match the current prediction-service POST / body format:
//   { parameters: { ph, tds, specificGravity, turbidityNTU,
//                   red, green, blue, turbidityLevel, warnaDasar },
//     notes: "" }
// All numeric fields are realistic urine analysis values.
// Categorical fields use the enum values from the Mongoose schema.
// ============================================================
const PAYLOADS = [
  { ph: 4.91, tds: 725,  specificGravity: 1.021, turbidityNTU: 14.68, red: 255, green: 200, blue: 120, turbidityLevel: 'Jernih',     warnaDasar: 'KUNING'  },
  { ph: 5.74, tds: 577,  specificGravity: 1.017, turbidityNTU: 20.00, red: 240, green: 190, blue: 100, turbidityLevel: 'Jernih',     warnaDasar: 'KUNING'  },
  { ph: 7.20, tds: 321,  specificGravity: 1.008, turbidityNTU: 14.86, red: 220, green: 220, blue: 200, turbidityLevel: 'Jernih',     warnaDasar: 'BENING'  },
  { ph: 5.51, tds: 408,  specificGravity: 1.011, turbidityNTU: 12.45, red: 245, green: 210, blue: 140, turbidityLevel: 'Jernih',     warnaDasar: 'KUNING'  },
  { ph: 6.52, tds: 187,  specificGravity: 1.005, turbidityNTU:  7.50, red: 230, green: 230, blue: 215, turbidityLevel: 'Jernih',     warnaDasar: 'BENING'  },
  { ph: 4.52, tds: 662,  specificGravity: 1.025, turbidityNTU: 25.31, red: 255, green: 180, blue:  90, turbidityLevel: 'Agak Keruh', warnaDasar: 'ORANGE'  },
  { ph: 6.95, tds: 443,  specificGravity: 1.013, turbidityNTU: 12.34, red: 235, green: 215, blue: 160, turbidityLevel: 'Jernih',     warnaDasar: 'KUNING'  },
  { ph: 5.13, tds: 596,  specificGravity: 1.019, turbidityNTU: 19.19, red: 250, green: 195, blue: 110, turbidityLevel: 'Jernih',     warnaDasar: 'KUNING'  },
  { ph: 6.89, tds: 289,  specificGravity: 1.009, turbidityNTU:  9.76, red: 225, green: 220, blue: 195, turbidityLevel: 'Jernih',     warnaDasar: 'BENING'  },
  { ph: 5.68, tds: 502,  specificGravity: 1.015, turbidityNTU: 15.22, red: 248, green: 205, blue: 130, turbidityLevel: 'Jernih',     warnaDasar: 'KUNING'  },
  { ph: 7.01, tds: 234,  specificGravity: 1.007, turbidityNTU:  8.42, red: 215, green: 218, blue: 205, turbidityLevel: 'Jernih',     warnaDasar: 'BENING'  },
  { ph: 4.87, tds: 688,  specificGravity: 1.023, turbidityNTU: 22.14, red: 255, green: 175, blue:  85, turbidityLevel: 'Agak Keruh', warnaDasar: 'ORANGE'  },
  { ph: 6.33, tds: 376,  specificGravity: 1.012, turbidityNTU: 11.58, red: 238, green: 212, blue: 150, turbidityLevel: 'Jernih',     warnaDasar: 'KUNING'  },
  { ph: 5.29, tds: 548,  specificGravity: 1.018, turbidityNTU: 17.83, red: 252, green: 200, blue: 118, turbidityLevel: 'Jernih',     warnaDasar: 'KUNING'  },
  { ph: 6.71, tds: 310,  specificGravity: 1.010, turbidityNTU: 10.45, red: 228, green: 222, blue: 198, turbidityLevel: 'Jernih',     warnaDasar: 'BENING'  },
  { ph: 5.02, tds: 615,  specificGravity: 1.020, turbidityNTU: 18.67, red: 253, green: 192, blue: 105, turbidityLevel: 'Agak Keruh', warnaDasar: 'KUNING'  },
  { ph: 7.12, tds: 201,  specificGravity: 1.006, turbidityNTU:  7.89, red: 210, green: 215, blue: 208, turbidityLevel: 'Jernih',     warnaDasar: 'BENING'  },
  { ph: 5.95, tds: 467,  specificGravity: 1.014, turbidityNTU: 13.76, red: 242, green: 208, blue: 145, turbidityLevel: 'Jernih',     warnaDasar: 'KUNING'  },
  { ph: 4.76, tds: 701,  specificGravity: 1.022, turbidityNTU: 21.49, red: 255, green: 178, blue:  88, turbidityLevel: 'Agak Keruh', warnaDasar: 'ORANGE'  },
  { ph: 6.18, tds: 521,  specificGravity: 1.016, turbidityNTU: 16.02, red: 246, green: 202, blue: 125, turbidityLevel: 'Jernih',     warnaDasar: 'KUNING'  },
];

// ============================================================
// SETUP — runs once before any VU starts.
// Logs in with every K6 account and returns the token pool.
// VUs pick a token by index so login never happens mid-test.
// ============================================================
export function setup() {
  const tokens = [];

  for (const account of K6_ACCOUNTS) {
    const loginRes = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ email: account.email, password: account.password }),
      { headers: { 'Content-Type': 'application/json' }, timeout: '15s' }
    );

    if (loginRes.status === 200 || loginRes.status === 201) {
      try {
        const token = JSON.parse(loginRes.body).token;
        if (token) {
          tokens.push(token);
          console.log(`[SETUP] ✓ ${account.email}`);
        }
      } catch (_) {
        console.warn(`[SETUP] ✗ ${account.email} — could not parse response`);
      }
    } else {
      console.warn(`[SETUP] ✗ ${account.email} — HTTP ${loginRes.status} (run create-k6-users.sh first)`);
    }
  }

  if (tokens.length === 0) {
    throw new Error(
      '[SETUP] No K6 accounts could log in.\n' +
      'Run create-k6-users.sh to create the test accounts first,\n' +
      `then retry. Server: ${BASE_URL}`
    );
  }

  console.log(`[SETUP] ${tokens.length}/${K6_ACCOUNTS.length} accounts ready — deployment=${DEPLOYMENT} target=${TARGET_RPS} rps`);
  return { tokens };
}

// ============================================================
// MAIN FUNCTION — called for every arrival (constant-arrival-rate)
// ============================================================
export function predictOnce(data) {
  // Each VU consistently uses the same account from the pool.
  // __VU is 1-indexed; cycling over the token array distributes
  // MongoDB user-lookup queries across 10 distinct user documents.
  const token  = data.tokens[(__VU - 1) % data.tokens.length];
  const payload = PAYLOADS[(__ITER) % PAYLOADS.length];  // cycle through all payloads

  const res = http.post(
    `${BASE_URL}/api/predict`,
    JSON.stringify({ parameters: payload, notes: '' }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      timeout: REQUEST_TIMEOUT,
      tags: { endpoint: 'predict', deployment: DEPLOYMENT },
    }
  );

  // ---- response validation ----
  let bodyOk = false;
  try {
    const body = JSON.parse(res.body);
    bodyOk = body.success === true;
  } catch (_) {
    bodyOk = false;
  }

  const ok = check(res, {
    'HTTP 2xx':      r => r.status === 200 || r.status === 201,
    'body success':  () => bodyOk,
  });

  // ---- record metrics ----
  predictionLatency.add(res.timings.duration);
  errorRate.add(!ok);

  if (ok) {
    successCount.add(1);
  } else {
    failureCount.add(1);
    // Log one-in-ten failures to avoid flooding stdout under high RPS while still giving
    // enough signal to diagnose the failure cause. Includes HTTP status and body snippet.
    if (__ITER % 10 === 0) {
      const snippet = res.body ? res.body.substring(0, 200) : '(no body — timeout or connection error)';
      console.warn(`[FAIL] iter=${__ITER} vu=${__VU} HTTP ${res.status} — ${snippet}`);
    }
  }
}

// ============================================================
// SUMMARY — printed at the end of the test run
// ============================================================
export function handleSummary(data) {
  const m = data.metrics;

  // Prefer the steady-phase-tagged slice (which thresholds are applied to),
  // fall back to the global metric if the tag key isn't present.
  const latM = m['prediction_latency{phase:steady}'] || m.prediction_latency;
  const p50  = latM?.values['p(50)'] ?? latM?.values['med'] ?? 0;
  const p95  = latM?.values['p(95)'] ?? 0;
  const p99  = latM?.values['p(99)'] ?? 0;
  const pMax = latM?.values['max']   ?? 0;

  const totalReqs    = m.http_reqs?.values.count        ?? 0;
  // NOTE: http_reqs.rate is averaged over the ENTIRE test including warmup and setup,
  // so it will always read lower than TARGET_RPS even on a healthy server.
  // At warmup=25% for 30s and steady for 2m30s the theoretical max is ~88% of TARGET_RPS.
  // This is a metric artifact, not a server shortfall.
  const achievedRPS  = m.http_reqs?.values.rate         ?? 0;
  const errRate      = (m.http_req_failed?.values.rate  ?? 0) * 100;
    const successes    = m.success_count?.values.count    ?? 0;
  const failures     = m.failure_count?.values.count    ?? 0;

  // ── Stability verdict ──────────────────────────────────────────────────────
  // STABLE   : system handles this RPS cleanly — acceptable for thesis comparison
  // DEGRADING: one or more metrics outside acceptable range — note this RPS level
  // SATURATED: clear saturation — do not push higher without addressing the cause
  // Thresholds are deliberately lenient to account for realistic baseline imperfections.
  const isStable     = errRate < 1   && p99 < 1000  && achievedRPS >= TARGET_RPS * 0.70;
  const isDegrading  = errRate <= 5  && p99 < 8000  && achievedRPS >= TARGET_RPS * 0.40;
  const verdict      = isStable ? 'STABLE' : isDegrading ? 'DEGRADING' : 'SATURATED';

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // Output ditulis ke folder yang sama (k6/) — jalankan dari dalam folder k6/
  // Run with: k6 run thesis-load-test.js  (dari dalam folder k6/ di mesin penguji)
  const filename = `${DEPLOYMENT}_${TARGET_RPS}rps_${stamp}.json`;

  const summary = {
    deployment:  DEPLOYMENT,
    baseUrl:     BASE_URL,
    targetRPS:   TARGET_RPS,
    duration:    DURATION,
    warmup:      WARMUP_DUR,
    timestamp:   new Date().toISOString(),
    verdict,
    latency: {
      p50_ms:  Math.round(p50),
      p95_ms:  Math.round(p95),
      p99_ms:  Math.round(p99),
      max_ms:  Math.round(pMax),
    },
    throughput: {
      targetRPS:   TARGET_RPS,
      achievedRPS: parseFloat(achievedRPS.toFixed(2)),
      totalRequests: totalReqs,
      successCount: successes,
      failureCount: failures,
    },
    errorRate_pct: parseFloat(errRate.toFixed(2)),
  };

  console.log(`
┌─────────────────────────────────────────────────────────┐
│  THESIS LOAD TEST RESULTS                               │
├─────────────────────────────────────────────────────────┤
│  Deployment : ${DEPLOYMENT.padEnd(43)} │
│  Target RPS : ${String(TARGET_RPS).padEnd(43)} │
│  Duration   : ${DURATION.padEnd(43)} │
├─────────────────────────────────────────────────────────┤
│  Latency P50  : ${String(Math.round(p50)).padEnd(5)} ms                              │
│  Latency P95  : ${String(Math.round(p95)).padEnd(5)} ms                              │
│  Latency P99  : ${String(Math.round(p99)).padEnd(5)} ms                              │
│  Latency MAX  : ${String(Math.round(pMax)).padEnd(5)} ms                              │
├─────────────────────────────────────────────────────────┤
│  Achieved RPS : ${String(achievedRPS.toFixed(2)).padEnd(43)} │
│  Total Reqs   : ${String(totalReqs).padEnd(43)} │
│  Successes    : ${String(successes).padEnd(43)} │
│  Failures     : ${String(failures).padEnd(43)} │
│  Error Rate   : ${String(errRate.toFixed(2)).padEnd(2)} %                               │
├─────────────────────────────────────────────────────────┤
│  VERDICT      : ${verdict.padEnd(43)} │
└─────────────────────────────────────────────────────────┘
  Result saved → ${filename}
`);

  return {
    [filename]: JSON.stringify(summary, null, 2),
    stdout: '',   // suppress the default k6 summary to keep output clean
  };
}