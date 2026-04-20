/* MyHome — minimal in-house i18n.
   Locale lives in cookie + localStorage. The HTML lang/dir attributes are
   set by an inline script in <head> to avoid flicker on first paint. */

export const LOCALES = ["en", "he", "ru", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const RTL_LOCALES = new Set<Locale>(["he", "ar"]);

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  he: "עברית",
  ru: "Русский",
  ar: "العربية",
};

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

export function dirFor(locale: Locale): "ltr" | "rtl" {
  return RTL_LOCALES.has(locale) ? "rtl" : "ltr";
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

interface Bundle {
  nav: { chat: string; playground: string; history: string; usage: string };
  theme: { toLight: string; toDark: string };
  locale: { switch: string };
  home: {
    title: string;
    subtitle: string;
    placeholder: string;
    send: string;
    thinking: string;
    quick: string[];
  };
  playground: {
    title: string;
    subtitle: string;
    jurisdiction: string;
    language: string;
    type: string;
    inputsJson: string;
    generate: string;
    generating: string;
    note: string;
    sectionsFor: string;
    edit: string;
    cancel: string;
    editInstruction: string;
    editPlaceholder: string;
    applyEdit: string;
    editing: string;
    costLast: string;
    totalTokens: string;
    latency: string;
    model: string;
    typeAnnual: string;
    typeSublet: string;
    typeManagement: string;
  };
  history: {
    title: string;
    subtitle: (n: number) => string;
    none: string;
    inPlayground: string;
    back: string;
    contractLabel: string;
    sectionsHeading: string;
    callsHeading: (n: number) => string;
    noLogs: string;
  };
  usage: {
    title: string;
    subtitle: string;
    ratesInput: string;
    ratesOutput: string;
    overrideVia: string;
    totalCost: string;
    totalCalls: string;
    totalTokens: string;
    totalCompute: string;
    byOperation: string;
    fullDrafting: string;
    partialEdit: string;
    freeFormChat: string;
    calls: string;
    tokens: string;
    cost: string;
    recentCalls: (n: number) => string;
    none: string;
    tryPlayground: string;
  };
  common: {
    error: string;
    notFound: string;
  };
}

const en: Bundle = {
  nav: { chat: "Chat", playground: "Playground", history: "History", usage: "Usage" },
  theme: { toLight: "Switch to light mode", toDark: "Switch to dark mode" },
  locale: { switch: "Language" },
  home: {
    title: "How can I help with your contract?",
    subtitle: "Ask anything about rentals, jurisdictions, or lease terms.",
    placeholder: "Ask about contracts, jurisdictions, or lease terms…",
    send: "Send",
    thinking: "thinking…",
    quick: [
      "What is the maximum security deposit in NY?",
      "Help me draft an annual lease in Tel Aviv",
      "What rights do tenants have in California?",
      "When can a landlord terminate a lease early?",
    ],
  },
  playground: {
    title: "Playground",
    subtitle: "Generate a contract, then edit any section in plain language.",
    jurisdiction: "Jurisdiction",
    language: "Language",
    type: "Type",
    inputsJson: "Inputs (JSON)",
    generate: "Generate Contract",
    generating: "Generating…",
    note: "Uses Ollama local model. Generation typically takes 30-90 seconds.",
    sectionsFor: "Sections — contract",
    edit: "Edit",
    cancel: "Cancel",
    editInstruction: "Edit instruction (free text)",
    editPlaceholder: "e.g. Reduce the deposit to one month rent",
    applyEdit: "Apply edit",
    editing: "Editing…",
    costLast: "Cost (last call)",
    totalTokens: "Total tokens",
    latency: "Latency",
    model: "Model",
    typeAnnual: "Annual",
    typeSublet: "Sublet",
    typeManagement: "Management",
  },
  history: {
    title: "History",
    subtitle: (n) => `All contracts in the database, newest first. ${n} shown.`,
    none: "No contracts yet. Generate one in the",
    inPlayground: "Playground",
    back: "← Back to history",
    contractLabel: "Contract",
    sectionsHeading: "Sections",
    callsHeading: (n) => `Calls on this contract (${n})`,
    noLogs: "No usage logs.",
  },
  usage: {
    title: "Usage",
    subtitle: "Token consumption, latency, and cost across every AI call.",
    ratesInput: "input",
    ratesOutput: "output",
    overrideVia: "Override via",
    totalCost: "Total cost",
    totalCalls: "Total calls",
    totalTokens: "Total tokens",
    totalCompute: "Total compute",
    byOperation: "By operation",
    fullDrafting: "Full contract drafting",
    partialEdit: "Per-section partial edit",
    freeFormChat: "Free-form chat Q&A",
    calls: "Calls",
    tokens: "Tokens",
    cost: "Cost",
    recentCalls: (n) => `Recent calls (${n})`,
    none: "No usage yet. Try the",
    tryPlayground: "Playground",
  },
  common: { error: "Error", notFound: "Not found" },
};

const he: Bundle = {
  nav: { chat: "צ׳אט", playground: "מגרש משחקים", history: "היסטוריה", usage: "שימוש" },
  theme: { toLight: "מעבר למצב יום", toDark: "מעבר למצב לילה" },
  locale: { switch: "שפה" },
  home: {
    title: "איך אפשר לעזור עם החוזה שלך?",
    subtitle: "שאל כל שאלה על שכירות, מדינות וסעיפי הסכם.",
    placeholder: "שאל על חוזים, מדינות, או תנאי שכירות…",
    send: "שלח",
    thinking: "חושב…",
    quick: [
      "מה גובה הפיקדון המקסימלי בישראל?",
      "תעזור לי לנסח שכירות שנתית בתל אביב",
      "מה הזכויות של שוכר במקרה של פינוי?",
      "מתי משכיר רשאי לסיים שכירות מוקדם?",
    ],
  },
  playground: {
    title: "מגרש משחקים",
    subtitle: "צור חוזה, ואז ערוך כל סעיף בשפה חופשית.",
    jurisdiction: "מדינה / שיפוט",
    language: "שפה",
    type: "סוג",
    inputsJson: "קלטים (JSON)",
    generate: "צור חוזה",
    generating: "מייצר…",
    note: "משתמש ב‑Ollama מקומי. יצירה אורכת בדרך כלל 30‑90 שניות.",
    sectionsFor: "סעיפים — חוזה",
    edit: "ערוך",
    cancel: "ביטול",
    editInstruction: "הוראת עריכה (טקסט חופשי)",
    editPlaceholder: 'למשל: "הפחת את הפיקדון לחודש שכירות אחד"',
    applyEdit: "החל עריכה",
    editing: "עורך…",
    costLast: "עלות (קריאה אחרונה)",
    totalTokens: "סך טוקנים",
    latency: "השהיה",
    model: "מודל",
    typeAnnual: "שנתי",
    typeSublet: "שכירות משנה",
    typeManagement: "ניהול",
  },
  history: {
    title: "היסטוריה",
    subtitle: (n) => `כל החוזים במאגר, החדשים ביותר תחילה. ${n} מוצגים.`,
    none: "אין חוזים עדיין. צור אחד ב",
    inPlayground: "מגרש המשחקים",
    back: "→ חזרה להיסטוריה",
    contractLabel: "חוזה",
    sectionsHeading: "סעיפים",
    callsHeading: (n) => `קריאות על החוזה הזה (${n})`,
    noLogs: "אין רישומי שימוש.",
  },
  usage: {
    title: "שימוש",
    subtitle: "צריכת טוקנים, השהיה ועלות לכל קריאה ל‑AI.",
    ratesInput: "קלט",
    ratesOutput: "פלט",
    overrideVia: "ניתן לשנות דרך",
    totalCost: "עלות כוללת",
    totalCalls: "קריאות סך הכל",
    totalTokens: "טוקנים סך הכל",
    totalCompute: "זמן עיבוד כולל",
    byOperation: "לפי פעולה",
    fullDrafting: "ניסוח חוזה מלא",
    partialEdit: "עריכה חלקית של סעיף",
    freeFormChat: "צ׳אט שאלות ותשובות",
    calls: "קריאות",
    tokens: "טוקנים",
    cost: "עלות",
    recentCalls: (n) => `קריאות אחרונות (${n})`,
    none: "אין שימוש עדיין. נסה את",
    tryPlayground: "מגרש המשחקים",
  },
  common: { error: "שגיאה", notFound: "לא נמצא" },
};

const ru: Bundle = {
  nav: { chat: "Чат", playground: "Песочница", history: "История", usage: "Использование" },
  theme: { toLight: "Светлая тема", toDark: "Тёмная тема" },
  locale: { switch: "Язык" },
  home: {
    title: "Чем помочь с вашим договором?",
    subtitle: "Спросите о аренде, юрисдикциях или условиях договора.",
    placeholder: "Спросите о договорах, юрисдикциях или условиях аренды…",
    send: "Отправить",
    thinking: "думаю…",
    quick: [
      "Каков максимальный депозит в Москве?",
      "Помоги составить годовой договор аренды",
      "Какие права у арендатора при выселении?",
      "Когда арендодатель может расторгнуть договор досрочно?",
    ],
  },
  playground: {
    title: "Песочница",
    subtitle: "Сгенерируйте договор, затем редактируйте любой раздел свободным текстом.",
    jurisdiction: "Юрисдикция",
    language: "Язык",
    type: "Тип",
    inputsJson: "Данные (JSON)",
    generate: "Создать договор",
    generating: "Создание…",
    note: "Использует локальную модель Ollama. Обычно 30–90 секунд.",
    sectionsFor: "Разделы — договор",
    edit: "Изменить",
    cancel: "Отмена",
    editInstruction: "Инструкция (свободный текст)",
    editPlaceholder: "напр.: Снизить депозит до одной месячной арендной платы",
    applyEdit: "Применить",
    editing: "Изменение…",
    costLast: "Стоимость (последний вызов)",
    totalTokens: "Всего токенов",
    latency: "Задержка",
    model: "Модель",
    typeAnnual: "Годовой",
    typeSublet: "Субаренда",
    typeManagement: "Управление",
  },
  history: {
    title: "История",
    subtitle: (n) => `Все договоры, сначала новые. Показано: ${n}.`,
    none: "Договоров пока нет. Создайте в",
    inPlayground: "Песочнице",
    back: "← Назад к истории",
    contractLabel: "Договор",
    sectionsHeading: "Разделы",
    callsHeading: (n) => `Вызовы по этому договору (${n})`,
    noLogs: "Нет записей об использовании.",
  },
  usage: {
    title: "Использование",
    subtitle: "Расход токенов, задержка и стоимость каждого вызова AI.",
    ratesInput: "вход",
    ratesOutput: "выход",
    overrideVia: "Переопределить через",
    totalCost: "Общая стоимость",
    totalCalls: "Всего вызовов",
    totalTokens: "Всего токенов",
    totalCompute: "Время вычислений",
    byOperation: "По операциям",
    fullDrafting: "Полный договор",
    partialEdit: "Частичное редактирование",
    freeFormChat: "Чат, вопросы и ответы",
    calls: "Вызовы",
    tokens: "Токены",
    cost: "Стоимость",
    recentCalls: (n) => `Последние вызовы (${n})`,
    none: "Пока нет использования. Попробуйте",
    tryPlayground: "Песочницу",
  },
  common: { error: "Ошибка", notFound: "Не найдено" },
};

const ar: Bundle = {
  nav: { chat: "محادثة", playground: "ساحة التجربة", history: "السجل", usage: "الاستخدام" },
  theme: { toLight: "التبديل إلى الوضع النهاري", toDark: "التبديل إلى الوضع الليلي" },
  locale: { switch: "اللغة" },
  home: {
    title: "كيف يمكنني مساعدتك في عقدك؟",
    subtitle: "اسأل أي شيء عن الإيجارات والقوانين وشروط العقود.",
    placeholder: "اسأل عن العقود أو القوانين أو شروط الإيجار…",
    send: "إرسال",
    thinking: "أفكر…",
    quick: [
      "ما الحد الأقصى للتأمين في الإمارات؟",
      "ساعدني في صياغة عقد إيجار سنوي",
      "ما حقوق المستأجر عند الإخلاء؟",
      "متى يحق للمؤجر إنهاء العقد مبكراً؟",
    ],
  },
  playground: {
    title: "ساحة التجربة",
    subtitle: "أنشئ عقداً، ثم عدّل أي بند بنص حر.",
    jurisdiction: "الولاية القضائية",
    language: "اللغة",
    type: "النوع",
    inputsJson: "المدخلات (JSON)",
    generate: "إنشاء العقد",
    generating: "جارٍ الإنشاء…",
    note: "يستخدم Ollama المحلي. الإنشاء عادة 30–90 ثانية.",
    sectionsFor: "البنود — العقد",
    edit: "تعديل",
    cancel: "إلغاء",
    editInstruction: "تعليمات التعديل (نص حر)",
    editPlaceholder: "مثال: قلّل التأمين إلى إيجار شهر واحد",
    applyEdit: "تطبيق التعديل",
    editing: "جارٍ التعديل…",
    costLast: "التكلفة (آخر طلب)",
    totalTokens: "إجمالي الرموز",
    latency: "زمن الاستجابة",
    model: "النموذج",
    typeAnnual: "سنوي",
    typeSublet: "إيجار من الباطن",
    typeManagement: "إدارة",
  },
  history: {
    title: "السجل",
    subtitle: (n) => `كل العقود في قاعدة البيانات، الأحدث أولاً. ${n} معروض.`,
    none: "لا توجد عقود بعد. أنشئ واحداً في",
    inPlayground: "ساحة التجربة",
    back: "→ العودة إلى السجل",
    contractLabel: "العقد",
    sectionsHeading: "البنود",
    callsHeading: (n) => `الطلبات على هذا العقد (${n})`,
    noLogs: "لا توجد سجلات استخدام.",
  },
  usage: {
    title: "الاستخدام",
    subtitle: "استهلاك الرموز وزمن الاستجابة والتكلفة لكل طلب AI.",
    ratesInput: "إدخال",
    ratesOutput: "إخراج",
    overrideVia: "يمكن التعديل عبر",
    totalCost: "إجمالي التكلفة",
    totalCalls: "إجمالي الطلبات",
    totalTokens: "إجمالي الرموز",
    totalCompute: "إجمالي الحوسبة",
    byOperation: "حسب العملية",
    fullDrafting: "صياغة عقد كامل",
    partialEdit: "تعديل بند جزئي",
    freeFormChat: "محادثة حرة",
    calls: "الطلبات",
    tokens: "الرموز",
    cost: "التكلفة",
    recentCalls: (n) => `آخر الطلبات (${n})`,
    none: "لا يوجد استخدام بعد. جرّب",
    tryPlayground: "ساحة التجربة",
  },
  common: { error: "خطأ", notFound: "غير موجود" },
};

export const messages: Record<Locale, Bundle> = { en, he, ru, ar };

export type T = Bundle;
