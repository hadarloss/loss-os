@AGENTS.md

# 🚀 AI Team Workspace — CLAUDE.md

מסמך זה הוא נקודת הכניסה למי (או מה) שעובד על הריפו הזה — בין אם זה Claude Code/Codex ישירות מהטרמינל, ובין אם זה מפתח/ת אנושי/ת. הוא מסביר את המבנה, איך הניתוב עובד, ואילו החלטות סטו מהספק המקורי.

## מה זה הפרויקט
"AI Team Workspace" עבור עסק דובר עברית: 37 סוכני AI מתמחים (17 שיווק + 18 מיתוג + 2 גלובליים), מנוהלים תחת שני מנהלי צוות (גיא לשיווק, ריי למיתוג), עם זיכרון עסקי משותף ודינאמי. יש שני אופנים לעבוד מול המערכת:
1. **ישירות מה-CLI** — פותחים סוכן ספציפי (קובץ md תחת `skills/`) כפרסונת מערכת ועובדים איתו בטרמינל.
2. **דרך הדשבורד** — `npm run dev` ואז `http://localhost:3000`, אפליקציית Next.js שמפעילה את אותם קבצי סוכן בפועל מול Claude API, עם ניתוב היררכי, סטרימינג, וממשק גרפי מלא בעברית (RTL).

## Quickstart
```bash
npm install                     # פעם ראשונה בלבד
cp .env.example .env.local      # ואז להזין ANTHROPIC_API_KEY (וגם OPENAI_API_KEY אם צריך) בקובץ
npm run dev                     # מריץ על http://localhost:3000
```
בלי `ANTHROPIC_API_KEY` תקין ב-`.env.local`, הדשבורד יעלה אבל שיחות עם סוכנים יחזירו שגיאה ברורה (לא קריסה). `OPENAI_API_KEY` נדרש בפועל כמעט תמיד — שני מנהלי הצוות והמסווג הפנימי (`classifyNextStep`) רצים על OpenAI ללא קשר לספק של שאר הסוכנים — ראו "שני ספקי מודל" למטה.

## הרצה דרך Docker (פריסה לשרת)
```bash
cp .env.example .env             # להזין ANTHROPIC_API_KEY (וגם OPENAI_API_KEY/OMNIROUTE אם צריך), APP_USERNAME, APP_PASSWORD אמיתיים
docker compose up -d --build     # בונה ומריץ app + caddy (+ omniroute אם צריך)
```
`context/`, `outputs/` ו-`data/` (בסיס הנתונים SQLite, `data/app.db`) מחוברים כ-volumes (ראו `docker-compose.yml`) כדי שהמשתמשים, המותגים, תיקי העסק, יומני הזיכרון והתוצרים שנכתבים בזמן ריצה ישרדו ריסטארט/עדכון של הקונטיינר.

**זיכרון מרובה-מותגים, מגובה SQLite**: המערכת רב-משתמשית ורב-מותגית — כל משתמש יכול להיות חבר במספר "מותגים" (עסקים), וכל הנתונים החיים (משתמשים, מותגים, חברות במותג, תיק עסק, יומן זיכרון, אינדקס תוצרים) יושבים ב-`data/app.db` (SQLite, ראו `lib/db/schema.ts`), לא בקבצי markdown שטוחים. תיק העסק ויומן הזיכרון נשמרים כעת per-brand בטבלאות `business_profiles`/`memory_log_entries` — `lib/fs/businessProfile.ts` ו-`lib/fs/memoryLog.ts` מקבלים `brandId` ומבודדים לחלוטין בין מותגים. `context/BUSINESS_PROFILE.template.md` נשאר בשימוש רק לזריעת תיק עסק ריק למותג חדש (ה-DB-equivalent של `ensureSeededFromTemplate` הישן). קובצי ה-`.md`/`.meta.json` בפועל של תוצרים עדיין נשמרים תחת `outputs/`, אך מאונדקסים לפי `brandId` בטבלת `outputs`. `data/` (כמו `context/`/`outputs/` בעבר) אינו במעקב git — ראו `.gitignore` — ומחובר כ-volume כדי לשרוד `git pull` + `docker compose up -d --build`.

**הרשאה — משתמשים אמיתיים עם אישור מנהל**: [proxy.ts](proxy.ts) שומר על כל האתר (כולל ה-API) לפי עוגיית session חתומה נגד `SESSION_SECRET` ב-`.env` ([lib/auth/session.ts](lib/auth/session.ts)) — **לא** HTTP Basic Auth הדפדפני, כי הפרומפט הנייטיבי שלו לא עובד באופן עקבי בדפדפנים/webviews בנייד. אם `SESSION_SECRET` ריק, השער מדלג על עצמו (כדי לא לנעול פיתוח מקומי בלי `.env`). הרשמה: `/signup` יוצרת משתמש בסטטוס `pending`; התחברות (`/login`) חוסמת עד אישור. חריג יחיד: הרשמה עם `SUPER_ADMIN_EMAIL` (מוגדר ב-`.env`) מאשרת את עצמה אוטומטית בפעם הראשונה בלבד ומסמנת את המשתמש כ-`is_super_admin` — כך שהדר לא צריך אישור מעצמו. כל שאר המשתמשים ממתינים לאישור/דחייה של הדר במסך הניהול `/admin/users` (`app/(dashboard)/admin/users/page.tsx`, מוגן ל-super-admin בלבד). יציאה: כפתור "יציאה" בתחתית הסיידבר (קורא ל-`POST /api/auth/logout`).

**HTTPS**: `docker-compose.yml` כולל שירות `caddy` (reverse proxy) שמנפיק ומחדש תעודת HTTPS אמיתית אוטומטית דרך Let's Encrypt — קונטיינר ה-`app` עצמו כבר לא חשוף ישירות לאינטרנט (`expose` בלבד, לא `ports`), רק Caddy על 80/443. הדומיין מוגדר ב-[Caddyfile](Caddyfile); כרגע זה `139-59-145-176.sslip.io` (שירות DNS חינמי שממפה כל כתובת IP לשם דומיין תואם — `<ip-עם-מקפים>.sslip.io`), כי אין עדיין דומיין אמיתי. **כשיהיה דומיין אמיתי**: להחליף את השורה הראשונה ב-`Caddyfile` לשם הדומיין (ולוודא שה-DNS שלו מצביע ל-IP של השרת), ואז `docker compose up -d` — Caddy יטפל בתעודה החדשה לבד.

## מפת תיקיות
```
context/                # הזיכרון — תיק עסק (סטטי) + יומן דינאמי (append-only)
skills/                 # 39 קבצי סוכן: onboarding, quality_assurance, leads/*, marketing/*, branding/*
outputs/                # תוצרים שנשמרים מהדשבורד (קמפיינים / נכסי מיתוג)
lib/agents/             # registry.ts (parsing+validation), router.ts (ניתוב היררכי + דיספאץ' לפי provider), types.ts
lib/anthropic/          # קליינט Anthropic API
lib/openai/             # קליינט OpenAI API (Responses API) — משמש סוכנים עם provider: openai
lib/omniroute/          # קליינט OmniRoute (Chat Completions API) — משמש סוכנים עם provider: omniroute
lib/fs/                 # קריאה/כתיבה ל-context/ ו-outputs/
app/                    # עמודי הדשבורד + app/api/* (route handlers)
components/              # רכיבי UI (chat, layout, shadcn primitives)
```

## איך הניתוב ההיררכי עובד
1. משתמש בוחר צוות (שיווק/מיתוג) ומקליד הודעה — פונה קודם למנהל הצוות (גיא/ריי).
2. המנהל, דרך Anthropic tool-use (`route_to_agent`), בוחר את המומחה המתאים מתוך רשימת הסוכנים בצוותו (הרשימה נבנית דינאמית מ-`lib/agents/registry.ts`, לא מקודדת בפרומפט של המנהל עצמו).
3. ה-UI מציג breadcrumb ניתוב (את/ה → מנהל → מומחה), ואז זורם המענה בפועל מפרסונת המומחה שנבחר.
4. המשך שיחה עם אותו מומחה לא מנתב מחדש — רק נושא חדש/החלפת סוכן מפעילים ניתוב נוסף.
5. אפשר גם לדלג על המנהל ולדבר ישירות עם מומחה ספציפי מהסיידבר.
6. ערן (`quality_assurance.md`) אינו בציר האוטומטי — הוא סוכן נגיש ישירות לבדיקת איכות של טיוטה מוכנה, משני הצוותים.

## סכמת Frontmatter של סוכן (כל קובץ תחת skills/)
```yaml
id: agent_id            # ייחודי, תואם שם הקובץ
name: "שם בעברית"
role: "תיאור תפקיד קצר"
team: marketing | branding | core
reports_to: agent_id_of_lead | null
kind: lead | specialist | core
icon: "אימוג'י"
description: "תיאור קצר לכרטיס בחירה ולפרומפט הניתוב של המנהל"
output_types: [type1, type2]
order: number
provider: anthropic     # anthropic (ברירת מחדל) | openai | omniroute — קובע איזה API/SDK ישמש לסוכן הזה
model: claude-haiku-4-5-20251001   # מזהה המודל אצל אותו provider; ניתן לדריסה לכל סוכן
```

**בחירת מודל לפי תפקיד**: 36 הסוכנים המומחים (ספציאליסטים + ערן/QA) על `provider: anthropic, model: claude-haiku-4-5-20251001` — המודל הזול ביותר בקטלוג Claude, ברירת המחדל ההיסטורית של המערכת לכתיבה. שני מנהלי הצוות (גיא, ריי) והמסווג הפנימי `classifyNextStep` (`lib/agents/router.ts`) — שלושת הרכיבים היחידים במערכת שמחליטים בפועל handoff (למי לנתב / האם להעביר לסוכן הבא) — על `provider: openai, model: gpt-5.1`: המודל המלא, במכוון לא הזול ביותר (`gpt-5.1-mini`), כי טעויות סיווג handoff הן בדיוק מה שגורם לתוצרים "ללכת לאיבוד" (ראו גם "תוצרים" למטה). אורית (`onboarding`) על `provider: openai, model: gpt-5.1-mini` — היא לא מחליטה handoff, אז יורדת לשכבה הזולה ביותר של OpenAI (זולה בפועל יותר מ-Claude Haiku). כל סוכן OpenAI עתידי שלא אחראי על handoff אמור לרדת ל-`gpt-5.1-mini` (הזול, `DEFAULT_OPENAI_MODEL`) — לא ל-`gpt-5.1` המלא.

## שני ספקי מודל (Anthropic + OpenAI)
כל סוכן בוחר ספק דרך שדה `provider` בפרונטמאטר (`anthropic` בברירת מחדל או `openai`). `lib/agents/router.ts` מנתב כל קריאה — גם ניתוב ההיררכיה (`routeToAgent`) וגם תשובת המומחה בסטרימינג (`streamAgentReply`) — לפי `provider` של הסוכן הרלוונטי:
- `provider: anthropic` (ברירת מחדל, וכיום 36 הסוכנים המומחים) → `lib/anthropic/client.ts`, Messages API, `model` הוא מזהה Claude (`claude-haiku-4-5-20251001` הזול ביותר).
- `provider: openai` (שני מנהלי הצוות, המסווג הפנימי, ואורית) → `lib/openai/client.ts`, Responses API (`client.responses.create`), `model` הוא `gpt-5.1-mini` (זול, ברירת מחדל — גם לאורית) או `gpt-5.1` המלא (לרכיבי handoff בלבד).

**כדי "לפרוס מחדש" סוכן על ספק אחר**: לשנות בקובץ ה-`skills/*.md` שלו את `provider` ואת `model` יחד למזהה המתאים לספק החדש — אין ברירת מחדל בין ספקים למודל. אין צורך בשינוי קוד נוסף.

**מפתחות/הגדרות**: `ANTHROPIC_API_KEY` נדרש כמעט תמיד (ברירת המחדל של רוב הסוכנים). `OPENAI_API_KEY` נדרש בפועל בכל שיחה שעוברת דרך מנהל צוות (גיא/ריי) או שמייצרת handoff אוטומטי — כלומר כמעט כל שיחה — כולם ב-`.env.local` (dev) או `.env` (Docker), ראו `.env.example`. `app/api/chat/route.ts` בודק מראש (לפני פתיחת ה-stream) אילו ספקים ה-request הזה עלול להגיע אליהם ומחזיר שגיאת JSON ברורה אם ההגדרה הרלוונטית חסרה.

### OmniRoute — עדיין נתמך בקוד, לא בשימוש כרגע
`provider: omniroute` נשאר תקף ברמת קוד (`lib/omniroute/client.ts`, וטיפול ב-`router.ts`) לשימוש עתידי, אבל נכון להיום **אף סוכן לא מוגדר עליו** — כל 39 הסוכנים עברו ל-Anthropic/OpenAI ישירות (ללא שרשרת fallback חיצונית). `OMNIROUTE_BASE_URL`/`OMNIROUTE_API_KEY` הפכו לאופציונליים לגמרי; שירות ה-`omniroute` ב-`docker-compose.yml` אינו נדרש להרצה. [OmniRoute](https://github.com/diegosouzapw/OmniRoute) עצמו הוא שער MIT/open-source מרובה-ספקים — אם ירצו בעתיד להחזיר סוכן אליו, ראו את התיעוד ההיסטורי בהיסטוריית ה-git של קובץ זה.

## תיקוני ספק שבוצעו (Known spec deviations)
מסמך ה-`PROJECT_SPEC.md` המקורי הכיל שתי אי-התאמות; שתיהן טופלו וקבועות מכאן ואילך:

1. **שיווק — 16 קבצים מול "17 סוכני שיווק" בטקסט.** נוסף סוכן שבע-עשרה: `skills/marketing/eden_marketing_analytics.md` (עדן — אנליטיקס ודוחות ביצועים), שממלא פער שלא היה מכוסה (מדידת ביצועים לעומת מחקר שוק/תחרות של אסף).
2. **התנגשות שם: `eran_consistency.md` (מיתוג) מול `quality_assurance.md` (ערן, QA גלובלי).** סוכן העקביות המיתוגית שונה ל-`skills/branding/tomer_consistency.md` (תומר). "ערן" נשאר שם ה-QA הגלובלי היחיד במערכת, כדי למנוע בלבול בממשק ובניתוב.

**אם מוסיפים סוכן חדש**: יש לוודא `id` ייחודי, `reports_to` תקין (מנהל צוות קיים או `null`), ושם עברי שלא מתנגש עם סוכן קיים.

## פרוטוקול Handoff (ניתוב בפועל)
כשמנהל צוות מנתב בקשה, נוצרת רשומה (לא קובץ md — אובייקט runtime שנשמר ליד פלט אם נשמר תוצר):
```yaml
task_id, from_agent, to_agent, status(queued|in_progress|done|blocked|revised),
deliverable_type, output_path, requested_by, created_at, updated_at, notes
```

## יומן זיכרון דינאמי
טבלת `memory_log_entries` (per-brand, append-only מבחינת שימוש) שומרת רשומות. כל סוכן (או המשתמש דרך מסך "זיכרון" בדשבורד, בנתיב `/[brandId]/memory-log`) יכול להוסיף רשומה מסוג `correction` / `new_rule` / `preference` / `note`. סוכנים קוראים אותו לפני מענה כדי להתאים את עצמם להעדפות שנצברו — כל זה מבודד לפי `brandId`, כך שמותגים שונים (גם של אותו משתמש) לא חולקים זיכרון. אישור תוצר בעמוד "תוצרים" (ראו מטריצת ההחלטות למטה) כותב רשומת `preference` לכאן אוטומטית.

## מטריצת החלטות של סוכנים
מי מחליט מה בלי לחכות למשתמש, ומה כן דורש אישור מפורש — ההתנהגות בפועל, לא הצעה:

| פעולה | מי מחליט | מתי דורש אישור משתמש |
|---|---|---|
| ניתוב ראשוני (סוכן בודד) | מנהל הצוות, אוטומטית (`routeToAgent`/`proposePlan` עם משימה אחת) | אף פעם — מיידי |
| בניית תוכנית רב-סוכנית (2+ משימות) | מנהל הצוות מציע (`proposePlan`), אבל **לא מתחילה לרוץ** | תמיד — מסך אישור תוכנית לפני כל ביצוע |
| מעבר בין משימה למשימה בתוך תוכנית **מאושרת** | הקלאסיפייר (`classifyNextStep`), אוטומטית | לא — זה בדיוק למה התוכנית אושרה מראש |
| שמירת תוצר (`saveOutput`) בסיום משימה/deliverable | אוטומטית, ברגע שהקלאסיפייר קבע `task_complete`/`deliverable_complete` | לא לשמירה עצמה; כן ל"אישור" הסטטוס בעמוד תוצרים |
| אישור/דחיית תוצר בעמוד "תוצרים" | המשתמש בלבד | — זו הפעולה שדורשת אישור; אישור כותב רשומת זיכרון, דחייה מוחקת |
| תשובה לשאלת הבהרה (`needs_user_input`) | — | תמיד המשתמש; ההודעה הבאה שלו ממשיכה אותה משימה/job (לא פותחת אחד חדש) |
| handoff אוטומטי בין סוכנים | אוטומטית, כברירת מחדל (הקלאסיפייר עצמו תמיד רץ על OpenAI `gpt-5.1`, ללא קשר לספק של הסוכן שענה — ראו "בחירת מודל לפי תפקיד" למעלה) | לא, אלא אם הוגדר `auto_handoff_enabled: false` בפרונטמאטר של אותו סוכן |

**דגל פר-סוכן**: `auto_handoff_enabled: false` בפרונטמאטר (`skills/*.md`) מכבה handoff/auto-save אוטומטי לאותו סוכן ספציפית — כל תגובה שלו נופלת ל-`needs_user_input`, גם בתוך תוכנית מאושרת. ברירת המחדל `true` לכל 39 הסוכנים.

**רצפת בטיחות דטרמיניסטית**: לפני שהקלאסיפייר נשאל בכלל אם תגובה היא תוצר גמור, תגובה קצרה מ-40 תווים או שמסתיימת בסימן שאלה מסווגת אוטומטית כ-`needs_user_input` — לא תלוי בשיפוט המודל.
