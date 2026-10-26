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
| `franchise` | Satu **show** per franchise: season, movie, OVA, recap, dan side story yang terhubung lewat relasi MAL `prequel`/`sequel`/`side_story`/`parent_story`/`summary`/`full_story` digabung (spin-off, alternative version/setting tetap terpisah). Entri paling populer (member MAL terbanyak) jadi entri kanonik (`anime.canonical_id`): hanya entri itu yang ditanya, muncul di autocomplete dan halaman Database, dan member-nya menentukan difficulty. Nama season lain tetap bisa dicari di autocomplete; menebak entri mana pun dari franchise itu benar |
| `media` | Per show (entri kanonik, paling populer dulu): cover MAL → WebP lebar 400 di R2 (`v1/cover/<hash>.webp`, nama = hash isi, cache `immutable`); OP pertama dan ED pertama dari AnimeThemes dicatat saja (URL audio + judul lagu + artis), tidak diunduh. Hasil per judul di tabel `anime_media` (`ok` / `missing` / `broken` / `rejected`); `missing`/`broken` dicoba lagi setelah 30 hari, `rejected` (ditolak admin) hanya dengan `--refresh`. Gangguan jaringan/R2/DB tidak menandai apa pun, judulnya dicoba lagi di run berikutnya. Butuh `R2_*` di `.env`; ffmpeg dari `ffmpeg-static` |
| `characters` | 4 karakter per show dari jikan-edge (role Main dulu, lalu favorit MAL terbanyak; tanpa gambar placeholder) → WebP lebar 300 di `v1/char/<hash>.webp`, tabel `anime_character`. Show dengan kurang dari 4 karakter bergambar `missing` dan tidak dipakai mode Character |
| `nicknames` | Nickname + nama kanji karakter yang ditanyakan mode Character (karakter paling terkenal tiap show) dari jikan-edge `/v1/characters/{id}`, supaya karakter juga bisa dicari lewat alias di autocomplete |
| `screenshots` | 3 frame dari video OP pertama (seek ke detik 45, 70, 22, lalu 58/82/32/12/64 kalau frame gelap, terlalu terang, atau datar) → WebP lebar 960 di `v1/shot/<hash>.webp`, tabel `anime_screenshot` (slot 0–2). Frame yang sudah ada dipakai lagi, jadi show yang baru punya 1 frame hanya mencari sisanya; status `ok` baru setelah 3 frame. Hanya show easy + medium (≥ 200 rb member): satu seek video 1080p ±25 dtk dan beberapa MB |

Bisa dijalankan ulang kapan saja; tidak membuat duplikat. Rate limit: MAL 3 req/dtk, jikan-edge 25 req/10 dtk dan 50 req/menit, AnimeThemes 80 req/menit, dengan retry untuk timeout/429/5xx. Step `media` hanya mengunduh 1,6 MB awal tiap lagu; run pertama untuk ±3.760 judul makan beberapa jam (bandwidth AnimeThemes yang jadi batas).

Hasil run Okt 2026 (1 pemain, `Velvetaco`): 621 completed + 3.701 populer → 3.842 anime, 78 dikecualikan (49 Hentai/Erotica, 29 belum tayang), **3.764 judul bisa dimainkan**: 537 easy, 888 medium, 2.339 hard. Pool harian (easy + medium) ±1.425 judul.

## Game

- **Difficulty** dari jumlah member MAL: **easy** ≥ 500 rb, **medium** 200–500 rb, **hard** < 200 rb (ambang di `shared/catalog.ts`).
- **Harian** (`#/daily`, `#/daily/opening`, `#/daily/ending`, `#/daily/character`, `#/daily/screenshot`): satu puzzle per mode per tanggal WIB untuk semua orang, dipilih deterministik dari pool `semua` **dengan difficulty easy atau medium saja**, dan tidak mengulang jawaban 60 hari terakhir. Disimpan di DB saat pertama diminta, jadi update pool di tengah hari tidak mengubahnya.
- **Difficulty per ronde** (semua mode 3 ronde): ronde 1 dari judul **easy**, ronde 2–3 dari **medium**, untuk harian dan untuk unlimited dengan filter "All" atau "Easy + Medium" (`roundDifficulties` di `shared/modes.ts`). Filter difficulty lain berlaku untuk semua ronde. Kalau slice difficulty itu terlalu kecil (media belum tersalin), ronde itu mengambil dari seluruh pool.
- **Unlimited** (`#/unlimited`): mode apa pun, pool `semua`, `teman`, `bareng`, `saya`, atau `populer`, dengan filter genre (18 genre utama) dan difficulty. Pengaturan terakhir diingat browser. URL `#/play/<id>` bisa di-reload.
- **Anidle**: setiap tebakan dibandingkan dengan jawaban: tipe, tahun ↑↓, season, episode ↑↓, skor ↑↓, source, studio, genre, theme, demographic (cocok/sebagian/beda). 10 tebakan, skor 1000 − 100 per tebakan tambahan.
- **Opening / Ending**: 3 ronde dari franchise berbeda. Lagu diputar **penuh** (bisa di-seek), dari AnimeThemes lewat proxy `GET /api/media?puzzle=&round=&kind=audio|video&v=` (same-origin, jadi nama file AnimeThemes, yang berisi judul anime, tidak terlihat di browser; `v` = tag HMAC yang berubah kalau ronde diganti). Ketiga lagu diunduh utuh di background begitu puzzle dibuka (AnimeThemes butuh ±5 dtk sebelum mulai mengirim), ronde langsung tampil dengan "Loading song…"; lagu puzzle harian di-cache CDN Vercel (`s-maxage`), jadi hanya pemain pertama hari itu yang menunggu AnimeThemes. **Satu tebakan** per ronde: benar 500 poin, benar setelah membuka clue 250, salah atau "Give up" 0. Clue = video OP/ED-nya sendiri, blur; Ending juga menampilkan poster (cover) blur di sebelah video. Begitu video siap, video **mengambil alih** dari audio di detik yang sama dengan suaranya sendiri (audio berhenti); play/pause/seek di player mengatur video, klik video = play/pause, klik dua kali atau tombol Fullscreen = layar penuh (player ikut). Proxy hanya melayani video setelah pemain membuka clue; kalau video tidak siap dalam 20 dtk, lagu tetap jalan dan clue tinggal cover blur. Kalau lagu gagal dimuat ada "Try again", dan di puzzle unlimited milik sendiri ronde yang belum disentuh bisa diganti (`POST /api/puzzle/replace`, difficulty ronde sama).
- **Screenshot**: 3 ronde. Mulai dari satu screenshot opening (utuh). Di bawah gambar ada tab clue: "Unlock first clue" (screenshot kedua), "Unlock second clue" (screenshot ketiga), "Unlock title clue" (huruf pertama tiap kata, sisanya `_`, mis. `N_____`; judul Inggris ikut kalau ada), dibuka berurutan kapan saja. Tab screenshot yang sudah terbuka bisa dipilih lagi; petunjuk judul tampil di kotak sendiri di bawah tab, jadi semua screenshot tetap bisa dilihat. **Satu tebakan** per ronde: benar = 500 − 125 per clue yang dibuka, salah atau "Give up" 0. Clue baru dikirim server setelah dibuka.
- Opening, Ending, Character, dan Screenshot menampilkan "Round N" + label difficulty ronde itu (Easy/Medium/Hard) dari awal; Character bisa punya lebih dari satu label kalau anime-nya beda difficulty.
- **Character**: 3 ronde × 4 karakter dari 4 anime berbeda (hanya seri TV, karakter paling terkenal tiap show). Per karakter: pilih **nama** dari autocomplete karakter (`GET /api/characters`: semua karakter di database, dicari lewat nama, nama kanji, atau nickname) dan pilih **anime**-nya dari autocomplete judul. **Satu pilihan** per kolom, tiap kolom benar 62,5 poin (500 / 8), maksimal 500 per ronde. Jawaban per karakter terbuka setelah dua kolomnya terisi; "Give up round" mengisi semua kolom yang tersisa dengan 0.
- Semua tebakan (anime dan nama karakter) lewat autocomplete: memilih saran hanya mengisi kolom, tebakan baru dikirim lewat tombol **Guess** (atau Enter sekali lagi); mengetik ulang membatalkan pilihan.
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
