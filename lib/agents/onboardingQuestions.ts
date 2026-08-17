/**
 * Fixed onboarding questionnaire — mirrors the 12-topic checklist in skills/onboarding.md.
 * Presented one at a time by the onboarding wizard UI (components/onboarding/OnboardingWizard.tsx)
 * instead of a free-form chat: no LLM call happens per question, so there's nothing to stream or
 * echo back — the collected answers are sent once to /api/business-profile/complete-onboarding,
 * which is the only point אורית (the onboarding agent) actually runs.
 */
export interface OnboardingQuestion {
  id: string;
  question: string;
  placeholder: string;
}

export const ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  { id: "identity", question: "מה העסק שלכם עושה, ובאיזה תחום?", placeholder: "לדוגמה: רשת חנויות דיסקאונט למוצרי בית ומשפחה..." },
  { id: "products", question: "מהם המוצרים או השירותים העיקריים שלכם?", placeholder: "פרטו את הקטגוריות/השירותים המרכזיים..." },
  { id: "audience", question: "מי קהל היעד המרכזי שלכם?", placeholder: "גיל, מצב משפחתי, צרכים, איפה הם נמצאים..." },
  { id: "competitors", question: "מי המתחרים הישירים או העקיפים שלכם?", placeholder: "שמות מתחרים, או תיאור סוג המתחרה..." },
  { id: "positioning", question: "במה אתם שונים או עדיפים ביחס למתחרים?", placeholder: "מה מבדל אתכם — מחיר, איכות, שירות, חוויה..." },
  { id: "tone", question: "איך הייתם רוצים שהטון של המותג יישמע?", placeholder: "רשמי / חברי / נועז / מקצועי / הומוריסטי..." },
  { id: "presence", question: "איזו נוכחות מותגית כבר קיימת לכם היום?", placeholder: "לוגו, אתר, עמודי סושיאל — מה כבר יש ומה המצב שלו..." },
  { id: "channels", question: "באילו ערוצי שיווק אתם פעילים היום?", placeholder: "סושיאל, פרסום ממומן, מייל, וואטסאפ, שילוט..." },
  { id: "goals", question: "מהם היעדים העסקיים שלכם לרבעון/שנה הקרובה?", placeholder: "הגדלת מכירות, מודעות, השקת קטגוריה חדשה..." },
  { id: "budget", question: "יש תקציב או מגבלות משאבים שכדאי שנדע עליהם?", placeholder: "תקציב שיווק, כוח אדם, זמן פנוי לתוכן..." },
  { id: "history", question: "היו קמפיינים או מהלכי שיווק קודמים? מה עבד ומה לא?", placeholder: "אפשר גם לכתוב 'אין ניסיון קודם'..." },
  { id: "redlines", question: "יש נושאים, ניסוחים או מהלכים שיש להימנע מהם לחלוטין?", placeholder: "רשימה שחורה — מה אסור בתקשורת של המותג..." },
];
