## Cost / ops — round 1

**Özet:** Headless-CLI kararı teknik olarak uygulanabilir. Altı CLI'nin altısında da headless mod ve akış/JSON çıktısı var, ama bunların hiçbirinin akış şeması birbiriyle aynı değil. Ana maliyet para değil, bakım yükü: 6 adaptör, hızlı değişen sürümler ve her turda yeniden başlayan süreçler. 4–6 gün MVP tahmini makul ama doğrulanmamış; sürdürme maliyeti MVP'den büyük olur.

### Bulgular
1. **Her CLI'de headless var, ama bayrak seti farklı; adaptör sayısı = bakım yüzeyi.**
   - claude: `-p` ve `--output-format stream-json` (`reports/2026-10-30-council-app/cli-help/claude.txt:150-154`).
   - gemini: `-p` ve `-o stream-json` (`cli-help/gemini.txt:23,45`).
   - kimi: `-p` ve `--output-format stream-json` (`cli-help/kimi.txt:19-21`).
   - qwen: `-o stream-json` ve `--json-schema` (`cli-help/qwen.txt:58-62`).
   - cursor-agent: `-p` ve `--output-format` (`cli-help/cursor-agent.txt:18-22`).
   - codex: ayrı alt komut `exec` ve `--json` (`cli-help/codex.txt:14,245`).
   - Onay/izin bayrakları da farklı: `--permission-mode`, `--approval-mode`, `-y`, `-f`, `-a/-s`. Salt-okunur (güvenli) modu her adaptörde ayrı eşlemek gerekir.
   - Şiddet: orta.

2. **Sürüm sürüklenmesi yüksek; her adaptör için sürüm kapısı ve CI gerekir.**
   - Sürümler: claude 2.1.310, codex 0.159.0, gemini 0.62.0, kimi 0.27.0, qwen 0.17.1, cursor-agent 2026.01.23 (`reports/2026-10-30-council-app/context.md:9-12`).
   - qwen'de `-p` zaten "deprecated, will be removed" (`cli-help/qwen.txt:34`). Bu, bayrakların yakında kırılacağının kanıtı.
   - Motion de aynı riski kabul ediyor (Spotify Xirp örneği, `motion.md:28-30`).
   - Gerçek CLI'lerle CI testi ücretli ve oturum gerektirir. Bu yüzden kayıtlı fixture (golden stream) testi şart.
   - Şiddet: yüksek.

3. **Oturum devamı (resume) tutarsız; "tur başına yeni süreç" ya da "devam ettir" seçimi maliyeti belirler.**
   - Resume var: claude `--fork-session`/resume (`claude.txt:108`), gemini `-r` (`gemini.txt:38`), qwen `-r/--session-id` (`qwen.txt:64-67`), kimi `-S` (`kimi.txt:11`), cursor `--resume` (`cursor-agent.txt:34`), codex `exec resume` (`codex.txt:150`).
   - Her biri farklı kimlik/saklama modeli kullanıyor. Codex `--ephemeral` ve claude `--no-session-persistence` ile devam edilemez hale gelir.
   - Ölçülen: prototipte resume edilen ajan turu 17–30 s sürdü ve önceki okumayı korudu (`context.md:24-26`). Ama bu Claude alt ajanları, ayrı CLI süreci değil (`context.md:35-37`). Gerçek süreç başlatma maliyeti ölçülmedi. [assumption] 3–10 s ek açılış.
   - Şiddet: orta.

4. **Token/bağlam maliyeti kullanıcı aboneliğine yüklenir ve hızlı büyür; "maliyet sayacı" yanıltıcı olabilir.**
   - Tur başına üye bağlamı ~100–180k token (`context.md:26-27`). 6 üye × ~10 tur ≈ 60 tur ≈ milyonlarca token [assumption, çarpım tahmini].
   - Abonelik kotası (rate limit) tükenebilir. Her CLI'nin kullanım/maliyet alanı farklı; bazılarında hiç olmayabilir [assumption].
   - Ucuz azaltmalar: üye sayısını 3–4'e indir, bağlamı özetle, `--max-session-turns` / `--max-wall-time` gibi tavanlar kullan (qwen'de var: `qwen.txt:69-70`).
   - Şiddet: orta.

5. **Operasyonel olarak ucuz kısım: barındırma yok, yalnızca yerel; sunucu, ücretli API, anahtar yönetimi gerekmiyor.**
   - Mimari Node/TS + SSE + yerel SQLite (`motion.md:35-38`). Çalışma zamanı bağımlılığı az olur [assumption: ~10–20 doğrudan bağımlılık; UI çerçevesi hariç].
   - Kullanıcı her CLI'yi kendi kurar ve giriş yapar (`motion.md:41-43`). Bu, destek yükünü artırır ("benim gemini girişim çalışmıyor" sorunları).
   - Şiddet: düşük.

6. **Kalite sorunları prototipte görüldü; bunlar gözlemlenebilirlik ve test gerektirir.**
   - Üyeler bağlam dosyasının satır numaralarını gerçek dosyanınki sanarak alıntıladı; nazik "build" uyumuna kayma; yanlış STANCE etiketi nedeniyle otomatik yanıt kuralı tetiklenmedi (`context.md:28-33`).
   - Bunlar kural-tabanlı doğrulayıcı (stance parse, alıntı kontrolü) ve olay günlüğü ister. Her olayı SQLite'a yazmak (zaten planlı) hem tekrar oynatma hem hata ayıklama için en ucuz gözlemlenebilirlik.
   - Şiddet: orta.

7. **Güvenlik/işletim riski (bakım maliyetine dönüşür): ajanlar repoyu kendi araçlarıyla okur; onay bayrakları atlanırsa yazma/komut riski doğar.**
   - Codex `--dangerously-bypass-approvals-and-sandbox` "EXTREMELY DANGEROUS" (`codex.txt:100-102`); qwen/gemini/kimi `--yolo`. Varsayılanı plan/salt-okunur tutmak gerekir (gemini `plan`: `gemini.txt:29`, cursor `--plan`: `cursor-agent.txt:32`).
   - ToS: otomatik/headless kullanımın her satıcıda serbest olup olmadığı dosyalardan doğrulanamaz. [assumption] Abonelik kimlik bilgilerini üçüncü taraf uygulamadan sürmek bazı satıcılarda kısıtlı olabilir; yayından önce her satıcı için kontrol edilmeli.
   - Şiddet: yüksek (hukuki/ToS belirsizliği).

### En ucuz, en yüksek getirili değişiklikler
1. Önce 2 adaptör (claude + codex, ya da kurulu olanlardan en kararlı ikisi); gerisini topluluğa bırak.
2. Her adaptör için kaydedilmiş stream fixture + sürüm kapısı (CLI `--version` kontrolü).
3. Her olayı SQLite'a yaz; tekrar oynatma ve hata ayıklama aynı kayıttan gelsin.
4. Varsayılan salt-okunur mod, tur/süre/üye tavanı.
5. Yayından önce her satıcının ToS'unu kontrol et.

### Provisional vote
**conditional — güven 0.6 —** Hosting maliyeti yok ve yapılabilir; ama 6 adaptörün bakımı, sürüm sürüklenmesi ve ToS belirsizliği yüzünden yalnızca 2 adaptör + fixture testi + ToS kontrolü şartıyla.
