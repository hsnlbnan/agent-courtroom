# Konsey kararı — Açık kaynak "konsey/mahkeme" uygulaması
**Karar:** conditional — güven 0.70
**Tek satır gerekçe:** Yapılabilir ve altı üye de aynı yönde; ama önergenin çekirdeği (çok-satıcılı headless CLI'ların güvenle tartışması) hiç test edilmedi (`context.md:35-37`), bu yüzden "go" 1 günlük spike + canary testinin sonucuna bağlı.

> **Spike sonrası güncelleme (2026-10-30, orkestratör; kaynak `spike/RESULTS.md`).** Konsey kararı aşağıda olduğu gibi duruyor. Bu not, ölçülmüş spike bulgularının v0 planında neyi değiştirdiğini anlatıyor.
> - **Adım 1 tamamlandı. En riskli varsayım tuttu.** Claude ve Codex 3 headless turu bitirdi ve ID ile resume etti. Silinen dosyadaki kelimeyi 3. turda ikisi de hatırladı, ikisi de read-only kaldı. Ölçüm: Claude 3 tur 32 sn, $0.06; Codex 3 tur 16 sn. Cold start Claude'da ~0.7 sn, Codex'te 0.1–0.4 sn; asıl bekleme modelin ilk token'ı.
> - **`--restricted` salt-okuma DEĞİL.** Edit, Write ve NotebookEdit hâlâ açık kalıyor. v0'da Claude şöyle çalışır:
>   - Kod modunda `--tools Read,Glob,Grep --strict-mcp-config`.
>   - Fikir modunda `--tools ""`.
>   - `--tools` argv'nin sonunda olmalı, çünkü prompt'u yutuyor.
>   - Aşağıdaki "Kod tabanı modu: yalnızca Claude `--restricted`" maddesi bu şekilde okunmalı.
> - **Codex `--ignore-user-config` ile çalışmalı.** Kullanıcının config'indeki model ve MCP ayarları koşuyu bozdu. Ek olarak:
>   - Resume'da sandbox `-c sandbox_mode="read-only"` ile verilir (`-s` yok).
>   - `--skip-git-repo-check` gerekir.
>   - stdin kapalı olmalı.
> - **Akış farkları adaptörde normalize edilmeli:**
>   - Codex token'ları kümülatif geliyor; Claude'un `total_cost_usd` değeri de kümülatif.
>   - Tur başına değerler fark alınarak hesaplanır.
>   - Codex stream'inde model adı ve maliyet yok.
> - **Adım 3'ün yeni tahmini [varsayım; spike ölçümlerinden]:**
>   - Adaptör çekirdeği ~1 gün (spike script'i ~150 satır).
>   - SSE ve SQLite 1 gün.
>   - Transkript, STANCE rozeti, verdict paneli ve erişilebilirlik 2–3 gün.
>   - Canlı Claude-only koşu ve entegrasyon 0.5–1 gün.
>   - Adım 3 toplamı 4.5–6 gün. Adım 2 (canary) ~1 gün ile v0 kalan iş 5.5–7 gün. Önceki tahmin 7–8 gündü.
> - **Adım 2 tamamlandı.**
>   - Claude kod modu ve fikir modu geçti.
>   - Codex düz `-s read-only` ile canary'yi sızdırdı, bu yüzden "kapalı, ileri düzey".
>   - Codex izin profiliyle geçti ama yine ileri düzey kalıyor.
> - **Adım 3 tamamlandı (v0 dilimi, `app/`).**
>   - Replay-first UI, SSE, SQLite (0600) ve Claude adaptörü hazır. Codex yalnızca parser olarak var.
>   - Canlı Claude-only kod modu davası koştu: 2 dk 54 sn, $0.86.
>   - Canary, SQLite, SSE ve UI'da 0 kez göründü.
>   - Ayrıntı: `spike/RESULTS.md` "Adım 3" ve `app/README.md`.

## Oy dağılımı
| Üye | Model | Oy | Güven |
|---|---|---|---|
| optimist | sonnet | conditional | 0.70 |
| skeptic | opus | conditional | 0.75 |
| deterministic | opus | conditional | 0.65 |
| user-advocate | sonnet | conditional | 0.65 |
| cost-ops | sonnet | conditional | 0.65 |
| security | sonnet | conditional | 0.70 |
| **Başkan** | fable | **conditional** | **0.70** |

## MVP kapsamı (v0)
- İçeride:
  - Kod tabanı modu: yalnızca Claude `--restricted` (+ `--strict-mcp-config`, temiz env allowlist); arayüzde açık "tek-satıcı modu" etiketi (`cli-help/claude.txt:199-213`).
  - Fikir modu: Claude (`--tools ""`, `claude.txt:259-263`) + Codex `exec -s read-only` (`codex.txt:92-95`), ancak home-dizini canary testini geçerse.
  - Canary testi altyapısı: repoya yerleştirilmiş enjeksiyon dosyası, repo dışı sahte canary; canary metni stream/SQLite/UI'da görünmemeli (T5, T6, T8).
  - Replay-first: spike'ta kaydedilen stream-json/JSONL fixture'ları ile UI geliştirme (T1–T2).
  - Arayüz: akan transkript (tur sayacı, süre, durdur), konuşmacı rengi + metin etiketi, REPLY_TO bağlantılı animasyonsuz STANCE rozeti, etiket–metin uyuşmazlığı işareti ("?"), verdict paneli (oy, azınlık görüşü, path:line), aria-live, klavyeyle durdur (T14–T16).
  - Hiçbir CLI için `--yolo` / `--force` / `--dangerously-*` sunulmaz (`gemini.txt:28`, `qwen.txt:40`, `kimi.txt:15`, `codex.txt:100-102`, `cursor-agent.txt:39`).
  - Tur, süre ve üye sayısı tavanı; SQLite 0600, repo dışında; sunucu 127.0.0.1.
- Dışarıda (v1+):
  - Gemini (ID ile resume kapısı açık, `gemini.txt:38-40`), Cursor (`-p` varsayılanda yazma+bash, `cursor-agent.txt:18-20`), Kimi (sandbox bayrağı yok, `kimi.txt:13-27`), Qwen — hepsi varsayılan kapalı, canary geçince ve açık kullanıcı onayıyla.
  - Mahkeme sahnesi (hâkim/jüri yerleşimi, animasyonlu "İtiraz!"), maliyet göstergesi süsü, "mahkemeye müdahale" (durdur hariç).
  - Docker/kapsayıcı yolu (T8'de geri çekildi).
  - ACP ortak istemcisi (yalnızca Gemini/Qwen/Kimi'de var; `gemini.txt:32`, `qwen.txt:43`, `kimi.txt:32`).

## En riskli varsayım
"Birden fazla satıcının headless CLI'ı, salt-okunur zorlanmış biçimde, ID ile resume edilerek tutarlı bir tartışma yürütebilir." Mevcut prototip tek Claude oturumunda alt ajanlarla çalışıyor ve bunu hiç test etmiyor (`context.md:35-37`); salt-okuma zorlaması CLI'lar arasında eşit değil (plan/ask modları yalnızca davranış tanımı: `cursor-agent.txt:28-31`, `gemini.txt:29`; Codex read-only'nin okuma kapsamı help'te yok: `codex.txt:92-95`, `:54`); cold start ölçülmedi. Test: 1 günlük spike — `claude -p --output-format stream-json --restricted --resume <id>` ve `codex exec --json -s read-only` + resume ile 3 turluk gerçek tartışma; her turda cold start süresi, token, ham olay şeması kaydedilir; aynı spike'ta canary testi (enjeksiyon dosyası + repo dışı sahte canary) koşturulur. Canary geçmeyen CLI varsayılan kapalı kalır; spike başarısız olursa çok-satıcı vaadi geri çekilir (skeptic closing).

## İlk 3 yapım adımı
1. **Headless spike (1 gün):** Claude ve Codex ile ID ile resume, stream şeması, cold start ve token ölçümü; ham çıktılar `fixtures/` olarak repoya girer — bitti sayılma ölçütü: her iki CLI için 3 turluk kayıt + resume'un önceki okumayı koruduğunun kanıtı + tur başına süre/token tablosu.
2. **Canary + salt-okuma testi:** repoya enjeksiyon dosyası, home'da sahte canary; Claude `--restricted`/`--tools ""` ve Codex `-s read-only` altında koşu — bitti: canary metni stream, SQLite ve UI'da sıfır kez görünür; geçmeyen CLI "kapalı, ileri düzey" olarak işaretlenir; sonuç README'ye yazılır.
3. **Replay-first UI + adaptör çekirdeği:** fixture'lardan beslenen SSE akışı, SQLite transkript, REPLY_TO bağlantılı STANCE rozeti ve uyuşmazlık işareti, verdict paneli — bitti: fixture'dan uçtan uca replay demo + canlı Claude-only kod modu koşusu; süre tahmini (7–8 gün, T18) spike ölçümüyle yeniden verilir.

## Uzlaşma
- Spike UI'dan önce; replay-first ile UI fixture'larla paralel ilerleyebilir (T1–T2; tüm closing'ler).
- "Zorlanmış salt-okuma yoksa üye varsayılan kapalı" + canary testi (T4–T6, T8; security/skeptic/deterministic/optimist closing).
- Docker şartı düştü: kimlik bilgisini kapsayıcıya bağlamak sızıntı yüzeyini büyütür (T7–T8).
- ACP ortak yol değil; yalnızca Gemini/Qwen/Kimi'de (T3; `gemini.txt:32`, `qwen.txt:43`, `kimi.txt:32`).
- Gemini v0 dışı: ID ile resume belgelenmemiş (`gemini.txt:38-40`; T2, T18, dört closing).
- v0 arayüzü karar paneli + bağlantılı animasyonsuz rozet; sahne v1'e (T14–T16).
- Token tahminleri (2–3M, 3–5M) ölçümle çürüdü: dava ≈1,2M bağlam, üye turu 31–54k (`conversation.md:213-217`; T17–T18). Cold start hâlâ ölçülmedi.
- Tehlikeli bayraklar üründe sunulmaz (tüm closing'ler).

## Çözülmemiş ayrılıklar
### v0 Claude(+Codex fikir modu) "koşullu go" mu, kapsam değişikliği mi?
- **security, deterministic:** kapsam değişikliğidir; motion "different coding agents" ve 4 CLI listeliyor; belgelenmeli — T10, deterministic closing koşul 4 (`motion.md:3-4`, `:24-26`).
- **optimist:** fikir modunda Codex ile v0 yine çok-satıcılıdır; kod modu Claude-only kalır — T12, closing.
- **Başkanın dosya okuması:** `motion.md:3-4` "different coding agents debate an idea or a codebase", `:24-26` Claude/Codex/Gemini/Kimi sayıyor. Dosya security/deterministic'i destekliyor: kod tabanı modu Claude-only ise önergenin yarısı daralmış olur. Optimist'in fikir-modu ayrımı kısmi bir cevap, çürütme değil. Karar: v0 README'de açıkça "kapsam daraltması: kod modu tek-satıcı" yazar.

### Fikir modunda Codex "güvenli" mi?
- **optimist:** boş cwd + read-only ile yüzey küçük, canary geçince v0'a girer — T12.
- **security:** repo injection kalkar ama home okuma, env/CLI token'ları ve ağ yolu kalır; Codex'te araçları kapatan bayrak yok — T13 (`codex.txt:92-95`, `:54`).
- **Başkanın dosya okuması:** `codex.txt:92-95` yalnızca sandbox modlarını listeliyor, okuma kapsamı hakkında satır yok; `disk-full-read-access` örneği hem `:54` hem `:167`'de (exec alt komutunda tekrar), yani skeptic'in `:167` ve security'nin `:54` atıfları ikisi de geçerli. Dosya "doğrulanmamış"ı destekliyor; canary testi şart, optimist'in "güvenli" sözü erken.

### Süre: 4–6 gün mü, 7–8 gün mü?
- **cost-ops:** v0 7–8 gün (4 + 1 canary + 1,5 Codex + 0,5 rozet), spike sonrası revize — T18 [assumption].
- **skeptic:** kapsam büyüdü, Gemini'ye süre biçilemez; tahmin spike'a bağlı — T17.
- **Başkanın dosya okuması:** `motion.md:38` 4–6 günü "unverified" diye işaretliyor. Her iki rakam da [assumption]; iki token ölçümü de oturum içi alt ajanlardan (`conversation.md:213-217`), headless cold start değil. Kayıt: "üzerinde anlaşılmış tahmin, ölçülmemiş".

### Atıf düzeltmeleri (başkan kontrol etti)
- `--yolo`: `gemini.txt:28`, `qwen.txt:40`, `kimi.txt:15`; `codex.txt:100-102` ise `--dangerously-bypass-approvals-and-sandbox`. Deterministic T9 haklı, security T10'da kabul etti.
- `claude.txt:199-213` `--restricted`: dosya araçları çalışma dizinine sınırlı, MCP ancak `--strict-mcp-config` ile, env hakkında satır yok; `:259-263` `--tools ""` tüm araçları kapatır. Deterministic T9 doğru.
- `cursor-agent.txt:18-20`: `-p` "has access to all tools, including write and bash" — skeptic doğru.
- Deterministic closing "kimi'de json seçeneği yok" diyor; `kimi.txt:20-21` `--output-format text|stream-json` gösteriyor. Düzeltme: Kimi'nin boşluğu çıktı biçimi değil, zorlama (sandbox bayrağı yok, `:13-27`).
- isim-analiz: T3–T6 moderatör seçimli (`:40`, `:63`, `:72`, `:85`, `:94`) ve hepsi `build` etiketli (`:68`, `:77`, `:90`, `:99`); T4 soru soruyor ama `build` yazıyor. User-advocate T16 doğru; optimist T15'teki "moderatörsüz" yanlış.

### Tartışılmadan kalan koşullar (tek closing'de, itiraz görmedi)
- Satıcı ToS'u headless/abonelik kullanımı (cost-ops, security) [assumption].
- İlk açılışta kurulu/girişli CLI kontrol ekranı, sürüm uyuşmazlık hatası, erişilebilirlik, dil ayarı (user-advocate).
- 127.0.0.1 bind, oturum token'ı, Origin/Host denetimi, çıktı sanitize, SQLite 0600 (security).
- Adaptör başına fixture + CLI sürüm kapısı; `qwen.txt:34` `-p` deprecated (cost-ops).

## Konuşma nasıl ilerledi
- T1–T3: optimist "2 CLI çok-satıcı değeri öldürür" ve "ACP ortak yol" dedi; skeptic Claude+Codex'in zaten iki satıcı olduğunu ve ACP'nin Claude/Codex'te olmadığını gösterdi; optimist T3'te iki noktada da geri adım attı. Replay-first karşılıklı kabul edildi.
- T4–T6: security, plan modlarının yalnızca davranış tanımı olduğunu gösterdi; skeptic kapı 2'yi canary + transkript sızıntısı testine genişletti; "geçmeyen CLI kapalı" kuralı Codex'e de uygulandı.
- T7–T8: user-advocate Docker şartını kurulum/kimlik gerekçesiyle çürüttü; security T8'de geri çekti ve Claude-only v0'ı 4 koşulla kabul etti — en etkili tek itiraz.
- T9–T13: deterministic `--restricted` sınırlarını ve `--yolo` atıflarını düzeltti, "Claude-only = kapsam değişikliği" sorusunu attı; security kabul etti; optimist T12'de fikir/kod modu ayrımıyla Codex'i geri kazandı, security T13'te canary şartıyla kısmen kabul etti.
- T14–T18: user-advocate sahne yerine karar paneli istedi, optimist sahneyi bıraktı ama bağlantılı STANCE rozetini savundu ve kazandı (T16); skeptic T17'de token ve süre rakamlarını ölçümle çürüttü, cost-ops T18'de 2–3M'yi geri çekip 7–8 gün + önce spike dedi.
