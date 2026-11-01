## Optimist — round 1

**Özet:** Fikrin çekirdeği sağlam ve kanıtlı. Altı CLI'nin dördünden fazlası aynı dört yeteneği gösteriyor: headless mod, stream-json çıktı, session resume ve salt-okunur mod. Çalışan prototip ise "tartışma formatı"nın değer ürettiğini zaten gösterdi. Gerçek boşluk, bunu çok-satıcılı CLI'larla görsel ve canlı hale getirmek. Bu boşluk bir frontend geliştiricisinin güçlü olduğu yerde duruyor.

### Findings
1. **Headless + stream-json neredeyse evrensel, adapter katmanı ince olur.** claude `-p`/`--output-format stream-json`, `--resume`, `--session-id` (`reports/2026-10-30-council-app/cli-help/claude.txt:150-154,214,228`); qwen `--output-format stream-json`, `--resume`, `--session-id` (`.../qwen.txt:58,65-66`); gemini `-o stream-json`, `-r` (`.../gemini.txt:38,45`); kimi `-p` + `--output-format stream-json`, `-S` (`.../kimi.txt:11,19-21`); cursor-agent `--print`, `stream-json`, `--resume` (`.../cursor-agent.txt:18-22,34`); codex `exec`, `--json`, `exec resume` (`.../codex.txt:14,150,245`). MVP'yi ilk etapta 3 CLI ile (claude, codex, gemini) sınırlamak makul. — severity: high (olumlu kaldıraç)
2. **Salt-okunur üye modu her CLI'da var, bu güvenlik ve güven hikâyesini açar.** codex `--sandbox read-only` (`.../codex.txt:92-95`); gemini `--approval-mode plan` (read-only) (`.../gemini.txt:29`); cursor-agent `--mode plan/ask` (`.../cursor-agent.txt:28-31`); qwen `--approval-mode plan` (`.../qwen.txt:41`); claude `--permission-mode` ve `--allowedTools` (`.../claude.txt:27,155`). "Üyeler repoyu okur, yazmaz" bir özellik olarak pazarlanabilir. — severity: high
3. **Protokol zaten yazılı ve çalışıyor; ürünün ham maddesi hazır.** `council/protocol.md:29-72` rol çıktısı, STANCE, REPLY_TO, kapanış JSON'u tanımlıyor. `STANCE: challenge` sözleşmesi ("Objection!" olayı) ve kapanış JSON'u (jüri oyu, azınlık görüşü) UI'a doğrudan eşlenir. Gerçek koşuda REPLY_TO/STANCE yapısı makine okunur çıktı (`reports/2026-10-30-isim-analiz/conversation.md:43-77`). Mahkeme metaforu için yeni veri modeli gerekmiyor. — severity: high
4. **Gerçek koşu, formatın çatışma ürettiğini gösteriyor.** Skeptic'in itirazı Optimist'in bahsiyle çarpıştı, sonra `concede` geldi (`reports/2026-10-30-isim-analiz/conversation.md:43-57`). Moderatör tutarlı biçimde gerçek bir ayrışma seçiyor (`:40,63,72,85`). Bu "izlemeye değer" içeriğin kanıtı, canlı UI için kritik. — severity: medium
5. **Bilinen sorunların çoğu ürün tasarımıyla çözülebilir, temel engel değil.** Satır numarası karışması, nazik "build" kayması ve yanlış etiketlenen soru, orkestratör tarafında doğrulanabilir kurallarla yakalanır. Örnekler: STANCE ile soru işaretini çapraz kontrol etmek, alıntılanan `path:line` değerini gerçek dosyaya karşı doğrulamak. Bunlar özellik olur ("fact-check badge"). Kaynak: `reports/2026-10-30-council-app/context.md:27-34`. — severity: medium
6. **Gecikme bir UI sorunu değil, UI'ın avantajı.** Tur başına ~1 dk (`context.md:23-26`) hâlâ tiyatro gibi izlenebilir. Streaming ve "düşünüyor..." animasyonu bunu kapatır. Açılışlar paralel koşuyor (25-180 sn, `context.md:23`). Asıl hız kazancı da açılışta paralelliktir. — severity: medium
7. **Farklılaşma: mevcut araçların çoğu API tabanlı; abonelik + repo-okuyan CLI üyeleri bu işi ayırır.** Bu bir pazar iddiası, dosyada doğrulayamadım. [assumption] Motion bu gerekçeyi açıkça sayıyor (`reports/2026-10-30-council-app/motion.md:24-26`). Tek başına prototip ve claude-only da farklı bir ürün (`council.json:1-17`), ama çok-satıcılı çapraz-görüş değeri taşımıyor. — severity: medium

### Çift bahis (double down)
1. **Olay-akışı sözleşmesi (protokol -> JSON event şeması) ilk gün.** `council/protocol.md` + kapanış JSON'u zaten ham şema. Adapter'lar bunu üretmeye zorlanır, UI sadece tüketir. Tüm CLI farkları adapter altında kalır.
2. **Replay-first MVP.** SQLite transkript + kayıttan oynatma, UI geliştirmeyi canlı CLI'lardan ayırır. Frontend uzmanlığın vitrini olur, demo/GIF kolay üretilir (açık kaynak büyümesi için kritik). Canlı çalıştırma sonra gelir.
3. **Tek CLI ile başla (claude), sonra codex, sonra gemini.** Claude'un `--session-id` ve `--include-partial-messages` benzeri akış bayrakları en zengin (`claude.txt:114-126,228`). İlk dilim bununla riski en aza indirir.

### Riskleri dürüstçe kabul ediyorum
- Bayrak sürümleri kayabilir: bu yüzden adapter başına sürüm kapısı gerekir (`motion.md:27-30`).
- ToS/otomatik kullanım ve pazar iddiaları dosyalarda yok: [assumption], Security/Cost-ops doğrulamalı.
- Prototip CLI'ları hiç test etmiyor (`context.md:35-37`). Yani çok-satıcılı headless çalışma hâlâ kanıtsız. En büyük açık bu.
- 4-6 gün tahmini doğrulanmadı (`motion.md:36-38`). Replay-first dilim için gerçekçi, 3 CLI canlı için iyimser. [assumption]

### Provisional vote
**conditional** — confidence 0.72 — Fikir teknik olarak yapılabilir ve protokol hazır. Koşul: ilk sprintte 2-3 CLI ile gerçek bir headless tur spike'ı (stream-json ayrıştırma + resume) yapılsın, bu kanıtlanmadan UI'a tam yatırım yapılmasın.
