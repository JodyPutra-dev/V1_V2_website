"""
Uji Signifikansi Statistik — Mann-Whitney U
Skripsi: Implementasi Reverse Proxy NGINX dan PM2 pada Backend Node.js (U-Detect)
Muhammad Jody Putra Islami — 2210511018

Tujuan: menguji apakah perbedaan latensi (P50, P95, P99) dan error rate
antara arsitektur baseline (V1) dan usulan (V2) signifikan secara statistik,
bukan sekadar berbeda secara numerik.

Metode: Mann-Whitney U (non-parametrik), dipilih karena uji normalitas
Shapiro-Wilk menunjukkan distribusi tidak normal akibat tail latency.
Data: 35 run per titik beban (isolated repeat).
"""

from scipy import stats
import numpy as np

# ============================================================
# DATA 35 RUN PER TITIK (dari hasil pengujian k6, sesi final)
# ============================================================

data = {
    "100_RPS": {
        "P50": {
            "V1": [12]*34 + [12],  # seluruh run P50 = 12
            "V2": [12] + [11]*34,
        },
        "P95": {
            "V1": [44,14,14,14,14,14,14,13,13,13,13,14,13,14,14,14,15,14,14,14,14,14,16,13,14,14,14,13,14,13,13,27,13,14,17],
            "V2": [14,13,13,12,12,12,12,12,12,13,13,13,12,12,12,12,13,12,12,12,12,13,12,12,12,12,12,12,12,12,12,12,13,13,13],
        },
        "P99": {
            "V1": [478,17,18,17,17,18,18,17,17,17,15,17,16,18,17,19,19,17,17,17,18,18,19,16,118,19,17,16,17,16,16,43,16,17,22],
            "V2": [17,15,15,15,15,14,14,15,13,16,16,16,14,16,14,15,15,15,14,15,15,15,14,14,16,14,13,14,14,14,14,14,15,16,14],
        },
    },
    "250_RPS": {
        "P50": {
            "V1": [44,27,39,32,36,26,27,32,27,26,24,29,23,21,23,22,26,20,23,23,21,22,20,20,20,22,21,22,19,23,22,113,25,23,23],
            "V2": [18,17,18,18,19,20,18,18,18,18,18,18,18,19,18,18,18,19,18,18,18,18,18,18,18,18,17,18,18,18,17,17,18,17,18],
        },
        "P95": {
            "V1": [420,113,9945,81,108,83,89,84,83,101,77,97,73,72,94,80,99,68,91,66,72,187,73,65,67,137,77,102,61,72,80,9972,79,74,105],
            "V2": [35,29,34,30,32,42,32,30,35,31,33,32,30,782,29,34,33,172,33,30,31,32,30,38,33,29,32,34,31,35,30,27,32,28,38],
        },
        "P99": {
            "V1": [620,216,10000,122,186,159,149,121,138,168,116,160,124,113,144,155,163,132,158,119,142,1663,135,127,137,250,138,176,115,135,147,10000,147,141,177],
            "V2": [85,88,84,56,60,128,99,89,96,74,121,106,82,2257,98,120,136,529,111,103,121,109,92,151,163,106,116,167,143,134,129,98,123,96,216],
        },
        "Error": {
            "V1": [0.03,0,5.63,0.01,0,0,0.04,0,0,0.01,0,0.09,0,0,0.01,0.01,0.08,0.01,0,0.01,0.03,0.14,0.01,0.03,0.02,0.02,0.06,0.02,0.02,0.01,0.03,5.87,0.02,0.04,0.02],
            "V2": [0.08,0,0.07,0,0,0,0,0,0,0,0,0,0,0.42,0,0,0,0,0,0.06,0.03,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
        },
    },
}

# ============================================================
# FUNGSI UJI
# ============================================================

def rank_biserial(u, n1, n2):
    """Ukuran efek untuk Mann-Whitney U."""
    return abs(1 - (2 * u) / (n1 * n2))

def uji_mannwhitney(v1, v2):
    u, p = stats.mannwhitneyu(v1, v2, alternative='two-sided')
    return {
        "median_V1": np.median(v1),
        "median_V2": np.median(v2),
        "U": u,
        "p": p,
        "effect": rank_biserial(u, len(v1), len(v2)),
        "signifikan": p < 0.05,
    }

def uji_normalitas(data):
    w, p = stats.shapiro(data)
    return {"W": w, "p": p, "normal": p >= 0.05}

# ============================================================
# JALANKAN & CETAK
# ============================================================

print("="*70)
print("UJI NORMALITAS (Shapiro-Wilk) — justifikasi penggunaan non-parametrik")
print("="*70)
for titik in data:
    for metrik in data[titik]:
        for arch in ["V1", "V2"]:
            r = uji_normalitas(data[titik][metrik][arch])
            status = "normal" if r["normal"] else "TIDAK normal"
            print(f"  {titik} {metrik} {arch}: W={r['W']:.3f}, p={r['p']:.2e} ({status})")
    break  # cukup tampilkan satu titik sebagai contoh

print()
print("="*70)
print("UJI MANN-WHITNEY U (two-sided, alpha=0.05)")
print("="*70)
for titik in data:
    print(f"\n--- {titik.replace('_',' ')} ---")
    for metrik in data[titik]:
        r = uji_mannwhitney(data[titik][metrik]["V1"], data[titik][metrik]["V2"])
        pstr = "< 0.001" if r["p"] < 0.001 else f"{r['p']:.4f}"
        sig = "SIGNIFIKAN" if r["signifikan"] else "tidak signifikan"
        print(f"  {metrik:6s}: median V1={r['median_V1']:.1f}, V2={r['median_V2']:.1f} | "
              f"U={r['U']:.0f} | p={pstr} | effect={r['effect']:.2f} | {sig}")