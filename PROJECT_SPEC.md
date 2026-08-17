# 🚀 AI Team Workspace - ספר אפיון וארכיטקטורה
**מערכת צוותי AI אוטונומית לעבודה בסביבת Claude Code / Codex (CLI)**

---

## 1. סקירת על (Overview)
המערכת הממירה את תפיסת "37 הסוכנים בעברית" למערכת AI סוכנית (Agentic AI) מבוססת CLI. המערכת עושה שימוש בזיכרון משותף, ניתוב היררכי מבוסס מנהלי צוותים (Leads), פרוטוקול העברת מקל מובנה (YAML Frontmatter), ויומן זיכרון דינאמי להתאמה מתמשכת לצרכי העסק.

---

## 2. מבנה תיקיות הפרויקט (Repository Structure)

```text
ai-team-workspace/
│
├── CLAUDE.md                         # 👑 המוח הראשי: פקודות CLI מהירות, חוקי מערכת ונתב עליון
├── PROJECT_SPEC.md                  # מסמך אפיון זה
│
├── context/                          # 🧠 אזור הזיכרון המשוכפל והדינאמי
│   ├── BUSINESS_PROFILE.md           # תיק העסק הסטטי (נבנה בעזרת אורית)
│   └── MEMORY_LOG.md                 # יומן זיכרון דינאמי (פידבקים, חוקים חדשים ושינויים)
│
├── skills/                           # 👥 ספריית הסוכנים (קבצי .md)
│   ├── onboarding.md                 # אורית - הקמת תיק העסק
│   ├── quality_assurance.md          # ערן - בקרת איכות ועקביות לכלל התוצרים
│   │
│   ├── leads/                        # 👔 מנהלי הצוותים (הנתבים ההיררכיים)
│   │   ├── guy_marketing_lead.md     # גיא - מנתב ל-17 סוכני שיווק
│   │   └── ray_branding_lead.md      # ריי - מנתבת ל-18 סוכני מיתוג
│   │
│   ├── marketing/                    # 17 סוכני שיווק
│   │   ├── avi_audience_research.md
│   │   ├── shiran_funnels.md
│   │   ├── roni_content_calendar.md
│   │   ├── asaf_business_intel.md
│   │   ├── maya_social_organic.md
│   │   ├── idan_video_scripts.md
│   │   ├── nir_linkedin_b2b.md
│   │   ├── jonathan_long_articles.md
│   │   ├── liat_blog_seo.md
│   │   ├── roei_sales_calls.md
│   │   ├── dana_price_quotes.md
│   │   ├── shahar_landing_pages.md
│   │   ├── carmel_ppc_ads.md
│   │   ├── shira_whatsapp.md
│   │   ├── tamar_emails.md
│   │   └── noa_personal_assistant.md
│   │
│   └── branding/                     # 18 סוכני מיתוג
│       ├── omer_brand_strategy.md
│       ├── adi_positioning.md
│       ├── hadar_story_narrative.md
│       ├── lia_tone_identity.md
│       ├── matan_messages_value.md
│       ├── shahaf_art_director.md
│       ├── neta_brand_kit.md
│       ├── inbal_typography.md
│       ├── niv_naming.md
│       ├── nevo_web_design.md
│       ├── oren_architecture.md
│       ├── rotem_rebranding.md
│       ├── gal_personal_brand.md
│       ├── ron_employer_brand.md
│       ├── eran_consistency.md
│       ├── sivan_brand_experience.md
│       ├── itay_brand_launch.md
│       └── hadas_brand_book.md
│
└── outputs/                          # 📦 תוצרי המערכת המובנים
    ├── brand_assets/                 # תוצרי מיתוג
    └── marketing_campaigns/          # תוצרי שיווק