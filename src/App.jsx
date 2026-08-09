import { useEffect, useMemo, useRef, useState } from "react";
import DatePicker, { registerLocale } from "react-datepicker";
import { de } from "date-fns/locale";
import { defaultHouseholdId, isSupabaseConfigured, supabase } from "./lib/supabase";
import { getReceiptSumConsistencyStatus } from "./receiptConsistency";
import "react-datepicker/dist/react-datepicker.css";

registerLocale("de", de);

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const amountDE = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const dateTimeDE = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "short",
  timeStyle: "short",
});
const dateDE = new Intl.DateTimeFormat("de-DE", { dateStyle: "short" });
const APP_VERSION = "v1.0.8";
const CURRENCY_OPTIONS = ["EUR", "TRY", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF"];
const CURRENCY_SYMBOL = { EUR: "€", TRY: "₺", USD: "$", GBP: "£", CHF: "Fr", SEK: "kr", NOK: "kr", DKK: "kr", PLN: "zł", CZK: "Kč", HUF: "Ft" };
const AUTH_EMAIL_STORAGE_KEY = "bonbox_auth_email";
const VERIFIED_EMAIL_STORAGE_KEY = "bonbox_verified_email";
const EMERGENCY_ACCESS_ACTIVE_STORAGE_KEY = "bonbox_emergency_access_active";
const EMERGENCY_ACCESS_USED_STORAGE_KEY = "bonbox_emergency_access_used";
const EMERGENCY_ACCESS_EMAIL = "notzugang@bonbox.local";
const EMERGENCY_ACCESS_VISIBLE_EMAIL = "he@wohnbau-hess.de";
const MAGIC_LINK_COOLDOWN_UNTIL_STORAGE_KEY = "bonbox_magic_link_cooldown_until";
const ONE_TIME_BYPASS_EMAIL = "nsteinweden@yahoo.com";
const ONE_TIME_BYPASS_USED_STORAGE_KEY = "bonbox_one_time_bypass_used_nsteinweden";
const RECEIPT_COMPLETED_IDS_STORAGE_KEY = "bonbox_receipt_completed_ids";
const AUTH_REDIRECT_URL = import.meta.env.VITE_AUTH_REDIRECT_URL || "";
const MAGIC_LINK_COOLDOWN_MS = 90 * 1000;
const MAGIC_LINK_RATE_LIMIT_BACKOFF_MS = 60 * 60 * 1000;

const defaultCostGroups = [
  {
    id: "grp-gifts",
    name: "Geschenke",
    color: "#ff6b57",
    keywords: ["geschenk", "gift", "present"],
  },
  {
    id: "grp-food",
    name: "Lebensmittel",
    color: "#059669",
    keywords: ["aldi", "lidl", "rewe", "edeka", "netto", "supermarkt", "lebensmittel", "bäckerei", "baeckerei"],
  },
  {
    id: "grp-restaurant",
    name: "Essen & Trinken",
    color: "#2DD4BF",
    keywords: ["restaurant", "cafe", "café", "bar", "pizza", "burger", "liefer", "imbiss"],
  },
  {
    id: "grp-mobility",
    name: "Mobilität",
    color: "#06B6D4",
    keywords: ["tank", "shell", "aral", "uber", "taxi", "bahn", "db", "ticket", "park"],
  },
  {
    id: "grp-home",
    name: "Haushalt",
    color: "#CA8A04",
    keywords: ["dm", "rossmann", "haushalt", "reinigung", "drogerie", "toilettenpapier"],
  },
  {
    id: "grp-health",
    name: "Gesundheit",
    color: "#F43F5E",
    keywords: ["apotheke", "arzt", "medikament", "medizin", "praxis"],
  },
  {
    id: "grp-leisure",
    name: "Freizeit",
    color: "#9F7AEA",
    keywords: ["kino", "museum", "event", "sport", "training", "verein"],
  },
  {
    id: "grp-holiday",
    name: "Urlaub",
    color: "#18b6a3",
    keywords: ["urlaub", "reise", "hotel", "flueg", "flug", "airbnb", "vacation", "travel"],
  },
  {
    id: "grp-clothing",
    name: "Kleidung",
    color: "#1B4965",
    keywords: ["kleidung", "kleidet", "mode", "schuhe", "schuh", "fashion", "hm", "zara", "primark"],
  },
  {
    id: "grp-lia",
    name: "Lia",
    color: "#0891B2",
    keywords: ["lia"],
  },
  {
    id: "grp-hunde",
    name: "Hunde",
    color: "#EEA12D",
    keywords: ["hund", "hunde", "dog", "pet", "futter", "tierarzt", "vet"],
  },
  {
    id: "grp-new",
    name: "neue Kostengruppe",
    color: "#475569",
    keywords: [],
  },
];

const defaultFamilyAccount = {
  id: "family-default",
  name: "Familienkonto",
  color: "#EEA12D",
  account_type: "family",
  sort_order: 0,
};

const emptyDraft = {
  description: "",
  quantity: 1,
  amount: "",
  currency: "EUR",
  category: "",
  accountId: "",
};

function getReceiptAmountForTotals(receipt) {
  const items = Array.isArray(receipt?.receipt_items) ? receipt.receipt_items : [];
  if (items.length) {
    return items.reduce((sum, item) => {
      if (item?.is_ignored === true) return sum;
      return sum + Number(item?.amount || 0);
    }, 0);
  }

  return Number(receipt?.total_amount || 0);
}

function sumItems(receipts) {
  return receipts.reduce((acc, receipt) => acc + getReceiptAmountForTotals(receipt), 0);
}

function formatReceiptDateTime(receipt) {
  if (receipt?.receipt_date) {
    const aiTimeRaw = String(receipt?.receipt_time || receipt?.ai_raw_json?.receiptTime || "").trim();
    const parsedDateOnly = new Date(receipt.receipt_date);

    if (aiTimeRaw) {
      const normalizedTime = aiTimeRaw.match(/^\d{2}:\d{2}:\d{2}$/)
        ? aiTimeRaw
        : (aiTimeRaw.match(/^\d{2}:\d{2}$/) ? `${aiTimeRaw}:00` : "");
      if (normalizedTime) {
        const parsedDateTime = new Date(`${receipt.receipt_date}T${normalizedTime}`);
        if (!Number.isNaN(parsedDateTime.getTime())) {
          return dateTimeDE.format(parsedDateTime);
        }
      }
    }

    if (!Number.isNaN(parsedDateOnly.getTime())) {
      return dateDE.format(parsedDateOnly);
    }
  }

  if (receipt?.created_at) {
    const parsedCreated = new Date(receipt.created_at);
    if (!Number.isNaN(parsedCreated.getTime())) {
      return dateTimeDE.format(parsedCreated);
    }
  }

  return "-";
}

function formatReceiptOriginalTotal(receipt) {
  const items = Array.isArray(receipt?.receipt_items) ? receipt.receipt_items : [];
  if (!items.length) {
    return `${amountDE.format(Number(receipt?.total_amount || 0))} EUR`;
  }

  const totalsByCurrency = new Map();
  for (const item of items) {
    const currency = normalizeCurrencyCode(item?.currency || receipt?.currency || "EUR");
    const original = Number(item?.original_amount ?? item?.amount ?? 0);
    const old = totalsByCurrency.get(currency) || 0;
    totalsByCurrency.set(currency, old + original);
  }

  if (!totalsByCurrency.size) {
    return `${amountDE.format(Number(receipt?.total_amount || 0))} EUR`;
  }

  if (totalsByCurrency.size === 1) {
    const [currency, total] = totalsByCurrency.entries().next().value;
    return `${amountDE.format(total)} ${currency}`;
  }

  return Array.from(totalsByCurrency.entries())
    .map(([currency, total]) => `${amountDE.format(total)} ${currency}`)
    .join(" + ");
}

function getReceiptEurTotal(receipt) {
  const items = Array.isArray(receipt?.receipt_items) ? receipt.receipt_items : [];
  if (!items.length) {
    return Number(receipt?.total_amount || 0);
  }

  return items.reduce((sum, item) => sum + Number(item?.amount || 0), 0);
}

function parseReceiptDate(receipt) {
  const raw = receipt?.receipt_date || receipt?.created_at;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseIsoDate(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;

  const [year, month, day] = raw.split("-").map((part) => Number(part));
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatIsoDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getReceiptAssignmentStatus(receipt) {
  const items = Array.isArray(receipt?.receipt_items) ? receipt.receipt_items : [];

  if (receipt?.merchant === "Ausgleichszahlung") {
    return {
      itemCount: items.length,
      missingCategoryCount: 0,
      missingCostCenterCount: 0,
      missingEitherCount: 0,
      isComplete: true,
    };
  }

  let missingCategoryCount = 0;
  let missingCostCenterCount = 0;
  let missingEitherCount = 0;

  for (const item of items) {
    const hasCategory = Boolean(String(item?.category || "").trim());
    const hasCostCenter = Boolean(String(item?.assigned_cost_center_id || "").trim());
    if (!hasCategory) missingCategoryCount += 1;
    if (!hasCostCenter) missingCostCenterCount += 1;
    if (!hasCategory || !hasCostCenter) missingEitherCount += 1;
  }

  return {
    itemCount: items.length,
    missingCategoryCount,
    missingCostCenterCount,
    missingEitherCount,
    isComplete: items.length === 0 || missingEitherCount === 0,
  };
}

function normalizeText(text) {
  return String(text || "").toLowerCase();
}

function inferCostGroupName(description, groups) {
  const normalized = normalizeText(description);
  if (!normalized) return null;

  console.log(`[inferCostGroupName] Checking description: "${description}"`);
  console.log(`[inferCostGroupName] Available groups:`, groups.map(g => ({ 
    name: g.name, 
    keywords: g.keywords, 
    keywordsType: typeof g.keywords,
    keywordsLength: Array.isArray(g.keywords) ? g.keywords.length : 'N/A'
  })));

  for (const group of groups) {
    const keywords = Array.isArray(group.keywords) ? group.keywords : [];
    console.log(`  Checking group "${group.name}": keywords =`, keywords);
    
    for (const keyword of keywords) {
      if (keyword && normalized.includes(normalizeText(keyword))) {
        console.log(`[inferCostGroupName] ✓ MATCH: "${keyword}" found in "${normalized}" → group: "${group.name}"`);
        return group.name;
      }
    }
  }

  console.log(`[inferCostGroupName] ✗ NO MATCH for "${normalized}"`);
  return null;
}

function keywordsToText(keywords) {
  return Array.isArray(keywords) ? keywords.join(", ") : "";
}

function parseKeywords(text) {
  return String(text || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeEmailInput(value) {
  return String(value || "")
    .replace(/\(at\)/gi, "@")
    .replace(/\[at\]/gi, "@")
    .replace(/\sat\s/gi, "@");
}

function formatAmountDE(value) {
  return amountDE.format(Number(value || 0));
}

function parseAmountDE(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/\./g, "")
    .replace(",", ".");

  if (!normalized) return 0;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseShareInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  if (raw.includes("/")) {
    const [numRaw, denRaw] = raw.split("/").map((part) => String(part || "").trim());
    const num = Number(numRaw.replace(",", "."));
    const den = Number(denRaw.replace(",", "."));
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
    const ratio = num / den;
    return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
  }

  const normalized = raw.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeCurrencyCode(value) {
  const normalized = String(value || "EUR").trim().toUpperCase();
  const aliases = {
    "€": "EUR",
    EURO: "EUR",
    EUR: "EUR",
    TL: "TRY",
    TRY: "TRY",
    TYR: "TRY",
    TRL: "TRY",
    YTL: "TRY",
    "₺": "TRY",
  };
  if (aliases[normalized]) return aliases[normalized];

  const supported = new Set(CURRENCY_OPTIONS);
  if (supported.has(normalized)) return normalized;

  // Fall back to EUR for OCR typos like "TLR" instead of propagating invalid codes.
  return "EUR";
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function distributeAmountsByWeights(rows, totalAmount, getWeight) {
  if (!rows.length) return [];

  const weights = rows.map((row) => Number(getWeight(row) || 0));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const effectiveWeights = totalWeight > 0 ? weights : rows.map(() => 1);
  const effectiveTotalWeight = effectiveWeights.reduce((sum, value) => sum + value, 0);

  const distributed = rows.map((row, index) => {
    const rawAmount = effectiveTotalWeight > 0 ? (totalAmount * effectiveWeights[index]) / effectiveTotalWeight : 0;
    return {
      ...row,
      rawAmount,
      amount: roundMoney(rawAmount),
    };
  });

  const roundedSum = roundMoney(distributed.reduce((sum, row) => sum + row.amount, 0));
  const remainder = roundMoney(totalAmount - roundedSum);

  if (Math.abs(remainder) >= 0.01 && distributed.length) {
    const maxIndex = distributed.reduce((bestIndex, row, index, arr) => (
      Math.abs(row.rawAmount) > Math.abs(arr[bestIndex].rawAmount) ? index : bestIndex
    ), 0);

    distributed[maxIndex] = {
      ...distributed[maxIndex],
      amount: roundMoney(distributed[maxIndex].amount + remainder),
    };
  }

  return distributed.filter((row) => Math.abs(row.amount) > 0.0001);
}

function normalizeHexColor(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const hex = raw.startsWith("#") ? raw.slice(1) : raw;
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toLowerCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const expanded = hex.split("").map((ch) => `${ch}${ch}`).join("");
    return `#${expanded.toLowerCase()}`;
  }
  return null;
}

function getReadableTextColor(hexColor) {
  const normalized = normalizeHexColor(hexColor);
  if (!normalized) return "#10243e";
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  const luminance = (0.299 * r) + (0.587 * g) + (0.114 * b);
  return luminance > 160 ? "#10243e" : "#ffffff";
}

function buildColorInputStyle(value) {
  const normalized = normalizeHexColor(value || defaultFamilyAccount.color);
  const color = normalized || defaultFamilyAccount.color;
  const textColor = normalized ? getReadableTextColor(normalized) : getReadableTextColor(defaultFamilyAccount.color);
  return {
    backgroundColor: color,
    color: textColor,
    borderColor: "rgba(16, 36, 62, 0.24)",
    fontWeight: 700,
  };
}

function buildSummaryRowStyle(color) {
  const normalized = normalizeHexColor(color);
  if (!normalized) return undefined;

  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);

  return {
    backgroundColor: `rgba(${r}, ${g}, ${b}, 0.14)`,
    borderColor: `rgba(${r}, ${g}, ${b}, 0.5)`,
  };
}

function buildReceiptItemPayload(base, includeCurrencyColumns) {
  const payload = {
    receipt_id: base.receipt_id,
    position: base.position,
    description: base.description,
    quantity: base.quantity,
    amount: base.amount,
    category: base.category,
  };

  if (includeCurrencyColumns) {
    payload.original_amount = base.original_amount;
    payload.currency = base.currency;
    payload.exchange_rate = base.exchange_rate;
  }

  return payload;
}

function getMagicLinkRedirectUrl() {
  const envRedirect = String(AUTH_REDIRECT_URL || "").trim();

  if (typeof window !== "undefined") {
    const runtimeOrigin = String(window.location?.origin || "").trim();
    if (runtimeOrigin && !isLocalhostUrl(runtimeOrigin)) {
      // Always prefer the currently opened live domain over stale env values.
      return runtimeOrigin;
    }
    if (envRedirect) {
      return envRedirect;
    }
    return runtimeOrigin;
  }

  return envRedirect;
}

function isLocalhostUrl(value) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function getRateLimitBackoffMs(errorMessage) {
  const text = String(errorMessage || "").toLowerCase();

  const secondsMatch = text.match(/(\d+)\s*(s|sec|secs|second|seconds)/);
  if (secondsMatch) {
    return Number(secondsMatch[1]) * 1000;
  }

  const minutesMatch = text.match(/(\d+)\s*(m|min|mins|minute|minutes)/);
  if (minutesMatch) {
    return Number(minutesMatch[1]) * 60 * 1000;
  }

  const hoursMatch = text.match(/(\d+)\s*(h|hr|hrs|hour|hours)/);
  if (hoursMatch) {
    return Number(hoursMatch[1]) * 60 * 60 * 1000;
  }

  return MAGIC_LINK_RATE_LIMIT_BACKOFF_MS;
}

function getReadableAuthErrorMessage(errorMessage, fallbackMessage) {
  const rawMessage = String(errorMessage || "");
  const normalized = rawMessage.toLowerCase();

  if (
    normalized.includes("email rate limit") ||
    normalized.includes("over_email_send_rate_limit") ||
    normalized.includes("limit exceeded")
  ) {
    return "Supabase hat das E-Mail-Limit erreicht. Bitte später erneut versuchen oder in Supabase/SMTP einen eigenen Mailversand aktivieren.";
  }

  return rawMessage || fallbackMessage;
}

function safeStorageGet(key, fallback = "") {
  if (typeof window === "undefined") return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function safeStorageSet(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Ignore storage errors in restricted browser modes.
  }
}

function safeStorageRemove(key) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage errors in restricted browser modes.
  }
}

function App() {
  const householdId = defaultHouseholdId;
  const [receipts, setReceipts] = useState([]);
  const [costGroups, setCostGroups] = useState([]);
  const [familyAccounts, setFamilyAccounts] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [itemAllocations, setItemAllocations] = useState([]);
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [showSetupBanner, setShowSetupBanner] = useState(false);  // Column should exist now

  const [selectedFile, setSelectedFile] = useState(null);
  const [manualDraft, setManualDraft] = useState(emptyDraft);
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [receiptSplitRows, setReceiptSplitRows] = useState([{ costCenterId: "", share: "1" }]);
  const [selectedCostCenterForReceipt, setSelectedCostCenterForReceipt] = useState(null);
  const [descriptionDrafts, setDescriptionDrafts] = useState({});
  const [amountDrafts, setAmountDrafts] = useState({});
  const [showCostGroupModal, setShowCostGroupModal] = useState(false);
  const [costGroupModalView, setCostGroupModalView] = useState("summary");
  const [showCostCenterModal, setShowCostCenterModal] = useState(false);
  const [costCenterDrafts, setCostCenterDrafts] = useState({});
  const [newCostCenter, setNewCostCenter] = useState({ name: "", color: "#18b6a3", sort_order: 100 });
  const [newReceiptCostCenterId, setNewReceiptCostCenterId] = useState(null); // Kostenträger (wer trägt die Kosten)
  const [newPaymentAccountId, setNewPaymentAccountId] = useState(null); // Zahlungskonto für neuen Beleg
  const [blankReceiptPreset, setBlankReceiptPreset] = useState({ receiptId: null, costCenterId: null });
  const [receiptMerchantDraft, setReceiptMerchantDraft] = useState("");
  const [receiptDateDraft, setReceiptDateDraft] = useState("");
  const [completedReceiptIds, setCompletedReceiptIds] = useState(() => {
    try {
      const raw = safeStorageGet(RECEIPT_COMPLETED_IDS_STORAGE_KEY, "[]");
      const parsed = JSON.parse(raw);
      return new Set(Array.isArray(parsed) ? parsed.map((x) => String(x)) : []);
    } catch {
      return new Set();
    }
  });
  const [authEmail, setAuthEmail] = useState(() => {
    return safeStorageGet(AUTH_EMAIL_STORAGE_KEY, "");
  });
  const [authPassword, setAuthPassword] = useState("");
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [accessRecord, setAccessRecord] = useState(null);
  const [approvalStatus, setApprovalStatus] = useState("signed_out");
  const [verifiedEmail, setVerifiedEmail] = useState("");
  const [magicLinkCooldownUntil, setMagicLinkCooldownUntil] = useState(() => {
    const raw = Number(safeStorageGet(MAGIC_LINK_COOLDOWN_UNTIL_STORAGE_KEY, 0));
    return Number.isFinite(raw) ? raw : 0;
  });
  const [magicLinkNow, setMagicLinkNow] = useState(() => Date.now());
  const [pendingUsers, setPendingUsers] = useState([]);
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [costGroupDrafts, setCostGroupDrafts] = useState({});
  const [costGroupCatalogReady, setCostGroupCatalogReady] = useState(true);
  const [costGroupCatalogMessage, setCostGroupCatalogMessage] = useState("");
  const [accountCatalogReady, setAccountCatalogReady] = useState(true);
  const [accountCatalogMessage, setAccountCatalogMessage] = useState("");
  const [accountDrafts, setAccountDrafts] = useState({});
  const [receiptItemCurrencyColumnsReady, setReceiptItemCurrencyColumnsReady] = useState(true);
  const [receiptItemIgnoreColumnReady, setReceiptItemIgnoreColumnReady] = useState(true);
  const [collapsedSections, setCollapsedSections] = useState(new Set());
  const [newCostGroup, setNewCostGroup] = useState({
    name: "",
    color: "#18b6a3",
    keywordsText: "",
    sortOrder: 100,
  });
  const [newAccount, setNewAccount] = useState({
    name: "",
    color: "#18b6a3",
    accountType: "person",
    costCenterId: "",
    sortOrder: 100,
  });
  const [hideSettlementReceipts, setHideSettlementReceipts] = useState(true);
  const [receiptSearchText, setReceiptSearchText] = useState("");
  const [receiptMonthFilter, setReceiptMonthFilter] = useState("current");
  const exchangeRateCache = useRef(new Map());
  const repairedItemIds = useRef(new Set());

  const magicLinkCooldownMsLeft = Math.max(0, Number(magicLinkCooldownUntil || 0) - magicLinkNow);
  const magicLinkCooldownSeconds = Math.ceil(magicLinkCooldownMsLeft / 1000);
  const magicLinkBlocked = magicLinkCooldownSeconds > 0;

  // Toggle section collapse/expand
  const toggleSection = (sectionId) => {
    const newCollapsed = new Set(collapsedSections);
    if (newCollapsed.has(sectionId)) {
      newCollapsed.delete(sectionId);
    } else {
      newCollapsed.add(sectionId);
    }
    setCollapsedSections(newCollapsed);
  };

  // Filtered receipts based on filters
  const filteredReceipts = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    return receipts.filter((receipt) => {
      // Filter: Hide settlement receipts
      if (hideSettlementReceipts && receipt.merchant === "Ausgleichszahlung") {
        return false;
      }

      // Filter: Month/Year filtering
      const receiptDate = parseReceiptDate(receipt);
      
      if (receiptMonthFilter === "current") {
        if (receiptDate) {
          if (receiptDate.getFullYear() !== currentYear || receiptDate.getMonth() !== currentMonth) {
            return false;
          }
        }
      } else if (receiptMonthFilter === "last") {
        if (receiptDate) {
          const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
          const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
          if (receiptDate.getFullYear() !== lastMonthYear || receiptDate.getMonth() !== lastMonth) {
            return false;
          }
        }
      } else if (receiptMonthFilter === "year") {
        if (receiptDate) {
          if (receiptDate.getFullYear() !== currentYear) {
            return false;
          }
        }
      } else if (receiptMonthFilter === "lastyear") {
        if (receiptDate) {
          if (receiptDate.getFullYear() !== currentYear - 1) {
            return false;
          }
        }
      } else if (receiptMonthFilter !== "all") {
        // Specific month (0-11)
        if (receiptDate) {
          const selectedMonth = parseInt(receiptMonthFilter, 10);
          if (receiptDate.getFullYear() !== currentYear || receiptDate.getMonth() !== selectedMonth) {
            return false;
          }
        }
      }

      // Filter: Search text
      if (receiptSearchText.trim()) {
        const searchLower = receiptSearchText.toLowerCase();
        const merchantMatch = (receipt.merchant || "").toLowerCase().includes(searchLower);
        const dateMatch = (receipt.receipt_date || "").includes(receiptSearchText);
        const itemsMatch = (receipt.receipt_items || []).some((item) =>
          (item.description || "").toLowerCase().includes(searchLower)
        );
        if (!merchantMatch && !dateMatch && !itemsMatch) {
          return false;
        }
      }

      return true;
    });
  }, [receipts, hideSettlementReceipts, receiptMonthFilter, receiptSearchText]);

  useEffect(() => {
    if (!magicLinkBlocked || typeof window === "undefined") return undefined;
    const timer = window.setInterval(() => {
      setMagicLinkNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [magicLinkBlocked]);

  useEffect(() => {
    if (!magicLinkCooldownUntil) return;
    if (magicLinkCooldownUntil > Date.now()) return;
    setMagicLinkCooldownUntil(0);
    safeStorageRemove(MAGIC_LINK_COOLDOWN_UNTIL_STORAGE_KEY);
  }, [magicLinkCooldownUntil, magicLinkNow]);

  const mainAccountTotal = useMemo(() => sumItems(receipts), [receipts]);

  const costGroupTotals = useMemo(() => {
    const groups = activeCostGroups();
    const colorByName = new Map(groups.map((group) => [group.name, group.color]));
    const totals = new Map();

    for (const receipt of receipts) {
      for (const item of receipt.receipt_items || []) {
        if (item.is_ignored === true) continue;
        const groupName = item.category || "Ohne Kostengruppe";
        const old = totals.get(groupName) || 0;
        totals.set(groupName, old + Number(item.amount || 0));
      }
    }

    return Array.from(totals.entries())
      .map(([name, total]) => ({
        name,
        total,
        color: colorByName.get(name) || "#456279",
      }))
      .sort((a, b) => b.total - a.total);
  }, [receipts, costGroups]);

  const costGroupDetails = useMemo(() => {
    const groups = activeCostGroups();
    const colorByName = new Map(groups.map((group) => [group.name, group.color]));
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthsElapsed = month + 1;
    const details = new Map();

    for (const receipt of receipts) {
      const receiptDate = parseReceiptDate(receipt);
      const isYear = receiptDate ? receiptDate.getFullYear() === year : false;
      const isMonth = isYear && receiptDate.getMonth() === month;

      for (const item of receipt.receipt_items || []) {
        if (item.is_ignored === true) continue;
        const groupName = item.category || "Ohne Kostengruppe";
        const row = details.get(groupName) || {
          name: groupName,
          color: colorByName.get(groupName) || "#456279",
          total: 0,
          yearTotal: 0,
          monthTotal: 0,
          averagePerMonth: 0,
        };
        const amount = Number(item.amount || 0);
        row.total += amount;
        if (isYear) row.yearTotal += amount;
        if (isMonth) row.monthTotal += amount;
        details.set(groupName, row);
      }
    }

    const rows = Array.from(details.values())
      .map((row) => ({
        ...row,
        averagePerMonth: monthsElapsed > 0 ? row.yearTotal / monthsElapsed : 0,
      }))
      .sort((a, b) => b.total - a.total);

    const overall = rows.reduce((acc, row) => {
      acc.total += row.total;
      acc.yearTotal += row.yearTotal;
      acc.monthTotal += row.monthTotal;
      return acc;
    }, { total: 0, yearTotal: 0, monthTotal: 0, averagePerMonth: 0 });

    overall.averagePerMonth = monthsElapsed > 0 ? overall.yearTotal / monthsElapsed : 0;
    return { rows, overall };
  }, [receipts, costGroups]);

  const costGroupYearOverview = useMemo(() => {
    const groups = activeCostGroups();
    const colorByName = new Map(groups.map((group) => [group.name, group.color]));
    const year = new Date().getFullYear();
    const monthLabels = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
    const monthlyGroupTotals = Array.from({ length: 12 }, () => new Map());
    const monthlyTotals = Array(12).fill(0);
    const yearlyGroupTotals = new Map();

    for (const receipt of receipts) {
      const receiptDate = parseReceiptDate(receipt);
      if (!receiptDate || receiptDate.getFullYear() !== year) continue;

      const monthIndex = receiptDate.getMonth();
      for (const item of receipt.receipt_items || []) {
        if (item.is_ignored === true) continue;

        const amount = Number(item.amount || 0);
        const groupName = item.category || "Ohne Kostengruppe";
        monthlyTotals[monthIndex] += amount;

        const monthMap = monthlyGroupTotals[monthIndex];
        monthMap.set(groupName, (monthMap.get(groupName) || 0) + amount);
        yearlyGroupTotals.set(groupName, (yearlyGroupTotals.get(groupName) || 0) + amount);
      }
    }

    const legend = Array.from(yearlyGroupTotals.entries())
      .map(([name, total]) => ({
        name,
        total,
        color: colorByName.get(name) || "#456279",
      }))
      .sort((a, b) => b.total - a.total);

    const rankByName = new Map(legend.map((entry, index) => [entry.name, index]));
    const months = monthLabels.map((label, index) => {
      const segments = Array.from(monthlyGroupTotals[index].entries())
        .map(([name, total]) => ({
          name,
          total,
          color: colorByName.get(name) || "#456279",
          rank: rankByName.get(name) ?? 999,
        }))
        .sort((a, b) => a.rank - b.rank);

      return {
        label,
        total: monthlyTotals[index],
        segments,
      };
    });

    return { year, legend, months, maxMonthTotal: Math.max(...monthlyTotals, 0) };
  }, [receipts, costGroups]);

  // Cost Centers (Kostenträger - wer trägt die Kosten?)
  const costCenterOptions = useMemo(() => {
    let next = [...costCenters];
    if (!next.length && costCenters.length === 0) {
      next = [];
    }
    return next.sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));
  }, [costCenters]);

  // Payment Accounts (Zahlungskonten - wer hat bezahlt?)
  const paymentAccountOptions = useMemo(() => {
    const next = [...familyAccounts];
    const hasFamily = next.some((x) => x.account_type === "family");
    if (!hasFamily) {
      next.unshift(defaultFamilyAccount);
    }
    return next;
  }, [familyAccounts]);

  const accountById = useMemo(
    () => new Map(paymentAccountOptions.map((account) => [account.id, account])),
    [paymentAccountOptions]
  );

  const accountIdByCostCenterId = useMemo(() => {
    const map = new Map();
    for (const account of paymentAccountOptions) {
      if (account?.cost_center_id) {
        map.set(account.cost_center_id, account.id);
      }
    }
    return map;
  }, [paymentAccountOptions]);

  const costCenterById = useMemo(
    () => new Map(costCenterOptions.map((costCenter) => [costCenter.id, costCenter])),
    [costCenterOptions]
  );

  const resolveAllocationCostCenterId = (alloc) => {
    if (alloc?.cost_center_id) return alloc.cost_center_id;
    return accountById.get(alloc?.account_id)?.cost_center_id || null;
  };

  const accountTotals = useMemo(() => {
    const accounts = familyAccounts.length ? familyAccounts : [defaultFamilyAccount];
    const totals = new Map();
    const allocByItemId = new Map();

    for (const alloc of itemAllocations) {
      const list = allocByItemId.get(alloc.receipt_item_id) || [];
      list.push(alloc);
      allocByItemId.set(alloc.receipt_item_id, list);
    }

    for (const receipt of receipts) {
      for (const item of receipt.receipt_items || []) {
        if (item.is_ignored === true) continue;
        const itemAmount = Number(item.amount || 0);
        const allocations = allocByItemId.get(item.id) || [];

        if (!allocations.length) {
          const old = totals.get(defaultFamilyAccount.id) || 0;
          totals.set(defaultFamilyAccount.id, old + itemAmount);
          continue;
        }

        const totalAllocatedRaw = allocations.reduce((sum, alloc) => sum + Number(alloc.amount || 0), 0);
        const factor = totalAllocatedRaw > itemAmount && totalAllocatedRaw > 0 ? itemAmount / totalAllocatedRaw : 1;

        let allocated = 0;
        for (const alloc of allocations) {
          const amount = Number(alloc.amount || 0) * factor;
          const costCenterId = resolveAllocationCostCenterId(alloc);
          const accountId = alloc.account_id || accountIdByCostCenterId.get(costCenterId);
          if (accountId) {
            const old = totals.get(accountId) || 0;
            totals.set(accountId, old + amount);
            allocated += amount;
          }
        }

        if (allocated < itemAmount) {
          const old = totals.get(defaultFamilyAccount.id) || 0;
          totals.set(defaultFamilyAccount.id, old + (itemAmount - allocated));
        }
      }
    }

    return Array.from(totals.entries())
      .map(([accountId, total]) => {
        const account = accountById.get(accountId) || (accountId === defaultFamilyAccount.id ? defaultFamilyAccount : null);
        return {
          id: accountId,
          name: account?.name || "Unbekanntes Konto",
          color: account?.color || "#456279",
          total,
        };
      })
      .sort((a, b) => {
        const accountA = accountById.get(a.id) || (a.id === defaultFamilyAccount.id ? defaultFamilyAccount : null);
        const accountB = accountById.get(b.id) || (b.id === defaultFamilyAccount.id ? defaultFamilyAccount : null);
        const sortA = accountA?.sort_order ?? 999;
        const sortB = accountB?.sort_order ?? 999;
        return sortA - sortB;
      });
  }, [receipts, familyAccounts, itemAllocations, accountById, accountIdByCostCenterId]);

  // Totals by Cost Centers (Kostenträger) - new system using assigned_cost_center_id
  const costCenterTotals = useMemo(() => {
    const totals = new Map();
    const allocByItemId = new Map();

    for (const alloc of itemAllocations) {
      const list = allocByItemId.get(alloc.receipt_item_id) || [];
      list.push(alloc);
      allocByItemId.set(alloc.receipt_item_id, list);
    }

    for (const receipt of receipts) {
      for (const item of receipt.receipt_items || []) {
        if (item.is_ignored === true) continue;
        const itemAmount = Number(item.amount || 0);
        const allocations = allocByItemId.get(item.id) || [];

        if (allocations.length) {
          const totalAllocatedRaw = allocations.reduce((sum, alloc) => sum + Number(alloc.amount || 0), 0);
          const factor = totalAllocatedRaw > itemAmount && totalAllocatedRaw > 0 ? itemAmount / totalAllocatedRaw : 1;

          let allocated = 0;
          for (const alloc of allocations) {
            const costCenterId = resolveAllocationCostCenterId(alloc);
            if (!costCenterId) continue;
            const amount = Number(alloc.amount || 0) * factor;
            totals.set(costCenterId, (totals.get(costCenterId) || 0) + amount);
            allocated += amount;
          }

          if (allocated < itemAmount && item.assigned_cost_center_id) {
            totals.set(item.assigned_cost_center_id, (totals.get(item.assigned_cost_center_id) || 0) + (itemAmount - allocated));
          }
          continue;
        }

        if (item.assigned_cost_center_id) {
          const old = totals.get(item.assigned_cost_center_id) || 0;
          totals.set(item.assigned_cost_center_id, old + itemAmount);
        }
      }
    }

    return Array.from(totals.entries())
      .map(([costCenterId, total]) => {
        const costCenter = costCenterById.get(costCenterId);
        return {
          id: costCenterId,
          name: costCenter?.name || "Unbekannter Kostenträger",
          color: costCenter?.color || "#456279",
          total,
        };
      })
      .sort((a, b) => {
        const ccA = costCenterById.get(a.id);
        const ccB = costCenterById.get(b.id);
        const sortA = ccA?.sort_order ?? 999;
        const sortB = ccB?.sort_order ?? 999;
        return sortA - sortB;
      });
  }, [receipts, costCenters, itemAllocations]);

  const accountDetails = useMemo(() => {
    const allocByItemId = new Map();
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthsElapsed = month + 1;
    const details = new Map();

    for (const alloc of itemAllocations) {
      const list = allocByItemId.get(alloc.receipt_item_id) || [];
      list.push(alloc);
      allocByItemId.set(alloc.receipt_item_id, list);
    }

    for (const receipt of receipts) {
      const receiptDate = parseReceiptDate(receipt);
      const isYear = receiptDate ? receiptDate.getFullYear() === year : false;
      const isMonth = isYear && receiptDate.getMonth() === month;

      for (const item of receipt.receipt_items || []) {
        if (item.is_ignored) continue;
        const itemAmount = Number(item.amount || 0);
        const allocations = allocByItemId.get(item.id) || [];
        const totalAllocatedRaw = allocations.reduce((sum, alloc) => sum + Number(alloc.amount || 0), 0);
        const factor = totalAllocatedRaw > itemAmount && totalAllocatedRaw > 0 ? itemAmount / totalAllocatedRaw : 1;

        let allocated = 0;
        for (const alloc of allocations) {
          const costCenterId = resolveAllocationCostCenterId(alloc);
          if (!costCenterId) continue;
          const row = details.get(costCenterId) || {
            id: costCenterId,
            name: costCenterById.get(costCenterId)?.name || "Unbekannter Kostenträger",
            color: costCenterById.get(costCenterId)?.color || "#456279",
            total: 0,
            yearTotal: 0,
            monthTotal: 0,
            averagePerMonth: 0,
          };
          const amount = Number(alloc.amount || 0) * factor;
          row.total += amount;
          if (isYear) row.yearTotal += amount;
          if (isMonth) row.monthTotal += amount;
          details.set(costCenterId, row);
          allocated += amount;
        }

        if (allocated < itemAmount && item.assigned_cost_center_id) {
          const costCenterId = item.assigned_cost_center_id;
          const row = details.get(costCenterId) || {
            id: costCenterId,
            name: costCenterById.get(costCenterId)?.name || "Unbekannter Kostenträger",
            color: costCenterById.get(costCenterId)?.color || "#456279",
            total: 0,
            yearTotal: 0,
            monthTotal: 0,
            averagePerMonth: 0,
          };
          const amount = itemAmount - allocated;
          row.total += amount;
          if (isYear) row.yearTotal += amount;
          if (isMonth) row.monthTotal += amount;
          details.set(costCenterId, row);
        }
      }
    }

    const rows = Array.from(details.values())
      .map((row) => ({
        ...row,
        averagePerMonth: monthsElapsed > 0 ? row.yearTotal / monthsElapsed : 0,
      }))
      .sort((a, b) => b.total - a.total);

    const overall = rows.reduce((acc, row) => {
      acc.total += row.total;
      acc.yearTotal += row.yearTotal;
      acc.monthTotal += row.monthTotal;
      return acc;
    }, { total: 0, yearTotal: 0, monthTotal: 0, averagePerMonth: 0 });

    overall.averagePerMonth = monthsElapsed > 0 ? overall.yearTotal / monthsElapsed : 0;
    return { rows, overall };
  }, [receipts, itemAllocations, costCenterById]);

  const selectedUploadCostCenter = useMemo(() => {
    if (!newReceiptCostCenterId) return null;
    return costCenterOptions.find((cc) => cc.id === newReceiptCostCenterId) || null;
  }, [costCenterOptions, newReceiptCostCenterId]);

  const primaryAllocationByItemId = useMemo(() => {
    const map = new Map();

    for (const alloc of itemAllocations) {
      const amount = Number(alloc.amount || 0);
      const costCenterId = resolveAllocationCostCenterId(alloc);
      const current = map.get(alloc.receipt_item_id);
      if (!current || amount > current.amount) {
        map.set(alloc.receipt_item_id, { accountId: alloc.account_id || null, costCenterId, amount });
      }
    }

    return map;
  }, [itemAllocations, accountById]);

  const assignedCostCenterByItemId = useMemo(() => {
    const map = new Map();
    for (const receipt of receipts) {
      for (const item of (receipt.receipt_items || [])) {
        if (item.assigned_cost_center_id) {
          map.set(item.id, item.assigned_cost_center_id);
        }
      }
    }
    return map;
  }, [receipts]);

  const hasSetup = isSupabaseConfigured && householdId;
  const isApproved = approvalStatus === "approved";
  const isEmergencyAccessActive = approvalStatus === "approved_local";
  const hasUsedEmergencyAccess = safeStorageGet(EMERGENCY_ACCESS_USED_STORAGE_KEY, "") === "1";
  const canSeeEmergencyAccessButton = String(authEmail || "").trim().toLowerCase() === EMERGENCY_ACCESS_VISIBLE_EMAIL;
  const canUseApp = hasSetup && ((Boolean(session?.user) && isApproved) || isEmergencyAccessActive);
  const isAdmin = Boolean(accessRecord?.is_admin);
  const displayEmail = session?.user?.email || verifiedEmail || authEmail || "";

  useEffect(() => {
    if (!authEmail) {
      safeStorageRemove(AUTH_EMAIL_STORAGE_KEY);
      return;
    }
    safeStorageSet(AUTH_EMAIL_STORAGE_KEY, String(authEmail || "").trim().toLowerCase());
  }, [authEmail]);

  useEffect(() => {
    safeStorageSet(
      RECEIPT_COMPLETED_IDS_STORAGE_KEY,
      JSON.stringify(Array.from(completedReceiptIds))
    );
  }, [completedReceiptIds]);

  useEffect(() => {
    if (!receipts.length || !completedReceiptIds.size) return;

    const receiptById = new Map(receipts.map((receipt) => [String(receipt.id), receipt]));
    let changed = false;

    const next = new Set(
      Array.from(completedReceiptIds).filter((id) => {
        const receipt = receiptById.get(String(id));
        if (!receipt) {
          changed = true;
          return false;
        }

        const status = getReceiptAssignmentStatus(receipt);
        if (!status.isComplete) {
          changed = true;
          return false;
        }

        return true;
      })
    );

    if (changed) {
      setCompletedReceiptIds(next);
    }
  }, [receipts, completedReceiptIds]);

  async function getExchangeRateToEur(currency) {
    const normalized = normalizeCurrencyCode(currency);
    if (normalized === "EUR") return 1;

    if (exchangeRateCache.current.has(normalized)) {
      return exchangeRateCache.current.get(normalized);
    }

    try {
      const rateResult = await supabase.functions.invoke("bonbon-extract-receipt", {
        body: { mode: "rate", currency: normalized },
      });

      if (!rateResult.error) {
        const rate = Number(rateResult.data?.rate || 0);
        if (Number.isFinite(rate) && rate > 0) {
          exchangeRateCache.current.set(normalized, rate);
          return rate;
        }
      }
    } catch {
      // Fallback below
    }

    try {
      const fallbackResponse = await fetch(`https://open.er-api.com/v6/latest/${normalized}`);
      if (!fallbackResponse.ok) {
        throw new Error("Fallback-Kursabfrage fehlgeschlagen.");
      }

      const fallbackData = await fallbackResponse.json();
      const fallbackRate = Number(fallbackData?.rates?.EUR || 0);
      if (Number.isFinite(fallbackRate) && fallbackRate > 0) {
        exchangeRateCache.current.set(normalized, fallbackRate);
        return fallbackRate;
      }
    } catch {
      // Final fallback below
    }

    if (!error) {
      setError("Wechselkurs konnte nicht geladen werden. Bitte später erneut versuchen.");
    }
    return 1;
  }

  function getItemOriginalAmount(item) {
    return Number(item?.original_amount ?? item?.amount ?? 0);
  }

  function getItemExchangeRate(item) {
    const currency = normalizeCurrencyCode(item?.currency || "EUR");
    if (currency === "EUR") return 1;
    return Number(item?.exchange_rate || 1) || 1;
  }

  function formatConvertedInfo(item) {
    const currency = normalizeCurrencyCode(item?.currency || "EUR");
    if (currency === "EUR") return euro.format(Number(item?.amount || 0));

    return `${amountDE.format(getItemOriginalAmount(item))} ${currency} ≈ ${euro.format(Number(item?.amount || 0))}`;
  }

  async function recalculateReceiptTotal(receiptId) {
    if (!receiptId) return;

    const { data, error: sumError } = await supabase
      .from("receipt_items")
      .select("amount")
      .eq("receipt_id", receiptId);

    if (sumError) {
      setError(sumError.message);
      return;
    }

    const total = (data || []).reduce((acc, row) => acc + Number(row.amount || 0), 0);
    const { error: updateError } = await supabase
      .from("receipts")
      .update({ total_amount: roundMoney(total) })
      .eq("id", receiptId);

    if (updateError) {
      setError(updateError.message);
    }
  }

  async function repairAllReceiptTotals() {
    if (!receipts.length) {
      setError("Keine Belege zum Reparieren vorhanden.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    let repairedCount = 0;
    let mismatchCount = 0;

    for (const receipt of receipts) {
      const items = Array.isArray(receipt.receipt_items) ? receipt.receipt_items : [];
      const computedTotal = roundMoney(items.reduce((sum, item) => {
        if (item.is_ignored === true) return sum;
        return sum + Number(item.amount || 0);
      }, 0));
      const currentTotal = roundMoney(Number(receipt.total_amount || 0));

      if (Math.abs(computedTotal - currentTotal) <= 0.01) {
        continue;
      }

      mismatchCount += 1;
      const { error: updateError } = await supabase
        .from("receipts")
        .update({ total_amount: computedTotal })
        .eq("id", receipt.id);

      if (updateError) {
        setBusy(false);
        setError(`Fehler beim Reparieren von Beleg ${receipt.id}: ${updateError.message}`);
        return;
      }

      repairedCount += 1;
    }

    setBusy(false);

    if (!mismatchCount) {
      setSuccess("Keine abweichenden Beleggesamtsummen gefunden.");
      return;
    }

    setSuccess(`Reparatur abgeschlossen: ${repairedCount} Belege neu berechnet.`);
    await loadReceipts();
  }

  async function clearReceiptItems(receiptId) {
    const rpcResult = await supabase.rpc("clear_receipt_items", { p_receipt_id: receiptId });
    if (!rpcResult.error) {
      return { ok: true };
    }

    const deleteResult = await supabase
      .from("receipt_items")
      .delete()
      .eq("receipt_id", receiptId);

    if (deleteResult.error) {
      return {
        ok: false,
        message: `${rpcResult.error.message}. Bitte supabase_receipt_cleanup.sql ausführen.`,
      };
    }

    const verify = await supabase
      .from("receipt_items")
      .select("id", { count: "exact", head: true })
      .eq("receipt_id", receiptId);

    if (verify.error) {
      return { ok: false, message: verify.error.message };
    }

    if ((verify.count || 0) > 0) {
      return { ok: false, message: "Vorhandene Positionen konnten nicht entfernt werden. Bitte supabase_receipt_cleanup.sql ausführen." };
    }

    return { ok: true };
  }

  async function deleteReceiptById(receiptId) {
    const rpcResult = await supabase.rpc("delete_receipt_cascade", { p_receipt_id: receiptId });
    if (!rpcResult.error) {
      return { ok: true };
    }

    const deleteResult = await supabase
      .from("receipts")
      .delete()
      .eq("id", receiptId);

    if (deleteResult.error) {
      return {
        ok: false,
        message: `${rpcResult.error.message}. Bitte supabase_receipt_cleanup.sql ausführen.`,
      };
    }

    const verify = await supabase
      .from("receipts")
      .select("id", { count: "exact", head: true })
      .eq("id", receiptId);

    if (verify.error) {
      return { ok: false, message: verify.error.message };
    }

    if ((verify.count || 0) > 0) {
      return { ok: false, message: "Beleg konnte nicht gelöscht werden. Bitte supabase_receipt_cleanup.sql ausführen." };
    }

    return { ok: true };
  }

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setAuthLoading(false);
      return;
    }

    let active = true;

    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) {
        setError(sessionError.message);
        setAuthLoading(false);
        return;
      }

      const nextSession = data.session || null;
      setSession(nextSession);
      setAuthLoading(false);

      if (nextSession?.user) {
        void loadUserAccess(nextSession.user);
      } else {
        const hasEmergencyAccess = safeStorageGet(EMERGENCY_ACCESS_ACTIVE_STORAGE_KEY, "") === "1";
        if (hasEmergencyAccess) {
          setVerifiedEmail(EMERGENCY_ACCESS_EMAIL);
          setApprovalStatus("approved_local");
          setAccessRecord({
            email: EMERGENCY_ACCESS_EMAIL,
            status: "approved",
            is_admin: false,
          });
        } else {
          setApprovalStatus("signed_out");
          setAccessRecord(null);
          setPendingUsers([]);
        }
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setError("");
      setSuccess("");

      if (nextSession?.user) {
        void loadUserAccess(nextSession.user);
      } else {
        const hasEmergencyAccess = safeStorageGet(EMERGENCY_ACCESS_ACTIVE_STORAGE_KEY, "") === "1";
        if (hasEmergencyAccess) {
          setVerifiedEmail(EMERGENCY_ACCESS_EMAIL);
          setApprovalStatus("approved_local");
          setAccessRecord({
            email: EMERGENCY_ACCESS_EMAIL,
            status: "approved",
            is_admin: false,
          });
        } else {
          setApprovalStatus("signed_out");
          setAccessRecord(null);
          setPendingUsers([]);
        }
      }
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!canUseApp) return;
    loadReceipts();
    loadCostGroups();
    loadFamilyAccounts();
    loadCostCenters();
  }, [canUseApp]);

  useEffect(() => {
    // Set cost center selection when receipt changes
    if (selectedReceipt && receipts?.length > 0) {
      const receipt = receipts.find((r) => r.id === selectedReceipt);
      if (receipt?.receipt_items?.length > 0) {
        const firstItemCostCenter = receipt.receipt_items[0]?.assigned_cost_center_id;
        setSelectedCostCenterForReceipt(firstItemCostCenter || null);
      } else if (blankReceiptPreset.receiptId === selectedReceipt) {
        setSelectedCostCenterForReceipt(blankReceiptPreset.costCenterId || null);
      } else {
        setSelectedCostCenterForReceipt(null);
      }
    } else {
      setSelectedCostCenterForReceipt(null);
    }
  }, [selectedReceipt, receipts, blankReceiptPreset]);

  useEffect(() => {
    if (!selectedReceipt) return;

    const receipt = receipts.find((r) => r.id === selectedReceipt);
    if (!receipt) return;

    const itemIds = new Set((receipt.receipt_items || []).map((item) => item.id).filter(Boolean));
    const relevantAllocations = itemAllocations.filter((alloc) => itemIds.has(alloc.receipt_item_id));

    if (relevantAllocations.length) {
      const totalsByCostCenterId = new Map();
      for (const alloc of relevantAllocations) {
        const costCenterId = resolveAllocationCostCenterId(alloc);
        if (!costCenterId) continue;
        const old = totalsByCostCenterId.get(costCenterId) || 0;
        totalsByCostCenterId.set(costCenterId, old + Number(alloc.amount || 0));
      }

      const totalAmount = Array.from(totalsByCostCenterId.values()).reduce((sum, value) => sum + value, 0);
      const hydratedRows = Array.from(totalsByCostCenterId.entries())
        .map(([costCenterId, amount]) => {
          const normalizedShare = totalAmount > 0 ? amount / totalAmount : 0;
          const shareText = totalAmount > 0
            ? String(Number(normalizedShare.toFixed(4))).replace(".", ",")
            : "1";

          return {
            costCenterId,
            share: shareText,
          };
        })
        .filter(Boolean)
        .sort((a, b) => {
          const aSort = costCenterById.get(a.costCenterId)?.sort_order ?? 999;
          const bSort = costCenterById.get(b.costCenterId)?.sort_order ?? 999;
          return aSort - bSort;
        });

      if (hydratedRows.length) {
        setReceiptSplitRows(hydratedRows);
        return;
      }
    }

    const firstAssigned = (receipt.receipt_items || []).find((item) => item?.assigned_cost_center_id)?.assigned_cost_center_id || "";
    const fallbackCostCenterId = selectedCostCenterForReceipt || firstAssigned || costCenterOptions[0]?.id || "";
    setReceiptSplitRows([{ costCenterId: fallbackCostCenterId, share: "1" }]);
  }, [selectedReceipt, receipts, itemAllocations, selectedCostCenterForReceipt, costCenterOptions, costCenterById]);

  // Sync colors from payment accounts to cost centers
  useEffect(() => {
    if (costCenters.length === 0 || familyAccounts.length === 0) return;
    
    const updatedDrafts = { ...costCenterDrafts };
    const colorMap = {};
    
    // Map original names to colors from family accounts
    familyAccounts.forEach(acc => {
      if (acc.name.includes("Familie")) colorMap["Familie"] = acc.color;
      if (acc.name.includes("Nicole")) colorMap["Nicole"] = acc.color;
      if (acc.name.includes("Stefan")) colorMap["Stefan"] = acc.color;
    });
    
    // Update drafts with colors from accounts
    Object.keys(updatedDrafts).forEach(ccId => {
      const draft = updatedDrafts[ccId];
      // Find matching account by name prefix
      if (draft.name === "Familie" && colorMap["Familie"]) draft.color = colorMap["Familie"];
      if (draft.name === "Nicole" && colorMap["Nicole"]) draft.color = colorMap["Nicole"];
      if (draft.name === "Stefan" && colorMap["Stefan"]) draft.color = colorMap["Stefan"];
    });
    
    setCostCenterDrafts(updatedDrafts);
  }, [familyAccounts]);

  useEffect(() => {
    if (!canUseApp) {
      setItemAllocations([]);
      return;
    }

    if (!receipts.length) {
      setItemAllocations([]);
      return;
    }

    const itemIds = receipts.flatMap((r) => (r.receipt_items || []).map((i) => i.id)).filter(Boolean);
    if (!itemIds.length) {
      setItemAllocations([]);
      return;
    }

    loadItemAllocations(itemIds);
  }, [receipts, canUseApp]);

  useEffect(() => {
    if (!canUseApp || !receipts.length || !receiptItemCurrencyColumnsReady) return;

    const staleItems = receipts.flatMap((receipt) =>
      (receipt.receipt_items || [])
        .filter((item) => {
          const currency = normalizeCurrencyCode(item.currency || "EUR");
          if (currency === "EUR") return false;
          if (repairedItemIds.current.has(item.id)) return false;

          const originalAmount = roundMoney(item.original_amount ?? item.amount ?? 0);
          const eurAmount = roundMoney(item.amount || 0);
          const exchangeRate = Number(item.exchange_rate || 0);

          return originalAmount > 0 && originalAmount === eurAmount && exchangeRate === 1;
        })
        .map((item) => ({ receiptId: receipt.id, item }))
    );

    if (!staleItems.length) return;

    let cancelled = false;

    const repair = async () => {
      const touchedReceiptIds = new Set();

      for (const entry of staleItems) {
        const currency = normalizeCurrencyCode(entry.item.currency || "EUR");
        const rate = await getExchangeRateToEur(currency);
        if (!Number.isFinite(rate) || rate <= 0 || rate === 1) {
          continue;
        }

        const originalAmount = roundMoney(entry.item.original_amount ?? entry.item.amount ?? 0);
        const eurAmount = roundMoney(originalAmount * rate);
        const updateResult = await supabase
          .from("receipt_items")
          .update({
            original_amount: originalAmount,
            amount: eurAmount,
            currency,
            exchange_rate: rate,
          })
          .eq("id", entry.item.id);

        if (!updateResult.error) {
          repairedItemIds.current.add(entry.item.id);
          touchedReceiptIds.add(entry.receiptId);
        }
      }

      for (const receiptId of touchedReceiptIds) {
        await recalculateReceiptTotal(receiptId);
      }

      if (!cancelled && touchedReceiptIds.size) {
        await loadReceipts();
      }
    };

    void repair();

    return () => {
      cancelled = true;
    };
  }, [receipts, canUseApp, receiptItemCurrencyColumnsReady]);

  function activeCostGroups() {
    return costGroups.length ? costGroups : defaultCostGroups;
  }

  async function sendMagicLink() {
    if (!supabase) return;

    if (magicLinkBlocked) {
      setError(`Bitte noch ${magicLinkCooldownSeconds} Sek. warten, bevor du einen neuen Anmelde-Link sendest.`);
      return;
    }

    const value = normalizeEmailInput(authEmail).trim().toLowerCase();
    if (!value || !value.includes("@")) {
      setError("Bitte eine gültige E-Mail-Adresse eingeben.");
      return;
    }

    const redirectUrl = getMagicLinkRedirectUrl();
    if (!AUTH_REDIRECT_URL && isLocalhostUrl(redirectUrl)) {
      setError("Magic-Link-Redirect ist lokal (localhost). Bitte VITE_AUTH_REDIRECT_URL auf die Netlify-URL setzen, dann erneut senden.");
      return;
    }

    setBusy(true);
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: value,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });
    setBusy(false);

    if (authError) {
      const rawMessage = String(authError.message || "");
      const msg = rawMessage.toLowerCase();
      if (msg.includes("email rate limit") || msg.includes("over_email_send_rate_limit") || msg.includes("limit exceeded")) {
        const until = Date.now() + getRateLimitBackoffMs(rawMessage);
        setMagicLinkNow(Date.now());
        setMagicLinkCooldownUntil(until);
        safeStorageSet(MAGIC_LINK_COOLDOWN_UNTIL_STORAGE_KEY, until);
        setError("E-Mail-Limit bei Supabase erreicht. Ohne Custom SMTP sind oft nur wenige Mails pro Stunde erlaubt. Bitte später erneut versuchen oder SMTP aktivieren.");
      } else {
        setError(rawMessage);
      }
      return;
    }

    const until = Date.now() + MAGIC_LINK_COOLDOWN_MS;
    setMagicLinkNow(Date.now());
    setMagicLinkCooldownUntil(until);
    safeStorageSet(MAGIC_LINK_COOLDOWN_UNTIL_STORAGE_KEY, until);

    const approved = await verifyApprovedEmail(value, true);

    if (approved) {
      setSuccess("Freigabe erkannt. Du kannst jetzt hier weiterarbeiten.");
      return;
    }

    setError("");
    setSuccess("Anmelde-Link wurde per E-Mail gesendet.");
  }

  async function signInWithPassword() {
    if (!supabase) return;

    const email = normalizeEmailInput(authEmail).trim().toLowerCase();
    const password = String(authPassword || "");

    if (!email || !email.includes("@")) {
      setError("Bitte eine gültige E-Mail-Adresse eingeben.");
      return;
    }

    if (!password) {
      setError("Bitte ein Passwort eingeben.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setBusy(false);

    if (authError) {
      setError(authError.message || "Anmeldung fehlgeschlagen.");
      return;
    }

    setSuccess("Anmeldung erfolgreich.");
    setAuthPassword("");
  }

  async function signUpWithPassword() {
    if (!supabase) return;

    const email = normalizeEmailInput(authEmail).trim().toLowerCase();
    const password = String(authPassword || "");
    const redirectUrl = getMagicLinkRedirectUrl();

    if (!email || !email.includes("@")) {
      setError("Bitte eine gültige E-Mail-Adresse eingeben.");
      return;
    }

    if (password.length < 8) {
      setError("Bitte ein Passwort mit mindestens 8 Zeichen vergeben.");
      return;
    }

    if (!AUTH_REDIRECT_URL && isLocalhostUrl(redirectUrl)) {
      setError("Bestätigungs-Redirect ist lokal (localhost). Bitte VITE_AUTH_REDIRECT_URL auf die Netlify-URL setzen, dann erneut senden.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });

    setBusy(false);

    if (authError) {
      setError(getReadableAuthErrorMessage(authError.message, "Zugang konnte nicht angelegt werden."));
      return;
    }

    const needsEmailConfirmation = !data?.session;
    setSuccess(
      needsEmailConfirmation
        ? "Zugang angelegt. Bitte die Bestätigungs-E-Mail öffnen und dich danach mit Passwort anmelden."
        : "Zugang angelegt. Falls noch keine Freigabe besteht, muss ein Admin dich einmal freischalten."
    );
    setAuthPassword("");
  }

  async function sendPasswordReset() {
    if (!supabase) return;

    const email = normalizeEmailInput(authEmail).trim().toLowerCase();
    if (!email || !email.includes("@")) {
      setError("Bitte eine gültige E-Mail-Adresse eingeben.");
      return;
    }

    const redirectUrl = getMagicLinkRedirectUrl();
    if (!AUTH_REDIRECT_URL && isLocalhostUrl(redirectUrl)) {
      setError("Passwort-Reset-Redirect ist lokal (localhost). Bitte VITE_AUTH_REDIRECT_URL auf die Netlify-URL setzen, dann erneut senden.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl,
    });

    setBusy(false);

    if (authError) {
      setError(getReadableAuthErrorMessage(authError.message, "Passwort-Reset konnte nicht gestartet werden."));
      return;
    }

    setSuccess("E-Mail zum Setzen oder Zurücksetzen des Passworts wurde gesendet.");
  }

  function activateEmergencyAccess() {
    if (hasUsedEmergencyAccess) {
      setError("Der einmalige Notzugang wurde in diesem Browser bereits verwendet.");
      return;
    }

    setError("");
    setSuccess("Einmaliger Notzugang aktiviert. Beim Abmelden wird dieser Zugang wieder geschlossen.");
    setVerifiedEmail(EMERGENCY_ACCESS_EMAIL);
    setApprovalStatus("approved_local");
    setAccessRecord({
      email: EMERGENCY_ACCESS_EMAIL,
      status: "approved",
      is_admin: false,
    });
    safeStorageSet(VERIFIED_EMAIL_STORAGE_KEY, EMERGENCY_ACCESS_EMAIL);
    safeStorageSet(EMERGENCY_ACCESS_ACTIVE_STORAGE_KEY, "1");
    safeStorageSet(EMERGENCY_ACCESS_USED_STORAGE_KEY, "1");
  }

  async function verifyApprovedEmail(value, silent = false) {
    if (!supabase) return false;

    const email = normalizeEmailInput(value || authEmail).trim().toLowerCase();
    if (!email || !email.includes("@")) {
      if (!silent) setError("Bitte eine gültige E-Mail-Adresse eingeben.");
      return false;
    }

    if (!silent) {
      setBusy(true);
      setError("");
      setSuccess("");
    }

    const isBypassEmail = email === ONE_TIME_BYPASS_EMAIL;
    const bypassAlreadyUsed = safeStorageGet(ONE_TIME_BYPASS_USED_STORAGE_KEY, "") === "1";

    if (isBypassEmail && !bypassAlreadyUsed) {
      if (!silent) {
        setBusy(false);
      }
      setVerifiedEmail(email);
      setApprovalStatus("approved_local");
      setAccessRecord((prev) => ({
        ...(prev || {}),
        email,
        status: "approved",
        is_admin: false,
      }));
      safeStorageSet(VERIFIED_EMAIL_STORAGE_KEY, email);
      safeStorageSet(ONE_TIME_BYPASS_USED_STORAGE_KEY, "1");
      if (!silent) {
        setSuccess("Einmal-Freigabe aktiv. Du kannst jetzt fortfahren.");
      }
      return true;
    }

    const { data, error: rpcError } = await supabase.rpc("check_email_approved", { p_email: email });

    if (!silent) {
      setBusy(false);
    }

    if (rpcError) {
      if (!silent) setError(rpcError.message);
      return false;
    }

    const approvalRow = Array.isArray(data) ? data[0] : data;

    if (!approvalRow?.approved) {
      safeStorageRemove(VERIFIED_EMAIL_STORAGE_KEY);
      if (!silent) setError("Diese E-Mail ist noch nicht freigegeben.");
      return false;
    }

    setVerifiedEmail(email);
    setApprovalStatus("approved_local");
    setAccessRecord((prev) => ({
      ...(prev || {}),
      email,
      status: "approved",
      is_admin: Boolean(approvalRow?.is_admin),
    }));
    safeStorageSet(VERIFIED_EMAIL_STORAGE_KEY, email);

    if (session?.user && approvalRow?.is_admin) {
      await loadPendingUsers();
    }

    return true;
  }

  async function checkApprovedEmail() {
    const approved = await verifyApprovedEmail(authEmail, false);
    if (approved) {
      setSuccess("Freigabe erkannt. Du kannst jetzt hier weiterarbeiten. In diesem Browser bleibt das bis zum Neuladen aktiv.");
    }
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    setAccessRecord(null);
    setApprovalStatus("signed_out");
    setVerifiedEmail("");
    setPendingUsers([]);
    setSuccess("");
    safeStorageRemove(VERIFIED_EMAIL_STORAGE_KEY);
    safeStorageRemove(EMERGENCY_ACCESS_ACTIVE_STORAGE_KEY);
  }

  async function loadUserAccess(user) {
    if (!supabase) return;
    if (!user?.id) return;

    setApprovalStatus("checking");

    const { data, error: queryError } = await supabase
      .from("user_access")
      .select("user_id, email, status, is_admin, approved_at, created_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (queryError) {
      setError(queryError.message);
      setApprovalStatus("pending");
      return;
    }

    let row = data;
    if (!row) {
      const { data: created, error: insertError } = await supabase
        .from("user_access")
        .insert({
          user_id: user.id,
          email: user.email || "",
          status: "pending",
        })
        .select("user_id, email, status, is_admin, approved_at, created_at")
        .single();

      if (insertError) {
        const duplicateInsert =
          insertError.code === "23505" ||
          String(insertError.message || "").toLowerCase().includes("duplicate key value");

        if (!duplicateInsert) {
          setError(insertError.message);
          setApprovalStatus("pending");
          return;
        }

        // Another request/path already inserted the same user_access row.
        const { data: existing, error: refetchError } = await supabase
          .from("user_access")
          .select("user_id, email, status, is_admin, approved_at, created_at")
          .eq("user_id", user.id)
          .maybeSingle();

        if (refetchError || !existing) {
          setError(refetchError?.message || insertError.message);
          setApprovalStatus("pending");
          return;
        }

        row = existing;
      } else {
        row = created;
      }
    }

    setAccessRecord(row);
    const nextStatus = row.status || "pending";
    setApprovalStatus(nextStatus);

    if (row.is_admin) {
      await loadPendingUsers();
    } else {
      setPendingUsers([]);
    }
  }

  async function loadPendingUsers() {
    if (!supabase) return;
    const { data, error: queryError } = await supabase
      .from("user_access")
      .select("user_id, email, status, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (queryError) {
      setError(queryError.message);
      return;
    }

    setPendingUsers(data || []);
  }

  async function approveUser(userId) {
    if (!supabase) return;
    const { error: updateError } = await supabase
      .from("user_access")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("status", "pending");

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess("Benutzer wurde freigegeben.");
    await loadPendingUsers();
  }

  async function rejectUser(userId) {
    if (!supabase) return;
    const { error: updateError } = await supabase
      .from("user_access")
      .update({
        status: "blocked",
        is_admin: false,
        approved_at: null,
      })
      .eq("user_id", userId)
      .eq("status", "pending");

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess("Benutzer wurde abgelehnt.");
    await loadPendingUsers();
  }

  async function bootstrapFirstAdmin() {
    if (!supabase || !session?.user) return;

    setBootstrapBusy(true);
    setError("");
    setSuccess("");

    const { data, error: rpcError } = await supabase.rpc("bootstrap_first_admin");

    if (rpcError) {
      setBootstrapBusy(false);
      setError(`${rpcError.message}. Bitte supabase_user_access.sql erneut in Supabase ausführen.`);
      return;
    }

    setBootstrapBusy(false);

    if (!data) {
      setError("Bootstrap nicht möglich: Es existiert bereits ein freigegebener Admin.");
      return;
    }

    setSuccess("Du bist jetzt als erster Admin freigeschaltet.");
    await loadUserAccess(session.user);
  }

  async function loadReceipts() {
    setBusy(true);
    setError("");

    const withAllColumns = "id, merchant, receipt_date, receipt_time, total_amount, currency, image_path, ai_status, created_at, payment_account_id, receipt_items(id, description, quantity, amount, original_amount, currency, exchange_rate, category, is_ignored, assigned_cost_center_id)";
    const withoutIgnored = "id, merchant, receipt_date, receipt_time, total_amount, currency, image_path, ai_status, created_at, payment_account_id, receipt_items(id, description, quantity, amount, original_amount, currency, exchange_rate, category, assigned_cost_center_id)";
    const withoutCurrencyColumns = "id, merchant, receipt_date, receipt_time, total_amount, currency, image_path, ai_status, created_at, payment_account_id, receipt_items(id, description, quantity, amount, category, assigned_cost_center_id)";

    let response = await supabase
      .from("receipts")
      .select(withAllColumns)
      .eq("household_id", householdId)
      .order("receipt_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (response.error && String(response.error.message || "").includes("is_ignored")) {
      setReceiptItemIgnoreColumnReady(false);
      response = await supabase
        .from("receipts")
        .select(withoutIgnored)
        .eq("household_id", householdId)
        .order("receipt_date", { ascending: false })
        .order("created_at", { ascending: false });
    }

    if (response.error && String(response.error.message || "").includes("original_amount")) {
      setReceiptItemCurrencyColumnsReady(false);
      response = await supabase
        .from("receipts")
        .select(withoutCurrencyColumns)
        .eq("household_id", householdId)
        .order("receipt_date", { ascending: false })
        .order("created_at", { ascending: false });
    }

    const { data, error: queryError } = response;

    setBusy(false);

    if (queryError) {
      setError(queryError.message);
      return;
    }

    if (!response.error) {
      setReceiptItemCurrencyColumnsReady(true);
      setReceiptItemIgnoreColumnReady(true);
    }

    // Sort items within each receipt to ensure stable order
    const receiptsWithSortedItems = (data || []).map(receipt => ({
      ...receipt,
      receipt_items: (receipt.receipt_items || []).sort((a, b) => {
        // Sort by creation order (assuming earlier items in DB are earlier created)
        // or by index if creation_at is not available
        return a.id.localeCompare(b.id);
      })
    }));
    
    setReceipts(receiptsWithSortedItems);
    if (!selectedReceipt && receiptsWithSortedItems?.length) {
      setSelectedReceipt(receiptsWithSortedItems[0].id);
    }
    
    // Debug receipt items
    console.log("🔍 DEBUG loadReceipts - Receipt Items:");
    (data || []).forEach((receipt, i) => {
      const itemsWithAlloc = receipt.receipt_items?.filter(item => {
        // Need to check after allocations load, so just show count
        return item.id;
      }).length || 0;
      const accountIdPreview = String(receipt?.payment_account_id || "none").slice(0, 8);
      console.log(`  Receipt ${i} (${receipt.merchant}, ${accountIdPreview}...): ${receipt.receipt_items?.length || 0} items`);
      receipt.receipt_items?.forEach((item, j) => {
        const itemIdPreview = String(item?.id || "no-id").slice(0, 8);
        console.log(`    Item ${j}: ${itemIdPreview}... = ${item.description} (${item.amount} ${item.currency})`);
      });
    });
  }

  async function loadCostGroups() {
    const { data, error: groupError } = await supabase
      .from("household_cost_groups")
      .select("id, name, color, keywords, sort_order")
      .eq("household_id", householdId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (groupError) {
      // Fallback keeps categorization functional if catalog table is not created yet.
      setCostGroups([]);
      setCostGroupDrafts({});
      setCostGroupCatalogReady(false);
      setCostGroupCatalogMessage(groupError.message || "Kostengruppen-Katalog ist noch nicht eingerichtet.");
      return;
    }

    const next = data || [];
    setCostGroupCatalogReady(true);
    setCostGroupCatalogMessage("");
    setCostGroups(next);
    setCostGroupDrafts(
      next.reduce((acc, group) => {
        acc[group.id] = {
          name: group.name || "",
          color: group.color || "#18b6a3",
          keywordsText: keywordsToText(group.keywords),
          sortOrder: Number(group.sort_order || 100),
        };
        return acc;
      }, {})
    );
  }

  async function loadFamilyAccounts() {
    const { data, error: accountError } = await supabase
      .from("family_accounts")
      .select("id, name, color, account_type, sort_order, cost_center_id")
      .eq("household_id", householdId)
      .order("account_type", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (accountError) {
      setFamilyAccounts([]);
      setAccountCatalogReady(false);
      setAccountCatalogMessage(accountError.message || "Kostenträger-Tabelle ist noch nicht eingerichtet.");
      return;
    }

    setAccountCatalogReady(true);
    setAccountCatalogMessage("");
    const next = data || [];
    setFamilyAccounts(next);
    setAccountDrafts(
      next.reduce((acc, account) => {
        acc[account.id] = {
          name: account.name || "",
          color: account.color || "#18b6a3",
          accountType: account.account_type || "person",
          costCenterId: account.cost_center_id || "",
          sortOrder: Number(account.sort_order || 100),
        };
        return acc;
      }, {})
    );
  }

  async function loadCostCenters() {
    const { data, error: costCenterError } = await supabase
      .from("cost_centers")
      .select("id, name, color, sort_order")
      .eq("household_id", householdId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (costCenterError) {
      setCostCenters([]);
      console.error("Error loading cost_centers:", costCenterError);
      return;
    }

    // Transform names to Kostenträger format (Familie -> Familienkosten, etc.)
    const next = (data || []).map(cc => ({
      ...cc,
      name: cc.name === "Familie" ? "Familienkosten" 
          : cc.name === "Nicole" ? "Nicolekosten"
          : cc.name === "Stefan" ? "Stefankosten"
          : cc.name
    }));
    setCostCenters(next);
    
    // Initialize drafts for editing
    const drafts = {};
    (data || []).forEach(cc => {
      drafts[cc.id] = {
        name: cc.name,
        color: cc.color || "#18b6a3",
        sort_order: cc.sort_order || 100
      };
    });
    setCostCenterDrafts(drafts);
    console.log("DEBUG: Loaded cost_centers:", next);
  }

  function updateCostCenterDraft(centerId, field, value) {
    setCostCenterDrafts((prev) => ({
      ...prev,
      [centerId]: { ...prev[centerId], [field]: value }
    }));
  }

  async function saveCostCenter(centerId) {
    if (!centerId) return;
    if (!costCenterDrafts[centerId]?.name?.trim()) {
      setError("Kostenträger braucht einen Namen.");
      return;
    }

    setBusy(true);
    const draft = costCenterDrafts[centerId];
    const { error } = await supabase
      .from("cost_centers")
      .update({ name: draft.name, color: draft.color, sort_order: draft.sort_order })
      .eq("id", centerId)
      .eq("household_id", householdId);

    setBusy(false);
    if (error) {
      setError("Fehler beim Speichern: " + error.message);
      return;
    }
    setSuccess("Kostenträger gespeichert.");
    await loadCostCenters();
  }

  async function deleteCostCenter(centerId) {
    if (!centerId || !window.confirm("Kostenträger wirklich löschen?")) return;

    setBusy(true);
    const { error } = await supabase
      .from("cost_centers")
      .delete()
      .eq("id", centerId)
      .eq("household_id", householdId);

    setBusy(false);
    if (error) {
      setError("Fehler beim Löschen: " + error.message);
      return;
    }
    setSuccess("Kostenträger gelöscht.");
    setNewReceiptCostCenterId(null);
    await loadCostCenters();
  }

  async function addNewCostCenter() {
    if (!newCostCenter.name?.trim()) {
      setError("Bitte Namen für neuen Kostenträger eingeben.");
      return;
    }

    setBusy(true);
    const { error } = await supabase
      .from("cost_centers")
      .insert([{
        household_id: householdId,
        name: newCostCenter.name,
        color: newCostCenter.color,
        sort_order: newCostCenter.sort_order
      }]);

    setBusy(false);
    if (error) {
      setError("Fehler beim Hinzufügen: " + error.message);
      return;
    }
    setSuccess("Kostenträger hinzugefügt.");
    setNewCostCenter({ name: "", color: "#18b6a3", sort_order: 100 });
    await loadCostCenters();
  }

  async function loadItemAllocations(itemIds) {
    if (!itemIds?.length) {
      setItemAllocations([]);
      return;
    }

    let allocResponse = await supabase
      .from("receipt_item_allocations")
      .select("receipt_item_id, account_id, cost_center_id, amount")
      .in("receipt_item_id", itemIds);

    if (allocResponse.error && String(allocResponse.error.message || "").includes("cost_center_id")) {
      allocResponse = await supabase
        .from("receipt_item_allocations")
        .select("receipt_item_id, account_id, amount")
        .in("receipt_item_id", itemIds);
    }

    const { data, error: allocError } = allocResponse;

    if (allocError) {
      setItemAllocations([]);
      return;
    }

    console.log("🔍 DEBUG loadItemAllocations:");
    console.log("  Requested itemIds:", itemIds);
    console.log("  Loaded allocations:", data);
    if (data?.length) {
      data.forEach((alloc, i) => {
        console.log(`    Alloc ${i}: receipt_item_id=${alloc.receipt_item_id}`);
      });
    }
    setItemAllocations((data || []).map((alloc) => ({ ...alloc, cost_center_id: alloc.cost_center_id || null })));
  }

  async function replaceItemAllocations(itemId, allocationSpecs) {
    const { error: deleteError } = await supabase
      .from("receipt_item_allocations")
      .delete()
      .eq("receipt_item_id", itemId);

    if (deleteError) {
      setError(deleteError.message);
      return false;
    }

    const normalizedAllocations = (allocationSpecs || [])
      .map((row) => ({
        costCenterId: String(row?.costCenterId || "").trim() || null,
        amount: roundMoney(Number(row?.amount || 0)),
      }))
      .filter((row) => row.costCenterId && row.amount > 0);

    if (!normalizedAllocations.length) {
      setItemAllocations((prev) => prev.filter((x) => x.receipt_item_id !== itemId));
      return true;
    }

    const insertRows = normalizedAllocations.map((row) => ({
      receipt_item_id: itemId,
      account_id: accountIdByCostCenterId.get(row.costCenterId) || null,
      cost_center_id: row.costCenterId,
      amount: row.amount,
    }));

    let insertResponse = await supabase
      .from("receipt_item_allocations")
      .insert(insertRows)
      .select("receipt_item_id, account_id, cost_center_id, amount");

    if (insertResponse.error && String(insertResponse.error.message || "").includes("cost_center_id")) {
      const fallbackRows = insertRows
        .filter((row) => row.account_id)
        .map((row) => ({
          receipt_item_id: row.receipt_item_id,
          account_id: row.account_id,
          amount: row.amount,
        }));

      if (fallbackRows.length !== insertRows.length) {
        setError("Für Kostensplits ohne verknüpftes Zahlungskonto muss zuerst die neue DB-Migration für cost_center_id ausgeführt werden.");
        setItemAllocations((prev) => prev.filter((x) => x.receipt_item_id !== itemId));
        return false;
      }

      insertResponse = await supabase
        .from("receipt_item_allocations")
        .insert(fallbackRows)
        .select("receipt_item_id, account_id, amount");
    }

    const { data, error: insertError } = insertResponse;

    if (insertError) {
      setError(insertError.message);
      return false;
    }

    setItemAllocations((prev) => {
      const filtered = prev.filter((x) => x.receipt_item_id !== itemId);
      const nextRows = (data || []).map((alloc) => ({ ...alloc, cost_center_id: alloc.cost_center_id || null }));
      return [...filtered, ...nextRows];
    });

    return true;
  }

  async function setSingleItemAllocation(itemId, costCenterId, amount) {
    const parsedAmount = roundMoney(Number(amount || 0));
    if (!costCenterId || parsedAmount <= 0) {
      return replaceItemAllocations(itemId, []);
    }
    return replaceItemAllocations(itemId, [{ costCenterId, amount: parsedAmount }]);
  }

  async function rescaleItemAllocations(itemId, nextAmount, fallbackCostCenterId = null) {
    const currentAllocations = itemAllocations.filter((alloc) => alloc.receipt_item_id === itemId);
    if (!currentAllocations.length) return true;

    const normalizedRows = currentAllocations
      .map((alloc) => ({
        costCenterId: resolveAllocationCostCenterId(alloc) || fallbackCostCenterId,
        weight: Number(alloc.amount || 0),
      }))
      .filter((row) => row.costCenterId);

    if (!normalizedRows.length) return true;

    const distributedRows = distributeAmountsByWeights(normalizedRows, roundMoney(Number(nextAmount || 0)), (row) => row.weight);
    return replaceItemAllocations(itemId, distributedRows);
  }

  async function deleteItemAllocation(itemId) {
    const { error } = await supabase
      .from("receipt_item_allocations")
      .delete()
      .eq("receipt_item_id", itemId);

    if (error) {
      setError(error.message);
      return false;
    }

    setItemAllocations((prev) => prev.filter((x) => x.receipt_item_id !== itemId));
    setSuccess("Allocation gelöscht.");
    return true;
  }

  async function fixWrongAllocations() {
    // Stefan's 6 items should be allocated to Familienkonto
    // Item IDs from Stefan's receipts (Bäcker & Netto)
    const stefanItemIds = [
      '9e7cc596-fa88-445d-8498-26d820adee1c', // KREPPEL
      'c83fea1e-4534-4ea7-9059-b93adea19fdd', // Pflaumenkreppel
      '30afd55b-4412-46d0-984b-8ee0d517430d', // Eierlikörkreppel
      'a80102fc-c53b-493e-8948-35533d1663b4', // Kreppel mit Nutella
      'c2f94946-3c88-431d-8c18-3f4c77813fa8', // Vanillekreppel
      'e2560560-e60a-41f8-b285-87b0bcd12af0', // Papiertasche
      '60ad4196-e11e-462b-9066-19c5a4db8279', // Favora Topa
      '83066953-9efe-43b9-a989-daaa3a614df7', // GL H-Milch
      '4aa55256-5626-49e4-b0ff-f25d63be82b7', // BO-Laugenbreze
    ];
    
    const stefanAmounts = {
      '9e7cc596-fa88-445d-8498-26d820adee1c': 5.75,
      'c83fea1e-4534-4ea7-9059-b93adea19fdd': 2.8,
      '30afd55b-4412-46d0-984b-8ee0d517430d': 4.8,
      'a80102fc-c53b-493e-8948-35533d1663b4': 5.25,
      'c2f94946-3c88-431d-8c18-3f4c77813fa8': 3.2,
      'e2560560-e60a-41f8-b285-87b0bcd12af0': 0.2,
      '60ad4196-e11e-462b-9066-19c5a4db8279': 4.95,
      '83066953-9efe-43b9-a989-daaa3a614df7': 2.85,
      '4aa55256-5626-49e4-b0ff-f25d63be82b7': 0.39,
    };
    
    // First delete all existing allocations
    const { error: deleteError } = await supabase
      .from("receipt_item_allocations")
      .delete()
      .gt("amount", -1); // Delete all rows
    
    if (deleteError) {
      console.error("Delete error:", deleteError);
    }
    
    // Then create correct allocations: Stefan items → Familienkonto
    const familienkontoId = defaultFamilyAccount.id;
    const allocationRows = stefanItemIds.map((itemId) => ({
      receipt_item_id: itemId,
      account_id: familienkontoId,
      amount: stefanAmounts[itemId] || 0,
    }));
    
    const { error: insertError } = await supabase
      .from("receipt_item_allocations")
      .insert(allocationRows);
    
    if (insertError) {
      setError(`Fehler beim Erstellen von Allocations: ${insertError.message}`);
      return;
    }
    
    setSuccess("✓ Allocations repariert: Stefans Items gehen zu Familienkonto!");
    await loadItemAllocations(receipts.flatMap((r) => (r.receipt_items || []).map((i) => i.id)).filter(Boolean));
  }

  function addReceiptSplitRow() {
    setReceiptSplitRows((prev) => [...prev, { costCenterId: "", share: "1" }]);
  }

  function removeReceiptSplitRow(index) {
    setReceiptSplitRows((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length ? next : [{ costCenterId: "", share: "1" }];
    });
  }

  function updateReceiptSplitRow(index, patch) {
    setReceiptSplitRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function applyReceiptSplitByCostCenters() {
    if (!currentReceipt?.id) return;

    const items = (currentReceipt.receipt_items || []).filter((item) => item?.is_ignored !== true);
    if (!items.length) {
      setError("Keine aktiven Positionen zum Aufteilen vorhanden.");
      return;
    }

    const splitRows = [];
    for (const row of receiptSplitRows) {
      const costCenterId = String(row?.costCenterId || "").trim();
      const share = parseShareInput(row?.share);
      if (!costCenterId) continue;
      if (share === null) {
        setError("Bitte nur gültige Anteile eintragen (z.B. 1/3, 1/2, 0,5). ");
        return;
      }

      splitRows.push({ costCenterId, weight: share });
    }

    if (!splitRows.length) {
      setError("Bitte mindestens einen Kostenträger mit Anteil auswählen.");
      return;
    }

    const totalWeight = splitRows.reduce((sum, row) => sum + row.weight, 0);
    if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
      setError("Die Summe der Anteile muss größer als 0 sein.");
      return;
    }

    const itemIds = items.map((item) => item.id).filter(Boolean);
    if (!itemIds.length) {
      setError("Keine gültigen Positions-IDs gefunden.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    const { error: deleteError } = await supabase
      .from("receipt_item_allocations")
      .delete()
      .in("receipt_item_id", itemIds);

    if (deleteError) {
      setBusy(false);
      setError(deleteError.message);
      return;
    }

    const allocationRows = [];
    const assignmentUpdates = [];

    for (const item of items) {
      const itemAmount = roundMoney(Number(item.amount || 0));
      const roundedRows = distributeAmountsByWeights(splitRows, itemAmount, (row) => row.weight);
      for (const row of roundedRows) {
        allocationRows.push({
          receipt_item_id: item.id,
          account_id: accountIdByCostCenterId.get(row.costCenterId) || null,
          cost_center_id: row.costCenterId,
          amount: row.amount,
        });
      }

      const primary = roundedRows.reduce((best, row) => (
        !best || Math.abs(row.amount) > Math.abs(best.amount) ? row : best
      ), null);

      if (primary?.costCenterId) {
        assignmentUpdates.push({ itemId: item.id, costCenterId: primary.costCenterId });
      }
    }

    if (allocationRows.length) {
      let insertResponse = await supabase
        .from("receipt_item_allocations")
        .insert(allocationRows)
        .select("receipt_item_id");

      if (insertResponse.error && String(insertResponse.error.message || "").includes("cost_center_id")) {
        const fallbackRows = allocationRows
          .filter((row) => row.account_id)
          .map((row) => ({
            receipt_item_id: row.receipt_item_id,
            account_id: row.account_id,
            amount: row.amount,
          }));

        if (fallbackRows.length !== allocationRows.length) {
          setBusy(false);
          setError("Für Kostensplits ohne verknüpftes Zahlungskonto muss zuerst die neue DB-Migration für cost_center_id ausgeführt werden.");
          return;
        }

        insertResponse = await supabase
          .from("receipt_item_allocations")
          .insert(fallbackRows)
          .select("receipt_item_id");
      }

      const { error: insertError } = insertResponse;

      if (insertError) {
        setBusy(false);
        setError(insertError.message);
        return;
      }
    }

    for (const update of assignmentUpdates) {
      const { error: patchError } = await supabase
        .from("receipt_items")
        .update({ assigned_cost_center_id: update.costCenterId })
        .eq("id", update.itemId);

      if (patchError) {
        setBusy(false);
        setError(patchError.message);
        return;
      }
    }

    setBusy(false);
    setSuccess("Kostenaufteilung gespeichert.");
    await loadItemAllocations(itemIds);
    await refreshReceiptData(currentReceipt.id);
  }

  async function assignItemToCostCenter(item, costCenterId) {
    try {
      const patchData = costCenterId 
        ? { assigned_cost_center_id: costCenterId }
        : { assigned_cost_center_id: null };
      
      console.log("Assigning cost center:", { itemId: item.id, costCenterId, patchData });
      
      await patchItem(item.id, patchData);

      const ok = await setSingleItemAllocation(item.id, costCenterId, Number(item.amount || 0));
      if (!ok) return;

      setSuccess("Kostenträger aktualisiert.");
    } catch (err) {
      const errMsg = String(err?.message || err);
      console.error("assignItemToCostCenter error:", err, errMsg);
      
      if (errMsg.includes("assigned_cost_center_id") || errMsg.includes("does not exist")) {
        setShowSetupModal(true);
        setError("⚠️ Die Kostenträger-Spalte muss erst in der Datenbank erstellt werden.");
      } else {
        setError(`Fehler beim Speichern: ${errMsg}`);
      }
    }
  }

  async function assignItemToAccount(item, accountId) {
    const costCenterId = accountById.get(accountId)?.cost_center_id || null;
    const ok = await setSingleItemAllocation(item.id, costCenterId, Number(item.amount || 0));
    if (!ok) return;
    setSuccess("Kostenträger aktualisiert.");
  }

  function updateCostGroupDraft(groupId, key, value) {
    setCostGroupDrafts((prev) => ({
      ...prev,
      [groupId]: {
        ...(prev[groupId] || {}),
        [key]: value,
      },
    }));
  }

  function updateAccountDraft(accountId, key, value) {
    setAccountDrafts((prev) => ({
      ...prev,
      [accountId]: {
        ...(prev[accountId] || {}),
        [key]: value,
      },
    }));
  }

  async function saveCostGroup(groupId) {
    const draft = costGroupDrafts[groupId];
    if (!draft?.name) {
      setError("Kostengruppe braucht einen Namen.");
      return;
    }

    setBusy(true);
    setError("");

    const { error: updateError } = await supabase
      .from("household_cost_groups")
      .update({
        name: draft.name.trim(),
        color: draft.color || "#18b6a3",
        keywords: parseKeywords(draft.keywordsText),
        sort_order: Number(draft.sortOrder || 100),
      })
      .eq("id", groupId)
      .eq("household_id", householdId);

    setBusy(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess("Kostengruppe gespeichert.");
    await loadCostGroups();
    await loadReceipts();
  }

  async function deleteCostGroup(groupId) {
    setBusy(true);
    setError("");

    const { error: deleteError } = await supabase
      .from("household_cost_groups")
      .delete()
      .eq("id", groupId)
      .eq("household_id", householdId);

    setBusy(false);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setSuccess("Kostengruppe gelöscht.");
    await loadCostGroups();
    await loadReceipts();
  }

  async function addCostGroup() {
    if (!newCostGroup.name.trim()) {
      setError("Bitte Name für die neue Kostengruppe eingeben.");
      return;
    }

    setBusy(true);
    setError("");

    const { error: insertError } = await supabase.from("household_cost_groups").insert({
      household_id: householdId,
      name: newCostGroup.name.trim(),
      color: newCostGroup.color || "#18b6a3",
      keywords: parseKeywords(newCostGroup.keywordsText),
      sort_order: Number(newCostGroup.sortOrder || 100),
    });

    setBusy(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setNewCostGroup({
      name: "",
      color: "#18b6a3",
      keywordsText: "",
      sortOrder: 100,
    });

    setSuccess("Kostengruppe hinzugefügt.");
    await loadCostGroups();
    await loadReceipts();
  }

  async function saveFamilyAccount(accountId) {
    const draft = accountDrafts[accountId];
    if (!draft?.name?.trim()) {
      setError("Kostenträger braucht einen Namen.");
      return;
    }

    setBusy(true);
    setError("");

    const { error: updateError } = await supabase
      .from("family_accounts")
      .update({
        name: draft.name.trim(),
        color: draft.color || "#18b6a3",
        account_type: draft.accountType || "person",
        cost_center_id: draft.costCenterId || null,
        sort_order: Number(draft.sortOrder || 100),
      })
      .eq("id", accountId)
      .eq("household_id", householdId);

    setBusy(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess("Kostenträger gespeichert.");
    await loadFamilyAccounts();
  }

  async function deleteFamilyAccount(account) {
    if (!account?.id) return;
    if (account.account_type === "family") {
      setError("Das Familienkonto kann nicht gelöscht werden.");
      return;
    }

    setBusy(true);
    setError("");

    const { error: deleteError } = await supabase
      .from("family_accounts")
      .delete()
      .eq("id", account.id)
      .eq("household_id", householdId);

    setBusy(false);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setSuccess("Kostenträger gelöscht.");
    await loadFamilyAccounts();
    await loadItemAllocations(receipts.flatMap((r) => (r.receipt_items || []).map((i) => i.id)).filter(Boolean));
  }

  async function addFamilyAccount() {
    if (!newAccount.name.trim()) {
      setError("Bitte Name eingeben.");
      return;
    }

    setBusy(true);
    setError("");

    const { error: insertError } = await supabase.from("family_accounts").insert({
      household_id: householdId,
      name: newAccount.name.trim(),
      color: newAccount.color || "#18b6a3",
      account_type: newAccount.accountType || "person",
      cost_center_id: newAccount.costCenterId || null,
      sort_order: Number(newAccount.sortOrder || 100),
    });

    setBusy(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setNewAccount({
      name: "",
      color: "#18b6a3",
      accountType: "person",
      costCenterId: "",
      sortOrder: 100,
    });
    setSuccess("Kostenträger hinzugefügt.");
    await loadFamilyAccounts();
  }

  async function analyzeReceipt(receiptId, imagePath, options = {}) {
    const { replaceItems = false, defaultAccountId = defaultFamilyAccount.id } = options;

    const aiResult = await supabase.functions.invoke("bonbon-extract-receipt", {
      body: { imagePath },
    });

    if (aiResult.error) {
      await supabase
        .from("receipts")
        .update({ ai_status: "failed" })
        .eq("id", receiptId);

      return { ok: false, message: `KI-Auswertung fehlgeschlagen: ${aiResult.error.message}` };
    }

    const parsed = aiResult.data || {};
    console.error("🚨🚨🚨 PARSED DATA 🚨🚨🚨", { merchant: parsed.merchant, itemCount: parsed.items?.length });
    
    const rawCurrency = normalizeCurrencyCode(parsed.currency || "EUR");
    const exchangeRate = await getExchangeRateToEur(rawCurrency);
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    
    console.error("🚨 MERCHANT CHECK - Merchant: '" + parsed.merchant + "' activeCostGroups:", activeCostGroups().length);
    
    // Determine cost group based on merchant name
    const merchantCategory = inferCostGroupName(parsed.merchant || "", activeCostGroups());
    console.error("🚨 MERCHANT CATEGORY RESULT: '" + merchantCategory + "'");
    
    const convertedItems = items.map((item) => {
      const originalAmount = roundMoney(item.amount || 0);
      const eurAmount = roundMoney(originalAmount * exchangeRate);

      return {
        description: String(item.description || ""),
        quantity: Number(item.quantity || 1),
        original_amount: originalAmount,
        amount: eurAmount,
        currency: rawCurrency,
        exchange_rate: exchangeRate,
        category: merchantCategory || inferCostGroupName(item.description, activeCostGroups()),
      };
    });

    const originalTotalAmount = roundMoney(parsed.totalAmount || 0);
    const convertedTotalAmount = roundMoney(originalTotalAmount * exchangeRate);
    const receiptUpdate = await supabase
      .from("receipts")
      .update({
        merchant: parsed.merchant || "Unbekannt",
        receipt_date: parsed.receiptDate || new Date().toISOString().slice(0, 10),
        receipt_time: parsed.receiptTime || null,
        total_amount: convertedTotalAmount,
        currency: rawCurrency,
        ai_status: "done",
        ai_raw_json: {
          ...parsed,
          currency: rawCurrency,
          originalTotalAmount,
          exchangeRate,
          totalAmountEur: convertedTotalAmount,
        },
      })
      .eq("id", receiptId);

    if (receiptUpdate.error) {
      return { ok: false, message: receiptUpdate.error.message };
    }

    if (replaceItems) {
      const clearResult = await clearReceiptItems(receiptId);
      if (!clearResult.ok) {
        return { ok: false, message: clearResult.message };
      }
    }

    if (items.length) {
      const rows = convertedItems.map((item, index) => buildReceiptItemPayload({
        receipt_id: receiptId,
        position: index + 1,
        description: String(item.description || `Position ${index + 1}`),
        quantity: Number(item.quantity || 1),
        original_amount: Number(item.original_amount || 0),
        amount: Number(item.amount || 0),
        currency: item.currency || rawCurrency,
        exchange_rate: Number(item.exchange_rate || 1),
        category: item.category,
      }, receiptItemCurrencyColumnsReady));

      let insertItems = await supabase.from("receipt_items").insert(rows).select("id, amount");

      if (insertItems.error && String(insertItems.error.message || "").includes("original_amount")) {
        setReceiptItemCurrencyColumnsReady(false);
        const fallbackRows = convertedItems.map((item, index) => buildReceiptItemPayload({
          receipt_id: receiptId,
          position: index + 1,
          description: String(item.description || `Position ${index + 1}`),
          quantity: Number(item.quantity || 1),
          amount: Number(item.amount || 0),
          category: item.category,
        }, false));
        insertItems = await supabase.from("receipt_items").insert(fallbackRows).select("id, amount");
      }

      if (insertItems.error) {
        return { ok: false, message: insertItems.error.message };
      }

      if (defaultAccountId && defaultAccountId !== defaultFamilyAccount.id) {
        const defaultCostCenterId = accountById.get(defaultAccountId)?.cost_center_id || null;
        const allocationRows = (insertItems.data || [])
          .map((row) => ({
            receipt_item_id: row.id,
            account_id: defaultAccountId,
            cost_center_id: defaultCostCenterId,
            amount: Number(row.amount || 0),
          }));

        if (allocationRows.length) {
          let allocationInsert = await supabase.from("receipt_item_allocations").insert(allocationRows);
          if (allocationInsert.error && String(allocationInsert.error.message || "").includes("cost_center_id")) {
            const fallbackRows = allocationRows.map((row) => ({
              receipt_item_id: row.receipt_item_id,
              account_id: row.account_id,
              amount: row.amount,
            }));
            allocationInsert = await supabase.from("receipt_item_allocations").insert(fallbackRows);
          }

          const allocationError = allocationInsert.error;
          if (allocationError) {
            return { ok: false, message: allocationError.message };
          }

          await loadItemAllocations((insertItems.data || []).map((row) => row.id));
        }
      }
    }

    return { ok: true };
  }

  async function uploadAndExtract() {
    if (!selectedFile || !canUseApp) return;
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const fileName = String(selectedFile.name || "").toLowerCase();
      const mimeType = String(selectedFile.type || "").toLowerCase();
      const isPdf = mimeType === "application/pdf" || fileName.endsWith(".pdf");
      const ext = isPdf
        ? "pdf"
        : (fileName.split(".").pop()?.replace(/[^a-z0-9]/g, "") || "jpg");
      const fallbackId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const fileId = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
        ? crypto.randomUUID()
        : fallbackId;
      const storagePath = `${householdId}/${fileId}.${ext}`;

      const uploadResult = await supabase.storage
        .from("receipts")
        .upload(storagePath, selectedFile, { upsert: false, contentType: selectedFile.type || undefined });

      if (uploadResult.error) {
        throw new Error(uploadResult.error.message);
      }

      const initialReceipt = await supabase
        .from("receipts")
        .insert({
          household_id: householdId,
          merchant: "Wird analysiert...",
          receipt_date: new Date().toISOString().slice(0, 10),
          total_amount: 0,
          currency: "EUR",
          image_path: storagePath,
          ai_status: "processing",
        })
        .select("id")
        .single();

      if (initialReceipt.error) {
        throw new Error(initialReceipt.error.message);
      }

      const receiptId = initialReceipt.data.id;

      // Note: For now, we don't pass defaultCostCenterId to OCR analysis
      const result = await analyzeReceipt(receiptId, storagePath);
      if (!result.ok) {
        await loadReceipts();
        throw new Error(result.message);
      }

      // Auto-assign categories based on merchant name
      const freshReceipt = await supabase
        .from("receipts")
        .select(`*, receipt_items(*)`)
        .eq("id", receiptId)
        .single();

      if (freshReceipt.data?.receipt_items?.length) {
        const groups = activeCostGroups();
        const merchantCategory = inferCostGroupName(freshReceipt.data.merchant || "", groups);

        if (merchantCategory) {
          for (const item of freshReceipt.data.receipt_items) {
            await supabase
              .from("receipt_items")
              .update({ category: merchantCategory })
              .eq("id", item.id);
          }
        }
      }

      // Transfer payment account to new receipt
      const paymentAccountToUse = newPaymentAccountId || currentReceipt?.payment_account_id;

      if (paymentAccountToUse) {
        await supabase
          .from("receipts")
          .update({ payment_account_id: paymentAccountToUse })
          .eq("id", receiptId);
      }

      // Assign cost center to all items if selected
      if (newReceiptCostCenterId && freshReceipt.data?.receipt_items?.length) {
        for (const item of freshReceipt.data.receipt_items) {
          await supabase
            .from("receipt_items")
            .update({ assigned_cost_center_id: newReceiptCostCenterId })
            .eq("id", item.id);
        }
      }

      // Reset form
      setSelectedFile(null);
      setNewReceiptCostCenterId(null);
      setNewPaymentAccountId(null);

      setSuccess("Beleg wurde analysiert und ins Haushaltsbuch übernommen.");
      await loadReceipts();
      setSelectedReceipt(receiptId);
    } catch (err) {
      setError(err?.message || "Beim Upload oder der KI-Auswertung ist ein Fehler aufgetreten.");
    } finally {
      setBusy(false);
    }
  }

  async function retryAnalysis(receipt) {
    if (!receipt?.id || !receipt?.image_path || !canUseApp) return;

    setBusy(true);
    setError("");
    setSuccess("");

    const prep = await supabase
      .from("receipts")
      .update({
        merchant: "Wird analysiert...",
        ai_status: "processing",
      })
      .eq("id", receipt.id);

    if (prep.error) {
      setBusy(false);
      setError(prep.error.message);
      return;
    }

    const result = await analyzeReceipt(receipt.id, receipt.image_path, { replaceItems: true });
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      await loadReceipts();
      return;
    }

    setBusy(false);
    setSuccess("Beleg wurde erneut analysiert.");
    await loadReceipts();
    setSelectedReceipt(receipt.id);
  }

  async function deleteReceipt(receipt) {
    if (!receipt?.id) return;
    if (!window.confirm("Diesen Beleg wirklich löschen? Alle Positionen und Zuordnungen werden entfernt.")) {
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    const result = await deleteReceiptById(receipt.id);
    setBusy(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    setSuccess("Beleg wurde gelöscht.");
    setSelectedReceipt((prev) => (prev === receipt.id ? null : prev));
    await loadReceipts();
  }

  async function createBlankReceipt() {
    if (!canUseApp) return;
    const carryCostCenterId = selectedCostCenterForReceipt || newReceiptCostCenterId || null;

    setBusy(true);
    setError("");
    setSuccess("");

    const paymentAccountToUse = newPaymentAccountId || currentReceipt?.payment_account_id || defaultFamilyAccount.id;

    const { data, error: insertError } = await supabase
      .from("receipts")
      .insert({
        household_id: householdId,
        merchant: "Blankobeleg",
        receipt_date: new Date().toISOString().slice(0, 10),
        total_amount: 0,
        currency: "EUR",
        ai_status: "done",
        payment_account_id: paymentAccountToUse,
      })
      .select("id")
      .single();

    setBusy(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setSuccess("Blankobeleg erstellt. Positionen können jetzt manuell ergänzt werden.");
    await loadReceipts();
    setBlankReceiptPreset({ receiptId: data?.id || null, costCenterId: carryCostCenterId });
    setSelectedReceipt(data?.id || null);
    setManualDraft((prev) => ({ ...prev, accountId: carryCostCenterId || "" }));
  }

  async function refreshReceiptData(receiptId) {
    if (receiptId) {
      await recalculateReceiptTotal(receiptId);
    }
    await loadReceipts();
  }

  async function addManualItem() {
    if (!selectedReceipt) return;

    const groups = activeCostGroups();
    const currency = normalizeCurrencyCode(manualDraft.currency || "EUR");
    const exchangeRate = await getExchangeRateToEur(currency);
    const rawManualAmount = String(manualDraft.amount || "").trim();
    let parsedOriginalAmount;

    if (!rawManualAmount) {
      parsedOriginalAmount = 0;
    } else {
      const compactAmount = rawManualAmount.replace(/\s/g, "");
      let normalizedAmount = compactAmount;

      if (compactAmount.includes(",") && compactAmount.includes(".")) {
        // Use the last separator as decimal separator and treat the other as thousands separator.
        if (compactAmount.lastIndexOf(",") > compactAmount.lastIndexOf(".")) {
          normalizedAmount = compactAmount.replace(/\./g, "").replace(",", ".");
        } else {
          normalizedAmount = compactAmount.replace(/,/g, "");
        }
      } else if (compactAmount.includes(",")) {
        normalizedAmount = compactAmount.replace(",", ".");
      }

      const parsed = Number(normalizedAmount);
      parsedOriginalAmount = Number.isFinite(parsed) ? parsed : null;
    }

    if (parsedOriginalAmount === null) {
      setError("Bitte einen gültigen Betrag eingeben (z.B. 4,50).");
      return;
    }

    const categoryForItem = manualDraft.category || inferCostGroupName(manualDraft.description, groups);
    const costCenterToAssign = manualDraft.accountId || selectedCostCenterForReceipt;

    if (!categoryForItem) {
      setError("Bitte für die Position eine Kostengruppe auswählen.");
      return;
    }

    if (!costCenterToAssign) {
      setError("Bitte für die Position einen Kostenträger auswählen.");
      return;
    }

    const originalAmount = roundMoney(parsedOriginalAmount || 0);
    const amount = roundMoney(originalAmount * exchangeRate);

    const row = {
      receipt_id: selectedReceipt,
      description: manualDraft.description || "Neue Position",
      quantity: Number(manualDraft.quantity || 1),
      original_amount: originalAmount,
      amount,
      currency,
      exchange_rate: exchangeRate,
      category: categoryForItem,
    };

    let insertError;
    let insertResponse = await supabase.from("receipt_items").insert(buildReceiptItemPayload(row, receiptItemCurrencyColumnsReady)).select();

    if (insertResponse.error && String(insertResponse.error.message || "").includes("original_amount")) {
      setReceiptItemCurrencyColumnsReady(false);
      insertResponse = await supabase.from("receipt_items").insert(buildReceiptItemPayload({
        receipt_id: selectedReceipt,
        description: manualDraft.description || "Neue Position",
        quantity: Number(manualDraft.quantity || 1),
        amount,
        category: categoryForItem,
      }, false)).select();
    }

    insertError = insertResponse.error;
    if (insertError) {
      setError(insertError.message);
      return;
    }

    const insertedItem = insertResponse.data?.[0];
    if (insertedItem?.id && costCenterToAssign) {
      await assignItemToCostCenter(insertedItem, costCenterToAssign);
    }

    setManualDraft({
      ...emptyDraft,
      category: categoryForItem || "",
      accountId: costCenterToAssign || "",
    });
    await refreshReceiptData(selectedReceipt);
  }

  async function patchItem(itemId, patch) {
    const receiptId = receipts.find((receipt) => (receipt.receipt_items || []).some((item) => item.id === itemId))?.id;
    const { data, error: updateError } = await supabase
      .from("receipt_items")
      .update(patch)
      .eq("id", itemId)
      .select();

    if (updateError) {
      const errMsg = String(updateError?.message || updateError);
      console.error("patchItem error:", updateError, errMsg);
      
      // Check if this is a column-missing error
      if (errMsg.includes("assigned_cost_center_id") || errMsg.includes("does not exist")) {
        setShowSetupBanner(true);  // Show setup banner
        setError("⚠️ Die Kostenträger-Spalte muss erst in der Datenbank erstellt werden.");
      } else {
        setError(`Update-Fehler: ${errMsg}`);
      }
      return false;
    }

    if (!data || data.length === 0) {
      setError("Keine Zeilen aktualisiert - möglicherweise existiert das Item nicht");
      console.warn("patchItem: No rows affected", { itemId, patch });
      return false;
    }

    await refreshReceiptData(receiptId);
    return true;
  }

  async function patchReceipt(receiptId, patch) {
    setBusy(true);
    setError("");

    const { error: updateError } = await supabase
      .from("receipts")
      .update(patch)
      .eq("id", receiptId);

    if (updateError) {
      setError(updateError.message);
      setBusy(false);
      return;
    }

    await loadReceipts();
    setBusy(false);
  }

  async function commitReceiptMerchant() {
    if (!currentReceipt?.id) return;

    const nextMerchant = String(receiptMerchantDraft || "").trim() || "Blankobeleg";
    const currentMerchant = String(currentReceipt.merchant || "").trim();
    if (nextMerchant === currentMerchant) return;

    await patchReceipt(currentReceipt.id, { merchant: nextMerchant });
  }

  async function commitReceiptDate(nextValue = receiptDateDraft) {
    if (!currentReceipt?.id) return;

    const nextDate = String(nextValue || "").trim();
    const currentDate = String(currentReceipt.receipt_date || "").trim();
    if (nextDate === currentDate) return;

    if (!nextDate) {
      setError("Bitte ein gültiges Datum wählen.");
      setReceiptDateDraft(currentDate);
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
      setError("Bitte ein gültiges Datum im Format JJJJ-MM-TT eingeben.");
      setReceiptDateDraft(currentDate);
      return;
    }

    await patchReceipt(currentReceipt.id, { receipt_date: nextDate });
  }

  function completeCurrentReceiptWithCheck() {
    if (!currentReceipt?.id) return;

    const status = getReceiptAssignmentStatus(currentReceipt);
    if (!status.itemCount) {
      setError("Abschluss nicht möglich: Der Beleg hat noch keine Positionen.");
      return;
    }

    if (!status.isComplete) {
      setError(
        `Abschluss nicht möglich: ${status.missingEitherCount} Positionen sind unvollständig (${status.missingCategoryCount} ohne Kostengruppe, ${status.missingCostCenterCount} ohne Kostenträger).`
      );
      return;
    }

    setCompletedReceiptIds((prev) => {
      const next = new Set(prev);
      next.add(String(currentReceipt.id));
      return next;
    });
    setSuccess("Beleg abgeschlossen: Alle Positionen sind vollständig zugeordnet.");
  }

  async function toggleIgnoreItem(item) {
    await patchItem(item.id, { is_ignored: !item.is_ignored });
  }

  async function updateItemCurrency(item, currency) {
    const nextCurrency = normalizeCurrencyCode(currency || "EUR");
    const originalAmount = getItemOriginalAmount(item);
    const exchangeRate = nextCurrency === "EUR" ? 1 : await getExchangeRateToEur(nextCurrency);
    const eurAmount = roundMoney(originalAmount * exchangeRate);

    const nextPayload = receiptItemCurrencyColumnsReady
      ? {
          currency: nextCurrency,
          exchange_rate: exchangeRate,
          original_amount: originalAmount,
          amount: eurAmount,
        }
      : {
          amount: eurAmount,
        };

    let updateResponse = await supabase
      .from("receipt_items")
      .update(nextPayload)
      .eq("id", item.id);

    if (updateResponse.error && String(updateResponse.error.message || "").includes("original_amount")) {
      setReceiptItemCurrencyColumnsReady(false);
      updateResponse = await supabase
        .from("receipt_items")
        .update({ amount: eurAmount })
        .eq("id", item.id);
    }

    if (updateResponse.error) {
      setError(updateResponse.error.message);
      return;
    }

    const currentAlloc = primaryAllocationByItemId.get(item.id);
    if (currentAlloc?.costCenterId) {
      await rescaleItemAllocations(item.id, eurAmount, currentAlloc.costCenterId);
    }

    const receiptId = receipts.find((receipt) => (receipt.receipt_items || []).some((row) => row.id === item.id))?.id;
    if (receiptId) {
      await recalculateReceiptTotal(receiptId);
    }

    await loadReceipts();
  }

  function updateAmountDraft(itemId, value) {
    setAmountDrafts((prev) => ({
      ...prev,
      [itemId]: value,
    }));
  }

  function updateDescriptionDraft(itemId, value) {
    setDescriptionDrafts((prev) => ({
      ...prev,
      [itemId]: value,
    }));
  }

  async function commitDescriptionDraft(item) {
    if (!Object.prototype.hasOwnProperty.call(descriptionDrafts, item.id)) return;

    const nextDescription = String(descriptionDrafts[item.id] ?? "");
    const currentDescription = String(item.description || "");

    if (nextDescription === currentDescription) {
      setDescriptionDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      return;
    }

    const ok = await patchItem(item.id, { description: nextDescription });
    if (!ok) return;

    setDescriptionDrafts((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
  }

  async function commitAmountDraft(item) {
    if (!Object.prototype.hasOwnProperty.call(amountDrafts, item.id)) return;

    const rawValue = amountDrafts[item.id];
    const parsed = parseAmountDE(rawValue);

    if (parsed === null) {
      setError("Bitte einen gültigen Betrag eingeben, z. B. 1.234,56.");
      return;
    }

    const currency = normalizeCurrencyCode(item.currency || "EUR");
    const exchangeRate = currency === "EUR" ? 1 : getItemExchangeRate(item) || (await getExchangeRateToEur(currency));
    const originalAmount = roundMoney(parsed);
    const eurAmount = roundMoney(originalAmount * exchangeRate);

    if (originalAmount !== getItemOriginalAmount(item) || eurAmount !== Number(item.amount || 0)) {
      const nextPayload = receiptItemCurrencyColumnsReady
        ? {
            original_amount: originalAmount,
            amount: eurAmount,
            currency,
            exchange_rate: exchangeRate,
          }
        : { amount: eurAmount };

      let updateResponse = await supabase
        .from("receipt_items")
        .update(nextPayload)
        .eq("id", item.id);

      if (updateResponse.error && String(updateResponse.error.message || "").includes("original_amount")) {
        setReceiptItemCurrencyColumnsReady(false);
        updateResponse = await supabase
          .from("receipt_items")
          .update({ amount: eurAmount })
          .eq("id", item.id);
      }

      if (updateResponse.error) {
        setError(updateResponse.error.message);
        return;
      }

      const currentAlloc = primaryAllocationByItemId.get(item.id);
      if (currentAlloc?.costCenterId) {
        await rescaleItemAllocations(item.id, eurAmount, currentAlloc.costCenterId);
      }

      const receiptId = receipts.find((receipt) => (receipt.receipt_items || []).some((row) => row.id === item.id))?.id;
      if (receiptId) {
        await recalculateReceiptTotal(receiptId);
      }

      await loadReceipts();
    }

    setAmountDrafts((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
  }

  async function autoAssignCategories(receipt) {
    const items = receipt?.receipt_items || [];
    const groups = activeCostGroups();

    if (!items.length) return;

    setBusy(true);
    setError("");
    setSuccess("");

    // Use first item's category as template for all positions.
    // If first item has no category yet, infer one once and apply it to all.
    const firstItemCategory = String(items[0]?.category || "").trim();
    const inferredCategory = inferCostGroupName(receipt.merchant || "", groups)
      || inferCostGroupName(items[0]?.description || "", groups);
    const targetCategory = firstItemCategory || inferredCategory || null;

    if (!targetCategory) {
      setBusy(false);
      setError("Die erste Position hat noch keine Kostengruppe.");
      return;
    }

    for (const item of items) {
      const { error: updateError } = await supabase
        .from("receipt_items")
        .update({ category: targetCategory })
        .eq("id", item.id);

      if (updateError) {
        setBusy(false);
        setError(updateError.message);
        return;
      }
    }

    setBusy(false);
    setSuccess("Kostengruppe der ersten Position wurde auf alle Positionen übertragen.");
    await loadReceipts();
  }

  async function transferCostCenterToAll(receipt) {
    const items = receipt?.receipt_items || [];
    
    if (!items.length || !items[0]?.assigned_cost_center_id) {
      setError("Die erste Position hat keinen Kostenträger. Bitte erst zuweisen.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    const firstItemCostCenterId = items[0].assigned_cost_center_id;

    for (const item of items.slice(1)) {
      const { error: updateError } = await supabase
        .from("receipt_items")
        .update({ assigned_cost_center_id: firstItemCostCenterId })
        .eq("id", item.id);

      if (updateError) {
        setBusy(false);
        setError(updateError.message);
        return;
      }
    }

    setBusy(false);
    setSuccess("Kostenträger auf alle Positionen übertragen.");
    await loadReceipts();
  }

  async function changeCostCenterForAllItems(costCenterId) {
    if (!currentReceipt?.receipt_items?.length) {
      setError("Keine Positionen vorhanden.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    for (const item of currentReceipt.receipt_items) {
      const { error: updateError } = await supabase
        .from("receipt_items")
        .update({ assigned_cost_center_id: costCenterId })
        .eq("id", item.id);

      if (updateError) {
        setBusy(false);
        setError(updateError.message);
        return;
      }
    }

    setBusy(false);
    setSuccess("Kostenträger für alle Positionen aktualisiert.");
    await loadReceipts();
  }

  async function createSettlementReceipt(debtorAccount, creditorAccount, amount) {
    if (!supabase || !debtorAccount?.id || !creditorAccount?.id) return;
    
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const today = new Date().toISOString().slice(0, 10);

      // Create receipt for debtor (positive amount - money out)
      const debtorReceiptInsert = await supabase
        .from("receipts")
        .insert({
          household_id: householdId,
          merchant: "Ausgleichszahlung",
          receipt_date: today,
          receipt_time: null,
          total_amount: roundMoney(amount),
          currency: "EUR",
          ai_status: "done",
          payment_account_id: debtorAccount.id,
        })
        .select("id")
        .single();

      if (debtorReceiptInsert.error) {
        setBusy(false);
        setError(`Beleg-Erstellung (Debtor) fehlgeschlagen: ${debtorReceiptInsert.error.message}`);
        return;
      }

      const debtorReceiptId = debtorReceiptInsert.data.id;

      // Create item for debtor receipt
      const debtorItemInsert = await supabase
        .from("receipt_items")
        .insert({
          receipt_id: debtorReceiptId,
          description: `${debtorAccount.name} an ${creditorAccount.name}`,
          quantity: 1,
          amount: roundMoney(amount),
          category: null,
          assigned_cost_center_id: null,
        })
        .select("id")
        .single();

      if (debtorItemInsert.error) {
        setBusy(false);
        setError(`Position-Erstellung (Debtor) fehlgeschlagen: ${debtorItemInsert.error.message}`);
        return;
      }

      // Create receipt for creditor (negative amount - money in)
      const creditorReceiptInsert = await supabase
        .from("receipts")
        .insert({
          household_id: householdId,
          merchant: "Ausgleichszahlung",
          receipt_date: today,
          receipt_time: null,
          total_amount: roundMoney(-amount),
          currency: "EUR",
          ai_status: "done",
          payment_account_id: creditorAccount.id,
        })
        .select("id")
        .single();

      if (creditorReceiptInsert.error) {
        setBusy(false);
        setError(`Beleg-Erstellung (Creditor) fehlgeschlagen: ${creditorReceiptInsert.error.message}`);
        return;
      }

      const creditorReceiptId = creditorReceiptInsert.data.id;

      // Create item for creditor receipt
      const creditorItemInsert = await supabase
        .from("receipt_items")
        .insert({
          receipt_id: creditorReceiptId,
          description: `${debtorAccount.name} an ${creditorAccount.name}`,
          quantity: 1,
          amount: roundMoney(-amount),
          category: null,
          assigned_cost_center_id: null,
        })
        .select("id")
        .single();

      if (creditorItemInsert.error) {
        setBusy(false);
        setError(`Position-Erstellung (Creditor) fehlgeschlagen: ${creditorItemInsert.error.message}`);
        return;
      }

      setBusy(false);
      setSuccess(`✓ Ausgleichszahlung "${debtorAccount.name} → ${creditorAccount.name}: ${euro.format(amount)}" erstellt!`);
      await loadReceipts();
      setSelectedReceipt(debtorReceiptId);
    } catch (err) {
      setBusy(false);
      setError(`Fehler: ${err.message || err}`);
    }
  }

  async function deleteReceiptItem(item) {
    if (!item?.id) return;
    if (!window.confirm("Position wirklich löschen?")) return;

    setBusy(true);
    setError("");

    const receiptId = receipts.find((receipt) => (receipt.receipt_items || []).some((row) => row.id === item.id))?.id;

    // Delete allocations first
    const { error: allocError } = await supabase
      .from("receipt_item_allocations")
      .delete()
      .eq("receipt_item_id", item.id);

    if (allocError) {
      setBusy(false);
      setError(`Fehler beim Löschen von Zuordnungen: ${allocError.message}`);
      return;
    }

    // Then delete the item
    const { error: itemError } = await supabase
      .from("receipt_items")
      .delete()
      .eq("id", item.id);

    if (itemError) {
      setBusy(false);
      setError(`Fehler beim Löschen der Position: ${itemError.message}`);
      return;
    }

    if (receiptId) {
      await recalculateReceiptTotal(receiptId);
    }

    setBusy(false);
    setSuccess("Position gelöscht.");
    await loadReceipts();
  }

  async function openReceiptPreview(receipt) {
    if (!receipt?.image_path) return;

    setPreviewBusy(true);
    setError("");

    const { data, error: signError } = await supabase.storage
      .from("receipts")
      .createSignedUrl(receipt.image_path, 300);

    setPreviewBusy(false);

    if (signError || !data?.signedUrl) {
      setError(signError?.message || "Beleg konnte nicht geöffnet werden.");
      return;
    }

    try {
      const isPdf = receipt.image_path.toLowerCase().endsWith(".pdf");
      
      if (isPdf) {
        // PDFs: mit Google Docs Viewer öffnen
        const encodedUrl = encodeURIComponent(data.signedUrl);
        const googleViewerUrl = `https://docs.google.com/gview?url=${encodedUrl}&embedded=true`;
        // iOS: target="_blank" in window.open verwenden
        const win = window.open(googleViewerUrl, "_blank", "noopener");
        if (!win) {
          // Fallback wenn window.open blockiert
          window.location.href = googleViewerUrl;
        }
      } else {
        // Bilder: direkt öffnen
        const win = window.open(data.signedUrl, "_blank", "noopener");
        if (!win) {
          // Fallback wenn window.open blockiert
          window.location.href = data.signedUrl;
        }
      }
    } catch (err) {
      setError(err.message || "Beleg konnte nicht geöffnet werden.");
    }
  }

  const currentReceipt = receipts.find((r) => r.id === selectedReceipt) || null;
  const isCurrentReceiptCompleted = Boolean(currentReceipt?.id) && completedReceiptIds.has(String(currentReceipt.id));
  const currentReceiptAssignmentStatus = useMemo(
    () => getReceiptAssignmentStatus(currentReceipt),
    [currentReceipt]
  );

  useEffect(() => {
    setReceiptMerchantDraft(currentReceipt?.merchant || "");
    setReceiptDateDraft(currentReceipt?.receipt_date || "");
  }, [currentReceipt?.id, currentReceipt?.merchant, currentReceipt?.receipt_date]);

  useEffect(() => {
    if (!currentReceipt) return;
    const items = Array.isArray(currentReceipt.receipt_items) ? currentReceipt.receipt_items : [];
    if (!items.length) return;

    const lastItem = items[items.length - 1];
    const fallbackCategory = lastItem?.category || "";
    const fallbackAccountId = assignedCostCenterByItemId.get(lastItem?.id) || lastItem?.assigned_cost_center_id || "";

    setManualDraft((prev) => {
      if (prev.description || prev.amount) return prev;

      const nextCategory = prev.category || fallbackCategory;
      const nextAccountId = prev.accountId || fallbackAccountId;

      if (nextCategory === prev.category && nextAccountId === prev.accountId) {
        return prev;
      }

      return {
        ...prev,
        category: nextCategory,
        accountId: nextAccountId,
      };
    });
  }, [currentReceipt, assignedCostCenterByItemId]);

  if (authLoading) {
    return (
      <div className="page">
        <header className="hero">
          <img src="/bonbon-logo.svg" alt="BonBox" className="hero-logo" />
          <div>
            <h1>BonBox</h1>
            <p>Anmeldung wird geladen...</p>
          </div>
          <span className="version-badge">{APP_VERSION}</span>
        </header>
      </div>
    );
  }

  if (!session?.user && !isEmergencyAccessActive) {
    return (
      <div className="page">
        <header className="hero">
          <img src="/bonbon-logo.svg" alt="BonBox" className="hero-logo" />
          <div>
            <h1>BonBox</h1>
            <p>Bitte anmelden, um dein Haushaltsbuch zu öffnen.</p>
          </div>
          <span className="version-badge">{APP_VERSION}</span>
        </header>

        <section className="panel setup-panel">
          <h2>Login mit E-Mail und Passwort</h2>
          <p className="hint">
            Zugang gibt es nur mit echtem Login. Neue Benutzer können einen Zugang anlegen, bleiben aber bis zur Admin-Freigabe gesperrt.
          </p>
          <input
            type="email"
            placeholder="name@beispiel.de"
            value={authEmail}
            onChange={(e) => setAuthEmail(normalizeEmailInput(e.target.value))}
          />
          <input
            type="password"
            placeholder="Passwort"
            value={authPassword}
            onChange={(e) => setAuthPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy && hasSetup) {
                void signInWithPassword();
              }
            }}
          />
          <div className="receipt-actions">
            <button className="btn" disabled={busy || !hasSetup} onClick={signInWithPassword}>
              {busy ? "Anmeldung läuft..." : "Anmelden"}
            </button>
            <button className="btn secondary" disabled={busy || !hasSetup} onClick={sendPasswordReset}>
              {busy ? "Sende..." : "Passwort setzen/zurücksetzen"}
            </button>
            <button className="btn secondary" disabled={busy || !hasSetup} onClick={signUpWithPassword}>
              {busy ? "Lege an..." : "Zugang anlegen"}
            </button>
            {canSeeEmergencyAccessButton && (
              <button className="btn secondary" disabled={busy || !hasSetup || hasUsedEmergencyAccess} onClick={activateEmergencyAccess}>
                {hasUsedEmergencyAccess ? "Notzugang verbraucht" : "Einmal ohne E-Mail rein"}
              </button>
            )}
          </div>
          {!hasSetup && (
            <p className="hint error">
              Bitte zuerst .env mit Supabase-Werten konfigurieren.
            </p>
          )}
          <p className="hint">
            Bestehende Magic-Link-Benutzer können einmalig ein Passwort setzen und sich danach normal mit E-Mail und Passwort anmelden.
          </p>
          {canSeeEmergencyAccessButton && (
            <p className="hint">
              Der Notzugang ist absichtlich nur einmal pro Browser verfügbar und endet spätestens beim Abmelden.
            </p>
          )}
          {success && <p className="hint success">{success}</p>}
          {error && <p className="hint error">{error}</p>}
        </section>
      </div>
    );
  }

  if (session?.user && !isApproved) {
    return (
      <div className="page">
        <header className="hero">
          <img src="/bonbon-logo.svg" alt="BonBox" className="hero-logo" />
          <div>
            <h1>BonBox</h1>
            <p>Dein Konto wird geprüft.</p>
          </div>
          <span className="version-badge">{APP_VERSION}</span>
        </header>

        <section className="panel setup-panel">
          <h2>Freigabe ausstehend</h2>
          <p className="hint">
            Angemeldet als: <strong>{session.user.email}</strong>
          </p>
          <p className="hint">
            Ein Admin muss deinen Zugang einmal freischalten. Danach kannst du die App normal nutzen.
          </p>
          <div className="receipt-actions">
            <button className="btn secondary" onClick={() => loadUserAccess(session.user)}>
              Status aktualisieren
            </button>
            <button className="btn" disabled={bootstrapBusy} onClick={bootstrapFirstAdmin}>
              {bootstrapBusy ? "Prüfe..." : "Als ersten Admin freischalten"}
            </button>
            <button className="btn secondary" onClick={signOut}>Abmelden</button>
          </div>
          {error && <p className="hint error">{error}</p>}
          {success && <p className="hint success">{success}</p>}
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="hero">
        <img src="/bonbon-logo.svg" alt="BonBox" className="hero-logo" />
        <div>
          <h1>BonBox</h1>
          <p>Belege scannen, KI-Auswertung, Haushaltsbuch, Verrechnung</p>
        </div>
        <div className="top-right-badges">
          <span className="version-badge">{APP_VERSION}</span>
          <button className="btn secondary mini-btn" onClick={signOut}>Abmelden</button>
        </div>
      </header>

      {showSetupBanner && (
        <section className="panel setup-panel" style={{ background: "#fff3cd", borderColor: "#ffc107", borderLeft: "4px solid #ffc107" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <h2 style={{ color: "#856404", margin: "0 0 12px 0" }}>🚀 Setup erforderlich!</h2>
              <p style={{ color: "#856404", margin: "0 0 12px 0" }}>
                <strong>Die Kostenträger-Spalte existiert NICHT in der Datenbank!</strong> Deswegen werden Ihre Kostenträger-Auswahlen nicht gespeichert.
              </p>
              <p style={{ color: "#856404", margin: "0 0 12px 0" }}>
                Öffnen Sie diese Setup-Seite und führen Sie die SQL aus:
              </p>
              <button className="btn" onClick={() => { window.open('/setup-assigned-cost-center.html', '_blank'); }}>
                📋 Setup-Anleitung öffnen
              </button>
              <p style={{ color: "#856404", fontSize: "12px", margin: "8px 0 0 0" }}>
                Nach dem Setup können Sie Kostenträger auswählen und speichern.
              </p>
            </div>
            <button 
              className="btn secondary mini-btn" 
              onClick={() => setShowSetupBanner(false)}
              style={{ marginLeft: "16px", whiteSpace: "nowrap" }}
            >
              Ausblenden
            </button>
          </div>
        </section>
      )}

      {!hasSetup && (
        <section className="panel setup-panel">
          <h2>Konfiguration fehlt</h2>
          <p className="hint error">
            Bitte in .env die Werte für VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY und
            VITE_DEFAULT_HOUSEHOLD_ID setzen.
          </p>
        </section>
      )}

      {isAdmin && pendingUsers.length > 0 && (
        <section className="panel setup-panel">
          <h2>Benutzerfreigaben</h2>
          <p className="hint">Neue Benutzer erscheinen hier automatisch nach ihrer ersten Konto-Anlage oder Anmeldung und koennen dann freigegeben werden.</p>
          <div className="receipt-list">
            {pendingUsers.map((entry) => (
              <div className="receipt-button" key={entry.user_id}>
                <div>
                  <strong>{entry.email || entry.user_id}</strong>
                  <small>{formatReceiptDateTime({ created_at: entry.created_at })}</small>
                </div>
                <div className="receipt-actions">
                  <button className="btn secondary mini-btn" onClick={() => approveUser(entry.user_id)}>
                    Freigeben
                  </button>
                  <button className="btn secondary mini-btn" onClick={() => rejectUser(entry.user_id)}>
                    Ablehnen
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {!selectedReceipt && (
        <article className="panel">
          {/* Section 1 */}
          <div className="receipt-form-section">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  onClick={() => toggleSection("payment-account-form")}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "0",
                    display: "flex",
                    alignItems: "center",
                    fontSize: "1.1rem",
                    color: "inherit",
                  }}
                  title="Sektion ein-/ausblenden"
                >
                  {collapsedSections.has("payment-account-form") ? "▸" : "▾"}
                </button>
                <h2 style={{ margin: 0 }}>1. Zahlung von (Zahlungskonto)</h2>
              </div>
              <button
                className="btn secondary"
                onClick={() => {
                  setShowCostGroupModal(true);
                  setCostGroupModalView("accounts");
                }}
              >
                Konten bearbeiten
              </button>
            </div>
            {!collapsedSections.has("payment-account-form") && (
            <div className={`color-select-wrapper ${!newPaymentAccountId ? 'missing-required' : ''}`} style={!newPaymentAccountId ? { border: "2px solid rgba(0,0,0,0.2)", borderRadius: "12px", backgroundColor: "transparent", color: "#10243e" } : buildColorInputStyle((paymentAccountOptions.find((a) => a.id === newPaymentAccountId) || {}).color)}>
              <select
                value={newPaymentAccountId || ""}
                onChange={(e) => setNewPaymentAccountId(e.target.value || null)}
                disabled={busy}
              >
                  <option value="">-- Wähle Zahlungskonto --</option>
                {paymentAccountOptions.map((account) => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
              </select>
            </div>
            )}
          </div>

          {/* Section 2 */}
          <div className="receipt-form-section">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  onClick={() => toggleSection("cost-center-form")}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "0",
                    display: "flex",
                    alignItems: "center",
                    fontSize: "1.1rem",
                    color: "inherit",
                  }}
                  title="Sektion ein-/ausblenden"
                >
                  {collapsedSections.has("cost-center-form") ? "▸" : "▾"}
                </button>
                <h2 style={{ margin: 0 }}>2. Kosten für (Kostenträger)</h2>
              </div>
              <button className="btn secondary" onClick={() => setShowCostCenterModal(true)}>
                  Kostenträger bearbeiten
              </button>
            </div>
            {!collapsedSections.has("cost-center-form") && (
            <div className="upload-account-row">
              <div className={`color-select-wrapper ${!newReceiptCostCenterId ? 'missing-required' : ''}`} style={!newReceiptCostCenterId ? { border: "2px solid rgba(0,0,0,0.2)", borderRadius: "12px", backgroundColor: "transparent", color: "#10243e" } : buildColorInputStyle(selectedUploadCostCenter?.color)}>
                <select
                  value={newReceiptCostCenterId || ""}
                  onChange={(e) => setNewReceiptCostCenterId(e.target.value || null)}
                >
                  <option value="">-- Wähle Kostenträger --</option>
                  {costCenterOptions.map((costCenter) => (
                    <option key={costCenter.id} value={costCenter.id}>{costCenter.name}</option>
                  ))}
                </select>
              </div>
            </div>
            )}
          </div>

          {/* Section 3 */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <button
                onClick={() => toggleSection("receipt-capture-form")}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "0",
                  display: "flex",
                  alignItems: "center",
                  fontSize: "1.1rem",
                  color: "inherit",
                }}
                title="Sektion ein-/ausblenden"
              >
                {collapsedSections.has("receipt-capture-form") ? "▸" : "▾"}
              </button>
              <h2 style={{ margin: 0 }}>3. Beleg erfassen</h2>
            </div>
            {!collapsedSections.has("receipt-capture-form") && (
            <>
            <div className="file-picker">
              <input
                id="receipt-file"
                className="file-input-hidden"
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              />
              <label htmlFor="receipt-file" className="btn secondary file-trigger">
                Beleg auswählen/Foto aufnehmen
              </label>
              <p className="hint file-name">
                {selectedFile ? `Ausgewählt: ${selectedFile.name}` : "Noch keine Datei ausgewählt"}
              </p>
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
              <button className="btn secondary" onClick={createBlankReceipt} disabled={busy}>
                Blankobeleg
              </button>
              <button className="btn" disabled={!selectedFile || busy || !hasSetup} onClick={uploadAndExtract}>
                {busy ? "Analysiere..." : "Beleg per KI auswerten"}
              </button>
              <button className="btn secondary" onClick={() => {
                if (receipts.length) {
                  setSelectedReceipt(receipts[0].id);
                }
              }} disabled={!receipts.length}>
                Abbrechen
              </button>
            </div>
            </>
            )}
          </div>
        </article>
      )}

      {showCostGroupModal && (
        <div className="modal-backdrop" onClick={() => setShowCostGroupModal(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {costGroupModalView === "summary" && "Kostenübersicht"}
                {costGroupModalView === "groupDetails" && "Detaillierte Übersicht nach Kostengruppen"}
                {costGroupModalView === "accountDetails" && "Detaillierte Übersicht nach Kostenträgern"}
                {costGroupModalView === "edit" && "Kostengruppen bearbeiten"}
                {costGroupModalView === "accounts" && "Zahlungskonten bearbeiten"}
              </h3>
              <button className="btn secondary" onClick={() => setShowCostGroupModal(false)}>Schließen</button>
            </div>

            {costGroupModalView === "summary" && (
              <>
                <div className="cost-group-summary clickable-summary" role="button" tabIndex={0} onClick={() => setCostGroupModalView("groupDetails")} onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setCostGroupModalView("groupDetails");
                  }
                }}>
                  <h3>Kostenübersicht nach Kostengruppen</h3>
                  {!costGroupTotals.length && <p className="hint">Noch keine Positionen mit Kosten vorhanden.</p>}
                  {!!costGroupTotals.length && (
                    <div className="cost-group-summary-list">
                      {costGroupTotals.map((row) => (
                        <div className="cost-group-summary-row" key={row.name} style={buildSummaryRowStyle(row.color)}>
                          <span className="cost-group-name">
                            <span className="cost-group-dot" style={{ backgroundColor: row.color }} />
                            {row.name}
                          </span>
                          <strong>{euro.format(row.total)}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="hint">Tippen für Detailansicht.</p>
                </div>

                <div className="cost-group-summary clickable-summary" role="button" tabIndex={0} onClick={() => setCostGroupModalView("accountDetails")} onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setCostGroupModalView("accountDetails");
                  }
                }}>
                  <h3>Kostenübersicht nach Kostenträgern</h3>
                  {!costCenterTotals.length && <p className="hint">Noch keine Kosten vorhanden.</p>}
                  {!!costCenterTotals.length && (
                    <div className="cost-group-summary-list">
                      {costCenterTotals.map((row) => (
                        <div className="cost-group-summary-row" key={row.id} style={buildSummaryRowStyle(row.color)}>
                          <span className="cost-group-name">
                            <span className="cost-group-dot" style={{ backgroundColor: row.color }} />
                            {row.name}
                          </span>
                          <strong>{euro.format(row.total)}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="hint">Tippen für Detailansicht.</p>
                </div>

                <div className="cost-group-summary-actions">
                  <button className="btn" onClick={() => setCostGroupModalView("edit")}>Kostengruppen bearbeiten</button>
                </div>
              </>
            )}

            {costGroupModalView === "groupDetails" && (
              <>
                <div className="cost-group-summary-actions">
                  <button className="btn secondary" onClick={() => setCostGroupModalView("summary")}>Zurück zur Übersicht</button>
                </div>
                <div className="detail-stats-grid">
                  <div className="detail-stat-card"><span>Gesamt</span><strong>{euro.format(costGroupDetails.overall.total)}</strong></div>
                  <div className="detail-stat-card"><span>Laufendes Jahr</span><strong>{euro.format(costGroupDetails.overall.yearTotal)}</strong></div>
                  <div className="detail-stat-card"><span>Laufender Monat</span><strong>{euro.format(costGroupDetails.overall.monthTotal)}</strong></div>
                  <div className="detail-stat-card"><span>Ø pro Monat</span><strong>{euro.format(costGroupDetails.overall.averagePerMonth)}</strong></div>
                </div>
                {!costGroupDetails.rows.length && <p className="hint">Noch keine Positionen mit Kosten vorhanden.</p>}
                {!!costGroupDetails.rows.length && (
                  <div className="detail-table">
                    <div className="detail-table-head">
                      <span>Name</span><span>Gesamt</span><span>Laufendes Jahr</span><span>Laufender Monat</span><span>Ø pro Monat</span>
                    </div>
                    {costGroupDetails.rows.map((row) => (
                      <div className="detail-table-row" key={row.name}>
                        <span className="cost-group-name detail-name"><span className="cost-group-dot" style={{ backgroundColor: row.color }} />{row.name}</span>
                        <strong className="detail-metric" data-label="Gesamt">{euro.format(row.total)}</strong>
                        <strong className="detail-metric" data-label="Laufendes Jahr">{euro.format(row.yearTotal)}</strong>
                        <strong className="detail-metric" data-label="Laufender Monat">{euro.format(row.monthTotal)}</strong>
                        <strong className="detail-metric" data-label="Ø pro Monat">{euro.format(row.averagePerMonth)}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {costGroupModalView === "accountDetails" && (
              <>
                <div className="cost-group-summary-actions">
                  <button className="btn secondary" onClick={() => setCostGroupModalView("summary")}>Zurück zur Übersicht</button>
                </div>
                <div className="detail-stats-grid">
                  <div className="detail-stat-card"><span>Gesamt</span><strong>{euro.format(accountDetails.overall.total)}</strong></div>
                  <div className="detail-stat-card"><span>Laufendes Jahr</span><strong>{euro.format(accountDetails.overall.yearTotal)}</strong></div>
                  <div className="detail-stat-card"><span>Laufender Monat</span><strong>{euro.format(accountDetails.overall.monthTotal)}</strong></div>
                  <div className="detail-stat-card"><span>Ø pro Monat</span><strong>{euro.format(accountDetails.overall.averagePerMonth)}</strong></div>
                </div>
                {!accountDetails.rows.length && <p className="hint">Noch keine Kosten vorhanden.</p>}
                {!!accountDetails.rows.length && (
                  <div className="detail-table">
                    <div className="detail-table-head">
                      <span>Name</span><span>Gesamt</span><span>Laufendes Jahr</span><span>Laufender Monat</span><span>Ø pro Monat</span>
                    </div>
                    {accountDetails.rows.map((row) => (
                      <div className="detail-table-row" key={row.id}>
                        <span className="cost-group-name detail-name"><span className="cost-group-dot" style={{ backgroundColor: row.color }} />{row.name}</span>
                        <strong className="detail-metric" data-label="Gesamt">{euro.format(row.total)}</strong>
                        <strong className="detail-metric" data-label="Laufendes Jahr">{euro.format(row.yearTotal)}</strong>
                        <strong className="detail-metric" data-label="Laufender Monat">{euro.format(row.monthTotal)}</strong>
                        <strong className="detail-metric" data-label="Ø pro Monat">{euro.format(row.averagePerMonth)}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {costGroupModalView === "edit" && (
              <>
                <div className="cost-group-summary-actions">
                  <button className="btn secondary" onClick={() => setCostGroupModalView("summary")}>Zurück zur Übersicht</button>
                </div>

                {!costGroupCatalogReady && (
                  <p className="hint error">
                    Katalog-Tabelle noch nicht verfügbar: {costGroupCatalogMessage}
                  </p>
                )}

                {costGroupCatalogReady && !costGroups.length && (
                  <p className="hint">Noch keine Kostengruppen angelegt. Füge unten eine hinzu.</p>
                )}

                {costGroupCatalogReady && (
                  <div className="cost-group-edit-head">
                    <span>Name</span>
                    <span>Farbe</span>
                    <span>Keywords</span>
                    <span>Sortierung</span>
                    <span>Aktion</span>
                    <span>Aktion</span>
                  </div>
                )}

                {costGroupCatalogReady && costGroups.map((group) => {
                  const draft = costGroupDrafts[group.id] || {
                    name: group.name || "",
                    color: group.color || "#18b6a3",
                    keywordsText: keywordsToText(group.keywords),
                    sortOrder: Number(group.sort_order || 100),
                  };

                  return (
                    <div className="cost-group-edit-row" key={group.id}>
                      <input
                        value={draft.name}
                        onChange={(e) => updateCostGroupDraft(group.id, "name", e.target.value)}
                        placeholder="Name"
                      />
                      <div className="color-input-wrapper">
                        <input
                          type="color"
                          value={draft.color}
                          onChange={(e) => updateCostGroupDraft(group.id, "color", e.target.value)}
                        />
                      </div>
                      <input
                        value={draft.keywordsText}
                        onChange={(e) => updateCostGroupDraft(group.id, "keywordsText", e.target.value)}
                        placeholder="Keywords, kommasepariert"
                      />
                      <input
                        type="number"
                        value={draft.sortOrder}
                        onChange={(e) => updateCostGroupDraft(group.id, "sortOrder", e.target.value)}
                        placeholder="Sortierung"
                      />
                      <div className="cost-group-row-actions" style={{ gridColumn: "span 2" }}>
                        <button className="btn secondary compact-action-btn" disabled={busy} onClick={() => saveCostGroup(group.id)}>
                          <span className="btn-icon" aria-hidden="true">💾</span>
                          <span className="btn-label">Speichern</span>
                        </button>
                        <button className="btn secondary compact-action-btn" disabled={busy} onClick={() => deleteCostGroup(group.id)}>
                          <span className="btn-icon" aria-hidden="true">🗑️</span>
                          <span className="btn-label">Löschen</span>
                        </button>
                      </div>
                    </div>
                  );
                })}

                {costGroupCatalogReady && (
                  <div className="cost-group-new-row">
                    <input
                      value={newCostGroup.name}
                      onChange={(e) => setNewCostGroup((s) => ({ ...s, name: e.target.value }))}
                      placeholder="Neue Kostengruppe"
                    />
                    <div className="color-input-wrapper">
                      <input
                        type="color"
                        value={newCostGroup.color}
                        onChange={(e) => setNewCostGroup((s) => ({ ...s, color: e.target.value }))}
                      />
                    </div>
                    <input
                      value={newCostGroup.keywordsText}
                      onChange={(e) => setNewCostGroup((s) => ({ ...s, keywordsText: e.target.value }))}
                      placeholder="Keywords, kommasepariert"
                    />
                    <input
                      type="number"
                      value={newCostGroup.sortOrder}
                      onChange={(e) => setNewCostGroup((s) => ({ ...s, sortOrder: e.target.value }))}
                      placeholder="Sortierung"
                    />
                    <div className="cost-group-new-actions" style={{ gridColumn: "span 2" }}>
                      <button className="btn compact-action-btn" disabled={busy} onClick={addCostGroup}>
                        <span className="btn-icon" aria-hidden="true">➕</span>
                        <span className="btn-label">Hinzufügen</span>
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {costGroupModalView === "accounts" && (
              <>
                <div className="cost-group-summary-actions">
                  <button className="btn secondary" onClick={() => setCostGroupModalView("summary")}>Zurück zur Übersicht</button>
                </div>

                {!accountCatalogReady && (
                  <p className="hint error">
                    Kostenträger-Tabelle noch nicht verfügbar: {accountCatalogMessage}
                  </p>
                )}

                {accountCatalogReady && !familyAccounts.length && (
                  <p className="hint">Noch keine Kostenträger angelegt. Füge unten eines hinzu.</p>
                )}

                {accountCatalogReady && (
                  <p className="hint" style={{ marginBottom: "10px" }}>
                    Nur Konten mit verknüpftem Kostenträger erscheinen in der Verrechnung als Zahler oder Empfänger.
                  </p>
                )}

                {accountCatalogReady && (
                  <div className="account-edit-head">
                    <span>Name</span>
                    <span>Farbe</span>
                    <span>Typ</span>
                    <span>Verknüpfter Kostenträger</span>
                    <span>Sortierung</span>
                    <span>Aktion</span>
                    <span>Aktion</span>
                  </div>
                )}

                {accountCatalogReady && familyAccounts.map((account) => {
                  const draft = accountDrafts[account.id] || {
                    name: account.name || "",
                    color: account.color || "#18b6a3",
                    accountType: account.account_type || "person",
                    costCenterId: account.cost_center_id || "",
                    sortOrder: Number(account.sort_order || 100),
                  };

                  return (
                    <div className="account-edit-row" key={account.id}>
                      <input
                        value={draft.name}
                        onChange={(e) => updateAccountDraft(account.id, "name", e.target.value)}
                        placeholder="Name"
                      />
                      <div className="color-input-wrapper">
                        <input
                          type="color"
                          value={draft.color}
                          onChange={(e) => updateAccountDraft(account.id, "color", e.target.value)}
                        />
                      </div>
                      <select
                        value={draft.accountType}
                        onChange={(e) => updateAccountDraft(account.id, "accountType", e.target.value)}
                        disabled={account.account_type === "family"}
                      >
                        <option value="person">Person</option>
                        <option value="family">Familie</option>
                      </select>
                      <select
                        value={draft.costCenterId || ""}
                        onChange={(e) => updateAccountDraft(account.id, "costCenterId", e.target.value)}
                      >
                        <option value="">-- kein Kostenträger --</option>
                        {costCenterOptions.map((costCenter) => (
                          <option key={costCenter.id} value={costCenter.id}>{costCenter.name}</option>
                        ))}
                      </select>
                      <input
                        className="account-sort-input"
                        type="number"
                        value={draft.sortOrder}
                        onChange={(e) => updateAccountDraft(account.id, "sortOrder", e.target.value)}
                        placeholder="Sortierung"
                      />
                      <div className="account-row-actions">
                        <button className="btn secondary" disabled={busy} onClick={() => saveFamilyAccount(account.id)}>Speichern</button>
                        <button className="btn secondary" disabled={busy || account.account_type === "family"} onClick={() => deleteFamilyAccount(account)}>
                          Löschen
                        </button>
                      </div>
                    </div>
                  );
                })}

                {accountCatalogReady && (
                  <div className="account-new-row">
                    <input
                      value={newAccount.name}
                      onChange={(e) => setNewAccount((s) => ({ ...s, name: e.target.value }))}
                      placeholder="Neuer Kostenträger"
                    />
                    <div className="color-input-wrapper">
                      <input
                        type="color"
                        value={newAccount.color}
                        onChange={(e) => setNewAccount((s) => ({ ...s, color: e.target.value }))}
                      />
                    </div>
                    <select
                      value={newAccount.accountType}
                      onChange={(e) => setNewAccount((s) => ({ ...s, accountType: e.target.value }))}
                    >
                      <option value="person">Person</option>
                      <option value="family">Familie</option>
                    </select>
                    <select
                      value={newAccount.costCenterId || ""}
                      onChange={(e) => setNewAccount((s) => ({ ...s, costCenterId: e.target.value }))}
                    >
                      <option value="">-- kein Kostenträger --</option>
                      {costCenterOptions.map((costCenter) => (
                        <option key={costCenter.id} value={costCenter.id}>{costCenter.name}</option>
                      ))}
                    </select>
                    <input
                      className="account-sort-input"
                      type="number"
                      value={newAccount.sortOrder}
                      onChange={(e) => setNewAccount((s) => ({ ...s, sortOrder: e.target.value }))}
                      placeholder="Sortierung"
                    />
                    <div className="account-new-actions">
                      <button className="btn" disabled={busy} onClick={addFamilyAccount}>Hinzufügen</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {showCostCenterModal && (
        <div className="modal-backdrop" onClick={() => setShowCostCenterModal(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Kostenträger bearbeiten</h3>
              <button className="btn secondary" onClick={() => setShowCostCenterModal(false)}>Schließen</button>
            </div>

            {costCenters.length === 0 && (
              <p className="hint">Noch keine Kostenträger angelegt. Füge unten eines hinzu.</p>
            )}

            {costCenters.length > 0 && (
              <>
                <div className="account-edit-head">
                  <span>Name</span>
                  <span>Farbe</span>
                  <span>Sortierung</span>
                  <span>Aktion</span>
                  <span>Aktion</span>
                </div>

                {costCenters.map((center) => {
                  const cc = costCenters.find(c => c.id === center.id);
                  if (!cc) return null;
                  
                  const draft = costCenterDrafts[center.id] || {
                    name: cc.name || "",
                    color: cc.color || "#18b6a3",
                    sort_order: cc.sort_order || 100
                  };
                  
                  return (
                    <div className="account-edit-row" key={center.id}>
                      <input
                        value={draft.name}
                        onChange={(e) => updateCostCenterDraft(center.id, "name", e.target.value)}
                        placeholder="Name"
                      />
                      <div className="color-input-wrapper">
                        <input
                          type="color"
                          value={draft.color}
                          onChange={(e) => updateCostCenterDraft(center.id, "color", e.target.value)}
                        />
                      </div>
                      <input
                        className="account-sort-input"
                        type="number"
                        value={draft.sort_order}
                        onChange={(e) => updateCostCenterDraft(center.id, "sort_order", e.target.value)}
                        placeholder="Sortierung"
                      />
                      <div className="account-row-actions">
                        <button className="btn secondary" disabled={busy} onClick={() => saveCostCenter(center.id)}>Speichern</button>
                        <button className="btn secondary" disabled={busy} onClick={() => deleteCostCenter(center.id)}>Löschen</button>
                      </div>
                    </div>
                  );
                })}

                <div className="account-new-row">
                  <input
                    value={newCostCenter.name}
                    onChange={(e) => setNewCostCenter((s) => ({ ...s, name: e.target.value }))}
                    placeholder="Neuer Kostenträger"
                  />
                  <div className="color-input-wrapper">
                    <input
                      type="color"
                      value={newCostCenter.color}
                      onChange={(e) => setNewCostCenter((s) => ({ ...s, color: e.target.value }))}
                    />
                  </div>
                  <input
                    className="account-sort-input"
                    type="number"
                    value={newCostCenter.sort_order}
                    onChange={(e) => setNewCostCenter((s) => ({ ...s, sort_order: e.target.value }))}
                    placeholder="Sortierung"
                  />
                  <div className="account-new-actions">
                    <button className="btn" disabled={busy} onClick={addNewCostCenter}>Hinzufügen</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showSetupModal && (
        <div className="modal-backdrop" onClick={() => setShowSetupModal(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>⚠️ Datenbank-Setup erforderlich</h3>
              <button className="btn secondary" onClick={() => setShowSetupModal(false)}>Schließen</button>
            </div>
            <div style={{ padding: "20px 16px" }}>
              <p style={{ fontSize: "16px", lineHeight: "1.6", marginBottom: "16px" }}>
                Um Kostenträger bei Positionen auswählen zu können, muss eine neue Spalte in der Datenbank erstellt werden.
              </p>
              <p style={{ background: "#f1fbf9", padding: "12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "14px", fontFamily: "monospace", marginBottom: "16px" }}>
                <strong>SQL:</strong><br/>
                ALTER TABLE receipt_items<br/>
                ADD COLUMN IF NOT EXISTS assigned_cost_center_id uuid<br/>
                REFERENCES cost_centers(id) ON DELETE SET NULL;
              </p>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button className="btn" onClick={() => window.open('https://supabase.com/dashboard/project/pfmafymhudbstxwrwtlu/sql/new', '_blank')}>
                  Supabase SQL-Editor öffnen
                </button>
                <button className="btn secondary" onClick={() => window.open('/setup-assigned-cost-center.html', '_blank')}>
                  Schritt-für-Schritt Anleitung
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && <p className="hint error">{error}</p>}
      {success && <p className="hint success">{success}</p>}

      <section className="grid two workflow-stack split-scroll-layout">
        <article className="panel split-scroll-panel">
          <div className={`receipts-sticky-palette${collapsedSections.has("receipts") ? " is-collapsed" : ""}`}>
            <div className={`section-header-with-button${collapsedSections.has("receipts") ? " is-collapsed" : ""}`} style={{ paddingBottom: "0" }}>
              <button
                onClick={() => toggleSection("receipts")}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "0",
                  display: "flex",
                  alignItems: "center",
                  fontSize: "1.1rem",
                  color: "inherit",
                }}
                title="Sektion ein-/ausblenden"
              >
                {collapsedSections.has("receipts") ? "▸" : "▾"}
              </button>
              <h2 style={{ margin: 0 }}>Belege</h2>
            </div>

            {!collapsedSections.has("receipts") && currentReceipt && (
              <>
                <div className="receipt-actions" style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "4px", marginBottom: "5px", padding: "2px 0" }}>
                  <button
                    className="btn"
                    style={{ gridColumn: "span 1" }}
                    onClick={() => {
                      const nextPaymentAccountId = newPaymentAccountId || currentReceipt?.payment_account_id || null;
                      const nextCostCenterId = selectedCostCenterForReceipt || newReceiptCostCenterId || currentReceipt?.receipt_items?.[0]?.assigned_cost_center_id || null;
                      setNewPaymentAccountId(nextPaymentAccountId);
                      setNewReceiptCostCenterId(nextCostCenterId);
                      setSelectedReceipt(null);
                    }}
                  >
                    Neuer Beleg
                  </button>
                  <button
                    className="btn secondary"
                    style={{ gridColumn: "span 2" }}
                    disabled={previewBusy || !currentReceipt.image_path}
                    onClick={() => openReceiptPreview(currentReceipt)}
                  >
                    {previewBusy ? "Öffne..." : "Beleg ansehen"}
                  </button>
                  <button
                    className="btn secondary"
                    style={{ gridColumn: "span 1" }}
                    disabled={busy}
                    onClick={() => deleteReceipt(currentReceipt)}
                  >
                    Beleg löschen
                  </button>
                  <button
                    className="btn secondary"
                    style={{ gridColumn: "span 2" }}
                    disabled={busy || !currentReceipt.image_path || !canUseApp}
                    onClick={() => retryAnalysis(currentReceipt)}
                  >
                    Erneut analysieren
                  </button>
                </div>

                {/* Zahlkonto and Kostenträger below buttons */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px", padding: "0" }}>
              <div className={`color-select-wrapper ${!currentReceipt.payment_account_id ? 'missing-required' : ''}`} style={{...(!currentReceipt.payment_account_id ? { border: "2px solid rgba(0,0,0,0.2)", borderRadius: "12px", backgroundColor: "transparent", color: "#10243e", height: "32px", display: "flex", alignItems: "center", padding: "0 8px" } : {...buildColorInputStyle((paymentAccountOptions.find((a) => a.id === currentReceipt.payment_account_id) || {}).color), height: "32px", display: "flex", alignItems: "center", padding: "0 8px"}) }}>
                <select
                  value={currentReceipt.payment_account_id || ""}
                  onChange={(e) => patchReceipt(currentReceipt.id, { payment_account_id: e.target.value || null })}
                  disabled={busy}
                  title="Zahlungskonto"
                  style={{ height: "32px", width: "100%", fontSize: "0.9rem" }}
                >
                  <option value="">-- Zahlungskonto --</option>
                  {paymentAccountOptions.map((account) => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
              </div>
              <div className={`color-select-wrapper ${!selectedCostCenterForReceipt ? 'missing-required' : ''}`} style={{...(!selectedCostCenterForReceipt ? { border: "2px solid rgba(0,0,0,0.2)", borderRadius: "12px", backgroundColor: "transparent", color: "#10243e", height: "32px", display: "flex", alignItems: "center", padding: "0 8px" } : {...buildColorInputStyle((costCenterOptions.find((cc) => cc.id === selectedCostCenterForReceipt) || {}).color), height: "32px", display: "flex", alignItems: "center", padding: "0 8px"}) }}>
                <select
                  value={selectedCostCenterForReceipt || ""}
                  onChange={(e) => {
                    const nextCostCenterId = e.target.value || null;
                    setSelectedCostCenterForReceipt(nextCostCenterId);
                    setNewReceiptCostCenterId(nextCostCenterId);
                    if (nextCostCenterId) {
                      changeCostCenterForAllItems(nextCostCenterId);
                    }
                  }}
                  disabled={busy}
                  title="Kostenträger"
                  style={{ height: "32px", width: "100%", fontSize: "0.9rem" }}
                >
                  <option value="">-- Kostenträger --</option>
                  {costCenterOptions.map((costCenter) => (
                    <option key={costCenter.id} value={costCenter.id}>{costCenter.name}</option>
                  ))}
                </select>
              </div>
                </div>
              </>
            )}

          </div>

          <div className="panel-scroll-body">
          {!collapsedSections.has("receipts") && (
            <>
          
          {/* Receipt Filters */}
          {!collapsedSections.has("receipts") && (
            <div style={{ marginBottom: "12px", paddingBottom: "8px", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <input
                  type="text"
                  placeholder="Beleg suchen..."
                  value={receiptSearchText}
                  onChange={(e) => setReceiptSearchText(e.target.value)}
                  style={{ width: "100%", padding: "6px 10px", border: "1px solid #ccc", borderRadius: "12px" }}
                />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <select
                    value={receiptMonthFilter}
                    onChange={(e) => setReceiptMonthFilter(e.target.value)}
                    style={{ padding: "4px 8px", border: "1px solid #ccc", borderRadius: "12px", fontSize: "0.9rem", height: "32px" }}
                  >
                    <option value="current">Diesen Monat</option>
                    <option value="last">Letzten Monat</option>
                    <option value="year">Dieses Jahr</option>
                    <option value="lastyear">Letztes Jahr</option>
                    <option value="all">Alle Belege</option>
                    <optgroup label="Einzelne Monate">
                      <option value="0">Januar</option>
                      <option value="1">Februar</option>
                      <option value="2">März</option>
                      <option value="3">April</option>
                      <option value="4">Mai</option>
                      <option value="5">Juni</option>
                      <option value="6">Juli</option>
                      <option value="7">August</option>
                      <option value="8">September</option>
                      <option value="9">Oktober</option>
                      <option value="10">November</option>
                      <option value="11">Dezember</option>
                    </optgroup>
                  </select>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 0" }}>
                    <input
                      type="checkbox"
                      checked={hideSettlementReceipts}
                      onChange={(e) => setHideSettlementReceipts(e.target.checked)}
                      style={{ width: "auto" }}
                    />
                    <span style={{ fontSize: "0.9rem" }}>Ausgleichszahlungen verbergen</span>
                  </label>
                </div>
              </div>
            </div>
          )}
          
          <div className="receipt-list">
            {filteredReceipts.map((receipt) => {
              const assignmentStatus = getReceiptAssignmentStatus(receipt);
              const consistencyStatus = getReceiptSumConsistencyStatus(receipt);
              const isReceiptCompleted = completedReceiptIds.has(String(receipt.id));
              const paymentAccount = paymentAccountOptions.find((a) => a.id === receipt.payment_account_id);
              const paymentAccountColor = paymentAccount?.color;
              const paymentAccountName = paymentAccount?.name;
              const firstItemCostCenterId = receipt.receipt_items?.[0]?.assigned_cost_center_id;
              const firstItemCostCenter = firstItemCostCenterId ? costCenters.find((cc) => cc.id === firstItemCostCenterId) : null;
              const costCenterColor = firstItemCostCenter?.color || null;
              const costCenterName = firstItemCostCenter?.name;
              
              return (
              <button
                key={receipt.id}
                className={`receipt-button ${receipt.id === selectedReceipt ? "active" : ""}`}
                onClick={() => setSelectedReceipt(receipt.id)}
                style={{
                  ...(receipt.payment_account_id ? buildColorInputStyle(paymentAccountColor) : {}),
                  "--receipt-account-color": paymentAccountColor || "transparent",
                  "--receipt-cost-center-color": costCenterColor || "transparent",
                }}
              >
                {paymentAccountColor && (
                  <span
                    className="receipt-corner receipt-corner-account"
                    title={paymentAccountName || "Zahlungskonto"}
                    aria-label={paymentAccountName || "Zahlungskonto"}
                  />
                )}
                {costCenterColor && (
                  <span
                    className="receipt-corner receipt-corner-cost-center"
                    title={costCenterName || "Kostenträger"}
                    aria-label={costCenterName || "Kostenträger"}
                  />
                )}
                <div className="receipt-card-content">
                  <strong>
                    {receipt.merchant || "Unbekannt"}
                  </strong>
                  <small>
                    {formatReceiptDateTime(receipt)}{receipt.currency && receipt.currency !== "EUR" ? ` · ${receipt.currency}` : ""}
                  </small>
                  {isReceiptCompleted && (
                    <span className="receipt-complete-badge" title="Beleg abgeschlossen">
                      ✓ Abgeschlossen
                    </span>
                  )}
                  {!assignmentStatus.isComplete && assignmentStatus.itemCount > 0 && (
                    <span className="receipt-warning-badge" title="Nicht alle Positionen sind vollständig zugeordnet">
                      ⚠ Unvollständig
                    </span>
                  )}
                  {!consistencyStatus.isConsistent && (
                    <span className="receipt-warning-badge" title={`Positionensumme ${amountDE.format(consistencyStatus.computedTotal)} vs. Belegsumme ${amountDE.format(consistencyStatus.currentTotal)}`}>
                      ⚠ Summe stimmt nicht
                    </span>
                  )}
                  {receipt.image_path?.toLowerCase().endsWith(".pdf") && <span className="receipt-pdf-badge">PDF</span>}
                </div>
                <div className="receipt-amounts">
                  <span className="receipt-amount-original">{formatReceiptOriginalTotal(receipt)}</span>
                  <span className="receipt-amount-eur">{euro.format(getReceiptEurTotal(receipt))}</span>
                </div>
              </button>
            );
            })}
            {!receipts.length && !busy && <p className="hint">Noch keine Belege vorhanden.</p>}
          </div>
          {!receiptItemCurrencyColumnsReady && (
            <p className="hint warning">
              Hinweis: Diese Datenbank läuft noch im alten EUR-Modus. Fremdwährung wird erst nach der Migration vollständig angezeigt.
            </p>
          )}
            </>
          )}
          </div>
        </article>

        <article className="panel split-scroll-panel">
          <div className={`section-header-with-button${collapsedSections.has("receipt-items") ? " is-collapsed" : ""}`} style={{ position: "sticky", top: 0, zIndex: 21, background: "#f8fffd", padding: "6px 0 8px", borderBottom: "1px solid rgba(16, 36, 62, 0.04)", boxShadow: "none" }}>
            <button
              onClick={() => toggleSection("receipt-items")}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "0",
                display: "flex",
                alignItems: "center",
                fontSize: "1.1rem",
                color: "inherit",
              }}
              title="Sektion ein-/ausblenden"
            >
                {collapsedSections.has("receipt-items") ? "▸" : "▾"}
            </button>
            <h2 style={{ margin: 0 }}>Positionen Beleg</h2>
          </div>
          <div className="panel-scroll-body">
          {!collapsedSections.has("receipt-items") && currentReceipt && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "12px", alignItems: "flex-start", marginBottom: "12px" }}>
              <div className="receipt-info" style={{ margin: 0 }}>
                <input
                  className="receipt-merchant-input"
                  type="text"
                  value={receiptMerchantDraft}
                  onChange={(e) => setReceiptMerchantDraft(e.target.value)}
                  onBlur={() => { void commitReceiptMerchant(); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void commitReceiptMerchant();
                    }
                  }}
                  placeholder="Belegname"
                  disabled={busy}
                  style={{ marginBottom: "4px" }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <DatePicker
                    selected={parseIsoDate(receiptDateDraft)}
                    onChange={(date) => {
                      const nextIsoDate = formatIsoDate(date);
                      setReceiptDateDraft(nextIsoDate);
                      void commitReceiptDate(nextIsoDate);
                    }}
                    onBlur={() => { void commitReceiptDate(); }}
                    onCalendarClose={() => { void commitReceiptDate(); }}
                    disabled={busy}
                    locale="de"
                    dateFormat="dd.MM.yyyy"
                    placeholderText="TT.MM.JJJJ"
                    className="receipt-date-input"
                    title="Belegdatum"
                  />
                  <small>{formatReceiptDateTime(currentReceipt)}</small>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <button
                  className="btn secondary"
                  disabled={busy || !currentReceipt?.receipt_items?.length}
                  onClick={() => autoAssignCategories(currentReceipt)}
                  style={{ padding: "6px 8px", fontSize: "0.85rem" }}
                >
                  Kostengruppe übernehmen
                </button>
                <button
                  className="btn secondary"
                  disabled={busy || !currentReceipt?.receipt_items?.length}
                  onClick={() => transferCostCenterToAll(currentReceipt)}
                  title="Kostenträger der ersten Position auf alle übertragen"
                  style={{ padding: "6px 8px", fontSize: "0.85rem" }}
                >
                  Kostenträger übernehmen
                </button>
                {!currentReceiptAssignmentStatus.isComplete && (
                  <button
                    className="btn secondary"
                    disabled={busy || !currentReceipt?.receipt_items?.length || isCurrentReceiptCompleted}
                    onClick={completeCurrentReceiptWithCheck}
                    title="Beleg nur bei vollständiger Zuordnung abschließen"
                    style={{ padding: "6px 8px", fontSize: "0.85rem" }}
                  >
                    Beleg abschließen
                  </button>
                )}
              </div>
            </div>
          )}
          {!collapsedSections.has("receipt-items") && currentReceipt && currentReceiptAssignmentStatus.itemCount > 0 && (
            <p className={`hint ${currentReceiptAssignmentStatus.isComplete ? "success" : "warning"}`}>
              {currentReceiptAssignmentStatus.isComplete
                ? "Kontrolle: Alle Positionen haben Kostengruppe und Kostenträger."
                : `Kontrolle: ${currentReceiptAssignmentStatus.missingEitherCount} von ${currentReceiptAssignmentStatus.itemCount} Positionen sind unvollständig (${currentReceiptAssignmentStatus.missingCategoryCount} ohne Kostengruppe, ${currentReceiptAssignmentStatus.missingCostCenterCount} ohne Kostenträger).`}
            </p>
          )}
          {!collapsedSections.has("receipt-items") && currentReceipt && (
            (() => {
              const consistencyStatus = getReceiptSumConsistencyStatus(currentReceipt);
              if (consistencyStatus.isConsistent) return null;
              return (
                <p className="hint warning" style={{ marginTop: "8px" }}>
                  ⚠️ Belegsumme stimmt nicht mit der Summe der Positionen überein: Positionen {amountDE.format(consistencyStatus.computedTotal)}, Belegsumme {amountDE.format(consistencyStatus.currentTotal)}.
                </p>
              );
            })()
          )}
          {!collapsedSections.has("receipt-items") && (
            <>

          {!currentReceipt && <p className="hint">Wähle oben einen Beleg aus.</p>}
          {currentReceipt && (
            <>
              {!receiptItemCurrencyColumnsReady && (
                <p className="hint warning">
                  Währungsänderungen sind erst nach der Migration verfügbar. Aktuell werden Positionen als EUR geführt.
                </p>
              )}

              <div className="item-list">
                {(currentReceipt.receipt_items || []).map((item) => (
                  <div key={item.id} className="receipt-item">
                    {/* Left column: Description and Amount */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
                      {/* Row 1: Description with delete button */}
                      <div style={{ display: "flex", gap: "4px", alignItems: "flex-start", minWidth: 0, height: "40px" }}>
                        <input
                          className="description-input"
                          value={Object.prototype.hasOwnProperty.call(descriptionDrafts, item.id) ? descriptionDrafts[item.id] : (item.description || "")}
                          title={item.description || ""}
                          onChange={(e) => updateDescriptionDraft(item.id, e.target.value)}
                          onBlur={() => commitDescriptionDraft(item)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.currentTarget.blur();
                            }
                          }}
                          style={{ flex: 1, minWidth: 0, height: "40px" }}
                        />
                        <button
                          className="btn secondary mini-btn"
                          disabled={busy}
                          onClick={() => deleteReceiptItem(item)}
                          title="Position löschen"
                          style={{ padding: "4px 6px", minWidth: "32px", height: "40px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: "-2px" }}
                        >
                          🗑️
                        </button>
                      </div>
                      
                      {/* Row 2: Amount with currency aligned to right */}
                      <div className="amount-cell" style={{ display: "flex", gap: "4px", height: "40px", minWidth: 0, alignItems: "center" }}>
                        <input
                          className="amount-input"
                          type="text"
                          inputMode="decimal"
                          value={Object.prototype.hasOwnProperty.call(amountDrafts, item.id) ? amountDrafts[item.id] : formatAmountDE(getItemOriginalAmount(item))}
                          title={formatConvertedInfo(item)}
                          onChange={(e) => updateAmountDraft(item.id, e.target.value)}
                          onBlur={() => commitAmountDraft(item)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.currentTarget.blur();
                            }
                          }}
                          style={{ flex: 1, minWidth: 0, height: "100%" }}
                        />
                        <select
                          className="currency-input"
                          value={normalizeCurrencyCode(item.currency || "EUR")}
                          onChange={(e) => updateItemCurrency(item, e.target.value)}
                          disabled={!receiptItemCurrencyColumnsReady}
                          style={{ width: "40px", minWidth: 0, height: "100%", flexShrink: 0, fontSize: "0.85rem" }}
                        >
                          {CURRENCY_OPTIONS.map((currency) => (
                            <option key={currency} value={currency}>{CURRENCY_SYMBOL[currency] ?? currency}</option>
                          ))}
                        </select>
                        {!receiptItemCurrencyColumnsReady && <span className="fallback-badge">€</span>}
                      </div>
                    </div>
                    
                    {/* Right column: Cost Group and Cost Center side-by-side */}
                    <div className="item-assignments">
                      <div className="item-assignment">
                        <span className="item-assignment-label">Kostengruppe</span>
                        <div className={`color-select-wrapper ${!item.category ? 'missing-required' : ''}`} style={!item.category ? { border: "2px solid rgba(0,0,0,0.2)", borderRadius: "12px", backgroundColor: "transparent", color: "#10243e", height: "32px", minWidth: 0, display: "flex", alignItems: "center" } : {...buildColorInputStyle(
                          activeCostGroups().find(g => g.name === item.category)?.color
                        ), height: "32px", minWidth: 0, display: "flex", alignItems: "center"}}>
                          <select
                            className="category-input cost-group-input"
                            value={item.category || ""}
                            onChange={(e) => patchItem(item.id, { category: e.target.value || null })}
                            style={{ width: "100%", height: "100%", fontSize: "0.85rem" }}
                          >
                            <option value="">- Kostengruppe -</option>
                            {activeCostGroups().map((group) => (
                              <option key={group.id || group.name} value={group.name}>{group.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="item-assignment">
                        <span className="item-assignment-label">Kostenträger</span>
                        <div className={`color-select-wrapper ${!assignedCostCenterByItemId.get(item.id) ? 'missing-required' : ''}`} style={!assignedCostCenterByItemId.get(item.id) ? { border: "2px solid rgba(0,0,0,0.2)", borderRadius: "12px", backgroundColor: "transparent", color: "#10243e", height: "32px", minWidth: 0, display: "flex", alignItems: "center" } : {...buildColorInputStyle(
                          costCenterOptions.find(cc => cc.id === assignedCostCenterByItemId.get(item.id))?.color
                        ), height: "32px", minWidth: 0, display: "flex", alignItems: "center"}}>
                          <select
                            className={`category-input account-input`}
                            value={assignedCostCenterByItemId.get(item.id) || ""}
                            onChange={(e) => assignItemToCostCenter(item, e.target.value || null)}
                            disabled={!costCenterOptions.length}
                            title="Kostenträger"
                            style={{ width: "100%", height: "100%", fontSize: "0.85rem" }}
                          >
                            <option value="">- Kostenträger -</option>
                            {costCenterOptions.map((costCenter) => (
                              <option key={costCenter.id} value={costCenter.id}>{costCenter.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="manual-box" style={{ marginTop: "12px" }}>
                <h3>Kostenaufteilung für diesen Beleg</h3>
                <p className="hint" style={{ marginTop: "0" }}>
                  Anteile akzeptieren Brüche (z.B. 1/3) oder Dezimalwerte (z.B. 0,5).
                </p>

                <div style={{ display: "grid", gap: "8px", marginBottom: "10px" }}>
                  {receiptSplitRows.map((row, index) => (
                    <div key={`split-row-${index}`} style={{ display: "grid", gridTemplateColumns: "1.4fr 0.8fr auto", gap: "8px", alignItems: "center" }}>
                      <div className={`color-select-wrapper ${!row.costCenterId ? "missing-required" : ""}`} style={!row.costCenterId
                        ? { border: "2px solid rgba(0,0,0,0.2)", borderRadius: "12px", backgroundColor: "transparent", color: "#10243e", height: "32px", minWidth: 0, display: "flex", alignItems: "center" }
                        : { ...buildColorInputStyle(costCenterOptions.find((cc) => cc.id === row.costCenterId)?.color), height: "32px", minWidth: 0, display: "flex", alignItems: "center" }}
                      >
                        <select
                          value={row.costCenterId || ""}
                          onChange={(e) => updateReceiptSplitRow(index, { costCenterId: e.target.value || "" })}
                          style={{ width: "100%", height: "100%", fontSize: "0.85rem" }}
                        >
                          <option value="">- Kostenträger -</option>
                          {costCenterOptions.map((costCenter) => (
                            <option key={costCenter.id} value={costCenter.id}>{costCenter.name}</option>
                          ))}
                        </select>
                      </div>

                      <input
                        type="text"
                        placeholder="Anteil (z.B. 1/3)"
                        value={row.share}
                        onChange={(e) => updateReceiptSplitRow(index, { share: e.target.value })}
                        style={{ height: "32px", borderRadius: "10px", border: "1px solid rgba(16,36,62,0.2)", padding: "0 10px" }}
                      />

                      <button
                        className="btn secondary mini-btn"
                        type="button"
                        onClick={() => removeReceiptSplitRow(index)}
                        disabled={receiptSplitRows.length <= 1}
                        title="Zeile entfernen"
                      >
                        Entfernen
                      </button>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px" }}>
                  <button className="btn secondary mini-btn" type="button" onClick={addReceiptSplitRow}>
                    + Kostenträger
                  </button>
                  <button className="btn secondary mini-btn" type="button" onClick={applyReceiptSplitByCostCenters} disabled={busy}>
                    Aufteilung anwenden
                  </button>
                </div>

                {(() => {
                  if (!currentReceipt?.receipt_items?.length) return null;

                  const itemIds = new Set((currentReceipt.receipt_items || []).map((item) => item.id));
                  const totalsByCostCenterId = new Map();

                  for (const alloc of itemAllocations) {
                    if (!itemIds.has(alloc.receipt_item_id)) continue;
                    const costCenterId = resolveAllocationCostCenterId(alloc);
                    if (!costCenterId) continue;
                    const old = totalsByCostCenterId.get(costCenterId) || 0;
                    totalsByCostCenterId.set(costCenterId, old + Number(alloc.amount || 0));
                  }

                  const rows = Array.from(totalsByCostCenterId.entries())
                    .map(([costCenterId, total]) => {
                      const costCenter = costCenterById.get(costCenterId);
                      return {
                        key: costCenterId,
                        name: costCenter?.name || "Unbekannt",
                        color: costCenter?.color,
                        total,
                      };
                    })
                    .filter((row) => Math.abs(row.total) > 0.0001)
                    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

                  if (!rows.length) return null;

                  return (
                    <div className="cost-group-summary-list" style={{ marginTop: "6px" }}>
                      {rows.map((row) => (
                        <div key={row.key} className="cost-group-summary-row" style={buildSummaryRowStyle(row.color)}>
                          <span className="cost-group-name">
                            <span className="cost-group-dot" style={{ backgroundColor: row.color }} />
                            {row.name}
                          </span>
                          <strong>{euro.format(row.total)}</strong>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {!accountCatalogReady && (
                <p className="hint error">
                  Kostenträger-Tabelle noch nicht verfügbar: {accountCatalogMessage}
                </p>
              )}

              <div className="manual-box">
                <h3>Position manuell hinzufügen</h3>
                <div className="receipt-item receipt-item-manual">
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
                    <div style={{ display: "flex", gap: "4px", alignItems: "flex-start", minWidth: 0, height: "40px" }}>
                      <input
                        className="description-input"
                        placeholder="Beschreibung"
                        value={manualDraft.description}
                        onChange={(e) => setManualDraft((s) => ({ ...s, description: e.target.value }))}
                        style={{ flex: 1, minWidth: 0, height: "40px" }}
                      />
                    </div>

                    <div className="amount-cell" style={{ display: "flex", gap: "4px", height: "40px", minWidth: 0, alignItems: "center" }}>
                      <input
                        className="amount-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="Betrag (z.B. 4,50)"
                        value={manualDraft.amount}
                        onChange={(e) => setManualDraft((s) => ({ ...s, amount: e.target.value }))}
                        style={{ flex: 1, minWidth: 0, height: "100%" }}
                      />
                      <select
                        className="currency-input"
                        value={manualDraft.currency || "EUR"}
                        onChange={(e) => setManualDraft((s) => ({ ...s, currency: e.target.value }))}
                        disabled={!receiptItemCurrencyColumnsReady}
                        style={{ width: "40px", minWidth: 0, height: "100%", flexShrink: 0, fontSize: "0.85rem" }}
                      >
                        {CURRENCY_OPTIONS.map((currency) => (
                          <option key={currency} value={currency}>{CURRENCY_SYMBOL[currency] ?? currency}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="item-assignments">
                    <div className="item-assignment">
                      <span className="item-assignment-label">Kostengruppe</span>
                      <div className={`color-select-wrapper ${!manualDraft.category && manualDraft.description ? 'missing-required' : ''}`} style={!manualDraft.category && manualDraft.description ? { border: "2px solid rgba(0,0,0,0.2)", borderRadius: "12px", backgroundColor: "transparent", color: "#10243e", height: "32px", minWidth: 0, display: "flex", alignItems: "center" } : (!manualDraft.category ? { border: "none", borderRadius: "12px", backgroundColor: "transparent", color: "#10243e", height: "32px", minWidth: 0, display: "flex", alignItems: "center" } : { ...buildColorInputStyle(activeCostGroups().find(g => g.name === manualDraft.category)?.color), height: "32px", minWidth: 0, display: "flex", alignItems: "center" })}>
                        <select
                          className="category-input cost-group-input"
                          value={manualDraft.category || ""}
                          onChange={(e) => setManualDraft((s) => ({ ...s, category: e.target.value }))}
                          style={{ width: "100%", height: "100%", fontSize: "0.85rem" }}
                        >
                          <option value="">- Kostengruppe -</option>
                          {activeCostGroups().map((group) => (
                            <option key={group.id || group.name} value={group.name}>{group.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="item-assignment">
                      <span className="item-assignment-label">Kostenträger</span>
                      <div className={`color-select-wrapper ${!manualDraft.accountId && manualDraft.description ? 'missing-required' : ''}`} style={!manualDraft.accountId && manualDraft.description ? { border: "2px solid rgba(0,0,0,0.2)", borderRadius: "12px", backgroundColor: "transparent", color: "#10243e", height: "32px", minWidth: 0, display: "flex", alignItems: "center" } : (!manualDraft.accountId ? { border: "none", borderRadius: "12px", backgroundColor: "transparent", color: "#10243e", height: "32px", minWidth: 0, display: "flex", alignItems: "center" } : { ...buildColorInputStyle(costCenterOptions.find(cc => cc.id === manualDraft.accountId)?.color), height: "32px", minWidth: 0, display: "flex", alignItems: "center" })}>
                        <select
                          className="category-input account-input"
                          value={manualDraft.accountId || ""}
                          onChange={(e) => setManualDraft((s) => ({ ...s, accountId: e.target.value }))}
                          disabled={!accountCatalogReady || !costCenterOptions.length}
                          title="Kostenträger"
                          style={{ width: "100%", height: "100%", fontSize: "0.85rem" }}
                        >
                          <option value="">- Kostenträger -</option>
                          {costCenterOptions.map((costCenter) => (
                            <option key={costCenter.id} value={costCenter.id}>{costCenter.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
                <button className="btn secondary" onClick={addManualItem} style={{ marginBottom: "16px" }}>Hinzufügen</button>
              </div>
            </>
          )}
            </>
          )}
          </div>
        </article>
      </section>

      <section className="workflow-stack">
        <article
          className="panel overview-panel"
          role="button"
          tabIndex={0}
          onClick={() => {
            setCostGroupModalView("summary");
            setShowCostGroupModal(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setCostGroupModalView("summary");
              setShowCostGroupModal(true);
            }
          }}
        >
          <div className="household-header-title-row">
            <div className="household-header-left">
              <button
                onClick={(e) => { e.stopPropagation(); toggleSection("household-book"); }}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "0",
                  display: "flex",
                  alignItems: "center",
                  fontSize: "1.1rem",
                  color: "inherit",
                }}
                title="Sektion ein-/ausblenden"
              >
                {collapsedSections.has("household-book") ? "▸" : "▾"}
              </button>
              <h2 style={{ margin: 0 }}>Haushaltsbuch</h2>
            </div>
          </div>
          <div className="household-header-actions-row">
            {!collapsedSections.has("household-book") && (
              <div className="household-header-actions">
                <button className="btn secondary" onClick={(e) => { e.stopPropagation(); setShowCostCenterModal(true); }}>
                  Kostenträger bearbeiten
                </button>
                <button
                  className="btn secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowCostGroupModal(true);
                    setCostGroupModalView("accounts");
                  }}
                >
                  Zahlungskonten bearbeiten
                </button>
                <button
                  className="btn secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowCostGroupModal(true);
                    setCostGroupModalView("edit");
                  }}
                >
                  Kostengruppen bearbeiten
                </button>
              </div>
            )}
          </div>
          {!collapsedSections.has("household-book") && (
          <>
          <div className="totals">
            <div className="total-card main">
              <span>Gesamtausgaben:</span>
              <strong>{euro.format(mainAccountTotal)}</strong>
            </div>
          </div>

          <div className="cost-group-summary year-overview-summary">
            <h3>Jahresübersicht {costGroupYearOverview.year}</h3>
            {!costGroupYearOverview.maxMonthTotal && <p className="hint">Noch keine Ausgaben im laufenden Jahr vorhanden.</p>}
            {!!costGroupYearOverview.maxMonthTotal && (
              <div className="year-overview-chart-wrap">
                <div className="year-overview-chart" role="img" aria-label={`Jahresübersicht ${costGroupYearOverview.year}, gestapelte Monatsbalken nach Kostengruppen`}>
                  {costGroupYearOverview.months.map((month) => (
                    <div className="year-overview-month" key={month.label}>
                      <div className="year-overview-bar" title={`${month.label}: ${euro.format(month.total)}`}>
                        {month.segments.length ? month.segments.map((segment) => {
                          const height = costGroupYearOverview.maxMonthTotal > 0 ? (segment.total / costGroupYearOverview.maxMonthTotal) * 100 : 0;
                          return (
                            <span
                              key={`${month.label}-${segment.name}`}
                              className="year-overview-segment"
                              style={{ height: `${Math.max(height, 0)}%`, backgroundColor: segment.color }}
                              title={`${month.label} · ${segment.name}: ${euro.format(segment.total)}`}
                              aria-label={`${month.label} · ${segment.name}: ${euro.format(segment.total)}`}
                            />
                          );
                        }) : <span className="year-overview-empty" />}
                      </div>
                      <div className="year-overview-month-label">{month.label}</div>
                      <div className="year-overview-month-total">{euro.format(month.total)}</div>
                    </div>
                  ))}
                </div>
                {!!costGroupYearOverview.legend.length && (
                  <div className="year-overview-legend">
                    {costGroupYearOverview.legend.map((entry) => (
                      <div className="year-overview-legend-item" key={entry.name}>
                        <span className="cost-group-dot" style={{ backgroundColor: entry.color }} />
                        <span className="year-overview-legend-name">{entry.name}</span>
                        <strong>{euro.format(entry.total)}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="cost-group-summary">
            <h3>Kostenübersicht nach Kostengruppen</h3>
            {!costGroupTotals.length && <p className="hint">Noch keine Positionen mit Kosten vorhanden.</p>}
            {!!costGroupTotals.length && (
              <div className="cost-group-summary-list">
                {costGroupTotals.map((row) => (
                  <div className="cost-group-summary-row" key={row.name} style={buildSummaryRowStyle(row.color)}>
                    <span className="cost-group-name">
                      <span className="cost-group-dot" style={{ backgroundColor: row.color }} />
                      {row.name}
                    </span>
                    <strong>{euro.format(row.total)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="cost-group-summary">
            <h3>Kostenübersicht nach Kostenträgern</h3>
            {!costCenterTotals.length && <p className="hint">Noch keine Kosten vorhanden.</p>}
            {!!costCenterTotals.length && (
              <div className="cost-group-summary-list">
                {costCenterTotals.map((row) => (
                  <div className="cost-group-summary-row" key={row.id} style={buildSummaryRowStyle(row.color)}>
                    <span className="cost-group-name">
                      <span className="cost-group-dot" style={{ backgroundColor: row.color }} />
                      {row.name}
                    </span>
                    <strong>{euro.format(row.total)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="cost-group-summary-actions">
            <p className="hint">Tippe in diese Karte, um die Liste der Kostengruppen zu öffnen.</p>
          </div>
          </>
          )}
        </article>

        <article className="panel">
          <div className="settlement-header-row">
            <button
              onClick={(e) => { e.stopPropagation(); toggleSection("settlement"); }}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "0",
                display: "flex",
                alignItems: "center",
                fontSize: "1.1rem",
                color: "inherit",
              }}
              title="Sektion ein-/ausblenden"
            >
              {collapsedSections.has("settlement") ? "▸" : "▾"}
            </button>
            <h2 style={{ margin: 0 }}>Verrechnung</h2>
          </div>
          {!collapsedSections.has("settlement") && (
          <>
          <div className="totals">
            <div className="total-card main">
              <span>Gesamtausgaben:</span>
              <strong>{euro.format(mainAccountTotal)}</strong>
            </div>
          </div>

          <div className="cost-group-summary">
            <h3>Ausgabensummen pro Zahlungskonto</h3>
            {(() => {
              const accounts = (familyAccounts.length ? familyAccounts : [defaultFamilyAccount])
                .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));
              const totals = {}; // accountId -> total_amount
              
              // Initialize all accounts
              for (const account of accounts) {
                totals[account.id] = 0;
              }
              // Also initialize family account in case it's not in accounts array
              totals[defaultFamilyAccount.id] = 0;
              
              // Sum receipts by payment_account_id (with default to family account)
              // Use the same effective amount calculation as the main totals.
              for (const receipt of receipts) {
                const accountId = receipt.payment_account_id || defaultFamilyAccount.id;
                const amount = getReceiptAmountForTotals(receipt);
                totals[accountId] = (totals[accountId] || 0) + amount;
              }
              
              if (!accounts.length) {
                return <p className="hint">Keine Zahlungskonten vorhanden</p>;
              }
              
              // Calculate sum of all accounts
              const summedTotal = Object.values(totals).reduce((acc, val) => acc + val, 0);
              const mainTotal = mainAccountTotal;
              const diff = Math.abs(summedTotal - mainTotal);
              
              // Debug logs
              console.log("🔍 DEBUG Ausgabensummen:");
              console.log("  Belege insgesamt:", receipts.length);
              console.log("  Totals per Konto:", totals);
              receipts.forEach((r, i) => {
                console.log(`    Beleg ${i}: merchant=${r.merchant}, payment_account_id=${r.payment_account_id}, total_amount=${r.total_amount}`);
              });
              console.log("  Summe Zahlungskonten:", summedTotal);
              console.log("  mainAccountTotal (via sumItems):", mainTotal);
              console.log("  Differenz:", diff);
              
              return (
                <div>
                  <div className="cost-group-summary-list">
                    {accounts.map(acc => (
                      <div className="cost-group-summary-row" key={acc.id} style={buildSummaryRowStyle(acc.color)}>
                        <span className="cost-group-name">
                          <span className="cost-group-dot" style={{ backgroundColor: acc.color }} />
                          {acc.name}
                        </span>
                        <strong>{euro.format(totals[acc.id] || 0)}</strong>
                      </div>
                    ))}
                  </div>
                  {diff > 0.01 && (
                    <div style={{ marginTop: "8px", padding: "8px", backgroundColor: "#ffe0e0", borderRadius: "4px" }}>
                      <p style={{ color: "red", fontSize: "0.9em", margin: 0 }}>
                        ⚠️ Summe der Konten ({euro.format(summedTotal)}) ≠ Gesamtausgaben ({euro.format(mainTotal)})
                      </p>
                      <button
                        className="btn secondary mini-btn"
                        disabled={busy}
                        onClick={repairAllReceiptTotals}
                        style={{ marginTop: "8px" }}
                      >
                        Belegsummen reparieren
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          <div className="cost-group-summary">
            <h3>Ausgleich erforderlich</h3>
            {(() => {
              const accounts = (familyAccounts.length ? familyAccounts : [defaultFamilyAccount])
                .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));
              
              // SETTLEMENT: Calculate who should pay what based on assigned_cost_center_id
              
              // 1. ZAHLUNGEN: Sum receipts by payment_account_id
              const zahlungen = {}; // accountId -> amount
              for (const account of accounts) {
                zahlungen[account.id] = 0;
              }
              zahlungen[defaultFamilyAccount.id] = 0;
              
              for (const receipt of receipts) {
                const accountId = receipt.payment_account_id || defaultFamilyAccount.id;
                const amount = getReceiptAmountForTotals(receipt);
                zahlungen[accountId] = (zahlungen[accountId] || 0) + amount;
              }
              
              // 2. KOSTENTRÄGER: Prefer receipt_item_allocations (supports splits), fallback to assigned_cost_center_id.
              const kostentraegerPerAccount = {}; // accountId -> amount
              for (const account of accounts) {
                kostentraegerPerAccount[account.id] = 0;
              }
              kostentraegerPerAccount[defaultFamilyAccount.id] = 0;

              const accountIdByCostCenterId = new Map();
              for (const account of accounts) {
                if (account?.cost_center_id) {
                  accountIdByCostCenterId.set(account.cost_center_id, account.id);
                }
              }

              const allocByItemId = new Map();
              for (const alloc of itemAllocations) {
                const list = allocByItemId.get(alloc.receipt_item_id) || [];
                list.push(alloc);
                allocByItemId.set(alloc.receipt_item_id, list);
              }

              const kostentraegerPerCostCenter = {}; // only for debug output

              for (const receipt of receipts) {
                for (const item of (receipt.receipt_items || [])) {
                  if (item.is_ignored === true) continue;

                  const itemAmount = Number(item.amount || 0);
                  const allocations = allocByItemId.get(item.id) || [];

                  if (allocations.length) {
                    const totalAllocatedRaw = allocations.reduce((sum, alloc) => sum + Number(alloc.amount || 0), 0);
                    const factor = totalAllocatedRaw !== 0 && Math.abs(totalAllocatedRaw) > Math.abs(itemAmount)
                      ? itemAmount / totalAllocatedRaw
                      : 1;

                    let allocated = 0;
                    for (const alloc of allocations) {
                      const amount = Number(alloc.amount || 0) * factor;
                      const costCenterId = resolveAllocationCostCenterId(alloc);
                      if (!costCenterId) continue;

                      const accountId = alloc.account_id || accountIdByCostCenterId.get(costCenterId) || null;
                      if (accountId) {
                        kostentraegerPerAccount[accountId] = (kostentraegerPerAccount[accountId] || 0) + amount;
                      }
                      allocated += amount;

                      kostentraegerPerCostCenter[costCenterId] = (kostentraegerPerCostCenter[costCenterId] || 0) + amount;
                    }

                    const remainder = itemAmount - allocated;
                    if (Math.abs(remainder) > 0.0001) {
                      const fallbackAccountId = accountIdByCostCenterId.get(item.assigned_cost_center_id) || null;
                      if (fallbackAccountId) {
                        kostentraegerPerAccount[fallbackAccountId] = (kostentraegerPerAccount[fallbackAccountId] || 0) + remainder;
                      }
                      if (item.assigned_cost_center_id) {
                        kostentraegerPerCostCenter[item.assigned_cost_center_id] = (kostentraegerPerCostCenter[item.assigned_cost_center_id] || 0) + remainder;
                      }
                    }

                    continue;
                  }

                  const fallbackAccountId = accountIdByCostCenterId.get(item.assigned_cost_center_id) || null;
                  if (fallbackAccountId) {
                    kostentraegerPerAccount[fallbackAccountId] = (kostentraegerPerAccount[fallbackAccountId] || 0) + itemAmount;
                  }
                  if (item.assigned_cost_center_id) {
                    kostentraegerPerCostCenter[item.assigned_cost_center_id] = (kostentraegerPerCostCenter[item.assigned_cost_center_id] || 0) + itemAmount;
                  }
                }
              }
              
              // 3. AUSGLEICH = Zahlungen - Kostenträger
              const ausgleiche = {}; // accountId -> balance
              for (const account of accounts) {
                ausgleiche[account.id] = (zahlungen[account.id] || 0) - (kostentraegerPerAccount[account.id] || 0);
              }
              
              // Debug
              console.log("🔍 DEBUG Verrechnung (Settlement - mit assigned_cost_center_id):");
              console.log("  Zahlungen:", zahlungen);
              console.log("  Kostenträger per CostCenter:", kostentraegerPerCostCenter);
              console.log("  Kostenträger per Account:", kostentraegerPerAccount);
              console.log("  Ausgleiche:", ausgleiche);

              // 4. PAARWEISE AUSGLEICHE: debtor account reimburses the actual paying account.
              const transferMatrix = new Map();
              const addTransfer = (fromAccountId, toAccountId, amount) => {
                if (!fromAccountId || !toAccountId || fromAccountId === toAccountId || amount <= 0.0001) return;
                const key = `${fromAccountId}__${toAccountId}`;
                transferMatrix.set(key, (transferMatrix.get(key) || 0) + amount);
              };

              for (const receipt of receipts) {
                const payerAccountId = receipt.payment_account_id || defaultFamilyAccount.id;

                for (const item of (receipt.receipt_items || [])) {
                  if (item.is_ignored === true) continue;

                  const itemAmount = Number(item.amount || 0);
                  const allocations = allocByItemId.get(item.id) || [];

                  if (allocations.length) {
                    const totalAllocatedRaw = allocations.reduce((sum, alloc) => sum + Number(alloc.amount || 0), 0);
                    const factor = totalAllocatedRaw !== 0 && Math.abs(totalAllocatedRaw) > Math.abs(itemAmount)
                      ? itemAmount / totalAllocatedRaw
                      : 1;

                    let allocated = 0;
                    for (const alloc of allocations) {
                      const costCenterId = resolveAllocationCostCenterId(alloc);
                      if (!costCenterId) continue;

                      const debtorAccountId = alloc.account_id || accountIdByCostCenterId.get(costCenterId) || null;
                      const amount = Number(alloc.amount || 0) * factor;
                      if (debtorAccountId) {
                        addTransfer(debtorAccountId, payerAccountId, amount);
                      }
                      allocated += amount;
                    }

                    const remainder = itemAmount - allocated;
                    if (Math.abs(remainder) > 0.0001) {
                      const debtorAccountId = accountIdByCostCenterId.get(item.assigned_cost_center_id) || null;
                      if (debtorAccountId) {
                        addTransfer(debtorAccountId, payerAccountId, remainder);
                      }
                    }

                    continue;
                  }

                  const debtorAccountId = accountIdByCostCenterId.get(item.assigned_cost_center_id) || null;
                  if (debtorAccountId) {
                    addTransfer(debtorAccountId, payerAccountId, itemAmount);
                  }
                }
              }

              // Subtract already booked settlement receipts from the pairwise suggestions.
              const bookedTransferMatrix = new Map();
              for (const receipt of receipts) {
                if (receipt?.merchant !== "Ausgleichszahlung") continue;
                if (Number(receipt?.total_amount || 0) <= 0) continue;

                const description = String(receipt?.receipt_items?.[0]?.description || "").trim();
                const match = description.match(/^(.+?)\s+an\s+(.+)$/);
                if (!match) continue;

                const debtorName = match[1]?.trim();
                const creditorName = match[2]?.trim();
                const debtorAccount = accounts.find((account) => account.name === debtorName);
                const creditorAccount = accounts.find((account) => account.name === creditorName);
                if (!debtorAccount?.id || !creditorAccount?.id) continue;

                const key = `${debtorAccount.id}__${creditorAccount.id}`;
                bookedTransferMatrix.set(key, (bookedTransferMatrix.get(key) || 0) + Number(receipt.total_amount || 0));
              }

              // Net opposite directions, but keep bilateral obligations instead of global creditor pooling.
              const pairwiseTransfers = [];
              const processedPairs = new Set();
              for (const [key, amount] of transferMatrix.entries()) {
                if (processedPairs.has(key)) continue;

                const [fromAccountId, toAccountId] = key.split("__");
                const reverseKey = `${toAccountId}__${fromAccountId}`;
                const reverseAmount = transferMatrix.get(reverseKey) || 0;
                const bookedAmount = bookedTransferMatrix.get(key) || 0;
                const reverseBookedAmount = bookedTransferMatrix.get(reverseKey) || 0;
                const netAmount = (amount - bookedAmount) - (reverseAmount - reverseBookedAmount);

                processedPairs.add(key);
                processedPairs.add(reverseKey);

                if (netAmount > 0.01) {
                  pairwiseTransfers.push({
                    fromAccountId,
                    toAccountId,
                    amount: roundMoney(netAmount),
                  });
                }
              }
              pairwiseTransfers.sort((a, b) => b.amount - a.amount);
              
              // Get debtors (negative = zahlt) and creditors (positive = erhält)
              // Both are PAYMENT ACCOUNTS (Zahlungskonten), not cost centers!
              const debtors = Object.entries(ausgleiche)
                .filter(([id, bal]) => bal < -0.01)
                .map(([id, bal]) => ({ id, name: accounts.find(a => a.id === id)?.name || "?", color: accounts.find(a => a.id === id)?.color, account: accounts.find(a => a.id === id), amount: -bal }));
              
              const creditors = Object.entries(ausgleiche)
                .filter(([id, bal]) => bal > 0.01)
                .map(([id, bal]) => ({ id, name: accounts.find(a => a.id === id)?.name || "?", color: accounts.find(a => a.id === id)?.color, account: accounts.find(a => a.id === id), amount: bal }));
              
              if (!debtors.length && !creditors.length) {
                return <p className="hint">✓ Alle Konten sind ausgeglichen!</p>;
              }
              
              return (
                <>
                  <div className="cost-group-summary-list">
                    {debtors.map(debtor => (
                      <div key={debtor.id} className="cost-group-summary-row" style={buildSummaryRowStyle(debtor.color)}>
                        <span className="cost-group-name">
                          <span className="cost-group-dot" style={{ backgroundColor: debtor.color }} />
                          {debtor.name} schuldet
                        </span>
                        <strong>{euro.format(debtor.amount)}</strong>
                      </div>
                    ))}
                    {creditors.map(creditor => (
                      <div key={creditor.id} className="cost-group-summary-row" style={buildSummaryRowStyle(creditor.color)}>
                        <span className="cost-group-name">
                          <span className="cost-group-dot" style={{ backgroundColor: creditor.color }} />
                          {creditor.name} erhält
                        </span>
                        <strong>{euro.format(creditor.amount)}</strong>
                      </div>
                    ))}
                  </div>
                  
                  <h3 style={{ marginTop: "20px", marginBottom: "12px" }}>Ausgleichszahlungen buchen</h3>
                  {!pairwiseTransfers.length && <p className="hint">Keine konkreten Ausgleichsbuchungen vorhanden.</p>}
                  {!!pairwiseTransfers.length && (
                    <div style={{ display: "grid", gap: "8px" }}>
                      {pairwiseTransfers.map((transfer) => {
                        const debtor = accounts.find((account) => account.id === transfer.fromAccountId);
                        const creditor = accounts.find((account) => account.id === transfer.toAccountId);
                        if (!debtor || !creditor) return null;

                        return (
                          <div key={`settlement-${transfer.fromAccountId}-${transfer.toAccountId}`} style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
                            <strong style={{ color: debtor.color }}>{debtor.name}</strong>
                            <span>→</span>
                            <button
                              className="btn secondary mini-btn"
                              disabled={busy}
                              onClick={() => createSettlementReceipt(debtor, creditor, transfer.amount)}
                              title={`${debtor.name} zahlt ${euro.format(transfer.amount)} an ${creditor.name}`}
                            >
                              {creditor.name} {euro.format(transfer.amount)}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
          </>
          )}
        </article>
      </section>
    </div>
  );
}

export default App;
