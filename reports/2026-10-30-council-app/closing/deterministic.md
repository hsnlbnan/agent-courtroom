Kapanış pozisyonum `conditional`, güven 0.65; yalnızca help metniyle kanıtlanan olgulara dayanıyor. T10'dan sonra Claude'un okuma araçlarının bağlamı da netleşti: `--restricted` kod çalıştıran araçları kaldırıyor ve dosya araçlarını çalışma dizinleriyle sınırlıyor. Ancak MCP yalnızca `--strict-mcp-config` ile atlanıyor ve env okumayı engelleyen bir satır yok. T9'daki "`--tools` listelenmiyor" tespitim help çıktısının eksik yakalanmasından kaynaklanıyordu; yeniden yakalanan help'te `--tools ""` ile tüm araçlar kapatılabiliyor (`cli-help/claude.txt:259-263`), bunu düzeltiyorum. T10'da security `--yolo` atıf düzeltmemi ve "Claude-only = kapsam değişikliği" sınıflandırmasını kabul etti. Ölçüm notu (`conversation.md:213-217`), T11'deki ~2–3M token tahmininin dayandığı 100–180k rakamını (`context.md:26-27`) çürüttü (T17, T18). Yine de dosyalar hâlâ şunları kanıtlamıyor: CLI olay şemalarının içeriği, headless yeniden başlatmada cold start süresi (`context.md:35-37`), Gemini'de ID ile resume (`gemini.txt:38-40`) ve Codex `read-only` modunun okuma kapsamı (`codex.txt:92-95`). Bu yüzden 7–8 günlük v0 tahmini (T18) de doğrulanmış değil.

```json
{
  "role": "deterministic",
  "vote": "conditional",
  "confidence": 0.65,
  "conditions": [
    "Kodlamadan önce 1 günlük spike: Claude ve Codex için gerçek stream-json/JSONL örnek çıktıları ve ID ile resume denemesi kaydedilip fixture olarak repoya eklensin",
    "Spike'ta headless süreç başına cold start ve tur başına token ölçülsün; MVP tahmini bu ölçüme göre yeniden verilsin",
    "Her üye için salt-okur davranış (Claude --restricted / --tools \"\", Codex -s read-only) canary testiyle doğrulanmadan varsayılan olarak açılmasın",
    "v0 Claude-only ya da Claude + Codex ise ürün bunu açıkça kapsam daraltması olarak belgelesin (motion.md:3-4, :24-26)"
  ],
  "findings": [
    {"claim": "Altı CLI'ın altısında da headless prompt modu ve JSON akış çıktısı var, ama adları farklı (codex: exec --json JSONL; kimi'de json seçeneği yok) ve olay şemaları hiçbir help dosyasında yok", "evidence": "reports/2026-10-30-council-app/cli-help/claude.txt:150-154, codex.txt:245-246, gemini.txt:45, kimi.txt:19-21, qwen.txt:58, cursor-agent.txt:21-22", "severity": "high"},
    {"claim": "Gemini'de ID ile resume belgelenmemiş: -r yalnızca 'latest' veya index alıyor, --session-id yalnızca yeni oturum başlatıyor", "evidence": "reports/2026-10-30-council-app/cli-help/gemini.txt:38-40", "severity": "high"},
    {"claim": "Claude --restricted kod çalıştıran araçları ve WebFetch'i kaldırıyor, dosya araçlarını çalışma dizinleriyle sınırlıyor; MCP yalnızca --strict-mcp-config ile atlanıyor, env okuma engeli yazmıyor; --tools \"\" tüm araçları kapatıyor", "evidence": "reports/2026-10-30-council-app/cli-help/claude.txt:199-213, :259-263", "severity": "high"},
    {"claim": "codex exec help'inde -a/--ask-for-approval yok; read-only sandbox yazmayı engelliyor ama okuma kapsamına dair bir satır yok", "evidence": "reports/2026-10-30-council-app/cli-help/codex.txt:117-123, :161-255, :92-95", "severity": "medium"},
    {"claim": "System prompt bayrağı yalnızca claude ve qwen'de var; maliyet/bütçe bayrağı yalnızca claude --max-budget-usd (API calls) ve qwen sınırları; claude --bare OAuth okumuyor", "evidence": "reports/2026-10-30-council-app/cli-help/claude.txt:30, :236, :135-136, :45-56, qwen.txt:36-37, :70-71", "severity": "medium"},
    {"claim": "Prototipte orkestratör kodu yok; üyeler Claude alt ajanları, planlanan path B Claude Agent SDK üzerinde ve çok satıcılı headless CLI'ı test etmiyor", "evidence": "README.md:3, :7; .claude/skills/council/SKILL.md:52, :64; docs/superpowers/specs/2026-10-30-agent-council-design.md:12", "severity": "high"},
    {"claim": "Bu koşuda ölçülen dava toplamı ≈1.2M context token, üye turu başına 31–54k; context.md'deki 100–180k başka bir koşudan ve generic ajanlardan geliyor", "evidence": "reports/2026-10-30-council-app/conversation.md:213-217, reports/2026-10-30-council-app/context.md:26-27", "severity": "low"}
  ]
}
```
