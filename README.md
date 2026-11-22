# Kuramanime Scraper API

REST API scraper berbasis **Node.js + Axios + Cheerio**, dirancang untuk **Vercel serverless** (tanpa `app.listen()`, tanpa server long-running).

## Struktur

```
/api
  home.js
  search.js
  /anime/[id]/[slug].js
  /episode/[id]/[slug]/[epSlug].js
/lib
  config.js    -> satu-satunya pembaca process.env
  client.js    -> axios + retry + cache in-memory
  parsers.js   -> parseHome, parseSearch, parseDetail, parseEpisode
  auth.js      -> CORS, preflight OPTIONS, cek x-api-key
.env.example
.env             -> untuk local dev (JANGAN di-commit)
.gitignore
vercel.json
package.json
README.md
```

## Endpoint

| Method | Path | Keterangan |
|--------|------|-----------|
| GET | `/api/home` | Daftar anime di homepage |
| GET | `/api/search?q=one+piece&order_by=oldest` | Hasil pencarian (`order_by` & `page` opsional) |
| GET | `/api/anime/:id/:slug` | Detail anime + daftar episode lengkap |
| GET | `/api/episode/:id/:slug/:epSlug` | Halaman nonton + daftar server |

Semua response dibungkus:

```json
{ "success": true, "data": ... }
{ "success": false, "error": "pesan error" }
```

Field `id` ditambahkan di item list (`/api/home`, `/api/search`) supaya mudah memanggil `/api/anime/:id/:slug`.

## Environment Variable

Semua dibaca lewat `lib/config.js` (sudah di-parse + ada fallback default).

| Variable | Default | Keterangan |
|----------|---------|-----------|
| `BASE_URL` | `https://v20.kuramanime.ing` | Base target scrape (tanpa trailing slash) |
| `REQUEST_TIMEOUT_MS` | `8000` | Timeout axios per request. **Maks 9000** (limit Vercel Hobby 10 detik) |
| `MAX_RETRY` | `2` | Retry maksimal (integer). Hanya untuk error jaringan/timeout/5xx/429 |
| `RETRY_DELAY_MS` | `500` | Jeda antar retry |
| `CACHE_TTL_MS` | `300000` | TTL cache in-memory (5 menit) |
| `ENABLE_CACHE` | `true` | `true`/`false` |
| `USER_AGENT` | Chrome 120 Windows | User-Agent request ke target |
| `REFERER` | `BASE_URL + "/"` | Referer request ke target |
| `API_KEY` | *(kosong)* | Kosong = auth mati. Diisi = wajib header `x-api-key` (salah/tidak ada -> 401) |
| `MAX_EPISODE_PAGES` | `10` | (opsional) Maks halaman tambahan daftar episode yang di-fetch. `0` = nonaktif |
| `TOTAL_BUDGET_MS` | `9000` | (opsional) Total budget waktu per request termasuk retry. Maks 9500 |

## Local development

```bash
npm install
npm i -g vercel        # sekali saja
vercel dev             # atau: npm run dev
```

`.env` otomatis dibaca. API jalan di `http://localhost:3000`.

## Deploy ke Vercel

1. Push project ke GitHub (pastikan `.env` tidak ikut — sudah di `.gitignore`).
2. Vercel Dashboard -> **Add New Project** -> import repo -> Deploy.
3. Set environment variable: **Project -> Settings -> Environment Variables**, tambahkan satu per satu (atau tombol *Import .env* untuk paste isi `.env`). Pilih environment Production / Preview / Development sesuai kebutuhan.
4. **Redeploy** (Deployments -> titik tiga -> Redeploy). Env baru hanya berlaku di deployment baru.

Lewat CLI:

```bash
vercel            # preview
vercel --prod     # production
```

## Contoh curl

Ganti `BASE` dengan `http://localhost:3000` atau domain Vercel kamu.

```bash
BASE=http://localhost:3000

# 1. Home
curl "$BASE/api/home"

# 2. Search
curl "$BASE/api/search?q=one+piece&order_by=oldest"

# 3. Detail anime (lengkap dengan episode)
curl "$BASE/api/anime/50/one-piece-OreGjicNb0Fh"

# 4. Episode / server
curl "$BASE/api/episode/50/one-piece-OreGjicNb0Fh/1180"

# Preflight CORS (204)
curl -i -X OPTIONS "$BASE/api/home"

# Kalau API_KEY diaktifkan
curl -H "x-api-key: ISI_API_KEY_KAMU" "$BASE/api/home"
curl -H "x-api-key: ISI_API_KEY_KAMU" "$BASE/api/search?q=one+piece&order_by=oldest"
curl -H "x-api-key: ISI_API_KEY_KAMU" "$BASE/api/anime/50/one-piece-OreGjicNb0Fh"
curl -H "x-api-key: ISI_API_KEY_KAMU" "$BASE/api/episode/50/one-piece-OreGjicNb0Fh/1180"

# Tanpa key saat API_KEY aktif -> 401
curl -i "$BASE/api/home"
```

## Catatan penting

**Timeout.** Vercel Hobby membatasi function 10 detik. `REQUEST_TIMEOUT_MS` dibatasi maks 9000, dan `TOTAL_BUDGET_MS` (default 9000) membatasi total waktu termasuk retry. Kalau sumber lambat, retry otomatis dipotong supaya tidak melewati limit.

**Cache.** Cache in-memory per instance serverless: hilang saat cold start dan tidak dibagi antar instance. Cukup untuk meredam request berulang, bukan cache permanen.

**API key.** Dibandingkan dengan `crypto.timingSafeEqual`. Preflight `OPTIONS` selalu lolos (204) sesuai standar CORS.

**Daftar episode.** Parser mengumpulkan link episode dari: HTML di atribut `data-content`, semua `<a>` bertipe `/anime/<id>/<slug>/episode/<n>`, URL episode di inline `<script>`, dan halaman pagination (`?page=N`) pada path yang sama. Duplikat dibuang, hasil diurutkan numerik.

**Server embed.** Scraper hanya membaca HTML statis (tanpa headless browser, karena serverless). Server yang URL-nya baru dibuat lewat JavaScript/token saat runtime tidak akan terbaca; item tersebut muncul dengan `embed_url: null` (nama server tetap ada).

**Troubleshooting.**
- `502 ... HTTP 403`: target memblokir IP datacenter Vercel / proteksi anti-bot. Coba ganti `USER_AGENT`/`REFERER`, atau jalankan lewat IP lain.
- Field `null` / list kosong: struktur HTML situs berubah. Ubah selector di `lib/parsers.js` (semua selector terkumpul di bagian atas file dan di tiap fungsi parse).
- Domain pindah: cukup ubah `BASE_URL`.
