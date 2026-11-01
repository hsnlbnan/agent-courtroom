Son görüşüm koşullu go. Maliyet tarafında asıl kalem barındırma ya da API değil, adaptör bakımı ve doğrulanmamış tahminler. T11'de verdiğim 2–3M token rakamını T17 ve orkestratörün ölçümü çürüttü: bir dava ~1,2M bağlam token'ı tutuyor (`reports/2026-10-30-council-app/conversation.md:213-217`). T18'de süre tahminimi büyüyen kapsama göre 7–8 güne çıkardım. Bu tahmine canary testleri (T8), fikir modunda Codex (T13) ve STANCE rozeti (T16) dahil. Hâlâ ölçülmemiş iki şey var: headless `-p --resume` ile süreç yeniden başlatma maliyeti (`reports/2026-10-30-council-app/context.md:35-37`) ve Gemini'nin ID ile resume'u (`reports/2026-10-30-council-app/cli-help/gemini.txt:38-40`). Bu yüzden önce 1 günlük bir spike yapılmalı, v0 tahmini de spike sonucuna göre yeniden verilmeli. v0 Claude artı Codex (fikir modu) ile sınırlı kalmalı, Gemini v1'e ertelenmeli.

```json
{
  "role": "cost-ops",
  "vote": "conditional",
  "confidence": 0.65,
  "conditions": [
    "Kod yazmadan önce 1 günlük spike: Claude ve Codex için headless resume, cold start süresi ve gerçek stream-json şeması ölçülsün, tahmin buna göre yeniden verilsin",
    "v0 kapsamı Claude artı fikir modunda Codex ile sınırlı kalsın, Gemini v1'e ertelensin",
    "Her adaptör için kaydedilmiş stream fixture ve CLI sürüm kapısı olsun",
    "Tur sayısı, süre ve üye sayısı için tavan konsun",
    "Yayından önce her satıcının ToS'u headless ve abonelik kullanımı için kontrol edilsin"
  ],
  "findings": [
    {"claim": "Dava başına bağlam yaklaşık 1,2M token. T11'deki 2–3M tahmini ölçümle çürütüldü. Headless cold start ise hâlâ ölçülmedi.", "evidence": "reports/2026-10-30-council-app/conversation.md:213-217", "severity": "medium"},
    {"claim": "Güncel v0 kapsamı (canary testleri, Codex fikir modu, rozet) için tahmin 7–8 gün. Doğrulanmadı, spike gerekir.", "evidence": "[assumption]", "severity": "medium"},
    {"claim": "Sürüm sürüklenmesi yüksek. qwen'de -p bayrağı zaten kaldırılacak olarak işaretli, bu yüzden adaptör başına fixture ve sürüm kapısı şart.", "evidence": "reports/2026-10-30-council-app/cli-help/qwen.txt:34", "severity": "high"},
    {"claim": "Gemini ID ile resume yapamıyor görünüyor. Bu adaptörün süresi sınırsız uzayabilir.", "evidence": "reports/2026-10-30-council-app/cli-help/gemini.txt:38-40", "severity": "medium"},
    {"claim": "Barındırma ve ücretli API maliyeti yok (yerel Node/TS, SSE, SQLite). Asıl maliyet bakım ve kullanıcı kurulum desteği.", "evidence": "reports/2026-10-30-council-app/motion.md:35-43", "severity": "low"},
    {"claim": "Satıcıların ToS'u headless ve abonelik kullanımına izin veriyor mu, dosyalardan doğrulanamıyor.", "evidence": "[assumption]", "severity": "high"}
  ]
}
```
