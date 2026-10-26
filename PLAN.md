# Anidle: Plan

Game tebak anime harian (mirip aniguessr.com) khusus untuk saya dan teman-teman.
Domain: `https://anidle.velvetaco.dev` · Repo GitHub terpisah dari portofolio · Semua layanan di paket gratis.

## 1. Tujuan & prinsip

1. **Pool anime terbatas**: anime di list *completed* MAL teman-teman, dan anime populer di MAL (≥ 50 rb member). Setiap anime punya difficulty dari jumlah member; puzzle harian hanya easy + medium.
2. **Tidak lemot, tidak gagal fetch**: masalah utama aniguessr. Prinsipnya:
   - Saat main **tidak ada request ke MAL / jikan-edge / AnimeThemes**. Semua data dan media sudah disalin ke database & storage sendiri.
   - Media **divalidasi saat pipeline**. Judul yang medianya rusak tidak masuk pool, jadi tidak ada ronde yang tidak bisa dijawab.
   - Satu request untuk satu game, lalu **semua media ronde di-preload** sebelum game mulai.
3. **Jawaban dicek di server**: kunci jawaban tidak pernah dikirim ke browser (beda dengan mode screenshot aniguessr yang mengirim `accepted_titles`).
4. **Terbuka, akun opsional**: siapa pun bisa main tanpa akun. Akun Anidle (username + password, atau masuk langsung dengan MAL) menyimpan progres lintas perangkat; menghubungkan MAL membuka pool dari list completed.

## 2. Stack (semua gratis)

| Bagian | Pakai | Catatan kuota (per Okt 2026) |
| --- | --- | --- |
| Web + API | **Vercel Hobby**: Vite + React + TypeScript, Vercel Functions di `api/` | Function maks 300 dtk, cron maks 1×/hari, non-komersial |
| Database | **Turso** (libSQL/SQLite) via `@libsql/client` | 5 GB, 500 jt baris dibaca/bulan. Lokal pakai file `file:./data/anidle.db` dengan client yang sama |
| Media | **Cloudflare R2**, custom domain `media.velvetaco.dev` | 10 GB, egress gratis. Aktivasi mungkin minta kartu (cek saat daftar) |
| Pipeline | **GitHub Actions** (jadwal mingguan + manual) atau PC lokal | Private repo: 2.000 menit/bulan. Run pertama sebaiknya di PC |
| Proses media | `ffmpeg-static` (audio) + `sharp` (gambar) dari npm | ffmpeg belum ter-install di PC; paket npm ini menghindari install manual |
| Login | Akun sendiri: username + password (scrypt) + cookie session ber-HMAC. Pemain anonim pakai cookie id acak. **MAL OAuth2 PKCE `plain`** untuk menghubungkan akun MAL, atau masuk langsung (akun tanpa password dibuat otomatis) | App MAL **kedua** untuk produksi (MAL hanya izinkan 1 redirect URL per app) |
| Test | Vitest untuk logika di `shared/` | |

DNS `velvetaco.dev` sudah di Cloudflare (NS `mckinley`/`agustin.ns.cloudflare.com`, ada wildcard `*` ke portofolio):
- `anidle` → CNAME ke Vercel, **DNS only** (awan abu-abu). Record eksplisit mengalahkan wildcard.
- `media` → R2 custom domain (dibuat otomatis dari dashboard R2). Subdomain satu tingkat saja (sertifikat `*.velvetaco.dev`).
- Record `@`, `www`, `*`, MX **tidak disentuh**.

## 3. Arsitektur

```mermaid
flowchart LR
  subgraph Pipeline["Pipeline (GitHub Actions / PC)"]
    MAL[MAL API v2<br/>list completed + detail] --> P[pool]
    JE[jikan-edge /v1<br/>genres, themes,<br/>demographics, karakter] --> P
    P --> EN[enrich]
    AT[AnimeThemes API<br/>OP/ED] --> EN
    EN --> MED[media: download → ffmpeg/sharp → validasi]
    MED --> R2[(R2 media.velvetaco.dev)]
    EN --> DB[(Turso)]
    MED --> DB
  end
  subgraph Play["Saat main"]
    B[Browser] -->|/api/*| V[Vercel Functions]
    V <--> DB
    B -->|preload langsung| R2
  end
```

## 4. Sumber data (sudah dicek live)

| Sumber | Dipakai untuk | Endpoint | Batas |
| --- | --- | --- | --- |
| MAL API v2 | list completed teman, judul alternatif, cover, tahun/season, skor, source, studio, relasi | `GET /v2/users/{user}/animelist?status=completed&limit=1000&fields=list_status,media_type&nsfw=true`, `GET /v2/anime/{id}?fields=…` | Tidak terdokumentasi → jaga ±1 req/dtk |
| jikan-edge | top per genre, genres/themes/demographics terpisah, karakter + gambar | `GET /v1/anime?genres={id}&order_by=score&sort=desc&page=N` (50/halaman), `GET /v1/anime/{id}`, `GET /v1/anime/{id}/characters`, `GET /v1/genres/anime` | 30 req/10 dtk, 60 req/menit per IP |
| AnimeThemes | file OP/ED | `GET https://api.animethemes.moe/anime?filter[has]=resources&filter[site]=MyAnimeList&filter[external_id]={mal_id}&include=animethemes.animethemeentries.videos.audio` (bracket harus di-URL-encode) | Header `x-ratelimit-limit: 90` |

Contoh hasil AnimeThemes untuk Frieren (52991): `OP1`, `ED1`, `OP2`, masing-masing ada audio `.ogg` ±2–3,7 MB (lagu penuh) dan video `.webm` 720p. Jadi audio wajib dipotong.

Playground `D:\Personal Project\MAL-WebAPI` dipakai untuk uji coba query sebelum masuk pipeline.

## 5. Pool

- **Completed**: per username MAL, ambil semua halaman `animelist?status=completed`. List publik cukup Client ID; list private pakai token MAL akun yang sudah menghubungkannya. Pool bersama hanya dari `POOL_USERS`; akun lain yang menghubungkan MAL hanya mengisi pool `saya` miliknya.
- **Populer**: ranking popularitas resmi MAL (`GET /v2/anime/ranking?ranking_type=bypopularity`, 500 per halaman) sampai `members < 50.000` (±3.700 judul per Okt 2026). Menggantikan "top 100 per genre" yang terlalu banyak berisi judul obscure.
- **Filter global**: buang `media_type` `music`, `cm`, `pv`; buang explicit genre Hentai (12) dan Erotica (49). Ecchi tetap boleh.
- **Difficulty** dari `anime.members`: easy ≥ 500 rb (±540 judul), medium 200–500 rb (±890), hard < 200 rb. Dihitung saat query, jadi ikut berubah setiap enrich memperbarui jumlah member.
- Pool di mode unlimited (semua bisa difilter genre dan difficulty):
  - `semua`: completed `POOL_USERS` + populer. Puzzle harian = `semua` dengan difficulty easy + medium,
  - `teman`: completed minimal 1 teman,
  - `bareng`: completed semua teman yang aktif,
  - `saya`: completed akun MAL milik pemain (butuh MAL terhubung; begitu juga `teman` dan `bareng`),
  - `populer`: hanya ranking populer MAL.
- **Franchise**: dihitung dari relasi MAL `prequel`/`sequel`/`side_story`/`parent_story`/`summary`/`full_story` (graph terhubung → `franchise_id`). Entri paling populer = entri kanonik (`canonical_id`), satu show per franchise. Dipakai untuk aturan jawaban (lihat §8).

## 6. Media

| Jenis | Sumber | Proses | Target ukuran |
| --- | --- | --- | --- |
| Cover | MAL `main_picture.large` | sharp → webp lebar 400 | ±30–50 KB |
| OP/ED | AnimeThemes audio `.ogg` | ffmpeg: 30 dtk dari awal, `loudnorm`, mp3 96 kbps | ±360 KB |
| Karakter | jikan-edge `imageUrl` | sharp → webp lebar 300 | ±20–30 KB |
| Screenshot (belakangan) | frame dari video OP/ED AnimeThemes | ffmpeg ambil 3–5 frame, buang frame gelap/blank | ±40–60 KB |

- Awal: hanya OP1 + ED1 per judul. Run pertama ±2.000 × 2 × ±3,5 MB ≈ **±14 GB download**, output ±1,5 GB → jalankan di PC, file sumber dihapus setelah diproses.
- **Validasi** setiap file: ukuran minimal, `ffprobe` durasi ≥ 20 dtk, `sharp().metadata()` bisa dibaca. Gagal → tandai `broken`, judul tidak dipakai untuk mode yang butuh media itu.
- **Layout R2** (nama file berisi hash, jadi bisa di-cache selamanya):
  ```
  v1/anime/{mal_id}/cover-{hash}.webp
  v1/anime/{mal_id}/op1-{hash}.mp3
  v1/anime/{mal_id}/ed1-{hash}.mp3
  v1/char/{char_id}-{hash}.webp
  v1/titles-{hash}.json        # daftar judul untuk autocomplete
  ```
  Semua di-upload dengan `Cache-Control: public, max-age=31536000, immutable`.
- Nama file media tidak boleh membocorkan jawaban (pakai `mal_id` + hash, bukan judul). Browser yang membuka devtools masih bisa melihat `mal_id`; untuk teman-teman ini dianggap cukup. Kalau perlu nanti diganti ID acak per puzzle.

## 7. Database (Turso)

```text
anime(mal_id PK, title, title_en, title_ja, synonyms JSON, media_type, year, season,
      score, members, source, studios JSON, franchise_id, cover_key, nsfw, updated_at)
genre(id PK, name, type)                       -- genres | explicit_genres | themes | demographics
anime_genre(mal_id, genre_id)
theme_song(id PK, mal_id, kind OP|ED, seq, title, artist, audio_key, status ok|broken)
character(id PK, mal_id, name, role, favorites, image_key, status)
player(username PK, mal_user_id, avatar, allowed, refresh_token_enc, token_expires_at, last_sync_at)
completed(username, mal_id, finished_at, PK(username, mal_id))
popular(mal_id PK, rank)                        -- ranking popularitas MAL sampai 50 rb member
enrich_queue(mal_id PK, reason, added_at)      -- judul baru dari "sync list", diproses pipeline berikutnya
puzzle(id PK, date NULL, mode, pool, rounds JSON, created_at)   -- UNIQUE(date, mode) untuk harian
play(id PK, puzzle_id, username, round, guesses JSON, score, finished_at)
```

Puzzle harian **disimpan** saat pertama diminta (dipilih dari seed `tanggal+mode`), supaya update pool di tengah hari tidak mengubah puzzle yang sedang dimainkan.

## 8. Game

**Mode** (urutan pengerjaan):
1. **Anidle**: tebak anime hari ini dari petunjuk. Setiap tebakan dibandingkan dengan jawaban: tahun (`<`/`>`/sama), skor MAL (`<`/`>`), source, studio, genres, themes, demographics (cocok/sebagian). Tidak butuh media kecuali cover saat jawaban terbuka.
2. **Opening** dan **Ending**: 3 ronde, audio diputar bertahap (1 → 3 → 6 → 12 → 30 dtk), poin turun setiap reveal/salah.
3. **Karakter**: 4 portrait karakter dari satu anime per ronde.
4. **Screenshot**: dari frame video OP/ED.

**Jawaban**:
- Pemain memilih judul dari autocomplete (yang dikirim `mal_id`), bukan teks bebas. Autocomplete mencari di judul romaji, Inggris, Jepang, dan sinonim setelah normalisasi (huruf kecil, tanpa tanda baca/makron).
- Benar kalau `mal_id` sama, **atau** satu `franchise_id` (default, lihat §12).
- Server menyimpan setiap tebakan di `play`. Reload halaman melanjutkan progres, tidak mengulang.

**Harian vs unlimited**: harian = satu puzzle per mode per tanggal (WIB), pool `semua`, masuk leaderboard. Unlimited = puzzle acak, pool bisa dipilih, tidak masuk leaderboard.

## 9. API (Vercel Functions)

| Route | Fungsi |
| --- | --- |
| `POST /api/auth/register` · `POST /api/auth/login` · `POST /api/logout` | Akun Anidle (username + password). Progres anonim di browser itu dipindah ke akun |
| `GET /api/oauth/login` · `GET /api/oauth/callback` · `POST /api/mal/unlink` | Sudah masuk: hubungkan / putuskan akun MAL. Tamu: masuk dengan MAL (akun dibuat kalau belum ada) |
| `GET /api/me` | Akun yang masuk + status MAL |
| `POST /api/sync` | Sync list completed akun MAL yang terhubung. Judul baru masuk `enrich_queue` |
| `GET /api/puzzle?mode=&date=` · `POST /api/puzzle/unlimited` | Puzzle tanpa jawaban: ronde + URL media R2 |
| `POST /api/guess` | `{puzzleId, round, malId}` → benar/salah, petunjuk (Anidle), skor |
| `GET /api/leaderboard?date=&mode=` | Skor teman per hari/mode |

Puzzle, tebakan, dan daftar judul terbuka untuk semua orang; pemain diidentifikasi lewat session akun atau cookie anonim (`HttpOnly`, `SameSite=Lax`, `Secure` di HTTPS). Pool `teman`/`bareng`/`saya` butuh MAL terhubung (403 kalau belum).

## 10. Frontend

- Vite + React + TypeScript. Halaman: Home (pilih mode), Game, Hasil + share, Leaderboard, Akun (sync list, pilih pool).
- **Preload**: setelah `/api/puzzle`, semua media ronde dimuat (`Audio` dengan `preload="auto"` + `canplaythrough`, `Image().decode()`) dengan progress bar. Game mulai setelah semua siap.
- **Fallback**: media yang tetap gagal dimuat → panggil `/api/puzzle/replace-round`, ronde diganti judul lain, skor tidak dipotong.
- `titles.json` diambil dari R2 sekali dan disimpan di cache browser (nama file berisi hash, jadi otomatis segar saat pool berubah).

## 11. Struktur repo `D:\Personal Project\Anidle`

```
src/                 React app
api/                 Vercel Functions (oauth, me, sync, puzzle, guess, leaderboard)
shared/              logika bersama + test: seed, normalisasi judul, franchise, perbandingan Anidle, skor
pipeline/            sources/ (mal, jikanEdge, animeThemes), pool.ts, enrich.ts, media.ts, upload.ts, index.ts
db/                  schema.sql + migrations
.github/workflows/   pipeline.yml (cron mingguan + workflow_dispatch)
.env.example
```

**Environment variable**:

| Variabel | Dipakai di | Isi |
| --- | --- | --- |
| `MAL_CLIENT_ID`, `MAL_CLIENT_SECRET` | api, pipeline | App MAL produksi |
| `MAL_REDIRECT_URI` | api | `https://anidle.velvetaco.dev/oauth/callback` (di-rewrite ke `/api/oauth/callback`) |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | api, pipeline | Lokal: `file:./data/anidle.db` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | pipeline | API token R2 |
| `MEDIA_BASE_URL` | api | `https://media.velvetaco.dev` |
| `SESSION_SECRET`, `TOKEN_ENC_KEY` | api, pipeline | Acak 32 byte. Refresh token MAL dienkripsi AES-GCM |
| `POOL_USERS` | api, pipeline | Username MAL yang list completed-nya membentuk pool bersama, dipisah koma |
| `JIKAN_BASE_URL` | pipeline | Default `https://jikan.lucashdo.com` |

## 12. Keputusan (default dipilih, bisa diubah)

| Pertanyaan | Default | Alternatif |
| --- | --- | --- |
| Pool populer | Ranking popularitas MAL sampai `members ≥ 50.000` | Ambang lain |
| Season 2/3 | Digabung jadi satu show per franchise (entri paling populer, member-nya menentukan difficulty); menebak entri mana pun dari franchise benar | Entri MAL terpisah di pool |
| Difficulty | easy ≥ 500 rb, medium 200–500 rb, hard < 200 rb member; harian = easy + medium | Ambang lain |
| Konten | Tanpa Hentai/Erotica | Ikutkan dengan toggle |
| Zona waktu puzzle harian | WIB (UTC+7) | UTC |
| Mode pertama | Anidle (tanpa media), lalu Opening/Ending | Opening dulu |

## 13. Milestone

| # | Isi | Selesai kalau | Status |
| --- | --- | --- | --- |
| M0 | Setup: repo GitHub, project Vercel, domain `anidle.velvetaco.dev`, DB Turso, bucket R2 + `media.velvetaco.dev`, app MAL kedua | `https://anidle.velvetaco.dev/api/health` membalas OK dan bisa query Turso | belum (butuh akun) |
| M1 | Pipeline data (tanpa media): pool completed + populer MAL, difficulty, enrich MAL + jikan-edge, franchise, simpan ke DB lokal lalu Turso. Bisa diulang tanpa duplikat, patuh rate limit | Laporan jumlah judul per sumber; detail beberapa judul cocok dengan MAL | ✓ |
| M2 | Akun (username + password) + main anonim + hubungkan MAL + sync list, mode **Anidle** harian & unlimited, autocomplete, `/api/guess` | Bisa main tanpa akun; teman bisa daftar, hubungkan MAL, dan main pool completed; progres tersimpan saat reload | ✓ lokal |
| M3 | Pipeline media (cover, OP1, ED1) → R2, mode **Opening** & **Ending** dengan preload + fallback | Satu game dimulai < 3 dtk setelah preload di koneksi biasa; tidak ada ronde gagal | ✓ |
| M4 | Mode **Karakter** | 4 portrait per judul di R2, 3 ronde, preload + fallback sama dengan Opening/Ending | ✓ |
| M5 | Leaderboard, riwayat, share skor | Leaderboard harian per mode + total, statistik + streak per mode, teks share tanpa spoiler | ✓ |
| M6 | Screenshot dari video OP/ED + halaman admin untuk menandai media jelek | Mode Screenshot harian/unlimited; admin bisa melihat dan menolak/memulihkan media per judul | ✓ |
| M7 | GitHub Actions mingguan, proses `enrich_queue`, laporan media broken | Pipeline jalan otomatis tanpa PC | ✓ (butuh secrets) |

Catatan implementasi M1–M7 (beda dari rencana awal):
- Daftar judul autocomplete tetap lewat `/api/titles` (±3.760 judul, ETag, di-cache browser), tidak dipindah ke R2: sudah cepat, dan file di R2 butuh langkah tambahan untuk memberi tahu API nama file terbaru.
- Cover dan klip OP/ED disalin ke R2 dengan nama file = hash isi (`v1/cover/<hash>.webp`, `v1/audio/<hash>.mp3`), bukan `mal_id`, jadi URL media tidak membocorkan jawaban. Status per judul di `anime_media` (bukan `theme_song`). Cover yang belum tersalin tetap memakai CDN MAL.
- Klip: 30 dtk mulai dari bunyi pertama (`silenceremove`), hanya 1,6 MB awal file AnimeThemes yang diunduh.
- Fallback ronde: klip yang gagal dimuat bisa dicoba lagi; di puzzle unlimited milik sendiri, ronde yang belum ditebak bisa diganti judul lain. Puzzle harian tidak bisa diganti (berlaku untuk semua orang).
- State OAuth (state + PKCE verifier) disimpan di cookie bertanda tangan, karena serverless tidak punya memori antar request.
- Screenshot: 3 frame per show (bukan 5), tanpa zoom, mengikuti gaya AniGuessr: screenshot asli, lalu clue dibuka lewat tombol (screenshot 2, screenshot 3, judul `N_____`), satu tebakan, 500 − 125 per clue. Satu seek video 1080p lewat HTTP ±25 dtk dan beberapa MB, jadi hanya show easy + medium yang diproses.
- Admin = akun Anidle di `ADMIN_USERS`. Menolak media hanya mengubah status (`rejected`), file R2 tetap ada, jadi bisa dipulihkan.
- UI dan pesan error API dalam bahasa Inggris (dokumen tetap bahasa Indonesia).
- Mode Character diubah: bukan lagi "tebak anime dari 4 portrait", tapi 4 karakter dari 4 anime berbeda per ronde; nama karakter **dan** animenya dipilih dari autocomplete (bukan teks bebas), satu tombol Guess per ronde (kolom kosong = salah, ronde selesai).
- Difficulty Character diambil dari favorit MAL karakternya sendiri, bukan dari animenya: easy ≥ 5.000, medium 500–4.999, hard 100–499 (contoh Naruto: Naruto 88 rb, Neji 3,8 rb, Iruka 362). Ronde 1/2/3 = karakter easy/medium/hard dari pool anime biasa; per show disimpan maksimal 3 karakter per difficulty. Karakter utama saja terlalu gampang bagi yang sudah nonton.
- Season/movie/OVA satu franchise digabung jadi satu show (entri kanonik = paling populer; difficulty dari member entri itu). Hanya entri kanonik yang ditanya, ada di autocomplete, dan di halaman Database.
- Semua mode 3 ronde: ronde 1 easy, ronde 2–3 medium (harian, dan unlimited dengan filter All / Easy + Medium). Pengecualian: Character, yang ronde 1/2/3-nya easy/medium/hard menurut karakter.
- Opening/Ending tidak lagi memakai klip 30 dtk di R2: lagu penuh di-stream dari AnimeThemes lewat proxy `/api/media` (nama file tidak bocor), satu tebakan per ronde, clue = video OP/ED blur tanpa suara yang mengikuti lagu (klip 240p di R2 untuk show easy + medium, selebihnya video terkecil AnimeThemes lewat proxy; cover blur kalau video gagal).
- Masuk dengan MAL: callback memakai `accountId` di cookie OAuth (`null` = tamu → masuk). Akun baru dari MAL punya `password_hash` kosong (tidak pernah cocok), jadi login password ditolak dan unlink MAL diblokir supaya akunnya tidak terkunci.
- Blur clue dikurangi (terlalu susah): video/poster OP/ED 16 → 4 px, screenshot Anidle 9 → 3 px.
- Character: kolom anime menerima show mana pun tempat karakter muncul (tabel `character_show`, semua karakter ≥ 100 favorit per show), bukan hanya show yang ditanya, karena karakter populer muncul di banyak seri (Rin Toosaka: Fate/Zero, Fate/Extra, Prisma☆Illya, …).

## 14. Risiko

- **jikan-edge / AnimeThemes layanan pihak ketiga**: kalau mati, hanya update pool yang terganggu; game jalan dari data yang sudah disalin. Sumber dibungkus di `pipeline/sources/` supaya mudah diganti (mis. AniList untuk genre).
- **List completed private**: butuh pemiliknya menghubungkan MAL sekali; token disimpan terenkripsi dan di-refresh otomatis.
- **Run pertama media besar** (±14 GB download): di PC, bisa dicicil (pipeline melewati judul yang sudah `ok`).
- **Hak cipta media OP/ED**: web sekarang terbuka untuk umum (main anonim), jadi media M3 juga bisa diakses siapa pun. Tanpa iklan; kalau perlu, media bisa dibatasi ke akun yang masuk.
- **Batas Vercel Hobby**: repo di akun GitHub pribadi (bukan organization); commit dari orang lain ke repo private bisa membuat deploy tertahan.

## 15. Yang dibutuhkan dari kamu

1. Daftar username MAL teman untuk `POOL_USERS`, dan apakah list mereka publik.
2. Konfirmasi atau ubah default di §12.
3. Untuk M0: akun Turso, Cloudflare (aktifkan R2), app MAL kedua dengan redirect `https://anidle.velvetaco.dev/oauth/callback`, repo GitHub kosong.
