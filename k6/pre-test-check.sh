#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# pre-test-check.sh — Verifikasi kondisi server sebelum sesi load test skripsi
#
# PENDEKATAN: ALLOWLIST — scan SEMUA proses, identifikasi yang non-esensial.
# Menangkap proses tak terduga (GCP agents, cron job, dsb) bukan hanya yang
# sudah dikenal namanya.
#
# Flow: restart-server → bash pre-test-check.sh → ./stop.sh → ./start.sh → bash sweep-rps.sh
#
# Aturan:
#   - Seluruh Bagian 1, 2, 3: READ-ONLY kecuali langkah kill di [2.4]
#   - Kill selalu butuh konfirmasi y/n — tidak pernah otomatis
#   - Script TIDAK merestart service apapun
# ─────────────────────────────────────────────────────────────────────────────

set -uo pipefail

SCRIPT_PID=$$
SCRIPT_PPID=$PPID

# ═════════════════════════════════════════════════════════════════════════════
# DAFTAR PUTIH — BARIS 27–70
# Script TIDAK AKAN menyentuh proses yang cocok salah satu definisi di sini.
# Edit blok ini jika nama/path proses berubah.
# ═════════════════════════════════════════════════════════════════════════════

# [baris 32–46] COMM: nama executable pendek (max 15 char, tanpa path).
# Prefix match aktif: "systemd" juga menangkap "systemd-journald", dll.
WHITELIST_COMM=(
  # PID 1 + seluruh systemd family via prefix "systemd"
  systemd
  # SSH — KRITIS: jangan pernah matikan
  sshd
  # Shell (session user aktif + script ini sendiri)
  bash sh dash zsh fish ksh ash
  # Privesc & IPC
  sudo su dbus-daemon polkitd
  # Cron & logging (daemon-nya, BUKAN job yang dia spawn)
  cron crond atd rsyslog syslogd
  # Networking
  NetworkManager dhclient dhcpcd
  # OS essentials
  agetty getty login irqbalance multipathd udevd
  # Terminal multiplexer jika user ada session
  screen tmux
  # Infrastruktur sistem yang diuji
  nginx mongod pm2
)

# [baris 49–60] ARGS: pattern dicocokkan ke FULL command line.
# Membedakan node/python milik PM2 (whitelist) vs proses lain.
WHITELIST_ARGS=(
  '/var/www/html/JODY'      # SEMUA PM2 worker + Python ML worker project ini
  'python_worker'           # Python ML worker (safety net)
  '/node_modules/pm2'       # PM2 daemon (berjalan sebagai node, bukan 'pm2')
  '/usr/bin/pm2'            # PM2 jika di /usr/bin
  '/root/.pm2'              # PM2 home dir (God Daemon, log daemon)
  'God Daemon'              # PM2 God Daemon proses
  'PM2 v'                   # PM2 version string di cmdline
  'ecosystem.config.js'     # PM2 membaca ecosystem config
  '/usr/sbin/sshd'          # sshd parent process
  '/usr/sbin/cron'
  '/usr/sbin/rsyslog'
  '/usr/lib/systemd'
  '/usr/lib/openssh'
)

# [baris 63–82] Deskripsi proses yang dikenal — format "keyword=deskripsi".
# Ditampilkan ke user agar bisa mengenali proses asing.
KNOWN_DESC=(
  "google-cloud-ops=Google Cloud Ops Agent (monitoring GCP)"
  "ops-agent=Google Ops Agent (monitoring GCP)"
  "fluent-bit=Fluent Bit log forwarder (GCP)"
  "opentelemetry=OpenTelemetry collector (GCP)"
  "google_guest=Google Guest Agent (GCP VM)"
  "google_osconfi=Google OS Config Agent (GCP)"
  "gce-workload=GCE Workload Certificate (GCP)"
  "stackdriver=Google Stackdriver agent"
  "snapd=Snap package manager daemon"
  "packagekit=PackageKit software updater"
  "unattended-upgr=Unattended upgrades daemon (apt)"
  "ubuntu-advantage=Ubuntu Pro / Advantage daemon"
  "ua-=Ubuntu Advantage daemon"
  "vscode-server=VSCode Remote Server"
  ".vscode-server=VSCode Remote Server"
  "code-server=VSCode code-server"
  "claude=Claude Code / Anthropic AI agent"
  "anthropic=Anthropic agent"
  "copilot=GitHub Copilot"
  "kite=Kite AI autocomplete"
)

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
warn()    { echo -e "${YELLOW}  [WARN]${NC} $*"; }
ok()      { echo -e "${GREEN}  [ OK ]${NC} $*"; }
info()    { echo -e "${BLUE}  [INFO]${NC} $*"; }
fail()    { echo -e "${RED}  [FAIL]${NC} $*"; }
section() {
  echo -e "\n${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BOLD}  $*${NC}"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

VERDICT_OK=true
VERDICT_REASONS=()
add_fail() { VERDICT_OK=false; VERDICT_REASONS+=("$1"); }

CAND_STATUS="tidak dicek"
APT_DAILY_SNAP="tidak dicek"
uptime_min="?"
avail_mb="0"
load_1m="0"

# ─── Whitelist checks ───────────────────────────────────────────────────────

is_white_comm() {
  local name
  name=$(basename "${1:-}")
  local w
  for w in "${WHITELIST_COMM[@]}"; do
    if [[ "$name" == "$w" ]] || [[ "$name" == "${w}"* ]]; then return 0; fi
  done
  return 1
}

is_white_args() {
  local args="${1:-}"
  local p
  for p in "${WHITELIST_ARGS[@]}"; do
    echo "$args" | grep -qF "$p" && return 0
  done
  return 1
}

# ─── Systemd info + cache ───────────────────────────────────────────────────

declare -A _RC=()
declare -A _EC=()

get_unit() {
  local pid="$1" cg=""
  if [[ -f "/proc/$pid/cgroup" ]]; then
    cg=$(grep '^0::' "/proc/$pid/cgroup" 2>/dev/null | sed 's|^0::/||' || true)
    echo "$cg" | grep -qE '\.(service|scope)$' && { basename "$cg"; return; }
    cg=$(grep 'name=systemd:' "/proc/$pid/cgroup" 2>/dev/null \
         | sed 's|.*name=systemd:/||' | grep -oP '[^/]+\.service$' | head -1 || true)
  fi
  echo "${cg:-}"
}

get_restart() {
  local u="$1"
  [[ -z "$u" ]] && echo "none" && return
  [[ -n "${_RC[$u]+x}" ]] && echo "${_RC[$u]}" && return
  local r; r=$(systemctl show "$u" --property=Restart --value 2>/dev/null || echo "unknown")
  _RC["$u"]="$r"; echo "$r"
}

get_enabled() {
  local u="$1"
  [[ -z "$u" ]] && echo "n/a" && return
  [[ -n "${_EC[$u]+x}" ]] && echo "${_EC[$u]}" && return
  local e; e=$(systemctl is-enabled "$u" 2>/dev/null || echo "unknown")
  _EC["$u"]="$e"; echo "$e"
}

get_desc() {
  local full="${1:-} ${2:-}"
  local entry key desc
  for entry in "${KNOWN_DESC[@]}"; do
    key="${entry%%=*}"; desc="${entry#*=}"
    echo "$full" | grep -qiF "$key" && echo "$desc" && return
  done
  echo "(tidak dikenal)"
}

classify() {
  local comm="$1" args="$2" unit="$3" restart="$4" enabled="$5"
  local full="${comm} ${args}"
  if echo "$full" | grep -qiE \
      'google|ops.agent|stackdriver|fluent.bit|opentelemetry|gce|google_guest|google_os'; then
    echo "HATI-HATI"; return
  fi
  if [[ -n "$unit" ]] && \
     [[ "$restart" =~ ^(always|on-failure|on-abnormal|on-watchdog|on-abort)$ ]]; then
    echo "HATI-HATI"; return
  fi
  if [[ -n "$unit" ]] && [[ "$enabled" == "enabled" ]]; then
    echo "PERHATIAN"; return
  fi
  echo "SAFE"
}

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║    PRE-TEST-CHECK — Verifikasi Server Sebelum Load Test Skripsi     ║${NC}"
echo -e "${BOLD}║    Pendekatan: ALLOWLIST — semua non-esensial diidentifikasi        ║${NC}"
echo -e "${BOLD}║    $(date '+%Y-%m-%d %H:%M:%S %Z')                               ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Daftar Putih (baris 32–60) — TIDAK AKAN DISENTUH:${NC}"
echo "    COMM  : ${WHITELIST_COMM[*]:0:10} ..."
echo "    Args  : /var/www/html/JODY | /node_modules/pm2 | ..."
echo "    Extra : PID=$SCRIPT_PID (script ini) + PPID=$SCRIPT_PPID dikecualikan otomatis"

# ═════════════════════════════════════════════════════════════════════════════
# BAGIAN 1 — JOB TERJADWAL
# ═════════════════════════════════════════════════════════════════════════════
section "BAGIAN 1 — JOB TERJADWAL & TIMER SISTEM (READ-ONLY)"

echo -e "\n${BOLD}[1.1] Cron directories:${NC}"
ls -la /etc/cron.d/ /etc/cron.daily/ /etc/cron.hourly/ \
       /etc/cron.weekly/ /etc/cron.monthly/ 2>/dev/null || true

echo -e "\n${BOLD}[1.2] /etc/crontab:${NC}"
cat /etc/crontab 2>/dev/null || echo "  (tidak tersedia)"

echo -e "\n${BOLD}[1.3] Crontab $(whoami):${NC}"
crontab -l 2>/dev/null || echo "  (kosong atau tidak ada)"

echo -e "\n${BOLD}[1.4] Crontab root:${NC}"
sudo crontab -l -u root 2>/dev/null || echo "  (kosong, tidak ada, atau akses ditolak)"

echo -e "\n${BOLD}[1.5] Semua systemd timer:${NC}"
systemctl list-timers --all --no-pager 2>/dev/null || true

echo -e "\n${BOLD}[1.6] Sorot timer berpotensi mengganggu:${NC}"
DANGEROUS_TIMERS=( apt-daily apt-daily-upgrade unattended-upgrades man-db
                   update-motd logrotate fstrim systemd-tmpfiles-clean )
TIMER_FOUND=false

for timer in "${DANGEROUS_TIMERS[@]}"; do
  _ti=$(systemctl list-timers --all --no-pager 2>/dev/null | grep -i "^${timer}" || true)
  if [[ -n "$_ti" ]]; then
    TIMER_FOUND=true
    warn "TIMER DITEMUKAN: ${timer}"
    echo "    $_ti"
    _nx=$(systemctl list-timers "${timer}.timer" --no-pager 2>/dev/null \
          | awk 'NR==2{print $1,$2,$3}' || true)
    [[ -n "$_nx" ]] && echo "    Jadwal berikutnya: $_nx"
    echo ""
    echo "    Cara mask sementara (opsional):"
    echo "      sudo systemctl mask ${timer}.timer"
    echo "    Unmask setelah selesai test:"
    echo "      sudo systemctl unmask ${timer}.timer"
    echo ""
  fi
done
$TIMER_FOUND || ok "Tidak ada timer berbahaya dari daftar monitoring yang aktif."

# ═════════════════════════════════════════════════════════════════════════════
# BAGIAN 2 — KONDISI SERVER & IDENTIFIKASI PROSES NON-ESENSIAL
# ═════════════════════════════════════════════════════════════════════════════
section "BAGIAN 2 — KONDISI SERVER & PROSES NON-ESENSIAL (ALLOWLIST)"

# [2.1] Uptime
echo -e "\n${BOLD}[2.1] Uptime:${NC}"
_ur=$(awk '{print $1}' /proc/uptime)
uptime_min=$(awk "BEGIN{printf \"%.1f\", $_ur/60}")
_us=$(printf "%.0f" "$_ur")
echo "  $(uptime -p 2>/dev/null || uptime)  (${uptime_min} menit)"
if [[ "$_us" -lt 300 ]]; then
  warn "Server baru reboot (< 5 menit) — tunggu sistem stabil."
  add_fail "Uptime < 5 menit"
else
  ok "Uptime ${uptime_min} menit — sistem sudah stabil."
fi

# [2.2] RAM
echo -e "\n${BOLD}[2.2] RAM:${NC}"
free -h
avail_mb=$(free -m | awk '/^Mem:/{print $7}')
echo ""
if [[ "$avail_mb" -lt 1500 ]]; then
  warn "RAM available: ${avail_mb} MB < 1500 MB (batas aman)"
  add_fail "RAM available ${avail_mb} MB < 1500 MB"
else
  ok "RAM available: ${avail_mb} MB"
fi

# [2.3] Load average
echo -e "\n${BOLD}[2.3] Load Average (2 vCPU):${NC}"
_ll=$(cat /proc/loadavg)
load_1m=$(echo "$_ll" | awk '{print $1}')
echo "  /proc/loadavg: $_ll"
_lh=$(awk "BEGIN{print ($load_1m > 0.50) ? \"yes\" : \"no\"}")
if [[ "$_lh" == "yes" ]]; then
  warn "Load 1m = ${load_1m} pada 2 vCPU (idealnya < 0.50 sebelum test)"
  add_fail "Load 1m ${load_1m} > 0.50"
else
  ok "Load 1m = ${load_1m}"
fi

# ── [2.4] Scan SEMUA proses ──────────────────────────────────────────────────
echo -e "\n${BOLD}[2.4] Scan Semua Proses — ALLOWLIST (tampilkan semua non-esensial dulu):${NC}"
echo ""
info "Mengambil snapshot ps — menganalisis setiap proses terhadap whitelist..."
echo ""

PS_SNAP=$(ps --no-headers -e -o pid,user,%cpu,%mem,comm,args 2>/dev/null || true)

CAND_PIDS=(); CAND_USERS=(); CAND_CPUS=(); CAND_MEMS=()
CAND_COMMS=(); CAND_ARGS=()
CAND_UNITS=(); CAND_RESTARTS=(); CAND_ENABLEDS=()
CAND_CLASSES=(); CAND_DESCS=()

while IFS= read -r _line; do
  [[ -z "$_line" ]] && continue

  _pid=$(echo "$_line"  | awk '{print $1}')
  _usr=$(echo "$_line"  | awk '{print $2}')
  _cpu=$(echo "$_line"  | awk '{print $3}')
  _mem=$(echo "$_line"  | awk '{print $4}')
  _cm=$(echo "$_line"   | awk '{print $5}')
  _ar=$(echo "$_line"   | awk '{for(i=6;i<=NF;i++) printf "%s ",$i}' | xargs 2>/dev/null || true)

  if [[ -z "$_ar" ]] || [[ "$_ar" =~ ^\[ ]]; then continue; fi
  [[ "$_pid" == "1" ]] && continue
  if [[ "$_pid" == "$SCRIPT_PID" ]] || [[ "$_pid" == "$SCRIPT_PPID" ]]; then continue; fi

  _cn=$(basename "${_cm:-x}" 2>/dev/null || echo "${_cm:-x}")

  is_white_comm "$_cn" && continue
  is_white_args "$_ar" && continue
  [[ "$_cn" =~ ^systemd ]] && continue

  _unit=$(get_unit "$_pid")
  _rest=$(get_restart "$_unit")
  _enab=$(get_enabled "$_unit")
  _cls=$(classify "$_cn" "$_ar" "$_unit" "$_rest" "$_enab")
  _desc=$(get_desc "$_cn" "$_ar")

  CAND_PIDS+=("$_pid")
  CAND_USERS+=("$_usr")
  CAND_CPUS+=("$_cpu")
  CAND_MEMS+=("$_mem")
  CAND_COMMS+=("$_cn")
  CAND_ARGS+=("${_ar:0:80}")
  CAND_UNITS+=("${_unit:-none}")
  CAND_RESTARTS+=("${_rest:-none}")
  CAND_ENABLEDS+=("${_enab:-n/a}")
  CAND_CLASSES+=("$_cls")
  CAND_DESCS+=("$_desc")

done <<< "$PS_SNAP"

if [[ ${#CAND_PIDS[@]} -eq 0 ]]; then
  ok "Tidak ada proses non-esensial ditemukan. Server sudah bersih."
  CAND_STATUS="bersih"
else
  echo -e "  ${YELLOW}${#CAND_PIDS[@]} proses non-esensial ditemukan — ditampilkan SEBELUM ada yang dimatikan:${NC}"
  echo ""
  echo "  Status:"
  echo -e "    ${RED}HATI-HATI${NC} : auto-restart / monitoring agent — matikan via systemctl, bisa trigger alert"
  echo -e "    ${YELLOW}PERHATIAN${NC} : service enabled — mati sementara, aktif lagi setelah reboot"
  echo -e "    ${GREEN}SAFE     ${NC} : aman dimatikan untuk sesi test ini"
  echo ""

  printf "  %-3s  %-7s  %-12s  %-5s  %-5s  %-22s  %-10s  %-8s  %-9s\n" \
    "#" "PID" "COMM" "%CPU" "%MEM" "UNIT/SERVICE" "RESTART" "ENABLED" "STATUS"
  printf "  %s\n" "──────────────────────────────────────────────────────────────────────────────────────────────────────"

  for _cls_order in "HATI-HATI" "PERHATIAN" "SAFE"; do
    for i in "${!CAND_PIDS[@]}"; do
      [[ "${CAND_CLASSES[$i]}" != "$_cls_order" ]] && continue
      case "$_cls_order" in
        HATI-HATI) _col="$RED" ;;
        PERHATIAN) _col="$YELLOW" ;;
        *)         _col="$GREEN" ;;
      esac
      _us="${CAND_UNITS[$i]}"
      [[ ${#_us} -gt 22 ]] && _us="${_us:0:21}…"
      printf "  %-3s  %-7s  %-12s  %-5s  %-5s  %-22s  %-10s  %-8s  " \
        "$((i+1))" "${CAND_PIDS[$i]}" "${CAND_COMMS[$i]:0:12}" \
        "${CAND_CPUS[$i]}" "${CAND_MEMS[$i]}" "$_us" \
        "${CAND_RESTARTS[$i]:0:10}" "${CAND_ENABLEDS[$i]:0:8}"
      echo -e "${_col}${_cls_order}${NC}  — ${CAND_DESCS[$i]}"
    done
  done

  echo ""
  echo "  Command lines lengkap:"
  for i in "${!CAND_PIDS[@]}"; do
    printf "  [%2d] PID %-7s %s\n" "$((i+1))" "${CAND_PIDS[$i]}" "${CAND_ARGS[$i]}"
  done
  echo ""

  _ns=0; _nh=0; _np=0
  for i in "${!CAND_CLASSES[@]}"; do
    case "${CAND_CLASSES[$i]}" in
      SAFE)      _ns=$((_ns+1)) ;;
      HATI-HATI) _nh=$((_nh+1)) ;;
      PERHATIAN) _np=$((_np+1)) ;;
    esac
  done
  info "Ringkasan: SAFE=$_ns | PERHATIAN=$_np | HATI-HATI=$_nh"
  echo ""

  # ── Kill group SAFE ───────────────────────────────────────────────────────
  SAFE_IDX=()
  for i in "${!CAND_PIDS[@]}"; do
    [[ "${CAND_CLASSES[$i]}" == "SAFE" ]] && SAFE_IDX+=("$i")
  done

  if [[ ${#SAFE_IDX[@]} -gt 0 ]]; then
    echo -e "  ${GREEN}══ SAFE: ${#SAFE_IDX[@]} proses ══${NC}"
    for i in "${SAFE_IDX[@]}"; do
      printf "    [%2d] PID %-7s  %-14s  %s\n" \
        "$((i+1))" "${CAND_PIDS[$i]}" "${CAND_COMMS[$i]}" "${CAND_DESCS[$i]}"
    done
    echo ""
    read -r -p "  Matikan semua proses SAFE di atas? (y/N): " _ans
    if [[ "${_ans:-n}" =~ ^[Yy]$ ]]; then
      for i in "${SAFE_IDX[@]}"; do
        _pid="${CAND_PIDS[$i]}"; _cn="${CAND_COMMS[$i]}"
        if ! [[ "$_pid" =~ ^[0-9]+$ ]] || [[ "$_pid" -le 1 ]]; then
          fail "PID tidak valid untuk $_cn: '$_pid' — dilewati"
          continue
        fi
        if kill "$_pid" 2>/dev/null; then
          ok "PID $_pid ($_cn) — SIGTERM"
        elif sudo kill "$_pid" 2>/dev/null; then
          ok "PID $_pid ($_cn) — SIGTERM (sudo)"
        else
          fail "PID $_pid ($_cn) — gagal. Manual: sudo kill -9 $_pid"
        fi
      done
    else
      info "Proses SAFE dibiarkan berjalan."
      add_fail "Proses SAFE non-esensial masih aktif: $_ns proses"
    fi
    echo ""
  fi

  # ── Kill per-item HATI-HATI ───────────────────────────────────────────────
  for i in "${!CAND_PIDS[@]}"; do
    [[ "${CAND_CLASSES[$i]}" != "HATI-HATI" ]] && continue
    _pid="${CAND_PIDS[$i]}"; _cn="${CAND_COMMS[$i]}"
    _unit="${CAND_UNITS[$i]}"; _rest="${CAND_RESTARTS[$i]}"

    if ! [[ "$_pid" =~ ^[0-9]+$ ]] || [[ "$_pid" -le 1 ]]; then
      fail "PID tidak valid untuk $_cn: '$_pid' — dilewati"
      continue
    fi

    echo -e "  ${RED}══ HATI-HATI [$(( i+1 ))]: PID $_pid — $_cn ══${NC}"
    echo "    Deskripsi     : ${CAND_DESCS[$i]}"
    echo "    Unit          : ${_unit}"
    echo "    Restart policy: ${_rest}  (kill biasa → proses akan auto-restart!)"
    echo "    Enabled       : ${CAND_ENABLEDS[$i]}"
    if [[ "$_unit" != "none" ]] && [[ -n "$_unit" ]]; then
      echo "    Cara aman     : sudo systemctl stop ${_unit}"
      echo "    Catatan: monitoring agent GCP mungkin memicu alert bila dimatikan."
      echo ""
      read -r -p "  Matikan $_cn via 'systemctl stop ${_unit}'? (y/N): " _ah
      if [[ "${_ah:-n}" =~ ^[Yy]$ ]]; then
        sudo systemctl stop "$_unit" 2>/dev/null \
          && ok "$_unit — dihentikan via systemctl stop" \
          || fail "$_unit — gagal. Manual: sudo kill -9 $_pid"
      else
        info "PID $_pid dibiarkan (pilihan Anda)."
      fi
    else
      echo ""
      read -r -p "  Matikan PID $_pid ($_cn) via kill? (y/N): " _ah
      if [[ "${_ah:-n}" =~ ^[Yy]$ ]]; then
        sudo kill "$_pid" 2>/dev/null \
          && ok "PID $_pid — SIGTERM (sudo)" \
          || fail "PID $_pid — gagal. Manual: sudo kill -9 $_pid"
      else
        info "PID $_pid dibiarkan."
      fi
    fi
    echo ""
  done

  # ── Kill per-item PERHATIAN ───────────────────────────────────────────────
  for i in "${!CAND_PIDS[@]}"; do
    [[ "${CAND_CLASSES[$i]}" != "PERHATIAN" ]] && continue
    _pid="${CAND_PIDS[$i]}"; _cn="${CAND_COMMS[$i]}"
    _unit="${CAND_UNITS[$i]}"

    if ! [[ "$_pid" =~ ^[0-9]+$ ]] || [[ "$_pid" -le 1 ]]; then
      fail "PID tidak valid untuk $_cn: '$_pid' — dilewati"
      continue
    fi

    echo -e "  ${YELLOW}══ PERHATIAN [$(( i+1 ))]: PID $_pid — $_cn ══${NC}"
    echo "    Deskripsi : ${CAND_DESCS[$i]}"
    echo "    Unit      : ${_unit}  (enabled — aktif lagi setelah reboot)"
    echo ""
    if [[ "$_unit" != "none" ]] && [[ -n "$_unit" ]]; then
      read -r -p "  Matikan $_cn via 'systemctl stop ${_unit}'? (y/N): " _ap
    else
      read -r -p "  Matikan PID $_pid ($_cn) via kill? (y/N): " _ap
    fi
    if [[ "${_ap:-n}" =~ ^[Yy]$ ]]; then
      if [[ "$_unit" != "none" ]] && [[ -n "$_unit" ]]; then
        sudo systemctl stop "$_unit" 2>/dev/null \
          && ok "$_unit — dihentikan" \
          || { kill "$_pid" 2>/dev/null || sudo kill "$_pid" 2>/dev/null \
               || fail "PID $_pid — gagal. Manual: sudo kill -9 $_pid"; }
      else
        kill "$_pid" 2>/dev/null || sudo kill "$_pid" 2>/dev/null \
          || fail "PID $_pid — gagal. Manual: sudo kill -9 $_pid"
      fi
    else
      info "PID $_pid dibiarkan."
    fi
    echo ""
  done

  CAND_STATUS="ada (${#CAND_PIDS[@]} proses terdeteksi)"
fi

# ── [2.5] Verifikasi ulang ────────────────────────────────────────────────────
echo -e "\n${BOLD}[2.5] Verifikasi Ulang — Scan Kedua (KRUSIAL):${NC}"
sleep 2

echo ""
info "Memverifikasi proses whitelist masih hidup..."
# sshd: exact name + port 22 (dua pengecekan berbeda untuk keamanan KRITIS)
if pgrep -x sshd &>/dev/null || ss -lntp 2>/dev/null | grep -q ':22 '; then
  ok "SSH daemon (sshd) — masih berjalan ✓"
else
  fail "SSH DAEMON tidak ditemukan! Periksa segera."
  add_fail "sshd tidak terdeteksi setelah kill — KRITIS"
fi
# Infrastruktur test: exact comm match saja (-f terlalu longgar)
for _check in "nginx|NGINX" "mongod|MongoDB" "pm2|PM2 daemon"; do
  IFS='|' read -r _proc _lbl <<< "$_check"
  if pgrep -x "$_proc" &>/dev/null; then
    ok "${_lbl} (${_proc}) — masih berjalan ✓"
  else
    info "${_lbl} — tidak ditemukan (normal jika belum ./start.sh)"
  fi
done

echo ""
info "Scan kedua proses non-esensial..."
PS_SNAP2=$(ps --no-headers -e -o pid,user,%cpu,%mem,comm,args 2>/dev/null || true)
_remain=0

while IFS= read -r _line; do
  [[ -z "$_line" ]] && continue
  _pid=$(echo "$_line" | awk '{print $1}')
  _cm=$(echo "$_line"  | awk '{print $5}')
  _ar=$(echo "$_line"  | awk '{for(i=6;i<=NF;i++) printf "%s ",$i}' | xargs 2>/dev/null || true)

  if [[ -z "$_ar" ]] || [[ "$_ar" =~ ^\[ ]]; then continue; fi
  [[ "$_pid" == "1" ]] && continue
  if [[ "$_pid" == "$SCRIPT_PID" ]] || [[ "$_pid" == "$SCRIPT_PPID" ]]; then continue; fi

  _cn=$(basename "${_cm:-x}" 2>/dev/null || echo "${_cm:-x}")
  is_white_comm "$_cn" && continue
  is_white_args "$_ar" && continue
  [[ "$_cn" =~ ^systemd ]] && continue

  _remain=$(( _remain + 1 ))
  [[ $_remain -le 15 ]] && warn "Masih ada: PID $_pid  $_cn  ${_ar:0:60}"
done <<< "$PS_SNAP2"

if [[ $_remain -eq 0 ]]; then
  ok "Scan kedua: bersih — tidak ada proses non-esensial tersisa."
  CAND_STATUS="bersih"
else
  [[ $_remain -gt 15 ]] && fail "(total: $_remain proses, hanya 15 ditampilkan)"
  fail "MASIH ADA $_remain proses non-esensial. Identifikasi dari tabel di atas lalu matikan manual."
  add_fail "$_remain proses non-esensial masih aktif setelah kill"
  CAND_STATUS="MASIH ADA: $_remain proses"
fi

# ═════════════════════════════════════════════════════════════════════════════
# BAGIAN 3 — APT / NGINX / PM2
# ═════════════════════════════════════════════════════════════════════════════
section "BAGIAN 3 — APT, NGINX, PM2"

# [3.1] apt-daily-upgrade
echo -e "\n${BOLD}[3.1] apt-daily-upgrade.service:${NC}"
APT_ACTIVE=$(systemctl is-active apt-daily-upgrade.service 2>/dev/null || echo "unknown")
systemctl status apt-daily-upgrade.service --no-pager -l 2>/dev/null | head -20 || true
echo ""
if [[ "$APT_ACTIVE" == "active" ]]; then
  warn "apt-daily-upgrade SEDANG BERJALAN — makan CPU (kemarin 18 detik saat test)!"
  warn "  sudo systemctl stop apt-daily-upgrade.service"
  warn "  sudo systemctl mask apt-daily-upgrade.timer   (sementara selama test)"
  warn "  sudo systemctl unmask apt-daily-upgrade.timer (setelah selesai)"
  add_fail "apt-daily-upgrade sedang aktif"
  APT_DAILY_SNAP="ACTIVE"
else
  ok "apt-daily-upgrade: ${APT_ACTIVE}"
  APT_DAILY_SNAP="idle (${APT_ACTIVE})"
fi

# [3.2] NGINX error log
echo -e "\n${BOLD}[3.2] NGINX Error Log (30 baris relevan terakhir):${NC}"

NGINX_LOG=""
if command -v nginx &>/dev/null; then
  _cfg=$(nginx -T 2>/dev/null | grep -m1 'error_log' | awk '{print $2}' | tr -d ';' || true)
  [[ -n "$_cfg" ]] && [[ -f "$_cfg" ]] && NGINX_LOG="$_cfg" && info "Path dari nginx -T: $NGINX_LOG"
fi
# Kandidat manual — tambahkan path di sini jika auto-detect gagal (sekitar baris ini)
NGINX_CANDIDATES=( /var/log/nginx/urine-app-error.log /var/log/nginx/error.log )
if [[ -z "$NGINX_LOG" ]]; then
  for _c in "${NGINX_CANDIDATES[@]}"; do
    [[ -f "$_c" ]] && NGINX_LOG="$_c" && info "Path (kandidat manual): $NGINX_LOG" && break
  done
fi

if [[ -z "$NGINX_LOG" ]]; then
  warn "NGINX error log tidak ditemukan otomatis. ls /var/log/nginx/ :"
  ls /var/log/nginx/ 2>/dev/null || echo "  (tidak ditemukan)"
  warn "Tambahkan path ke NGINX_CANDIDATES di script (blok [3.2])."
else
  _nerr=$(grep -iE 'reset|upstream|disabled|timed out|no live|failed' "$NGINX_LOG" 2>/dev/null | tail -30 || true)
  if [[ -z "$_nerr" ]]; then
    ok "Tidak ada crash-restart storm — log bersih dari error upstream/reset/timeout."
  else
    warn "30 baris relevan dari ${NGINX_LOG}:"
    echo "$_nerr" | while IFS= read -r _l; do echo "    $_l"; done
    _nc=$(grep -c -iE 'reset|upstream|disabled|timed out' "$NGINX_LOG" 2>/dev/null || echo 0)
    if [[ "$_nc" -gt 10 ]]; then
      warn "$_nc error recent (threshold 10) — kemungkinan crash storm."
      add_fail "NGINX error log: $_nc error recent"
    fi
  fi
fi

# [3.3] PM2
echo -e "\n${BOLD}[3.3] PM2 Workers (restart count):${NC}"
PM2_BIN=""
if pm2 list &>/dev/null; then
  PM2_BIN="pm2"
elif sudo pm2 list &>/dev/null; then
  PM2_BIN="sudo pm2"
fi

if [[ -z "$PM2_BIN" ]]; then
  info "PM2 tidak berjalan — normal sebelum ./start.sh, lanjutkan."
else
  $PM2_BIN list
  echo ""
  if command -v python3 &>/dev/null; then
    _hr=$($PM2_BIN jlist 2>/dev/null | python3 -c "
import json,sys
try:
    for p in json.load(sys.stdin):
        r = p.get('pm2_env',{}).get('restart_time',0)
        name = p.get('name','?')
        status = p.get('pm2_env',{}).get('status','?')
        if r > 5:
            print(f'    {name:20s}  restart_time={r}  status={status}')
except: pass
" 2>/dev/null || true)
    if [[ -n "$_hr" ]]; then
      warn "Worker restart_time > 5 (kemungkinan crash storm sejak boot):"
      echo "$_hr"
      warn "Lakukan ./stop.sh && ./start.sh untuk reset counter sebelum test."
      add_fail "PM2 restart count tinggi — kemungkinan crash storm"
    else
      ok "PM2 restart count semua worker normal (<= 5)."
    fi
  fi
fi

# ═════════════════════════════════════════════════════════════════════════════
# BAGIAN 4 — VERDICT & SNAPSHOT
# ═════════════════════════════════════════════════════════════════════════════
section "BAGIAN 4 — VERDICT & SNAPSHOT DOKUMENTASI"

echo ""
if $VERDICT_OK; then
  echo -e "${GREEN}${BOLD}  ✓ SIAP TEST — Semua kondisi terpenuhi.${NC}"
  echo ""
  echo "  Lanjutkan dengan:"
  echo "    ./stop.sh && ./start.sh"
  echo "    bash sweep-rps.sh proposed    # atau: bash sweep-rps.sh baseline"
else
  echo -e "${RED}${BOLD}  ✗ JANGAN TEST DULU — ${#VERDICT_REASONS[@]} masalah:${NC}"
  echo ""
  for i in "${!VERDICT_REASONS[@]}"; do
    echo -e "    ${RED}$(( i+1 )). ${VERDICT_REASONS[$i]}${NC}"
  done
  echo ""
  echo "  Selesaikan semua masalah, lalu jalankan ulang script ini untuk konfirmasi."
fi

_VL="$(if $VERDICT_OK; then echo 'SIAP'; else echo "TIDAK SIAP (${#VERDICT_REASONS[@]} masalah)"; fi)"

echo ""
echo "══════════════════════════════════════════════════════════════════════"
echo "  SNAPSHOT SERVER — copy ke catatan skripsi"
echo "══════════════════════════════════════════════════════════════════════"
printf "  Timestamp         : %s\n" "$(date '+%Y-%m-%d %H:%M:%S %Z')"
printf "  Uptime            : %s menit\n"  "$uptime_min"
printf "  RAM available     : %s MB\n"     "$avail_mb"
printf "  Load avg 1m       : %s\n"        "$load_1m"
printf "  Proses non-esens  : %s\n"        "$CAND_STATUS"
printf "  apt-daily-upgrade : %s\n"        "$APT_DAILY_SNAP"
printf "  Verdict           : %s\n"        "$_VL"
echo "══════════════════════════════════════════════════════════════════════"
echo ""
