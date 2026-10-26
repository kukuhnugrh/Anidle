# Anidle

Game tebak anime harian untuk saya dan teman-teman. Pool berisi anime *completed* dari list MAL pemain dan anime populer di MAL (≥ 50 rb member), masing-masing dengan difficulty easy/medium/hard. Rencana lengkap: [PLAN.md](PLAN.md).

Status: **M1–M7 selesai**: pipeline data, mode Anidle, media di R2 + mode Opening/Ending, mode Karakter, leaderboard + riwayat + share, mode Screenshot + review media admin, pipeline mingguan di GitHub Actions. Live di https://anidle.velvetaco.dev.

## Akun

- **Tanpa akun**: langsung main. Progres disimpan di browser lewat cookie anonim `anidle_anon`.
- **Akun Anidle** (username + password, hash scrypt): progres ikut ke semua perangkat. Saat daftar/masuk, progres anonim di browser itu dipindah ke akun.
- **Masuk dengan MAL** ("Continue with MyAnimeList" di `/masuk`, lewat OAuth MAL): kalau akun MAL itu sudah terhubung ke akun Anidle, langsung masuk ke akun itu; kalau belum, dibuatkan akun Anidle tanpa password bernama username MAL (karakter selain huruf/angka/`_` jadi `_`, diberi akhiran acak kalau sudah dipakai). Akun seperti ini hanya bisa masuk lewat MAL, jadi MAL-nya tidak bisa di-unlink. List completed langsung di-sync tiap kali masuk.
- **Hubungkan MAL** (untuk akun username + password): membuka pool dari list completed (`teman`, `bareng`, `saya`). Lewat OAuth MAL, jadi list private ikut terbaca. Puzzle harian, pool `semua`, dan `populer` terbuka untuk semua orang.
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
npm run pipeline -- completed enrich   # step tertentu: genres, completed, popular, enrich, synopsis, franchise, media, characters, nicknames, screenshots
npm run pipeline -- enrich --refresh   # ambil ulang detail semua judul
npm run pipeline -- enrich --limit=50  # cicil
npm run pipeline -- --turso           # tulis ke Turso: baca .env.turso dulu, lalu .env untuk sisanya
```

| Step | Isi |
| --- | --- |
| `genres` | 78 genre/explicit genre/theme/demographic dari jikan-edge |
| `completed` | List completed setiap `POOL_USERS` dan setiap akun yang menghubungkan MAL. Pakai token MAL-nya kalau ada (list private ikut), kalau tidak lewat Client ID (list publik saja) |
| `popular` | Ranking popularitas resmi MAL (`ranking_type=bypopularity`) sampai `members ≥ 50.000`, tanpa Music/CM/PV |
| `enrich` | Detail MAL untuk judul baru / lebih tua dari 30 hari: judul alternatif, cover, tahun, skor, jumlah member, source, studio, genre, relasi, sinopsis. Hentai/Erotica, music/CM/PV, dan judul yang belum tayang ditandai `excluded` (judul belum tayang masuk lagi setelah tayang, pada enrich berikutnya) |
| `synopsis` | Sinopsis MAL (`anime.synopsis`, clue kedua Anidle) untuk show yang di-enrich sebelum sinopsis disimpan; `''` = MAL tidak punya. Setelah itu `enrich` yang menjaganya tetap baru |
| `franchise` | Satu **show** per franchise: season, movie, OVA, recap, dan side story yang terhubung lewat relasi MAL `prequel`/`sequel`/`side_story`/`parent_story`/`summary`/`full_story` digabung (spin-off, alternative version/setting tetap terpisah). Entri paling populer (member MAL terbanyak) jadi entri kanonik (`anime.canonical_id`): hanya entri itu yang ditanya, muncul di autocomplete dan halaman Database, dan member-nya menentukan difficulty. Nama season lain tetap bisa dicari di autocomplete; menebak entri mana pun dari franchise itu benar |
| `media` | Per show (entri kanonik, paling populer dulu): cover MAL → WebP lebar 400 di R2 (`v1/cover/<hash>.webp`, nama = hash isi, cache `immutable`); OP pertama dan ED pertama dari AnimeThemes dicatat saja (URL audio + judul lagu + artis), tidak diunduh. Hasil per judul di tabel `anime_media` (`ok` / `missing` / `broken` / `rejected`); `missing`/`broken` dicoba lagi setelah 30 hari, `rejected` (ditolak admin) hanya dengan `--refresh`. Gangguan jaringan/R2/DB tidak menandai apa pun, judulnya dicoba lagi di run berikutnya. Butuh `R2_*` di `.env`; ffmpeg dari `ffmpeg-static` |
| `characters` | Per show, sampai 3 karakter paling terkenal per **difficulty karakter** (dari favorit MAL karakter itu sendiri: easy ≥ 5.000, medium 500–4.999, hard 100–499; di bawah 100 tidak disimpan) dari jikan-edge, tanpa gambar placeholder → WebP lebar 300 di `v1/char/<hash>.webp`, tabel `anime_character` (slot 0 = paling terkenal). Show dengan kurang dari 2 karakter `missing`. Nickname yang sudah diambil ikut terbawa saat diulang. Semua karakter ≥ 100 favorit show itu (bukan hanya yang disimpan) dicatat di `character_show`: Character mode menerima show mana pun tempat karakter itu muncul |
| `nicknames` | Nickname **romaji** semua karakter tersimpan (paling terkenal dulu) dari jikan-edge `/v1/characters/{id}`, supaya karakter juga bisa dicari lewat alias di autocomplete. Nickname kana/kanji/hangul dibuang (`isRomaji`): nama karakter dijawab dalam romaji saja |
| `screenshots` | 3 frame dari video OP pertama (seek ke detik 45, 70, 22, lalu 58/82/32/12/64 kalau frame gelap, terlalu terang, atau datar) → WebP lebar 960 di `v1/shot/<hash>.webp`, tabel `anime_screenshot` (slot 0–2). Frame yang sudah ada dipakai lagi, jadi show yang baru punya 1 frame hanya mencari sisanya; status `ok` baru setelah 3 frame. Hanya show easy + medium (≥ 200 rb member): satu seek video 1080p ±25 dtk dan beberapa MB |
| `clips` | Clue Opening/Ending sebagai klip kecil: video OP/ED (versi terkecil di AnimeThemes, `anime_media.video_url`, dicatat step `media`) di-encode ulang jadi 240p H.264 tanpa suara (±1–2,5 MB, bukan 30–60 MB) → `v1/clip/<hash>.mp4`, kolom `clip_key`. Hanya show easy + medium (kuota R2 gratis 10 GB); lagu lain tetap di-stream lewat `/api/media`. Klip yang gagal dibuat ditandai `''` dan di-stream juga |
| `daily` | Menyiapkan Opening/Ending hari ini (UTC+7) sebelum pemain datang: membuat puzzle harian kalau belum ada, menyalin lagu penuh tiap ronde ke R2 (`v1/song/<hash>.ogg`, kolom `puzzle_round.audio_key`; nama = hash isi, jadi judul tidak bocor) dan membuat klip clue yang belum ada. Pemain lalu streaming dari Cloudflare (±50 ms ke byte pertama) alih-alih menunggu AnimeThemes ±5 dtk per lagu. Salinan yang lebih tua dari 7 hari dihapus (kuota R2), ronde tanpa salinan tetap lewat `/api/media`. Dijalankan tiap hari 00:05 UTC+7 oleh `.github/workflows/daily.yml` (bisa juga manual); `daily:reroll` ikut menghapus salinan puzzle yang dibuang |

Bisa dijalankan ulang kapan saja; tidak membuat duplikat. Rate limit: MAL 3 req/dtk, jikan-edge 25 req/10 dtk dan 50 req/menit, AnimeThemes 80 req/menit, dengan retry untuk timeout/429/5xx. Step `media` hanya mengunduh 1,6 MB awal tiap lagu; run pertama untuk ±3.760 judul makan beberapa jam (bandwidth AnimeThemes yang jadi batas).

Hasil run Okt 2026 (1 pemain, `Velvetaco`): 621 completed + 3.701 populer → 3.842 anime, 78 dikecualikan (49 Hentai/Erotica, 29 belum tayang), **3.764 judul bisa dimainkan**: 537 easy, 888 medium, 2.339 hard. Pool harian (easy + medium) ±1.425 judul.

## Game

- **Difficulty** dari jumlah member MAL: **easy** ≥ 500 rb, **medium** 200–500 rb, **hard** < 200 rb (ambang di `shared/catalog.ts`).
- **URL** bersih (History API, `src/route.ts`): `/`, `/daily`, `/play/<id>`, `/database?…`; link di dalam app pindah halaman tanpa reload (kecuali `/api/*` dan `/oauth/*`, yang memang ke server), back/forward jalan, dan `vercel.json` menyajikan `index.html` untuk path lain (file statis dan API tetap duluan). Link lama `/#/…` otomatis diubah ke path-nya.
- **Harian** (`/daily`, `/daily/opening`, `/daily/ending`, `/daily/character`, `/daily/screenshot`): satu puzzle per mode per tanggal **UTC+7** (ganti hari 00:00 UTC+7, `todayUtc7`; di UI ditulis "UTC+7") untuk semua orang, dipilih deterministik dari pool `semua` **dengan difficulty easy atau medium saja**, dan tidak mengulang jawaban 60 hari terakhir. Disimpan di DB saat pertama diminta, jadi update pool di tengah hari tidak mengubahnya. Di atas tiap puzzle harian ada bar: "← <hari itu>" kembali ke Home di tanggal yang sama, plus chip lima mode **hari itu** (puzzle arsip tetap di tanggalnya); puzzle unlimited punya "← Unlimited".
- **Difficulty per ronde** (semua mode 3 ronde): ronde 1 dari judul **easy**, ronde 2–3 dari **medium**, untuk harian dan untuk unlimited dengan filter "All" atau "Easy + Medium" (`roundDifficulties` di `shared/modes.ts`). Filter difficulty lain berlaku untuk semua ronde. Kalau slice difficulty itu terlalu kecil (media belum tersalin), ronde itu mengambil dari seluruh pool.
- **Unlimited** (`/unlimited`): mode apa pun, pool `semua`, `teman`, `bareng`, `saya`, atau `populer`, dengan filter genre (18 genre utama) dan difficulty. Pengaturan terakhir diingat browser. URL `/play/<id>` bisa di-reload.
- **Skor**: tiap mode maksimal **20.000** per puzzle, jadi 5 puzzle harian = **100.000** sehari (`MODE_MAX_POINTS`, `DAILY_MAX_POINTS` di `shared/modes.ts`). Mode 3 ronde: ronde 1 (easy) 6.000, ronde 2–3 (medium) 7.000. Sidebar menampilkan "Today's score" (jumlah skor puzzle harian hari ini) dan skor tiap mode di samping nama mode begitu puzzle harian mode itu selesai (`GET /api/me` → `today.score`, `today.modes`); Home menampilkan skor hari yang dipilih.
- **Arsip**: Home punya pemilih tanggal (← tanggal →, klik tanggal = kalender, "Today") untuk memainkan puzzle harian hari sebelumnya (sejak `FIRST_DAILY_DATE`, 25 Oktober 2026; `GET /api/puzzle?mode=&date=`, puzzle yang belum ada dibuat saat pertama dibuka, tanpa jawaban yang sama dalam ±60 hari). Main ulang hanya untuk seru: leaderboard, streak, dan statistik riwayat hanya menghitung puzzle yang selesai di harinya sendiri (UTC+7).
- **Anidle**: setiap tebakan dibandingkan dengan jawaban: tahun ↑↓, skor ↑↓, source, studio, genre, tags (theme + demographic MAL digabung; cocok/sebagian/beda). **16 percobaan**; clue terbuka sendiri seiring percobaan bertambah: setelah 10 poster anime-nya (cover) blur, setelah 13 sinopsis MAL (judulnya disamarkan `▇▇▇`, `maskSynopsis`), setelah 15 dua karakter paling terkenal, lalu percobaan ke-16 yang terakhir. Tombol **Skip** langsung lompat ke clue berikutnya dan memakai semua percobaan sampai clue itu tanpa menebak (dikonfirmasi dulu; di `play.guesses` tersimpan sebagai `0`, tampil sebagai satu baris "Skipped N tries", di share `⏭️ ×N`). Skor 20.000 − 1.250 per percobaan tambahan, skip ikut dihitung (1.250 di percobaan ke-16), 0 kalau tidak tertebak.
- **Opening / Ending**: 3 ronde dari franchise berbeda. Lagu diputar **penuh** (bisa di-seek). Puzzle harian: dari salinan R2 yang dibuat step `daily` tiap 00:05 UTC+7 (cepat, CDN Cloudflare); kalau belum ada salinan (unlimited, arsip > 7 hari, atau sebelum step jalan), dari AnimeThemes lewat proxy `GET /api/media?puzzle=&round=&kind=audio|video&v=` (same-origin, jadi nama file AnimeThemes, yang berisi judul anime, tidak terlihat di browser; `v` = tag HMAC yang berubah kalau ronde diganti). Ketiga lagu diunduh utuh di background begitu puzzle dibuka, ronde langsung tampil dengan "Loading song…"; lagu proxy puzzle harian juga di-cache CDN Vercel (`s-maxage`). **Satu tebakan** per ronde: benar = poin ronde (6.000/7.000/7.000), separuhnya kalau clue dibuka, salah atau "Give up" 0. Jawaban menampilkan judul romaji dan judul Inggris MAL kalau beda (`AnswerInfo.titleEn`, juga di Guess the Anime, Anidle, dan Answers). Clue = video OP/ED-nya sendiri, blur dan tanpa suara, **mengikuti lagu** (lagu tidak berhenti saat video memuat; play/pause/seek di player mengatur keduanya, klik video = play/pause, klik dua kali atau tombol Fullscreen = layar penuh, player ikut); Ending juga menampilkan poster (cover) blur di sebelah video. Videonya klip 240p di R2 (step `clips`, dan step `daily` untuk lagu hari itu, tampil <1 dtk) kalau ada, kalau tidak video terkecil AnimeThemes di-stream lewat proxy (hanya setelah pemain membuka clue) dan mulai dimuat dari detik lagu saat itu (`#t=`). Kalau video tidak tampil dalam 20 dtk, clue tinggal cover blur. Kalau lagu gagal dimuat ada "Try again", dan di puzzle unlimited milik sendiri ronde yang belum disentuh bisa diganti (`POST /api/puzzle/replace`, difficulty ronde sama).
- **Guess the Anime** (mode `screenshot`): 3 ronde. Mulai dari satu screenshot opening (utuh). Di bawah gambar ada tab clue: "Unlock first clue" (screenshot kedua), "Unlock second clue" (screenshot ketiga), "Unlock title clue" (huruf pertama tiap kata, sisanya `_`, mis. `N_____`; judul Inggris ikut kalau ada), dibuka berurutan kapan saja. Tab screenshot yang sudah terbuka bisa dipilih lagi; petunjuk judul tampil di kotak sendiri di bawah tab, jadi semua screenshot tetap bisa dilihat. **Satu tebakan** per ronde: benar = poin ronde (6.000/7.000/7.000) dikurangi seperempatnya per clue yang dibuka, salah atau "Give up" 0. Clue baru dikirim server setelah dibuka.
- Opening, Ending, Character, dan Screenshot menampilkan "Round N" + label difficulty ronde itu (Easy/Medium/Hard) dari awal; di Character label-nya dari favorit karakternya.
- Setelah puzzle Opening, Ending, Guess the Anime, atau Character selesai, di bawah kartu "Finished" muncul **Answers**: semua ronde sekaligus (Character: semua karakter per ronde) dengan tanda ✓/✗, jawaban benar (link MAL, cover/portrait, lagu untuk OP/ED), pilihan pemain kalau beda (dicoret kalau salah, "also right" kalau show lain yang juga diterima), "You gave up"/"No guess"/"not answered", dan poin per ronde dari maksimalnya (`src/AnswerSummary.tsx`).
- Setiap mode punya tombol **?** di samping judul: dialog "How to play" berisi aturan dan skor mode itu (`src/HowToPlay.tsx`, teksnya dibangun dari konstanta yang sama dengan server: `ROUND_MAX_POINTS`, `ANIDLE_CLUES`, `SONG_CLUE_SHARE`, `SCREENSHOT_CLUE_COST`, …). Escape, tombol tutup, atau klik di luar menutupnya.
- **Character**: 3 ronde × 4 karakter dari 4 anime berbeda (hanya seri TV). Difficulty ronde = popularitas **karakternya** (favorit MAL), bukan animenya: ronde 1 karakter easy, ronde 2 medium, ronde 3 hard (mis. Naruto easy, Rock Lee medium, Chouji hard, semuanya dari anime easy). Anime-nya tetap dari pool biasa (harian: anime easy + medium), dan karakter diambil acak dari karakter show itu yang sesuai difficulty ronde. Per karakter: pilih **nama** dari autocomplete karakter (`GET /api/characters`: semua karakter di database, dicari lewat nama atau nickname, romaji saja, tanpa kanji/kana; karakter berbeda dengan nama sama, mis. beberapa "Rin", jadi satu entri, dan kolom nama dinilai dari namanya, bukan id karakter) dan **anime**-nya dari autocomplete judul. Kolom anime benar kalau franchise-nya sama dengan show yang ditanya **atau** karakter itu juga muncul di show yang dipilih (`character_show`; mis. Rin Toosaka dari Fate/Extra juga benar dengan Fate/Zero, Prisma☆Illya, atau Carnival Phantasm). **Satu tombol Guess per ronde**: semua pilihan dikirim sekaligus, kolom yang dikosongkan dihitung salah, dan ronde tidak bisa ditebak ulang. Tiap kolom benar = 1/8 poin ronde (750 di ronde 1, 875 di ronde 2–3). Setelah Guess, tiap kartu menampilkan dua baris hijau/merah (nama, anime) berisi jawaban benar, poin, "Also accepted" (nama: nickname romaji; anime: semua show lain tempat karakter itu muncul, link ke MAL), dan pilihan pemain kalau berbeda (dicoret kalau salah, "also right" kalau show lain yang juga benar); border kartu hijau/kuning/merah.
- Autocomplete menampilkan nama yang cocok dengan ketikan: mengetik "Fate/stay night" menampilkan "Fate - Stay Night → Fate/Zero" (season yang digabung ke show lain), nickname karakter juga begitu.
- Semua tebakan (anime dan nama karakter) lewat autocomplete: memilih saran hanya mengisi kolom; tebakan baru dikirim lewat tombol **Guess** (Anidle, Opening, Ending, Screenshot: satu tombol di sebelah kolom, Enter juga bisa; Character: satu tombol untuk seluruh ronde). Mengetik ulang membatalkan pilihan.
- Satu franchise dianggap benar. Jawaban dicek di server dan baru dikirim ke browser setelah game (atau ronde) selesai. Cover jawaban diambil dari R2 kalau sudah disalin, kalau belum dari CDN MAL.
- **Leaderboard** (`/leaderboard`, `GET /api/leaderboard?date=`): skor puzzle harian per tanggal UTC+7 yang diselesaikan di hari itu juga, per mode dan total, hanya akun (pemain anonim tidak punya nama). **Riwayat** (`/riwayat`, `GET /api/history`): per mode jumlah main, persentase tertebak/sempurna, streak harian, rata-rata dan skor terbaik (hanya puzzle harian yang selesai di harinya), plus 60 puzzle terakhir termasuk main ulang arsip (bisa dibuka lagi). **Bagikan hasil**: teks tanpa spoiler ala Wordle (warna per kolom petunjuk / per percobaan ronde), lewat share sheet HP atau clipboard.

## Admin

`/admin` (hanya akun di `ADMIN_USERS`, username akun Anidle): jumlah media per jenis × status, lalu per judul cover, klip OP/ED, karakter, dan screenshot yang dihasilkan pipeline beserta error-nya. **Tolak** membuat media itu `rejected`: tidak dipakai puzzle baru dan tidak diproses ulang pipeline (kecuali `--refresh`); **Pulihkan** mengembalikannya ke `ok`. File di R2 tidak dihapus. API: `GET/POST /api/admin/media`.

## Pipeline otomatis (GitHub Actions)

`.github/workflows/pipeline.yml` menjalankan semua step tiap Selasa 03:00 UTC+7 ke Turso + R2 (bisa juga manual lewat **Run workflow**, dengan pilihan step dan flag), dan `.github/workflows/daily.yml` step `daily` tiap hari 00:05 UTC+7. Antrean `enrich_queue` dari "Sinkron ulang" ikut diproses di step `enrich`. Ringkasan run (jumlah per jenis media + daftar media yang rusak di run itu) muncul di halaman run. Secrets yang dibutuhkan: `MAL_CLIENT_ID`, `MAL_CLIENT_SECRET`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `TOKEN_ENC_KEY`, `POOL_USERS`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

## Database

Halaman `/database` menampilkan semua judul yang bisa keluar di Anidle (`GET /api/anime`, 48 per halaman; opsi filter dari `GET /api/anime/facets`).

- **Sort**: popularity (member terbanyak), skor, tahun terbaru/terlama, judul A–Z.
- **Filter**: cari judul (romaji/Inggris/Jepang/sinonim), genre dan tags (theme + demographic; digabung AND), studio, source, difficulty.
- Kartu menampilkan tahun, skor, member, ranking, jumlah entri yang digabung, plus chip studio, source, genre, dan tag yang bisa diklik untuk menambah filter. Filter tersimpan di URL (`/database?genre=22&sort=score`), jadi bisa dibagikan dan bertahan saat reload.

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
| `npm run daily:reroll -- [--date=YYYY-MM-DD] [--mode=anidle,opening] [--turso]` | Buang puzzle harian satu tanggal (default hari ini, semua mode) beserta play-nya, lalu puzzle diundi ulang saat dibuka berikutnya: seed tanggal itu jadi `<date>#<n>` (tabel `daily_reroll`), jadi hasilnya beda dari sebelumnya |
| `npm run pipeline` | Isi/update database |
