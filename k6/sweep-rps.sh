#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# sweep-rps.sh  — RPS sweep to find the maximum stable operating point
#
# !! WARNING !!
# Jalankan script ini dari MESIN PENGUJI TERPISAH — BUKAN dari server aplikasi
# yang menjalankan V1 atau V2. Menjalankan k6 di server yang sama akan
# mengkonsumsi CPU/RAM bersama aplikasi dan menghasilkan data yang tidak valid.
# !! WARNING !!
#
# Runs thesis-load-test.js at increasing RPS values and stops automatically
# when the server is clearly saturated.
#
# Usage (bisa dijalankan dari folder mana saja):
#   bash K6/sweep-rps.sh baseline      ← dari project root
#   bash sweep-rps.sh baseline         ← dari dalam folder k6/
#
# Output JSON dan log tersimpan di folder yang sama dengan script ini (k6/).
#
# Stop conditions (any one triggers):
#   - Error rate  > 15%         (server returning too many errors)
#   - P99 latency > 8000 ms     (latency completely blown up)
#   - 2 consecutive saturated levels
#
# The last level that prints STABLE is the maximum stable RPS for the thesis.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Resolve script's own directory so the script works regardless of where it's called from.
# bash K6/sweep-rps.sh  ← from project root, OR  bash sweep-rps.sh  ← from inside k6/
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DEPLOYMENT="${1:-baseline}"
DURATION="${DURATION:-2m30s}"       # durasi steady-state per level; override: DURATION=3m
WARMUP_DUR="${WARMUP_DUR:-30s}"     # durasi warmup per level
RECOVER_SEC="${RECOVER_SEC:-20}"    # detik jeda antar level
# Internal IP langsung ke server aplikasi — menghindari DNS/internet routing
# Override jika perlu: BASE_URL=https://domain.com bash K6/sweep-rps.sh baseline
BASE_URL="${BASE_URL:-https://10.77.0.2}"

# RPS sequence — sesuaikan dengan hardware server target

# RPS_SEQUENCE=(50 50 100 100 150 150 200 200 250 250 300 300)

# Sweep halus zona transisi — cari titik patah presisi
# RPS_SEQUENCE=(250 260 270 280 290 300)

# Titik pelengkap — 7 run saja (untuk bentuk kurva, bukan statistik)
# RPS_SEQUENCE=(150 150 150 150 150 150 150)
# RPS_SEQUENCE=(300 300 300 300 300 300 300)

# ─────────────────────────────────────────-─────────────────────
# TITIK DATA PADAT — 35 run per titik. Uncomment SATU baris saja.
# Kapasitas server ~250 RPS (4 vCPU). Titik 150-250 di bawah/tepi
# kapasitas (zona perbandingan); 300 = titik saturasi (perilaku jenuh).
# Jalankan SAMA untuk baseline DAN propose, kondisi server identik.
# ───────────────────────────────────────────────────────────────

# RPS_SEQUENCE=(100 100 100 100 100 100 100 100 100 100 100 100 100 100 100 100 100 100 100 100 100 100 100 100 100 100 100 100 100 100 100 100 100 100 100)


# RPS_SEQUENCE=(150 150 150 150 150 150 150 150 150 150 150 150 150 150 150 150 150 150 150 150 150 150 150 150 150 150 150 150 150 150 150 150 150 150 150)

# RPS_SEQUENCE=(200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200)

# RPS_SEQUENCE=(250 250 250 250 250 250 250 250 250 250 250 250 250 250 250 250 250 250 250 250 250 250 250 250 250 250 250 250 250 250 250 250 250 250 250)

# RPS_SEQUENCE=(300 300 300 300 300 300 300 300 300 300 300 300 300 300 300 300 300 300 300 300 300 300 300 300 300 300 300 300 300 300 300 300 300 300 300)

RPS_SEQUENCE=(350 350 350 350 350 350 350 350 350 350 350 350 350 350 350 350 350 350 350 350 350 350 350 350 350 350 350 350 350 350 350 350 350 350 350)

# ─────────────────────────────────────────────────────────────────────────────
# Saturation stop conditions
# ─────────────────────────────────────────────────────────────────────────────
MAX_ERROR_RATE=15       # % — stop if error rate exceeds this
MAX_P99_MS=8000         # ms — stop if P99 exceeds this
CONSECUTIVE_SAT=0       # counter for consecutive saturated levels
MAX_CONSECUTIVE_SAT=9999   # stop after this many consecutive saturated levels

# ─────────────────────────────────────────────────────────────────────────────
# Result log (appended each level) — disimpan di folder yang sama (k6/)
# ─────────────────────────────────────────────────────────────────────────────
LOGFILE="${SCRIPT_DIR}/sweep_${DEPLOYMENT}_$(date +%Y%m%dT%H%M%S).log"
echo "# RPS sweep — deployment=${DEPLOYMENT} — $(date)" | tee "$LOGFILE"
echo "# RPS  | P50(ms) | P99(ms) | ErrorRate% | AchievedRPS | Verdict" | tee -a "$LOGFILE"
echo "# -----+---------+---------+------------+-------------+--------" | tee -a "$LOGFILE"

# ─────────────────────────────────────────────────────────────────────────────
# Main sweep loop
# ─────────────────────────────────────────────────────────────────────────────
for RPS in "${RPS_SEQUENCE[@]}"; do
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Testing ${DEPLOYMENT} at ${RPS} RPS  (duration=${DURATION}, warmup=${WARMUP_DUR})"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # Run k6 from SCRIPT_DIR so JSON summary is written into the same folder
    set +e
    (
        cd "$SCRIPT_DIR"
        k6 run \
            -e DEPLOYMENT="${DEPLOYMENT}" \
            -e BASE_URL="${BASE_URL}" \
            -e TARGET_RPS="${RPS}" \
            -e DURATION="${DURATION}" \
            -e WARMUP_DUR="${WARMUP_DUR}" \
            ${MAX_VUS:+-e MAX_VUS="${MAX_VUS}"} \
            "./thesis-load-test.js"
    )
    K6_EXIT=$?
    set -e

    # Find the most recent JSON result written by thesis-load-test.js
    LATEST_JSON=$(ls -t "${SCRIPT_DIR}/${DEPLOYMENT}_${RPS}rps_"*.json 2>/dev/null | head -n1 || true)

    if [[ -z "$LATEST_JSON" ]]; then
        echo "  [WARN] No result JSON found for RPS=${RPS} — skipping level"
        continue
    fi

    # Extract key metrics from the JSON summary
    P50=$(python3 -c "import json,sys; d=json.load(open('${LATEST_JSON}')); print(d['latency']['p50_ms'])" 2>/dev/null || echo "?")
    P99=$(python3 -c "import json,sys; d=json.load(open('${LATEST_JSON}')); print(d['latency']['p99_ms'])" 2>/dev/null || echo "?")
    ERR=$(python3 -c "import json,sys; d=json.load(open('${LATEST_JSON}')); print(d['errorRate_pct'])" 2>/dev/null || echo "?")
    ARPS=$(python3 -c "import json,sys; d=json.load(open('${LATEST_JSON}')); print(d['throughput']['achievedRPS'])" 2>/dev/null || echo "?")
    VRD=$(python3 -c "import json,sys; d=json.load(open('${LATEST_JSON}')); print(d.get('verdict','?'))" 2>/dev/null || echo "?")

    # Log this level
    printf "  %-5s | %-7s | %-7s | %-10s | %-11s | %s\n" \
        "${RPS}" "${P50}" "${P99}" "${ERR}%" "${ARPS}" "${VRD}" | tee -a "$LOGFILE"

    # ── Saturation detection ─────────────────────────────────────────────────
    SATURATED=false

    # Check error rate threshold
    if [[ "$ERR" != "?" ]]; then
        ERR_INT=$(python3 -c "print(int(float('${ERR}') > ${MAX_ERROR_RATE}))")
        if [[ "$ERR_INT" == "1" ]]; then
            echo "  [STOP] Error rate ${ERR}% > ${MAX_ERROR_RATE}% — saturation"
            SATURATED=true
        fi
    fi

    # Check P99 threshold
    if [[ "$P99" != "?" ]]; then
        P99_INT=$(python3 -c "print(int(float('${P99}') > ${MAX_P99_MS}))")
        if [[ "$P99_INT" == "1" ]]; then
            echo "  [STOP] P99 ${P99}ms > ${MAX_P99_MS}ms — saturation"
            SATURATED=true
        fi
    fi

    # k6 threshold crossing (exit code 99 = threshold failed)
    if [[ $K6_EXIT -ne 0 && "$VRD" == "SATURATED" ]]; then
        echo "  [STOP] k6 thresholds crossed and verdict=SATURATED"
        SATURATED=true
    fi

    if $SATURATED; then
        CONSECUTIVE_SAT=$((CONSECUTIVE_SAT + 1))
        echo "  Consecutive saturated levels: ${CONSECUTIVE_SAT}/${MAX_CONSECUTIVE_SAT}"
        if [[ $CONSECUTIVE_SAT -ge $MAX_CONSECUTIVE_SAT ]]; then
            echo ""
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo "  SWEEP COMPLETE — server saturated at or before ${RPS} RPS"
            echo "  Full results: ${LOGFILE}"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            break
        fi
    else
        CONSECUTIVE_SAT=0
    fi

    # Recovery pause between levels
    if [[ "${RPS}" != "${RPS_SEQUENCE[-1]}" ]]; then
        echo "  Waiting ${RECOVER_SEC}s for server to recover before next level..."
        sleep "${RECOVER_SEC}"
    fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SWEEP SUMMARY"
echo "  Deployment : ${DEPLOYMENT}"
echo "  Log file   : ${LOGFILE}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cat "$LOGFILE"
