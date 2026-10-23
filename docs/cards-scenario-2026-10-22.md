# Kart modeli — senaryo (2026-10-22)

Sadece konuşma; kod yok. Bu doküman sonra implemente edilecek. Branch `domain` üstündeki
refactor bittikten sonra ayrı bir milestone olur.

Senaryo: proje `tenbox-demo`, task **DEMO-7 "GET /health returns the app version"**.
Baştan sona: `tenbox start`, planner, senin tarafın (`answer`, `approve`), build, worker'ın
sorusu, review, `build done`, PR, PR'dan dönen bulgular, `close`.

## Kurallar

- Bir taskın her kaydı bir **kart**, `cards/` altında. Numara sırayı verir, `<kind>` türü.
  Numarayı tenbox verir: klasördeki en büyük numara + 1, dosyayı "yoksa yarat" (`wx`) ile
  açar; başka bir süreç aynı numarayı aldıysa bir sonrakini dener. Kilit yok. Gruplar
  paralel build olurken gerekli. Bir gruba ait kart (worker sorusu, review) `group` taşır.
- Bir kart **çift dosya**:
  - `NNNN-<kind>.json`: kodun okuduğu her şey. Tenbox yazar, `jsons.check` ile şemaya karşı
    okur. Her kartta `id`, `kind`, `by`, `at`; cevap kartlarında `replyTo`.
  - `NNNN-<kind>.md`: uzun metin. İsteğe bağlı; sadece task ve plan kartında var. Kod
    `.md`'yi parse etmez. Kısa metin (sebep, sonuç, cevap) `.json`'da bir alandır.
- Agent veriyi **son mesajında döner**, tenbox `.json`'u yazar. Workflow `schema:` ile son
  mesajı zorlar: Claude Code, şemaya uymayan cevabı agent'a düzelttirir. Agent sadece `.md`
  ve `parts/` dosyalarını kendi yazar.
- Kartlar silinmez, değişmez, eklenir. Cevap, `replyTo` ile yeni bir kart. Bir kartın
  geçerli hali = kendisi + ona verilen en yeni cevap.
- Çizgi: **bir agent ya da insan okuyorsa kart; sadece tenbox yazıp sadece tenbox okuyorsa
  düz JSON dosyası** (`build.json`, `checks.json`, `checks-full.json`, `group.json`,
  `stats.json`, baseline).
- Durum saklanmaz, kartlardan hesaplanır.
- Her agent işe `cards/` okuyarak başlar.

## Kart türleri

| Kart | Açan | Ne zaman | `.md` |
|---|---|---|---|
| task | tenbox | `tenbox start` | var: açıklama + tracker yorumları |
| plan | planner → tenbox | `tenbox plan done` | var: plan metni, planner yazar |
| question | planner → tenbox | `tenbox plan done` | yok |
| question | worker → tenbox | `tenbox build done`, takılınca | yok |
| answer | sen → tenbox | `tenbox answer` | yok |
| answer (`auto: true`) | tenbox | deadline geçince | yok |
| note | sen → tenbox | `tenbox note` | yok |
| approval | sen → tenbox | `tenbox approve` | yok |
| review | reviewer → tenbox | `tenbox review done`, her round | yok |
| review (`by: user`) | sen → tenbox | `tenbox feedback --from-pr`, PR yorumlarını toplar | yok |
| question (`by: user`) | sen → tenbox | `tenbox feedback --from-pr`, PR'daki her thread | yok |
| answer (`by: worker`) | worker → tenbox | `tenbox reply done`, PR sorularına | yok |

"planner → tenbox": planner son mesajında döner, tenbox dosyayı yazar.

## Question kartı

Tek tür. Birinin bir seçim ya da bilgi sorduğu her şey bu; planner da worker da aynı
şekli kullanır. Alanlar:

| Alan | Ne | Ne zaman |
|---|---|---|
| `title` | soru, bir satır | her zaman |
| `area` | ne hakkında: `technical`, `product`, `contract`, `risk`, `migration`, `data-delete`, `feature-delete`, `paid-service`, `locked-file`, `scope`, `other` | her zaman |
| `options` | `[{ text, effect }]`, soranın tercih sırasında; `effect`: bu seçilirse ne olur, bir satır | seçenek yazılabiliyorsa |
| `taken` | soranın seçtiği seçenek, 1'den | seçebildiyse; sadece `options` varken |
| `reason` | neden bunu seçti; `taken` yoksa neden seçemedi | her zaman |
| `round`, `part`, `group` | hangi round, hangi part, hangi grup | sadece worker; `group` sadece gruplu planda |
| `path`, `line`, `thread` | PR'daki satır ve thread | sadece senin PR yorumların |
| `auto` | cevap gelmezse 1. seçenekle devam edilebilir mi | sadece worker |
| `deadline` | auto cevabın zamanı | tenbox koyar; `auto: true` ve alan "asla otomatik" değilse |

Tek `area` listesi: planner'ın bugünkü dört alanı ile worker'ın sekiz alanı birleşti.
Planner da `locked-file` sorabilir, worker da `product`. "Asla otomatik" kuralı alana
bağlı: `migration`, `data-delete`, `feature-delete`, `contract`, `paid-service`,
`locked-file` hiç auto cevaplanmaz.

Dört durum, aynı şekil:

| Durum | Kart | Örnek |
|---|---|---|
| seçim, soran seçti | `options` ≥ 2, `taken` var | "version source: package.json / env" |
| seçim, soran seçemedi | `options` ≥ 2, `taken` yok | "shipped order cancel: yes / no" |
| varsayım | `options` 1 tane, `taken: 1` | "I assume the version is semver" |
| bilgi gerek | `options` yok, `taken` yok | "Which Linear team owns this project?" |

Planner ile worker farkı: planner sorar ve `taken` ile ilerler, çünkü varsayımı sadece plan
metnine girer, sen onaylamadan kod olmaz. Worker `taken` vermez ve durur, çünkü varsayımı
doğrudan kod olur.

Tanımlar:

- **açık soru**: `taken` yok ve cevap yok. Approve'u engeller; worker sorusuysa build durur.
- **geçerli seçenek**: en yeni cevabın `option`'ı, yoksa `taken`. Worker ve reviewer bu
  kuralla okur.
- Cevap: `{ "replyTo": N, "option": k }` ya da seçeneklerin dışında bir şey için
  `{ "replyTo": N, "text": "..." }`. `options` olmayan soruya sadece `text`.

Planner kuralı: "Taskın söylemediği ve kodu değiştiren her seçim bir question. Sadece etkisi
taskın dosyaları dışına çıkan ya da kullanıcının bir komutu çalıştırmasını değiştiren
seçimler; bariz seçimleri kendin yap, yazma. Seçenek yazabiliyorsan yaz, en çok tercih
ettiğin ilk sırada, her birine bir satır sonuç. Seçebiliyorsan `taken` ver, seçemiyorsan
verme. Seçenek yazamıyorsan ne bilgi gerektiğini yaz."

Worker kuralı: "Planın ve kartların söylemediği, dosyalarının dışına çıkan ya da `locked`
bir dosyaya dokunan bir şey gerekiyorsa yapma: `status: blocked` ve bir question dön.
Seçenekleri tercih sırasında yaz, `taken` verme. `auto: true` sadece 1. seçenek güvenliyse."

## `tenbox answer`: tek cevap komutu

```
tenbox answer DEMO-7 2 2              kart 2'ye seçenek 2
tenbox answer DEMO-7 9 --text "..."   kart 9'a seçeneklerin dışında bir cevap
tenbox note DEMO-7 "..."              soru değil, bilgi: note kartı
```

`answer` kartı yazar, sonra taskın durumuna bakar ve gerekeni yapar:

| Durum | Sonra |
|---|---|
| cevaplanan soru bir worker sorusu ve build onda duruyor | duran run'ı `--resume` ile sürdürür |
| onaylı plan var, build yok | build'i başlatır (`tenbox build` gibi) |
| ikisi de değil | sadece yazar |

`--no-build`: yaz, hiçbir şeyi başlatma ve sürdürme. Birkaç soruya sırayla cevap verirken.

Kontroller, hiçbir şey yazmadan önce: kart var ve question; `option` o sorunun bir seçeneği
(`options` yoksa `option` olamaz); kart numarası zorunlu, çünkü aynı anda birden çok açık
soru olabilir.

## Adım 0 · `tenbox start DEMO-7`

Sen, PC'de. Tenbox tracker'dan taskı çeker, worktree açar, ilk kartı yazar.

```
~/.tenbox/k7f3qa/DEMO-7/
  cards/
    0001-task.json
    0001-task.md
  parts/
  rounds/
```

### `cards/0001-task.json`

```json
{ "id": 1, "kind": "task", "by": "tenbox", "at": "2026-10-22T09:00:00Z",
  "task": "DEMO-7", "title": "GET /health returns the app version",
  "tracker": "linear", "url": "https://linear.app/..." }
```

`tenbox start --kind <kind>` verildiyse task kartına `taskKind` girer; `plan done` onu
planner'ınkinin üstüne yazar. `--kind docs` planner çalıştırmaz: tenbox plan kartını kendisi
yazar (tek part, soru yok).

### `cards/0001-task.md`

```markdown
Add a GET /health route. It returns `{ version }` read at boot.

> 2026-10-21 enes: version comes from package.json, no env var.
```

Sonra `claude --bg` ile worktree'de `/tenbox-plan DEMO-7` başlar. Sana bildirim gelmez.

## Adım 1 · Planner çalışır

Workflow `tenbox-plan.js`, subagent `planner`. Okur: `cards/`, kod.

**Kendi yazdıkları:** `parts/01-health.md` ve `plan.md` (plan metni, ≤60 satır). `plan done`
bu dosyayı plan kartının `.md`'si olarak taşır; numarayı planner bilmek zorunda değil.

**Son mesajında döndürdüğü**, workflow `schema: PLAN` ile zorlar:

```json
{ "taskKind": "small",
  "parts": [{ "id": "01", "difficulty": "easy" }],
  "examples": [{ "part": "01", "title": "health returns version",
                 "before": "GET /health → 404",
                 "after": "GET /health → 200 { version: \"1.4.0\" }" }],
  "groups": [],
  "questions": [
    { "title": "Version source", "area": "technical",
      "options": [
        { "text": "package.json",    "effect": "no deploy change; version bumps with the release" },
        { "text": "env APP_VERSION", "effect": "one more deploy variable; can differ from the package" } ],
      "taken": 1,
      "reason": "package.json is already read at boot." },
    { "title": "Should /health also report db status?", "area": "product",
      "options": [
        { "text": "no, version only", "effect": "one route, no db call" },
        { "text": "yes, add db: ok|down", "effect": "a db ping per call; the route can fail" } ],
      "taken": 1,
      "reason": "The task says version only." } ] }
```

`taskKind`, taskın akış derinliği (`docs`, `small`, `normal`, `large`); kart türü `kind`
ile karışmasın diye bu ad.

### `tenbox plan done DEMO-7 --json '<yukarıdaki>'`

Runner çağırır. Tenbox kontrol eder: şema, `plan.md` ≤60 satır, example'da `grep` yok.
Sonra **üç kart** yazar. Önce question'lar, en son plan, çünkü "en yeni plan kartı"
sorgusu sondakini bulur.

```
cards/
  0002-question.json
  0003-question.json
  0004-plan.json
  0004-plan.md
```

### `cards/0002-question.json`

```json
{ "id": 2, "kind": "question", "by": "planner", "at": "2026-10-22T09:06:00Z",
  "title": "Version source", "area": "technical",
  "options": [
    { "text": "package.json",    "effect": "no deploy change; version bumps with the release" },
    { "text": "env APP_VERSION", "effect": "one more deploy variable; can differ from the package" } ],
  "taken": 1,
  "reason": "package.json is already read at boot." }
```

### `cards/0003-question.json`

```json
{ "id": 3, "kind": "question", "by": "planner", "at": "2026-10-22T09:06:00Z",
  "title": "Should /health also report db status?", "area": "product",
  "options": [
    { "text": "no, version only", "effect": "one route, no db call" },
    { "text": "yes, add db: ok|down", "effect": "a db ping per call; the route can fail" } ],
  "taken": 1,
  "reason": "The task says version only." }
```

### `cards/0004-plan.json`

```json
{ "id": 4, "kind": "plan", "by": "planner", "at": "2026-10-22T09:06:00Z",
  "taskKind": "small",
  "parts": [{ "id": "01", "difficulty": "easy" }],
  "examples": [{ "part": "01", "title": "health returns version",
                 "before": "GET /health → 404",
                 "after": "GET /health → 200 { version: \"1.4.0\" }" }],
  "groups": [],
  "questions": [2, 3] }
```

`questions`: bu planın soruları. Yeniden plan yeni soru kartları ve yeni bir plan kartı
yazar; eski planın cevapsız sorusu yeni planı engellemez.

### `cards/0004-plan.md`

```markdown
One route in src/health.ts, one test. Reads version from the package.json
already loaded in src/app.ts. No new dependency.
```

Sonra ntfy:

```
tenbox-demo · DEMO-7 · plan-ready · 1 part, 2 questions, 0 open → tenbox approve DEMO-7
```

Sayılar `cards/` içinden: `question` kartları, ve açık olanlar (`taken` yok, cevap yok).
"plan-ready" = en yeni plan kartı var, ona bağlı approval yok.

## Adım 2 · Senin tarafın

Bildirim geldi. `cards/` klasörüne bakıyorsun; sonra bir `tenbox inbox` komutu bunu
listeler, şimdilik `ls` ve `cat`. Senaryoda: planner'ın seçtiği `package.json` yerine env
istiyorsun, db sorusunda planner'ın seçimini onaylıyorsun, bir not bırakıyorsun,
onaylıyorsun.

```
tenbox answer DEMO-7 2 2 --no-build
tenbox answer DEMO-7 3 1 --no-build
tenbox note DEMO-7 "Version bump happens in CI, not by hand."
```

`--no-build`, çünkü onay yok; onay olsaydı ilk `answer` build'i başlatırdı.

```
cards/
  0005-answer.json
  0006-answer.json
  0007-note.json
```

### `cards/0005-answer.json`

```json
{ "id": 5, "kind": "answer", "by": "user", "at": "2026-10-22T09:40:00Z",
  "replyTo": 2, "option": 2 }
```

Soru 2'de `taken: 1` kalır. Geçerli seçenek 2: env. Worker "kart 2, cevap 5: env" diye okur.

### `cards/0006-answer.json`

```json
{ "id": 6, "kind": "answer", "by": "user", "at": "2026-10-22T09:40:00Z",
  "replyTo": 3, "option": 1 }
```

`taken` ile aynı seçenek; yine de kart yazılır. "Kullanıcı gördü ve onayladı" bilgisi.

### `cards/0007-note.json`

```json
{ "id": 7, "kind": "note", "by": "user", "at": "2026-10-22T09:40:00Z",
  "text": "Version bump happens in CI, not by hand." }
```

Cevap değil, bilgi. Her agent okur.

Cevaplar onayı bozmaz: onay plan kartına verilir, plan kartı değişmedi.

### `tenbox approve DEMO-7`

Approve, "bu planla build'e geçebilirsin" imzan. `tenbox build` onsuz başlamaz.

Kontroller: en yeni plan kartı şemaya uyar, `.md` ≤60 satır, **açık soru yok**: en yeni plan
kartının `questions` listesinde `taken`'sız ve cevapsız bir soru varsa `open-question`,
exit 1, kartın numarasıyla. Başka planların soruları sayılmaz.

```
cards/
  0008-approval.json
```

### `cards/0008-approval.json`

```json
{ "id": 8, "kind": "approval", "by": "user", "at": "2026-10-22T09:41:00Z",
  "replyTo": 4, "sha": "3f9a…" }
```

`sha`: `0004-plan.json` metninin SHA-256'sı. İkinci `approve` yeni bir kart ekler.

"approved" = en yeni plan kartına `replyTo` ile bağlı bir approval var ve `sha` tutuyor.
Plan kartı değişmediği için `sha` sadece elle bozulmaya karşı. Yeniden plan yeni bir plan
kartı açar; eski approval ona bağlı olmadığı için task yeniden "plan-ready" olur.

`answer` ve `approve` ayrı, çünkü cevap vermeden onaylayabilirsin (açık soru yoksa) ve
onayladıktan sonra bir seçimi değiştirebilirsin.

## Adım 3 · Build ve worker'ın sorusu

Senaryoyu zorlayalım: env seçtin, worker `APP_VERSION`'ı `.env.example`'a eklemek istiyor
ama o dosya manifest'te `locked`.

### `tenbox build DEMO-7`

Sen. Onayı kontrol eder: en yeni plan kartı 4, ona bağlı approval 8, sha tutuyor. Args'ı
(`parts`, `lenses`, `groups`, `kind`) plan kartından alır, `/tenbox-build` başlar. Kart
yazmaz.

### Worker, round 1, part 01

Workflow `tenbox-build.js`, subagent `worker`. `cards/` okur: soru 2 → cevap 5 → env; soru 3
→ cevap 6 → db yok; not 7. İki çıkışı var:

- **ilerler**: part'ı yazar, commit eder, `status: done` döner. Kart yok.
- **sorar**: `status: blocked` ve bir question döner. Build durur.

Burada sorar. Son mesajı, `schema: BUILT` zorlar:

```json
{ "status": "blocked",
  "question": {
    "title": "APP_VERSION needs a line in .env.example, which is locked",
    "area": "locked-file",
    "options": [
      { "text": "add the line to .env.example", "effect": "one locked file changes; deploy docs stay in sync" },
      { "text": "document it in README only", "effect": "locked file untouched; a dev can miss the variable" } ],
    "reason": "The example file is what devs copy; a missing line costs a debugging hour.",
    "auto": false } }
```

### `tenbox build done DEMO-7 --json`

Runner çağırır. Soruyu kart yapar, `round` ve `part` ekler. `auto: true` ve alan "asla
otomatik" değilse `deadline` koyar ve `tenbox answer --auto`'yu arkada başlatır. Burada
`auto: false`, deadline yok.

```
cards/
  0009-question.json
```

### `cards/0009-question.json`

```json
{ "id": 9, "kind": "question", "by": "worker", "at": "2026-10-22T10:12:00Z",
  "round": 1, "part": "01",
  "title": "APP_VERSION needs a line in .env.example, which is locked",
  "area": "locked-file",
  "options": [
    { "text": "add the line to .env.example", "effect": "one locked file changes; deploy docs stay in sync" },
    { "text": "document it in README only", "effect": "locked file untouched; a dev can miss the variable" } ],
  "reason": "The example file is what devs copy; a missing line costs a debugging hour.",
  "auto": false }
```

Build result'ın kendisi (`status`, `round`, proofs) `build.json` kalır: sadece tenbox okuyor,
kart değil. ntfy:

```
tenbox-demo · DEMO-7 · needs-you · APP_VERSION needs a line in .env.example → tenbox answer DEMO-7 9 1
```

"needs-you" = cevapsız bir worker sorusu var. Hesaplanır.

### Cevap

Üç yol, hepsi aynı kartı yazar:

1. **PC'den**: `tenbox answer DEMO-7 9 1`, ya da `--text "..."`.
2. **Telefondan**: ntfy'daki link Claude session'ını açar; "kart 9, seçenek 1" dersin, o
   `tenbox answer` çağırır.
3. **Hiç**: kart `auto: true` ise deadline'da tenbox 1. seçenekle cevap kartı yazar,
   `auto: true` işaretiyle. `auto: false` ise build bekler.

```
cards/
  0010-answer.json
```

### `cards/0010-answer.json`

```json
{ "id": 10, "kind": "answer", "by": "user", "at": "2026-10-22T10:30:00Z",
  "replyTo": 9, "option": 1 }
```

`answer` duruma bakar: soru 9 bir worker sorusu, build onda duruyor → duran run'ı
`--resume` ile sürdürür. Worker cevabı prompt'unda ve `cards/`'da görür, aynı part'ı aynı
round'da sürdürür.

## Adım 4 · Review ve round döngüsü

### Round nasıl işler

Round'ları kimse önceden bölmez. Bir round, kalan part'ların hepsini sırayla yapar, sonra
check ve review. Bir şey kırmızıysa döngü "kalanlar + düzeltilecekler" ile tekrar döner.
Part planın bölmesi, round döngünün tekrarı. Dört adım:

1. **Parts listesi.** Round 1'de args'tan gelir: plandaki part'lar. Sonraki round'larda
   planner listeler: kalan part'lar, feedback'in değiştirdiği done part'lar. `mustFix`
   round'unda planner çağrılmaz: tek sanal part `fix`.
2. **Worker, part başına, sırayla.** Yazar, commit eder, `tenbox part done` ve `tenbox check`
   çalıştırır. Check kırmızıysa aynı round'da bir düzeltme hakkı. Takılırsa `question`
   kartı, build durur (Adım 3).
3. **Checks.** Manifest'teki `checks:` komutları (`types`, `unit`, …); tenbox'ın kendi kodu,
   agent değil. Çıktıdaki failure satırlarını main'deki baseline ile karşılaştırır; sadece
   yeni bir failure kırmızı yapar. Sonuç `rounds/N/checks.json`, kart değil: kimse bir şey
   söylemiyor, bir komut bir sonuç üretiyor. Kırmızı → sonraki round, feedback = özet.
4. **Review.** `base` + lens'ler paralel; bir agent'ın görüşü, o yüzden kart. Tenbox bir
   `review` kartı yazar. `mustFix` dolu → sonraki round. Boş → `ready-for-you`.

Bir round'u bitiren dört şey:

| Sebep | Sonuç |
|---|---|
| worker takıldı | `question` kartı, build durur; cevap gelince aynı round devam |
| check kırmızı, düzeltme de kırmızı | sonraki round, feedback = check özeti |
| review `mustFix` verdi | sonraki round, feedback = review kartı; worker `fix` |
| review temiz | `ready-for-you`, `build done` |

`maxRounds` (3) dolunca `failed`. Kind'ın review sayısı dolunca review atlanır, yeşil
check'le `ready-for-you`.

### Review kartı

Round başına bir kart, lens'ler birleşik. Workflow review'ları topladıktan sonra runner
`tenbox review done DEMO-7 --json '<lens listesi>'` çağırır, tenbox kartı yazar. Cevap
beklemez, `replyTo` yok: bulgu, soru değil.

| Alan | Ne |
|---|---|
| `round`, `lenses`, `group` | hangi round, hangi lens'ler çalıştı; `group` sadece gruplu planda |
| `mustFix` | plan, spec ya da doğruluk gereği; bir satır, dosya ve davranış. Dolu ise sonraki round |
| `niceToHave` | en çok 3; engellemez; kanıtlı somut hata |
| `attention` | insanın okuması gereken hunk'lar: migration, auth, silme, contract, locked dosya, planda olmayan dosya |
| `unproven` | `{ part, reason }`: kanıtsız davranış değişikliği; stats'ta -1 |

Okuyucular: `mustFix` → sonraki round'un worker'ı (prompt'ta da gelir, `cards/`'da da).
`attention`, `niceToHave`, `unproven` → sen, PR'da. `unproven` → stats.

Kazanç: round geçmişi diskte. Bugün must_fix sadece transcript'te; "neden 2 round oldu"
sorusunun cevabı yok. Bedel: round başına bir runner çağrısı.

### Reviewer ne okur

Reviewer kart yazmaz; dört listeyi son mesajında döner, tenbox `review` kartını yazar.
Lens başına bir reviewer, paralel; lens'in kontrol listesi TEN-495. Okuduğu:

| Okur | Nereden | Niye |
|---|---|---|
| task açıklaması | `0001-task.md` | spec'e uyum |
| plan metni, example'lar, parts | `0004-plan.md`, `0004-plan.json`, `parts/` | plana uyum; `unproven` için example ↔ test eşlemesi |
| soru + cevaplar | `question` ve `answer` kartları | geçerli seçenek = en yeni cevap, yoksa `taken`; cevaplanmış bir seçim bulgu değil |
| worker sorusu + cevabı | kart 9 + 10 | `.env.example` değişikliği yetkili: must_fix değil, `attention` |
| notlar | `note` kartları | bağlam |
| önceki review kartları | `0011-review.json` | feedback round'unda geçen round'un `mustFix`'i düzeldi mi, tek tek; aynı hunk için attention'ı tekrar yazmaz |
| diff, `locked` | git, `tenbox.yaml` | bugünkü gibi |

Reviewer soru açmaz: bloke edeceği bir kodu yok. Belirsizlik `attention`'a gider, sen PR'da
karar verirsin.

### Senaryo: round 1 review

Worker cevap 10 ile `.env.example`'a satırı ekledi, part 01 done, check yeşil. Reviewer
`base` ve `contract` çalıştı.

```
cards/
  0011-review.json
```

```json
{ "id": 11, "kind": "review", "by": "reviewer", "at": "2026-10-22T10:48:00Z",
  "round": 1, "lenses": ["base", "contract"],
  "mustFix": ["src/health.ts:12 returns 200 with an empty version when APP_VERSION is unset; the example says 200 { version }, so an unset variable must fail at boot"],
  "niceToHave": [],
  "attention": [".env.example: locked file, one line added (answer 10)"],
  "unproven": [] }
```

`mustFix` dolu → round 2. Worker `fix` part'ı alır: prompt'ta kart 11'in `mustFix` satırları,
`cards/`'da kartın kendisi. Düzeltir, check yeşil.

### Senaryo: round 2 review

```
cards/
  0012-review.json
```

```json
{ "id": 12, "kind": "review", "by": "reviewer", "at": "2026-10-22T11:05:00Z",
  "round": 2, "lenses": ["base", "contract"],
  "mustFix": [],
  "niceToHave": ["src/health.ts: the version is read on every request; reading once at boot would do"],
  "attention": [".env.example: locked file, one line added (answer 10)"],
  "unproven": [] }
```

`mustFix` boş → `ready-for-you`.

### `tenbox build done DEMO-7 --json`

Runner çağırır. `build.json` yazar: status, round 2, proofs. Kart yazmaz. `proofs.json`'a
ekler. Draft PR açar; PR gövdesine plan kartının `.md`'si ve en yeni review kartının
`attention`'ı girer. ntfy:

```
tenbox-demo · DEMO-7 · ready-for-you · round 2, attention 1, nice-to-have 1, unproven 0 → PR #12
```

Sayılar en yeni review kartından. "ready-for-you" = `build.json` status + en yeni review
kartının `mustFix`'i boş.

`attention` iki round'da aynı hunk'ı veriyor: bugünkü "merge attention" adımı review
kartlarını okuyarak birleştirir, sonuç PR gövdesine gider, kart olmaz.

### Sonra için not: tester agent

Bugün testi ve kodu aynı worker yazar; test koda uyacak şekilde bükülebilir. Fikir: onaydan
sonra, round 1'den önce bir **tester** example'ları kara kutu teste çevirir, kırmızı görür,
commit eder; worker yeşile çevirir, kendi unit testlerini yazar, tester'ın testini
değiştiremez (çelişki → `question`). Reviewer "unproven"a git geçmişinden bakar. `docs` ve
`small` kind'da yok. Kart modelinden sonra ilk aday; şimdi değil.

## Adım 5 · PR, PR'dan dönen bulgular, close

### `tenbox pr DEMO-7`

`build done` draft olarak açar; sen `--ready` ile hazır yaparsın. Push eder, PR'ı açar ya da
günceller. Gövde:

1. Grup satırı `tenbox: DEMO-7 group 1`; `close` PR'ı bununla bulur.
2. `## Checks`: son `checks.json` özeti.
3. `## Review`: en yeni review kartının `attention` ve `niceToHave` satırları. Yeni: bugün
   attention PR'a girmiyor. Reviewer'ın "şu hunk'ı oku" dediği yer PR'ın kendisi.
4. `<details>Plan</details>`: plan kartının `.md`'si.

Kart yok. PR numarası ve URL `build.json`'da, JSON tarafı.

### Sen PR'da

Review kartının `attention`'ını okursun, `niceToHave`'den gerçek olanı kendin düzeltirsin,
merge edersin. GitHub'da; tenbox'a kayıt yok.

### PR'dan dönen yorumlar: plan aşamasının tersi

PR'da satırlara yorum yazarsın: soru, karar, bulgu. Önce her birine cevap istersin, sonra
"ok" dersin, sonra yapmasını beklersin. Bu, plan aşamasının aynısı, roller ters:

| Plan aşaması | PR aşaması |
|---|---|
| planner `plan` kartı, `questions: [2, 3]` | sen `review` kartı (`by: user`), `questions: [15, 16]` |
| planner `question` kartları | sen `question` kartları (`by: user`), thread başına bir |
| sen `answer` | worker `answer` |
| sen `approval` → plan kartı | sen `approval` → review kartı |
| `tenbox build` | `tenbox build`, must_fix round'u |

Yeni kart türü yok. Yeni alanlar: review kartında `questions` ve `pr`; question kartında
`path`, `line`, `thread`.

### `tenbox feedback DEMO-7 --from-pr`

`gh` ile PR'ın review thread'lerini çeker. Thread başına bir question kartı, hepsini toplayan
bir review kartı. Senaryoda iki yorum: `src/health.ts:12`'ye "Why is APP_VERSION read on
every request?", `src/health.test.ts:30`'a "Also test the empty string case".

```
cards/
  0015-question.json
  0016-question.json
  0017-review.json
```

### `cards/0015-question.json` — soru, `taken` yok

```json
{ "id": 15, "kind": "question", "by": "user", "at": "2026-10-22T14:10:00Z",
  "round": 2, "path": "src/health.ts", "line": 12, "thread": 1883,
  "area": "technical",
  "title": "Why is APP_VERSION read on every request?" }
```

### `cards/0016-question.json` — karar, `taken: 1`

```json
{ "id": 16, "kind": "question", "by": "user", "at": "2026-10-22T14:10:00Z",
  "round": 2, "path": "src/health.test.ts", "line": 30, "thread": 1884,
  "area": "technical",
  "title": "Also test the empty string case",
  "options": [{ "text": "add a test: APP_VERSION='' makes boot throw" }],
  "taken": 1 }
```

Yorum olduğu gibi `title` olur. Soru işaretiyle biten yorum soru (`taken` yok), diğeri karar
(tek seçenek, `taken: 1`). Kaba ama basit; yanlışsa worker cevabında söyler.

### `cards/0017-review.json` — toplayan kart

```json
{ "id": 17, "kind": "review", "by": "user", "at": "2026-10-22T14:10:00Z",
  "round": 2, "pr": 12, "questions": [15, 16] }
```

Reviewer agent'ın review kartı bulgu listeleri taşır (`mustFix` …), seninki soru listesi.
Aynı tür, iki içerik; kabul edildi.

### Worker cevaplar

`feedback` build başlatmaz; bir cevap koşusu başlatır: tek worker, kod yazmaz, her soruya
bir cevap döner, runner `tenbox reply done --json` ile kartları yazar. Soru başına bir
`answer`, `by: worker`:

```
cards/
  0018-answer.json
  0019-answer.json
```

```json
{ "id": 18, "kind": "answer", "by": "worker", "at": "2026-10-22T14:14:00Z",
  "replyTo": 15,
  "text": "No reason; reading once at boot would do. I will move it to app.ts and throw when it is empty." }
```

```json
{ "id": 19, "kind": "answer", "by": "worker", "at": "2026-10-22T14:14:00Z",
  "replyTo": 16, "option": 1,
  "text": "Agreed: boot with APP_VERSION='' expects a throw." }
```

Tenbox her cevabı GitHub'daki thread'e yorum olarak yazar. ntfy: `replied · 2 answers on PR
#12 → tenbox approve DEMO-7 17`.

### Thread = kart

Sen thread'e karşılık yazarsan `--from-pr` onu `answer` (`by: user`, `replyTo: 15`) olarak
çeker; worker yine cevaplar. En yeni cevap geçerli. Konuşma GitHub'da, kaydı `cards/`'da.
Yeni bir satıra yeni yorum yeni bir question kartı ve yeni bir review kartı açar.

### "Ok": `tenbox approve DEMO-7 17`

Approval kartı, `replyTo: 17`. Plan onayıyla aynı tür, aynı anlam: "bununla ilerle".
Sonra build başlar, must_fix round'u: planner yok, tek `fix` part'ı. Worker kart 17'nin
sorularını ve cevaplarını okur; `taken`'ı ya da senin son cevabı olan her soru bir iş,
`taken`'sız soru sadece bilgi. Round 3, review kartı 20, `build done`, PR güncellenir,
her thread'e "done in <commit>" yorumu, ntfy `ready-for-you`.

Elle, PR'sız: `tenbox feedback DEMO-7 --text "..."` tek question kartı (karar) ve review
kartı yazar, aynı akış.

### `tenbox close DEMO-7`

Main checkout'ta, merge sonrası. Adımlar aynı: merge kontrolü, base'i çek, `stats.json`,
session'ı durdur, worktree ve branch'i sil, tracker Done, maliyet yorumu, remote branch sil.
Değişen, `stats.json`'un nereden saydığı:

| Stats alanı | Nereden |
|---|---|
| `plan`: part sayısı, difficulty | en yeni plan kartı |
| `rounds` | `rounds/N`; neden bittiği review kartından (mustFix) ya da `checks.json`'dan (kırmızı) |
| `review`: must_fix, nice_to_have, attention | review kartları; round başına must_fix sayısı da çıkar, bugün yok; `by: user` olanlar ayrı sayılır |
| `questions` (yeni) | soru sayısı, açık kalan, auto cevaplanan; planner / worker ayrı |
| `proofs`, `points` | `proofs.json` + son review kartının `unproven`'ı |
| `timeline`, `minutes` | kartların `at`'i: task 1, plan 4, approval 8, son review |

`stats.json` JSON kalır; sunucu ve `tenbox stats` okuyor. Close kart yazmaz: "kapandı"
bilgisi `stats.json`'un varlığı. Task dir kalır, worktree gider.

## Domain

`cards.ts`: şema union (task, plan, question, answer, note, approval, review), `readCard`,
`latestOf(kind)`, `answerOf(card)`, `openQuestions`, `takenOption`. `answers.ts`: cevabın
etkisi (duruma göre başlat, sürdür, hiç). `plans.ts` sadece plan result; `builds.ts` sadece
build result; `tasks.ts` status'suz. `approvals.ts`, `decisions.ts`, `autoAnswers.ts` yok;
`PlanDecision` yok.

Komutlar: `tenbox decide` gider; `tenbox answer <id> <kart> <seçenek>|--text`,
`tenbox note <id> "..."`, `tenbox review done <id> --json`, `tenbox feedback <id> --from-pr|--text`
ve `tenbox reply done <id> --json` gelir; `tenbox approve <id> [<kart>]` review kartına da
verilir. `tenbox pr` gövdeye `## Review` ekler ve thread'lere yorum yazar; `tenbox close`
kartlardan sayar.

`agents/*.md`, üç workflow, `approve`/`answer` komutları, glossary ve README değişir.
Glossary: "plan decision" ve "decision card" gider; "question" ve "card" gelir.

## Açık konular

- `events.ts` ayrı kalır: makine telemetrisi, sunucuya gider. Büyük soru, şimdi değil:
  sunucudaki `events` tablosu ile kartlar aynı şey mi? Bildirim durumları kartlardan
  hesaplanıyor; sunucu kartları saklasa event'leri türetebilir. Telemetri (süre, token)
  kart değil.
- Babysitter (`docs/design.md`): yeni kart türü yok. "Collects questions" = her taskın cevap
  bekleyen kartları (açık question, approval bekleyen plan ve review kartı), tek numaralı
  mesaj. "Routes answers" = `approve`, `answer`, `note`; yazdığı kartlar `by: user`,
  istenirse `via: babysitter`. "System of record: the server" = teli geçen şey kart: Job
  yeni kartlarını POST eder, babysitter'ın answer ve approval kartları sunucuda bekler,
  makine boot'ta ve `tenbox wait`'te "N'den sonrakileri ver" ile çeker.
- `tenbox inbox`: açık soruların numaralı listesi. design.md'deki babysitter "Collects
  questions" bunun üstüne oturur. Şimdi değil.
