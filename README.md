# Anidle

Game tebak anime harian untuk saya dan teman-teman. Pool berisi anime *completed* dari list MAL pemain dan top 100 per genre. Rencana lengkap: [PLAN.md](PLAN.md).

Status: **M1 (pipeline data) dan M2 (mode Anidle) selesai, jalan lokal.** Belum di-deploy (M0) dan belum ada media (M3).

## Jalan lokal

Butuh Node 22+.

```bash
npm install
cp .env.example .env          # isi MAL_CLIENT_ID/SECRET, SESSION_SECRET, TOKEN_ENC_KEY, ALLOWED_USERS
npm run pipeline              # isi database lokal data/anidle.db (±10 menit pertama kali)
npm run dev                   # http://localhost:3000
```

Login lokal:
- **OAuth MAL**: App Redirect URL app MAL harus `http://localhost:3000/oauth/callback` (app playground sudah begitu).
- **Tanpa OAuth**: set `ANIDLE_DEV_LOGIN=1`, lalu buka `/api/dev/login?user=<username di ALLOWED_USERS>`. Route ini selalu mati di Vercel.

## Pipeline

```bash
npm run pipeline                       # semua step
npm run pipeline -- completed enrich   # step tertentu: genres, completed, top, enrich, franchise
npm run pipeline -- enrich --refresh   # ambil ulang detail semua judul
npm run pipeline -- enrich --limit=50  # cicil
npm run pipeline -- --turso           # tulis ke Turso: baca .env.turso dulu, lalu .env untuk sisanya
```

| Step | Isi |
| --- | --- |
| `genres` | 78 genre/explicit genre/theme/demographic dari jikan-edge |
| `completed` | List completed setiap `POOL_USERS` (default `ALLOWED_USERS`). Pakai token pemain kalau dia sudah login (list private ikut), kalau belum lewat Client ID (list publik saja) |
| `top` | Top 100 per 18 genre utama dari jikan-edge, urut skor, `members ≥ 30.000`, tanpa Music/CM/PV |
| `enrich` | Detail MAL untuk judul baru / lebih tua dari 30 hari: judul alternatif, cover, tahun, skor, source, studio, genre, relasi. Hentai/Erotica dan music/CM/PV ditandai `excluded` |
| `franchise` | Kelompok prequel/sequel (mis. semua season Shingeki no Kyojin satu franchise) |

Bisa dijalankan ulang kapan saja; tidak membuat duplikat. Rate limit: MAL 3 req/dtk, jikan-edge 25 req/10 dtk dan 50 req/menit, dengan retry untuk timeout/429/5xx.

Hasil run pertama (1 pemain, `Velvetaco`): 621 completed + 1.011 top genre → 1.453 anime, 27 dikecualikan, **pool 1.426 judul**. Avant Garde (34), Gourmet (58), Girls Love (63), dan Boys Love (75) tidak sampai 100 karena ambang 30.000 member.

## Game

- **Anidle harian**: satu jawaban untuk semua orang per tanggal WIB, dipilih deterministik dari pool `semua` dan tidak mengulang jawaban 60 hari terakhir. Disimpan di DB saat pertama diminta, jadi update pool di tengah hari tidak mengubahnya.
- **Unlimited**: pool `semua`, `teman`, `bareng`, `saya`, atau `top` (bisa per genre). URL `#/play/<id>` bisa di-reload.
- Setiap tebakan dibandingkan dengan jawaban: tipe, tahun ↑↓, season, episode ↑↓, skor ↑↓, source, studio, genre, theme, demographic (cocok/sebagian/beda). 10 tebakan, skor 1000 − 100 per tebakan tambahan. Satu franchise dianggap benar.
- Jawaban dicek di server dan baru dikirim ke browser setelah game selesai.

## Struktur

```
api/        Vercel Functions (export GET/POST, Web Request/Response). Lokal dijalankan oleh plugin di vite.config.ts
server/     db (libSQL), env, MAL API + OAuth, session/cookie, enkripsi token, logika puzzle
shared/     logika murni + test: aturan pool, normalisasi judul + autocomplete, perbandingan Anidle, franchise
pipeline/   CLI pengisi database + sources/ (jikan-edge) + rate limiter
db/         schema.sql
src/        React app
```

## Perintah

| Perintah | Fungsi |
| --- | --- |
| `npm run dev` | Vite + API di port 3000 |
| `npm test` | Unit test `shared/` |
| `npm run typecheck` | TypeScript |
| `npm run build` | Build frontend ke `dist/` |
| `npm run db:migrate` | Buat/upgrade schema |
| `npm run pipeline` | Isi/update database |
