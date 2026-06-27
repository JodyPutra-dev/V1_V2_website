# V1 dan V2 Website - U-Detect

Repository ini berisi dua versi deployment aplikasi U-Detect / Urine Disease Detection untuk kebutuhan perbandingan performa skripsi. Kedua versi memakai basis aplikasi yang mirip: React frontend, Node.js/Express microservices, MongoDB, Python worker untuk model ML, dan model `joblib` untuk prediksi batu ginjal.

Perbedaan utama ada di cara deployment backend dijalankan:

- `v1-non-nginx`: baseline tanpa NGINX dan tanpa PM2 cluster.
- `v2-nginx-pm2`: versi optimasi dengan NGINX reverse proxy dan PM2.

## Struktur Folder Utama

| Folder | Isi dan fungsi |
| --- | --- |
| `v1-non-nginx/` | Versi baseline. Service Node.js dijalankan langsung dari `start.sh` memakai proses terpisah dan file PID/log. Cocok untuk membandingkan performa deployment sederhana tanpa reverse proxy dan tanpa clustering. |
| `v2-nginx-pm2/` | Versi optimasi. Service dikelola oleh PM2 dan trafik masuk lewat NGINX. Cocok untuk pengujian deployment production-style dengan load balancing, SSL termination, cache, compression, dan rate limiting di NGINX. |
| `k6/` | Script load test skripsi. Digunakan untuk memberi beban yang sama ke V1 dan V2, menyimpan hasil JSON/log, melakukan pre-test check, dan membersihkan data prediksi hasil test. |
| `ssl/` | Pasangan sertifikat dan private key lokal (`localhost.crt`, `localhost.key`) untuk kebutuhan HTTPS/TLS lokal atau self-signed certificate. |
| `MODEL-ML/` | Model machine learning dan dokumentasi migrasi/retraining model. Folder ini dipakai oleh service ML di V1 dan V2. |

## Ringkasan V1: `v1-non-nginx/`

Folder `v1-non-nginx` adalah versi baseline. Tujuannya adalah menjadi pembanding terhadap V2, sehingga arsitekturnya dibuat lebih sederhana.

Komponen penting:

- `frontend/`: aplikasi React untuk halaman user, admin, dashboard, histori prediksi, upload CSV, dan profil.
- `microservices/`: service backend Node.js, termasuk gateway, user, admin, ML, prediction, cache, resilience, dan MongoDB helper.
- `MODEL-ML/`: model ML yang digunakan service prediksi.
- `IOT/`: kode dan dokumentasi integrasi ESP8266/NodeMCU.
- `ssl/`: sertifikat lokal untuk HTTPS langsung dari Node.js.
- `.env.v1`: konfigurasi runtime V1, termasuk port, MongoDB URI, JWT, Python path, dan path SSL.
- `start.sh` / `stop.sh`: script menjalankan dan menghentikan semua service V1.
- `README.md`: dokumentasi lengkap V1, termasuk detail bottleneck, testing, troubleshooting, dan catatan skripsi.

Pola deployment V1:

```text
Client
  -> Gateway Node.js
  -> User/Admin/ML/Prediction services
  -> MongoDB + Python ML worker
```

Catatan:

- Gateway default HTTP internal ada di port `7764`.
- HTTPS V1 dikendalikan oleh `HTTPS_PORT` di `.env.v1`.
- V1 tidak memakai NGINX sebagai reverse proxy.
- V1 tidak memakai PM2 sebagai process manager utama; service dijalankan langsung oleh script.
- Detail eksperimen dan bottleneck ada di `v1-non-nginx/README.md`.

Menjalankan V1:

```bash
cd v1-non-nginx
npm install
cd frontend && npm install && cd ..
./start.sh
```

Menghentikan V1:

```bash
cd v1-non-nginx
./stop.sh
```

## Ringkasan V2: `v2-nginx-pm2/`

Folder `v2-nginx-pm2` adalah versi optimasi. Versi ini dibuat untuk menunjukkan peningkatan performa dari arsitektur deployment yang lebih siap produksi.

Komponen penting:

- `frontend/`: aplikasi React yang dibuild dan disajikan lewat NGINX.
- `microservices/`: service backend Node.js yang dijalankan lewat PM2.
- `ecosystem.config.js`: konfigurasi PM2 untuk menjalankan beberapa instance service.
- `urine-disease-detection.conf`: konfigurasi NGINX untuk reverse proxy, cache, rate limit, compression, upstream backend, dan SSL.
- `ssl/`: sertifikat lokal cadangan untuk HTTPS.
- `.env.v2`: konfigurasi runtime V2, termasuk port NGINX, port service, MongoDB URI, dan flag HTTPS.
- `start.sh` / `stop.sh`: script menjalankan dan menghentikan NGINX + PM2.
- `README.md`: dokumentasi lengkap V2, termasuk optimasi, monitoring, load balancing, dan troubleshooting.

Pola deployment V2:

```text
Client
  -> NGINX
  -> PM2-managed Node.js services
  -> MongoDB + Python ML worker
```

Optimasi utama V2:

- NGINX menangani SSL termination, static file serving, rate limiting, compression, caching, dan reverse proxy.
- PM2 mengelola proses Node.js, restart, monitoring, dan clustering.
- Backend tidak perlu menangani pekerjaan HTTP-level yang bisa lebih efisien dikerjakan NGINX.
- Request queue dan konfigurasi resource dibuat lebih terkendali untuk beban tinggi.

Catatan port:

- `NGINX_HTTPS_PORT` dan `NGINX_HTTP_PORT` dikonfigurasi di `.env.v2`.
- Konfigurasi NGINX aktual ada di `v2-nginx-pm2/urine-disease-detection.conf`.
- Karena port bisa berubah sesuai deployment server, cek `.env.v2` sebelum menjalankan load test.

Menjalankan V2:

```bash
cd v2-nginx-pm2
npm install
cd frontend && npm install && cd ..
sudo ./start.sh
```

Menghentikan V2:

```bash
cd v2-nginx-pm2
./stop.sh
```

Monitoring V2:

```bash
pm2 list
pm2 logs
pm2 monit
sudo nginx -t
sudo systemctl status nginx
```

## Folder `k6/`

Folder `k6` berisi alat pengujian performa untuk membandingkan V1 dan V2.

File penting:

- `thesis-load-test.js`: skenario utama K6 untuk endpoint prediksi. Menggunakan `constant-arrival-rate`, sehingga V1 dan V2 mendapat tekanan request yang setara.
- `sweep-rps.sh`: menjalankan pengujian berulang pada level RPS tertentu dan menyimpan ringkasan hasil.
- `pre-test-check.sh`: memeriksa kondisi server sebelum load test, seperti RAM, load average, proses non-esensial, NGINX, PM2, dan log error.
- `cleanup-k6-predictions.sh`: mengecek atau menghapus prediction milik user K6 dari MongoDB.
- `cleanup-27m-predictions.sh`: cleanup besar untuk data prediction K6 dalam jumlah sangat banyak, dengan backup dan verifikasi sebelum drop/restore.

Contoh menjalankan load test langsung:

```bash
cd k6
k6 run -e DEPLOYMENT=baseline -e BASE_URL=https://10.77.0.2 -e TARGET_RPS=100 thesis-load-test.js
k6 run -e DEPLOYMENT=proposed -e BASE_URL=https://10.77.0.2 -e TARGET_RPS=100 thesis-load-test.js
```

Contoh menjalankan sweep:

```bash
cd k6
bash sweep-rps.sh baseline
bash sweep-rps.sh proposed
```

Catatan penting untuk pengujian:

- Jalankan K6 dari mesin penguji terpisah, bukan dari server aplikasi, agar CPU/RAM server aplikasi tidak ikut terpakai oleh K6.
- Pastikan `BASE_URL` mengarah ke deployment yang sedang diuji.
- Jalankan V1 dan V2 dengan kondisi server yang sebanding.
- Bersihkan data hasil K6 setelah test jika database dipakai ulang.

## Folder `ssl/`

Folder `ssl` berisi:

- `localhost.crt`: sertifikat lokal/self-signed.
- `localhost.key`: private key untuk sertifikat tersebut.

Ada juga folder `ssl/` di dalam `v1-non-nginx/` dan `v2-nginx-pm2/`. Fungsinya sama: menyediakan sertifikat lokal di dekat deployment masing-masing.

Pemakaian SSL:

- V1 dapat membaca sertifikat dari path di `.env.v1`, lalu fallback ke `v1-non-nginx/ssl/localhost.crt` dan `v1-non-nginx/ssl/localhost.key`.
- V2 umumnya memakai NGINX untuk SSL termination. Path production di konfigurasi NGINX mengarah ke `/etc/nginx/ssl/certificate.crt` dan `/etc/nginx/ssl/private.key`.
- Untuk local/self-signed certificate, browser atau K6 mungkin perlu melewati verifikasi TLS. Script K6 sudah memakai `insecureSkipTLSVerify: true`.

Peringatan:

- Jangan membagikan private key production.
- Untuk server publik, gunakan sertifikat resmi seperti Let's Encrypt.
- Jika mengganti sertifikat, pastikan path di `.env` atau konfigurasi NGINX ikut disesuaikan.

## Perbandingan Singkat V1 dan V2

| Aspek | V1 `v1-non-nginx` | V2 `v2-nginx-pm2` |
| --- | --- | --- |
| Tujuan | Baseline / pembanding | Versi optimasi |
| Reverse proxy | Tidak memakai NGINX | Memakai NGINX |
| Process manager | Script langsung | PM2 |
| Static frontend | Disajikan lewat gateway Node.js | Disajikan lewat NGINX |
| SSL/TLS | Bisa langsung dari Node.js | Diterminasi di NGINX |
| Load balancing | Tidak ada load balancing NGINX | NGINX upstream + PM2 instances |
| Monitoring proses | Log/PID manual | PM2 list, logs, monit |
| Cocok untuk | Eksperimen baseline | Eksperimen optimasi/production-style |

## Alur Pengujian Skripsi yang Disarankan

1. Siapkan database, model ML, Node.js, Python, MongoDB, dan dependency.
2. Jalankan `k6/pre-test-check.sh` di server sebelum sesi test.
3. Jalankan V1 dengan `v1-non-nginx/start.sh`.
4. Jalankan K6 dari mesin penguji untuk baseline.
5. Simpan hasil JSON/log dari folder `k6`.
6. Stop V1 dan bersihkan kondisi server.
7. Jalankan V2 dengan `v2-nginx-pm2/start.sh`.
8. Jalankan K6 dengan parameter yang sama untuk proposed/optimized.
9. Bandingkan latency, throughput, error rate, dan stabilitas.
10. Bersihkan data prediction K6 jika diperlukan.

## Catatan Keamanan

- File `.env.v1` dan `.env.v2` berisi konfigurasi sensitif seperti JWT secret, database URI, dan kredensial email. Ganti sebelum production dan jangan publikasikan ke repository publik.
- Sertifikat di `ssl/` cocok untuk pengujian lokal, bukan jaminan keamanan production.
- Default admin credential di dokumentasi hanya untuk pengujian dan harus diganti sebelum dipakai di server publik.

## Dokumentasi Lanjutan

Baca file berikut untuk detail lebih lengkap:

- `v1-non-nginx/README.md`
- `v2-nginx-pm2/README.md`
- `v2-nginx-pm2/DEPLOYMENT_COMPLETE.md`
- `v1-non-nginx/HYDRATION_ANALYSIS_FEATURE.md`
- `v2-nginx-pm2/HYDRATION_ANALYSIS_FEATURE.md`
- `MODEL-ML/joblib/kidney_stone_model/V2_MIGRATION_GUIDE.md`
- `MODEL-ML/joblib/kidney_stone_model/RETRAIN_V1_MODEL.md`
