#!/usr/bin/env node
// A slow, scripted stand-in for the `claude` CLI, used by states.mjs to put the
// UI into each waiting state long enough to screenshot it. It answers every
// council prompt in the right shape, streams turn text in small pieces, and
// fails the verdict when the case question contains FAILCASE.
const prompt = process.argv[process.argv.indexOf('-p') + 1] ?? '';
const sid = `stage-${process.pid}`;
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fence = '```';
const json = (o) => `\n${fence}json\n${JSON.stringify(o)}\n${fence}`;
const done = (text) => { out({ type: 'result', result: text, session_id: sid, usage: { input_tokens: 1800, output_tokens: 240 } }); };
const role = (prompt.match(/You are the council's (\S+)/) ?? prompt.match(/role": "([\w-]+)/) ?? [])[1] ?? 'member';

out({ type: 'system', subtype: 'init', session_id: sid });
if (prompt.includes('The hearing below has ended')) {
  await wait(4000);
  done(prompt.includes('risks')
    ? 'Kurulum en riskli nokta.\n\n1. **Ön koşul eksikliği:** Node 22.5 yoksa uygulama açılmıyor (T1). Kontrol: Node 20 ile `npx agent-courtroom` çalıştır; anlaşılır bir mesaj çıkmalı.\n2. **Giriş yapılmamış CLI:** `README.md:1` bunu anlatmıyor. Kontrol: çıkış yapıp başlat; arayüz çözüm adımını göstermeli.\n3. **Uzun davalarda bekleme:** kullanıcı ne olduğunu göremiyor. Kontrol: 6 turluk dava; her bekleme 3 sn içinde açıklanmalı.'
    : 'Tartışma ilk açılış deneyimine işaret ediyor.\n\n1. **Kurulum sihirbazı:** ilk açılışta ön koşulları tek ekranda kontrol et (T1). Deney: 5 kişiye kurdur, takıldıkları adımı say.\n2. **Örnek dava ile başla:** boş ekran yerine hazır bir dava oynat. Deney: ilk 2 dakikada yeni dava açma oranı.\n3. **Paylaşılabilir karar kartı:** kararı tek görsel olarak dışa aktar. Deney: kaç kişi paylaşıyor.');
} else if (prompt.includes('MODERATOR')) {
  await wait(3000);
  done('NEXT: skeptic REPLY_TO: O-optimist WHY: Kurulum adımlarındaki en zayıf varsayımı sınasın.');
} else if (prompt.includes('Your turn')) {
  await wait(2200); // the "waiting for the first words" window
  const text = 'REPLY_TO: O-optimist\nADDRESSES: optimist\nSTANCE: challenge\nKurulumun tek komutla bittiği iddiası `README.md:1` ile desteklenmiyor. Node sürümü ve CLI girişi iki ayrı ön koşul; ilk açılışta biri eksikse kullanıcı ne yapacağını görmüyor. Bu kanıtlanana kadar "hazır" demek erken.';
  for (const piece of text.match(/.{1,24}/gs)) {
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: piece } } });
    await wait(220);
  }
  done(text);
} else if (prompt.includes('Write the verdict')) {
  await wait(4000);
  if (prompt.includes('FAILCASE')) process.exit(1);
  done(`# Konsey kararı — örnek\n\n**Karar:** conditional — güven 0.72\n\n**Tek satır gerekçe:** Temel sağlam; kurulum ve hata yolları netleşmeden yayına çıkılmamalı.\n\n## Uzlaşma\n- Yerel ve salt-okuma tasarım doğru.\n\n## Çözülmemiş ayrılıklar\n- İlk açılış deneyimi yeterince açık mı?\n\n## İlk adımlar\n1. Ön koşul kontrollerini arayüzde göster (\`README.md:1\`).\n2. Hata ekranlarına çözüm adımı ekle.\n3. Kısa bir kurulum videosu hazırla.${json({
    verdict: 'conditional', confidence: 0.72, reason: 'Temel sağlam; kurulum ve hata yolları netleşmeden yayına çıkılmamalı.',
    consensus: ['Yerel ve salt-okuma tasarım doğru.', 'Atıf doğrulama güven veriyor.'],
    disagreements: [{ topic: 'İlk açılış deneyimi yeterince açık mı?', positions: [{ role: 'optimist', position: 'Tek komut yeterli.' }, { role: 'skeptic', position: 'Ön koşullar görünmüyor.' }], chair_read: 'Şüpheci haklı; ön koşullar arayüzde görünmeli.' }],
    first_steps: ['Ön koşul kontrollerini arayüzde göster (`README.md:1`).', 'Hata ekranlarına çözüm adımı ekle.', 'Kısa bir kurulum videosu hazırla.'],
  })}`);
} else if (prompt.includes('Round 1')) {
  await wait(5000); // blind openings
  done(`**Özet:** Proje yerel çalışıyor ve üyeleri salt-okuma tutuyor; asıl soru ilk açılış deneyimi.\n\n- Kurulum tek komut (\`README.md:1\`).\n\n### Geçici oy\nconditional — güven 0.7 — kurulum ön koşulları görünmeli.`);
} else if (prompt.includes('closing statement')) {
  await wait(3000);
  done(`T1'deki itiraz yerinde; kurulum ön koşulları görünür olmalı.${json({ role, vote: role === 'skeptic' ? 'no-go' : 'conditional', confidence: role === 'skeptic' ? 0.64 : 0.78 })}`);
} else {
  await wait(5000); // blind openings
  done(`**Özet:** Proje yerel çalışıyor ve üyeleri salt-okuma tutuyor; asıl soru ilk açılış deneyimi.\n\n- Kurulum tek komut (\`README.md:1\`).\n\n**Oy:** conditional 0.7`);
}
