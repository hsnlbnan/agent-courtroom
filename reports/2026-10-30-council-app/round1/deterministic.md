## Deterministic — round 1
**Özet:** Yardım çıktılarına göre altı CLI'ın altısı da etkileşimsiz (headless) bir prompt modu, bir JSON akış çıktısı ve `--model` seçimi sunuyor. Yani adaptör katmanının temel parçaları belgelerde var. Ancak şu dört şey hiçbir dosyada kanıtlanmıyor: olay şemalarının içeriği, Gemini'de ID ile resume, Codex `exec` altında onay politikası ve token/maliyet verisi. Repodaki prototipte orkestratör kodu yok. Yalnızca Claude alt ajanlarıyla çalışıyor ve çok satıcılı CLI senaryosunu hiç test etmiyor.

### Findings
1. **Altı CLI'ın hepsinde headless prompt ve akış çıktısı var, ama biçim adları ve kapsamları farklı.**
   - claude: `-p` ile `--output-format stream-json` kullanılıyor.
   - codex: `stream-json` yok. Bunun yerine `codex exec` altında `--json` ("Print events to stdout as JSONL") var.
   - gemini: `-p` ile `-o stream-json`.
   - kimi: `-p` ile `--output-format` var, ama seçenekler yalnızca `text` ve `stream-json` (`json` yok).
   - qwen: `-p` "deprecated" olarak işaretli; varsayılan yol positional one-shot.
   - cursor-agent: `-p` ile `--output-format stream-json`.

   Olay şemalarının (mesaj tipleri, alanlar) hiçbiri help dosyalarında görünmüyor. Bu yüzden "aynı ad = aynı format" denemez; her CLI'a ayrı parser gerekecek, ve bu parser'ların doğru çalışacağı kanıtlanmış değil.
   - Kısmi (delta) akış yalnızca claude, qwen ve cursor-agent'ta belgelenmiş. gemini, kimi ve codex help'inde böyle bir bayrak yok.
   - Kanıt: `reports/2026-10-30-council-app/cli-help/claude.txt:150-154`, `:175`, `:124-126` · `codex.txt:143-146`, `:245-246` · `gemini.txt:23`, `:45` · `kimi.txt:19-21` · `qwen.txt:20`, `:34`, `:58-59` · `cursor-agent.txt:18-23`
   - Önem: high

2. **ID ile resume beş CLI'da belgeli, Gemini'de değil.**
   - claude: `-r <id>` ve `--session-id <uuid>`.
   - codex: `exec resume` "by id".
   - qwen: `-r <id>` ve `--session-id`.
   - kimi: `-S [id]`.
   - cursor-agent: `--resume [chatId]` ve `create-chat` ("return its ID").
   - gemini: `-r` yalnızca `"latest"` veya index numarası alıyor. `--session-id` ise yalnızca yeni oturum başlatmak için.

   codex ve kimi'de oturuma önceden ID atayan bir bayrak yok. ID'nin çıktıdan nasıl yakalanacağı help dosyalarından anlaşılmıyor.
   - Kanıt: `claude.txt:214-216`, `:228-229` · `codex.txt:150` · `qwen.txt:65-66` · `kimi.txt:11-12` · `cursor-agent.txt:34`, `:63` · `gemini.txt:38`, `:40`
   - Önem: high

3. **Salt-okur çalıştırma her CLI'da farklı bayrakla yapılıyor, ve iki yerde açık boşluk var.**
   - Protokol üyeleri salt-okur tanımlıyor (`council/protocol.md:3`).
   - Salt-okur ya da plan modları:
     - claude: `--permission-mode plan`
     - codex: `-s read-only`
     - gemini: `--approval-mode plan`
     - qwen: `--approval-mode plan`
     - kimi: `--plan`
     - cursor-agent: `--mode plan|ask`
   - Boşluk 1, codex: `-a/--ask-for-approval` yalnızca üst düzey help'te görünüyor. `codex exec --help` çıktısında yok.
   - Boşluk 2, cursor-agent: `-p` açıklaması "Has access to all tools, including write and bash" diyor.

   Plan modlarının headless çalışmada araç çağrılarını gerçekten engellediği hiçbir dosyada doğrulanmıyor.
   - Kanıt: `claude.txt:155-158` · `codex.txt:117-123` (üst düzey), `:161-255` (exec help, `-a` yok), `:196-199` · `gemini.txt:29` · `qwen.txt:41` · `kimi.txt:26` · `cursor-agent.txt:18-20`, `:28-31`
   - Önem: high

4. **Rol prompt'u enjekte etmek için system-prompt bayrağı yalnızca claude ve qwen'de var.** codex, gemini, kimi ve cursor-agent help'inde system-prompt bayrağı yok. Bu dört CLI'da rol ve protokol metni kullanıcı prompt'una gömülmek zorunda. Model seçimi ise altısında da var.
   - Kanıt: `claude.txt:30`, `:236`, `:139` · `qwen.txt:36-37`, `:33` · `codex.txt:79`, `:183` · `gemini.txt:22` · `kimi.txt:17` · `cursor-agent.txt:36-38`
   - Önem: medium

5. **Token/maliyet sayacı hiçbir help dosyasıyla desteklenmiyor. Ayrıca claude'un minimal modu abonelik girişini dışlıyor.**
   - Bütçe ve sınır bayrakları yalnızca iki yerde var:
     - claude `--max-budget-usd`. Help metnine göre "API calls" için.
     - qwen `--max-wall-time` ve `--max-tool-calls`.
   - Akış çıktısında token veya maliyet alanı olduğunu gösteren bir dosya yok.
   - claude `--bare` modunda kimlik doğrulama "strictly ANTHROPIC_API_KEY"; "OAuth and keychain are never read". Bu, motiondaki "kullanıcının mevcut aboneliği" hedefiyle (`motion.md:26`) bu mod altında çelişiyor.
   - Kanıt: `claude.txt:135-136`, `:45-56` · `qwen.txt:70-71`
   - Önem: medium

6. **Prototip çok satıcılı CLI senaryosunu kanıtlamıyor.**
   - Repoda kod ya da yapılandırma olarak yalnızca `council.json` var. Glob ile `**/*.{ts,js,mjs,py,sh,json}` taraması tek sonuç döndürdü.
   - Üyeler Claude alt ajanları: README'de rol başına sonnet/opus/fable, SKILL içinde `Agent subagent_type` ve `SendMessage` ile resume.
   - Planlanan path B "Claude Agent SDK" üzerinde. Motion ise çok satıcılı headless CLI istiyor.
   - Kanıt: `README.md:3`, `:7`, `:33-41` · `.claude/skills/council/SKILL.md:52`, `:64` · `docs/superpowers/specs/2026-10-30-agent-council-design.md:12` · `reports/2026-10-30-council-app/motion.md:7-8`, `:24-26`
   - Önem: high

7. **Gerçek koşu tamamlanmadı ve protokol kuralları belgelerde ya da koşuda tutarsız uygulanıyor.**
   - Koşu T7'de iptal edildi; kapanış ve karar yazılmadı.
   - T3, T4, T5 ve T6'nın hepsi `STANCE: build`.
   - T4 bir soru soruyor ("söyler misin?") ama etiketi `build`. Oysa protokol, soru soran bir turun STANCE `question` olmasını şart koşuyor.
   - T5'te `context.md` satırının `package.json` satırı gibi atfedildiği yakalandı.
   - README hâlâ "three rounds" ve `round2/`, `round3/` klasörlerini anlatıyor. Protokol ise konuşma turları (T1, T2, ...) tanımlıyor.
   - 4–6 günlük MVP tahmini motionın kendi metninde "unverified".
   - Kanıt: `reports/2026-10-30-isim-analiz/conversation.md:107`, `:68`, `:77`, `:83`, `:90`, `:99`, `:92` · `council/protocol.md:53-55` · `README.md:3`, `:27-28` · `council/protocol.md:40-56` · `reports/2026-10-30-council-app/motion.md:38`
   - Önem: medium

### Provisional vote
conditional — confidence 0.6 — Altı CLI'ın headless temel parçaları help dosyalarında var, ama orkestratör kodu yok. Olay şemaları, Gemini'de ID ile resume, codex exec'te onay politikası, plan modlarının gerçekten salt-okur olması ve maliyet verisi doğrulanmadı. Koşul: her adaptör için gerçek bir `stream-json` ya da JSONL örnek çıktısı ile bir resume denemesi kaydedilip kanıt olarak eklensin.
