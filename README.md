# Anidle

Game tebak anime harian untuk saya dan teman-teman. Pool berisi anime *completed* dari list MAL pemain dan anime populer di MAL (≥ 50 rb member), masing-masing dengan difficulty easy/medium/hard. Rencana lengkap: [PLAN.md](PLAN.md).

Status: **M1 (pipeline data) dan M2 (mode Anidle) selesai.** Live di https://anidle.velvetaco.dev. Belum ada media (M3).

## Akun

- **Tanpa akun**: langsung main. Progres disimpan di browser lewat cookie anonim `anidle_anon`.
- **Akun Anidle** (username + password, hash scrypt): progres ikut ke semua perangkat. Saat daftar/masuk, progres anonim di browser itu dipindah ke akun.
- **Hubungkan MAL** (opsional, butuh akun): membuka pool dari list completed (`teman`, `bareng`, `saya`). Lewat OAuth MAL, jadi list private ikut terbaca. Puzzle harian, pool `semua`, dan `populer` terbuka untuk semua orang.
- Pool bersama (harian, `semua`, `teman`, `bareng`) hanya memakai list `POOL_USERS`. Akun lain yang menghubungkan MAL hanya dapat pool `saya` miliknya, jadi orang asing tidak bisa mengubah puzzle harian.

## Jalan lokal

Butuh Node 22+.

```bash
npm install
cp .env.example .env          # isi MAL_CLIENT_ID/SECRET, SESSION_SECRET, TOKEN_ENC_KEY, POOL_USERS
npm run pipeline              # isi database lokal data/anidle.db (±10 menit pertama kali)
npm run dev                   # http://localhost:3000
```

Menghubungkan MAL di lokal butuh App Redirect URL app MAL `http://localhost:3000/oauth/callback` (app playground sudah begitu).

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
| `completed` | List completed setiap `POOL_USERS` dan setiap akun yang menghubungkan MAL. Pakai token MAL-nya kalau ada (list private ikut), kalau tidak lewat Client ID (list publik saja) |
| `popular` | Ranking popularitas resmi MAL (`ranking_type=bypopularity`) sampai `members ≥ 50.000`, tanpa Music/CM/PV |
| `enrich` | Detail MAL untuk judul baru / lebih tua dari 30 hari: judul alternatif, cover, tahun, skor, jumlah member, source, studio, genre, relasi. Hentai/Erotica, music/CM/PV, dan judul yang belum tayang ditandai `excluded` (judul belum tayang masuk lagi setelah tayang, pada enrich berikutnya) |
| `franchise` | Kelompok prequel/sequel (mis. semua season Shingeki no Kyojin satu franchise) |

Bisa dijalankan ulang kapan saja; tidak membuat duplikat. Rate limit: MAL 3 req/dtk, jikan-edge 25 req/10 dtk dan 50 req/menit, dengan retry untuk timeout/429/5xx.

Hasil run Okt 2026 (1 pemain, `Velvetaco`): 621 completed + 3.701 populer → 3.842 anime, 78 dikecualikan (49 Hentai/Erotica, 29 belum tayang), **3.764 judul bisa dimainkan**: 537 easy, 888 medium, 2.339 hard. Pool harian (easy + medium) ±1.425 judul.

## Game

- **Difficulty** dari jumlah member MAL: **easy** ≥ 500 rb, **medium** 200–500 rb, **hard** < 200 rb (ambang di `shared/catalog.ts`).
- **Anidle harian**: satu jawaban untuk semua orang per tanggal WIB, dipilih deterministik dari pool `semua` **dengan difficulty easy atau medium saja**, dan tidak mengulang jawaban 60 hari terakhir. Disimpan di DB saat pertama diminta, jadi update pool di tengah hari tidak mengubahnya.
- **Unlimited**: pool `semua`, `teman`, `bareng`, `saya`, atau `populer`, dengan filter genre (18 genre utama) dan difficulty. Pengaturan terakhir diingat browser. URL `#/play/<id>` bisa di-reload.
- Setiap tebakan dibandingkan dengan jawaban: tipe, tahun ↑↓, season, episode ↑↓, skor ↑↓, source, studio, genre, theme, demographic (cocok/sebagian/beda). 10 tebakan, skor 1000 − 100 per tebakan tambahan. Satu franchise dianggap benar.
- Jawaban dicek di server dan baru dikirim ke browser setelah game selesai.

## Database

Halaman `#/database` menampilkan semua judul yang bisa keluar di Anidle (`GET /api/anime`, 48 per halaman; opsi filter dari `GET /api/anime/facets`).

- **Sort**: popularity (member terbanyak), skor, tahun terbaru/terlama, judul A–Z.
- **Filter**: cari judul (romaji/Inggris/Jepang/sinonim), genre, theme, demographic (digabung AND), studio, source, tipe, difficulty.
- Chip studio, source, genre, theme, dan demographic di kartu bisa diklik untuk menambah filter. Filter tersimpan di URL (`#/database?genre=22&sort=score`), jadi bisa dibagikan dan bertahan saat reload.

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
