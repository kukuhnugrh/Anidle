# Anidle

Game tebak anime harian untuk saya dan teman-teman. Pool berisi anime *completed* dari list MAL pemain dan anime populer di MAL (≥ 50 rb member), masing-masing dengan difficulty easy/medium/hard. Rencana lengkap: [PLAN.md](PLAN.md).

Status: **M1–M7 selesai**: pipeline data, mode Anidle, media di R2 + mode Opening/Ending, mode Karakter, leaderboard + riwayat + share, mode Screenshot + review media admin, pipeline mingguan di GitHub Actions. Live di https://anidle.velvetaco.dev.

## Akun

- **Tanpa akun**: langsung main. Progres disimpan di browser lewat cookie anonim `anidle_anon`.
- **Akun Anidle** (username + password, hash scrypt): progres ikut ke semua perangkat. Saat daftar/masuk, progres anonim di browser itu dipindah ke akun.
- **Hubungkan MAL** (opsional, butuh akun): membuka pool dari list completed (`teman`, `bareng`, `saya`). Lewat OAuth MAL, jadi list private ikut terbaca. Puzzle harian, pool `semua`, dan `populer` terbuka untuk semua orang.
- Pool bersama (harian, `semua`, `teman`, `bareng`) hanya memakai list `POOL_USERS`. Akun lain yang menghubungkan MAL hanya dapat pool `saya` miliknya, jadi orang asing tidak bisa mengubah puzzle harian.

## Jalan lokal

Butuh **Node 24 LTS** (`.nvmrc`, `engines: 24.x`; Vercel juga menjalankan 24.x). Pakai patch terbaru, minimal 24.22.1, yang berisi perbaikan keamanan 21 Okt 2026 (termasuk CVE-2026-111497 di decoder Brotli). Update dependency keamanan datang otomatis lewat Dependabot (`.github/dependabot.yml`); cek manual dengan `npm audit`.

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
npm run pipeline -- completed enrich   # step tertentu: genres, completed, popular, enrich, franchise, media, characters, screenshots
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
| `media` | Per judul (paling populer dulu): cover MAL → WebP lebar 400 di R2 (`v1/cover/<hash>.webp`, nama = hash isi, cache `immutable`); OP pertama dan ED pertama dari AnimeThemes dicatat saja (URL audio + judul lagu + artis), tidak diunduh. Hasil per judul di tabel `anime_media` (`ok` / `missing` / `broken` / `rejected`); `missing`/`broken` dicoba lagi setelah 30 hari, `rejected` (ditolak admin) hanya dengan `--refresh`. Gangguan jaringan/R2/DB tidak menandai apa pun, judulnya dicoba lagi di run berikutnya. Butuh `R2_*` di `.env`; ffmpeg dari `ffmpeg-static` |
| `characters` | 4 karakter per judul dari jikan-edge (role Main dulu, lalu favorit MAL terbanyak; tanpa gambar placeholder) → WebP lebar 300 di `v1/char/<hash>.webp`, tabel `anime_character`. Judul dengan kurang dari 4 karakter bergambar `missing` dan tidak dipakai mode Character |
| `nicknames` | Nickname + nama kanji karakter yang ditanyakan mode Character (karakter paling terkenal tiap judul) dari jikan-edge `/v1/characters/{id}`, supaya alias ikut diterima |
| `screenshots` | Satu frame dari video OP pertama (seek ke detik 45, lalu 32/58/22 kalau frame gelap, terlalu terang, atau datar) → WebP lebar 960 di `v1/shot/<hash>.webp`, tabel `anime_screenshot`. Hanya judul easy + medium (≥ 200 rb member): satu seek video 1080p ±25 dtk dan beberapa MB |

Bisa dijalankan ulang kapan saja; tidak membuat duplikat. Rate limit: MAL 3 req/dtk, jikan-edge 25 req/10 dtk dan 50 req/menit, AnimeThemes 80 req/menit, dengan retry untuk timeout/429/5xx. Step `media` hanya mengunduh 1,6 MB awal tiap lagu; run pertama untuk ±3.760 judul makan beberapa jam (bandwidth AnimeThemes yang jadi batas).

Hasil run Okt 2026 (1 pemain, `Velvetaco`): 621 completed + 3.701 populer → 3.842 anime, 78 dikecualikan (49 Hentai/Erotica, 29 belum tayang), **3.764 judul bisa dimainkan**: 537 easy, 888 medium, 2.339 hard. Pool harian (easy + medium) ±1.425 judul.

## Game

- **Difficulty** dari jumlah member MAL: **easy** ≥ 500 rb, **medium** 200–500 rb, **hard** < 200 rb (ambang di `shared/catalog.ts`).
- **Harian** (`#/daily`, `#/daily/opening`, `#/daily/ending`, `#/daily/character`, `#/daily/screenshot`): satu puzzle per mode per tanggal WIB untuk semua orang, dipilih deterministik dari pool `semua` **dengan difficulty easy atau medium saja**, dan tidak mengulang jawaban 60 hari terakhir. Disimpan di DB saat pertama diminta, jadi update pool di tengah hari tidak mengubahnya.
- **Difficulty per ronde** (semua mode 3 ronde): ronde 1 dari judul **easy**, ronde 2–3 dari **medium**, untuk harian dan untuk unlimited dengan filter "All" atau "Easy + Medium" (`roundDifficulties` di `shared/modes.ts`). Filter difficulty lain berlaku untuk semua ronde. Kalau slice difficulty itu terlalu kecil (media belum tersalin), ronde itu mengambil dari seluruh pool.
- **Unlimited** (`#/unlimited`): mode apa pun, pool `semua`, `teman`, `bareng`, `saya`, atau `populer`, dengan filter genre (18 genre utama) dan difficulty. Pengaturan terakhir diingat browser. URL `#/play/<id>` bisa di-reload.
- **Anidle**: setiap tebakan dibandingkan dengan jawaban: tipe, tahun ↑↓, season, episode ↑↓, skor ↑↓, source, studio, genre, theme, demographic (cocok/sebagian/beda). 10 tebakan, skor 1000 − 100 per tebakan tambahan.
- **Opening / Ending**: 3 ronde dari franchise berbeda. Lagu diputar **penuh** (bisa di-seek), langsung dari AnimeThemes lewat proxy `GET /api/media?puzzle=&round=&kind=audio|video` (same-origin, jadi nama file AnimeThemes, yang berisi judul anime, tidak terlihat di browser). **Satu tebakan** per ronde: benar 500 poin, benar setelah membuka clue 250, salah atau "Give up" 0. Clue Opening = video opening-nya diputar blur (proxy hanya melayani video setelah pemain membuka clue; kalau video tidak bisa diputar dalam 15 dtk, jatuh ke cover blur). Clue Ending = cover anime blur. Semua lagu di-preload sebelum ronde pertama; kalau satu lagu gagal dimuat ada "Try again", dan di puzzle unlimited milik sendiri ronde yang belum disentuh bisa diganti (`POST /api/puzzle/replace`, difficulty ronde sama).
- **Screenshot**: satu adegan opening, zoom 4× → 2,5× → 1,6× → penuh; tiap tebakan salah atau "Skip" membuka tahap berikutnya, 500/375/250/125 poin.
- **Character**: 3 ronde × 4 karakter dari 4 anime berbeda (hanya seri TV, karakter paling terkenal tiap judul). Per karakter: ketik **nama** (urutan nama bebas, satu bagian nama, nickname, atau nama kanji; toleransi 1 typo per 6 huruf dan ou/o) dan pilih **anime**-nya, masing-masing 3 kesempatan. Nama 75/45/15 poin, anime 50/30/10 (satu franchise dianggap benar), maksimal 500 per ronde. Jawaban per karakter terbuka setelah dua kolomnya selesai; "Give up round" menghabiskan sisa kesempatan ronde itu. Aturan pencocokan di `shared/characters.ts`.
- Satu franchise dianggap benar. Jawaban dicek di server dan baru dikirim ke browser setelah game (atau ronde) selesai. Cover jawaban diambil dari R2 kalau sudah disalin, kalau belum dari CDN MAL.
- **Leaderboard** (`#/leaderboard`, `GET /api/leaderboard?date=`): skor puzzle harian per tanggal WIB, per mode dan total, hanya akun (pemain anonim tidak punya nama). **Riwayat** (`#/riwayat`, `GET /api/history`): per mode jumlah main, persentase tertebak/sempurna, streak harian, rata-rata dan skor terbaik, plus 60 puzzle terakhir (bisa dibuka lagi). **Bagikan hasil**: teks tanpa spoiler ala Wordle (warna per kolom petunjuk / per percobaan ronde), lewat share sheet HP atau clipboard.

## Admin

`#/admin` (hanya akun di `ADMIN_USERS`, username akun Anidle): jumlah media per jenis × status, lalu per judul cover, klip OP/ED, karakter, dan screenshot yang dihasilkan pipeline beserta error-nya. **Tolak** membuat media itu `rejected`: tidak dipakai puzzle baru dan tidak diproses ulang pipeline (kecuali `--refresh`); **Pulihkan** mengembalikannya ke `ok`. File di R2 tidak dihapus. API: `GET/POST /api/admin/media`.

## Pipeline otomatis (GitHub Actions)

`.github/workflows/pipeline.yml` menjalankan semua step tiap Selasa 03:00 WIB ke Turso + R2 (bisa juga manual lewat **Run workflow**, dengan pilihan step dan flag). Antrean `enrich_queue` dari "Sinkron ulang" ikut diproses di step `enrich`. Ringkasan run (jumlah per jenis media + daftar media yang rusak di run itu) muncul di halaman run. Secrets yang dibutuhkan: `MAL_CLIENT_ID`, `MAL_CLIENT_SECRET`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `TOKEN_ENC_KEY`, `POOL_USERS`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

## Database

Halaman `#/database` menampilkan semua judul yang bisa keluar di Anidle (`GET /api/anime`, 48 per halaman; opsi filter dari `GET /api/anime/facets`).

- **Sort**: popularity (member terbanyak), skor, tahun terbaru/terlama, judul A–Z.
- **Filter**: cari judul (romaji/Inggris/Jepang/sinonim), genre, theme, demographic (digabung AND), studio, source, tipe, difficulty.
- Chip studio, source, genre, theme, dan demographic di kartu bisa diklik untuk menambah filter. Filter tersimpan di URL (`#/database?genre=22&sort=score`), jadi bisa dibagikan dan bertahan saat reload.

## Struktur

```
api/        Satu-satunya Vercel Function: router.ts, yang meneruskan setiap /api/* ke routes/
routes/     Handler API (export GET/POST, Web Request/Response), satu file per path: routes/anime/facets.ts = /api/anime/facets
server/     db (libSQL), env, MAL API + OAuth, session/cookie, enkripsi token, logika puzzle
shared/     logika murni + test: aturan pool, normalisasi judul + autocomplete, perbandingan Anidle, franchise
pipeline/   CLI pengisi database + sources/ (jikan-edge) + rate limiter
db/         schema.sql
src/        React app: sidebar (Sidebar.tsx), Beranda (Home.tsx), Anidle.tsx, mode ronde (RoundGame.tsx), Unlimited, Database, Leaderboard, Riwayat (HistoryPage.tsx), Akun & MAL (AccountPage.tsx), Admin (AdminPage.tsx), share.tsx
```

Semua `/api/*` (dan `/oauth/callback`) di-rewrite ke `api/router.ts` oleh `vercel.json`; lokal, plugin di `vite.config.ts` melakukan hal yang sama. Alasannya batas paket Hobby: maksimal 12 Serverless Function per deployment, dan setiap file di `api/` dihitung satu function. Route baru cukup ditambah di `routes/` lalu didaftarkan di `ROUTES` pada `api/router.ts`.

## Perintah

| Perintah | Fungsi |
| --- | --- |
| `npm run dev` | Vite + API di port 3000 |
| `npm test` | Unit test `shared/` |
| `npm run typecheck` | TypeScript |
| `npm run build` | Build frontend ke `dist/` |
| `npm run db:migrate` | Buat/upgrade schema |
| `npm run pipeline` | Isi/update database |
