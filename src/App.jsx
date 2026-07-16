import { useEffect, useMemo, useRef, useState } from "react";
import { defaultHouseholdId, isSupabaseConfigured, supabase } from "./lib/supabase";

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
const APP_VERSION = "v0.3.1";
const CURRENCY_OPTIONS = ["EUR", "TRY", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF"];
const CURRENCY_SYMBOL = { EUR: "€", TRY: "₺", USD: "$", GBP: "£", CHF: "Fr", SEK: "kr", NOK: "kr", DKK: "kr", PLN: "zł", CZK: "Kč", HUF: "Ft" };
const AUTH_EMAIL_STORAGE_KEY = "bonbox_auth_email";
const VERIFIED_EMAIL_STORAGE_KEY = "bonbox_verified_email";
const MAGIC_LINK_COOLDOWN_UNTIL_STORAGE_KEY = "bonbox_magic_link_cooldown_until";
const ONE_TIME_BYPASS_EMAIL = "nsteinweden@yahoo.com";
const ONE_TIME_BYPASS_USED_STORAGE_KEY = "bonbox_one_time_bypass_used_nsteinweden";
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
};

const emptyDraft = {
  description: "",
  quantity: 1,
  amount: "",
  currency: "EUR",
  category: "",
  accountId: defaultFamilyAccount.id,
};

function sumItems(receipts) {
  return receipts.reduce((acc, receipt) => {
    const chunk = (receipt.receipt_items || []).reduce((rowAcc, item) => {
      if (item.is_ignored === true) return rowAcc;
      return rowAcc + Number(item.amount || 0);
    }, 0);
    return acc + chunk;
  }, 0);
}

function formatReceiptDateTime(receipt) {
  if (receipt?.created_at) {
    return dateTimeDE.format(new Date(receipt.created_at));
  }

  if (receipt?.receipt_date) {
    const baseTime = `${receipt.receipt_date}T`;
    const aiTime = receipt?.ai_raw_json?.receiptTime || "00:00";
    return dateDE.format(new Date(`${baseTime}${aiTime}:00`));
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

function normalizeText(text) {
  return String(text || "").toLowerCase();
}

function inferCostGroupName(description, groups) {
  const normalized = normalizeText(description);
  if (!normalized) return null;

  for (const group of groups) {
    const keywords = Array.isArray(group.keywords) ? group.keywords : [];
    for (const keyword of keywords) {
      if (keyword && normalized.includes(normalizeText(keyword))) {
        return group.name;
      }
    }
  }

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

function normalizeCurrencyCode(value) {
  const normalized = String(value || "EUR").trim().toUpperCase();
  if (normalized === "TL" || normalized === "TRY" || normalized === "TYR" || normalized === "₺") return "TRY";
  if (normalized === "EURO") return "EUR";
  return normalized || "EUR";
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
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

function App() {
  const householdId = defaultHouseholdId;
  const [receipts, setReceipts] = useState([]);
  const [costGroups, setCostGroups] = useState([]);
  const [familyAccounts, setFamilyAccounts] = useState([]);
  const [itemAllocations, setItemAllocations] = useState([]);
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [selectedFile, setSelectedFile] = useState(null);
  const [manualDraft, setManualDraft] = useState(emptyDraft);
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [amountDrafts, setAmountDrafts] = useState({});
  const [showCostGroupModal, setShowCostGroupModal] = useState(false);
  const [costGroupModalView, setCostGroupModalView] = useState("summary");
  const [newReceiptAccountId, setNewReceiptAccountId] = useState(defaultFamilyAccount.id);
  const [authEmail, setAuthEmail] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(AUTH_EMAIL_STORAGE_KEY) || "";
  });
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [accessRecord, setAccessRecord] = useState(null);
  const [approvalStatus, setApprovalStatus] = useState("signed_out");
  const [verifiedEmail, setVerifiedEmail] = useState("");
  const [magicLinkCooldownUntil, setMagicLinkCooldownUntil] = useState(() => {
    if (typeof window === "undefined") return 0;
    const raw = Number(window.localStorage.getItem(MAGIC_LINK_COOLDOWN_UNTIL_STORAGE_KEY) || 0);
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
    sortOrder: 100,
  });
  const exchangeRateCache = useRef(new Map());
  const repairedItemIds = useRef(new Set());

  const magicLinkCooldownMsLeft = Math.max(0, Number(magicLinkCooldownUntil || 0) - magicLinkNow);
  const magicLinkCooldownSeconds = Math.ceil(magicLinkCooldownMsLeft / 1000);
  const magicLinkBlocked = magicLinkCooldownSeconds > 0;

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
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(MAGIC_LINK_COOLDOWN_UNTIL_STORAGE_KEY);
    }
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

  const accountTotals = useMemo(() => {
    const accounts = familyAccounts.length ? familyAccounts : [defaultFamilyAccount];
    const accountById = new Map(accounts.map((a) => [a.id, a]));
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
          const old = totals.get(alloc.account_id) || 0;
          totals.set(alloc.account_id, old + amount);
          allocated += amount;
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
      .sort((a, b) => b.total - a.total);
  }, [receipts, familyAccounts, itemAllocations]);

  const accountDetails = useMemo(() => {
    const accounts = familyAccounts.length ? familyAccounts : [defaultFamilyAccount];
    const accountById = new Map(accounts.map((a) => [a.id, a]));
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
          const accountId = alloc.account_id || defaultFamilyAccount.id;
          const row = details.get(accountId) || {
            id: accountId,
            name: accountById.get(accountId)?.name || "Unbekanntes Konto",
            color: accountById.get(accountId)?.color || "#456279",
            total: 0,
            yearTotal: 0,
            monthTotal: 0,
            averagePerMonth: 0,
          };
          const amount = Number(alloc.amount || 0) * factor;
          row.total += amount;
          if (isYear) row.yearTotal += amount;
          if (isMonth) row.monthTotal += amount;
          details.set(accountId, row);
          allocated += amount;
        }

        if (allocated < itemAmount) {
          const accountId = defaultFamilyAccount.id;
          const row = details.get(accountId) || {
            id: accountId,
            name: accountById.get(accountId)?.name || defaultFamilyAccount.name,
            color: accountById.get(accountId)?.color || defaultFamilyAccount.color,
            total: 0,
            yearTotal: 0,
            monthTotal: 0,
            averagePerMonth: 0,
          };
          const amount = itemAmount - allocated;
          row.total += amount;
          if (isYear) row.yearTotal += amount;
          if (isMonth) row.monthTotal += amount;
          details.set(accountId, row);
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
  }, [receipts, familyAccounts, itemAllocations]);

  const accountOptions = useMemo(() => {
    const next = [...familyAccounts];
    const hasFamily = next.some((x) => x.account_type === "family");
    if (!hasFamily) {
      next.unshift(defaultFamilyAccount);
    }
    return next;
  }, [familyAccounts]);

  const selectedUploadAccount = useMemo(() => {
    const account = accountOptions.find((account) => account.id === newReceiptAccountId) || defaultFamilyAccount;
    return {
      ...account,
      color: account.color || defaultFamilyAccount.color,
    };
  }, [accountOptions, newReceiptAccountId]);

  const primaryAccountByItemId = useMemo(() => {
    const map = new Map();

    for (const alloc of itemAllocations) {
      const amount = Number(alloc.amount || 0);
      const current = map.get(alloc.receipt_item_id);
      if (!current || amount > current.amount) {
        map.set(alloc.receipt_item_id, { accountId: alloc.account_id, amount });
      }
    }

    return map;
  }, [itemAllocations]);

  const hasSetup = isSupabaseConfigured && householdId;
  const isApproved = approvalStatus === "approved";
  const isEmailVerified = Boolean(verifiedEmail);
  const canUseApp = hasSetup && ((Boolean(session?.user) && isApproved) || isEmailVerified);
  const isAdmin = Boolean(accessRecord?.is_admin);
  const displayEmail = session?.user?.email || verifiedEmail || "";

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!authEmail) {
      window.localStorage.removeItem(AUTH_EMAIL_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(AUTH_EMAIL_STORAGE_KEY, String(authEmail || "").trim().toLowerCase());
  }, [authEmail]);

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
        setApprovalStatus("signed_out");
        setAccessRecord(null);
        setPendingUsers([]);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setError("");
      setSuccess("");

      if (nextSession?.user) {
        void loadUserAccess(nextSession.user);
      } else {
        setApprovalStatus("signed_out");
        setAccessRecord(null);
        setPendingUsers([]);
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
  }, [canUseApp]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || session?.user) return;
    if (typeof window === "undefined") return;
    const rememberedEmail = window.localStorage.getItem(VERIFIED_EMAIL_STORAGE_KEY);
    if (!rememberedEmail) return;

    setAuthEmail((prev) => prev || rememberedEmail);
    void verifyApprovedEmail(rememberedEmail, true);
  }, [session]);

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

    const value = String(authEmail || "").trim().toLowerCase();
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
        if (typeof window !== "undefined") {
          window.localStorage.setItem(MAGIC_LINK_COOLDOWN_UNTIL_STORAGE_KEY, String(until));
        }
        setError("E-Mail-Limit bei Supabase erreicht. Ohne Custom SMTP sind oft nur wenige Mails pro Stunde erlaubt. Bitte später erneut versuchen oder SMTP aktivieren.");
      } else {
        setError(rawMessage);
      }
      return;
    }

    const until = Date.now() + MAGIC_LINK_COOLDOWN_MS;
    setMagicLinkNow(Date.now());
    setMagicLinkCooldownUntil(until);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MAGIC_LINK_COOLDOWN_UNTIL_STORAGE_KEY, String(until));
    }

    const approved = await verifyApprovedEmail(value, true);

    if (approved) {
      setSuccess("Freigabe erkannt. Du kannst jetzt hier weiterarbeiten.");
      return;
    }

    setError("");
    setSuccess("Anmelde-Link wurde per E-Mail gesendet.");
  }

  async function verifyApprovedEmail(value, silent = false) {
    if (!supabase) return false;

    const email = String(value || authEmail || "").trim().toLowerCase();
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
    const bypassAlreadyUsed = typeof window !== "undefined" && window.localStorage.getItem(ONE_TIME_BYPASS_USED_STORAGE_KEY) === "1";

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
      if (typeof window !== "undefined") {
        window.localStorage.setItem(VERIFIED_EMAIL_STORAGE_KEY, email);
        window.localStorage.setItem(ONE_TIME_BYPASS_USED_STORAGE_KEY, "1");
      }
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
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(VERIFIED_EMAIL_STORAGE_KEY);
      }
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
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VERIFIED_EMAIL_STORAGE_KEY, email);
    }

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
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(VERIFIED_EMAIL_STORAGE_KEY);
    }
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
        setError(insertError.message);
        setApprovalStatus("pending");
        return;
      }

      row = created;
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

    const withAllColumns = "id, merchant, receipt_date, total_amount, currency, image_path, ai_status, created_at, receipt_items(id, description, quantity, amount, original_amount, currency, exchange_rate, category, is_ignored)";
    const withoutIgnored = "id, merchant, receipt_date, total_amount, currency, image_path, ai_status, created_at, receipt_items(id, description, quantity, amount, original_amount, currency, exchange_rate, category)";
    const withoutCurrencyColumns = "id, merchant, receipt_date, total_amount, currency, image_path, ai_status, created_at, receipt_items(id, description, quantity, amount, category)";

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

    setReceipts(data || []);
    if (!selectedReceipt && data?.length) {
      setSelectedReceipt(data[0].id);
    }
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
      .select("id, name, color, account_type, sort_order")
      .eq("household_id", householdId)
      .order("account_type", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (accountError) {
      setFamilyAccounts([]);
      setAccountCatalogReady(false);
      setAccountCatalogMessage(accountError.message || "Personenkonten-Tabelle ist noch nicht eingerichtet.");
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
          sortOrder: Number(account.sort_order || 100),
        };
        return acc;
      }, {})
    );
  }

  async function loadItemAllocations(itemIds) {
    if (!itemIds?.length) {
      setItemAllocations([]);
      return;
    }

    const { data, error: allocError } = await supabase
      .from("receipt_item_allocations")
      .select("receipt_item_id, account_id, amount")
      .in("receipt_item_id", itemIds);

    if (allocError) {
      setItemAllocations([]);
      return;
    }

    setItemAllocations(data || []);
  }

  async function setSingleItemAllocation(itemId, accountId, amount) {
    const { error: deleteError } = await supabase
      .from("receipt_item_allocations")
      .delete()
      .eq("receipt_item_id", itemId);

    if (deleteError) {
      setError(deleteError.message);
      return false;
    }

    const parsedAmount = Number(Number(amount || 0).toFixed(2));
    if (!accountId || accountId === defaultFamilyAccount.id || parsedAmount <= 0) {
      setItemAllocations((prev) => prev.filter((x) => x.receipt_item_id !== itemId));
      return true;
    }

    const { data, error: insertError } = await supabase
      .from("receipt_item_allocations")
      .insert({
        receipt_item_id: itemId,
        account_id: accountId,
        amount: parsedAmount,
      })
      .select("receipt_item_id, account_id, amount");

    if (insertError) {
      setError(insertError.message);
      return false;
    }

    setItemAllocations((prev) => {
      const filtered = prev.filter((x) => x.receipt_item_id !== itemId);
      return [...filtered, ...(data || [])];
    });

    return true;
  }

  async function assignItemToAccount(item, accountId) {
    const ok = await setSingleItemAllocation(item.id, accountId, Number(item.amount || 0));
    if (!ok) return;
    setSuccess("Personenkonto aktualisiert.");
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
      setError("Personenkonto braucht einen Namen.");
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
        sort_order: Number(draft.sortOrder || 100),
      })
      .eq("id", accountId)
      .eq("household_id", householdId);

    setBusy(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess("Personenkonto gespeichert.");
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

    setSuccess("Personenkonto gelöscht.");
    await loadFamilyAccounts();
    await loadItemAllocations(receipts.flatMap((r) => (r.receipt_items || []).map((i) => i.id)).filter(Boolean));
  }

  async function addFamilyAccount() {
    if (!newAccount.name.trim()) {
      setError("Bitte Name für das neue Personenkonto eingeben.");
      return;
    }

    setBusy(true);
    setError("");

    const { error: insertError } = await supabase.from("family_accounts").insert({
      household_id: householdId,
      name: newAccount.name.trim(),
      color: newAccount.color || "#18b6a3",
      account_type: newAccount.accountType || "person",
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
      sortOrder: 100,
    });
    setSuccess("Personenkonto hinzugefügt.");
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
    const rawCurrency = normalizeCurrencyCode(parsed.currency || "EUR");
    const exchangeRate = await getExchangeRateToEur(rawCurrency);
    const items = Array.isArray(parsed.items) ? parsed.items : [];
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
        category: inferCostGroupName(item.description, activeCostGroups()),
      };
    });

    const originalTotalAmount = roundMoney(parsed.totalAmount || 0);
    const convertedTotalAmount = roundMoney(originalTotalAmount * exchangeRate);
    const receiptUpdate = await supabase
      .from("receipts")
      .update({
        merchant: parsed.merchant || "Unbekannt",
        receipt_date: parsed.receiptDate || new Date().toISOString().slice(0, 10),
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
        const allocationRows = (insertItems.data || [])
          .map((row) => ({
            receipt_item_id: row.id,
            account_id: defaultAccountId,
            amount: Number(row.amount || 0),
          }));

        if (allocationRows.length) {
          const { error: allocationError } = await supabase.from("receipt_item_allocations").insert(allocationRows);
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

    const ext = selectedFile.name.split(".").pop()?.toLowerCase() || "jpg";
    const storagePath = `${householdId}/${crypto.randomUUID()}.${ext}`;

    const uploadResult = await supabase.storage
      .from("receipts")
      .upload(storagePath, selectedFile, { upsert: false, contentType: selectedFile.type });

    if (uploadResult.error) {
      setBusy(false);
      setError(uploadResult.error.message);
      return;
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
      setBusy(false);
      setError(initialReceipt.error.message);
      return;
    }

    const receiptId = initialReceipt.data.id;

    const result = await analyzeReceipt(receiptId, storagePath, { defaultAccountId: newReceiptAccountId });
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      await loadReceipts();
      return;
    }

    setSelectedFile(null);
    setBusy(false);
    setSuccess("Beleg wurde analysiert und ins Haushaltsbuch übernommen.");
    await loadReceipts();
    setSelectedReceipt(receiptId);
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

  async function addManualItem() {
    if (!selectedReceipt) return;

    const groups = activeCostGroups();
    const currency = normalizeCurrencyCode(manualDraft.currency || "EUR");
    const exchangeRate = await getExchangeRateToEur(currency);
    const originalAmount = roundMoney(manualDraft.amount || 0);
    const amount = roundMoney(originalAmount * exchangeRate);

    const row = {
      receipt_id: selectedReceipt,
      description: manualDraft.description || "Neue Position",
      quantity: Number(manualDraft.quantity || 1),
      original_amount: originalAmount,
      amount,
      currency,
      exchange_rate: exchangeRate,
      category: manualDraft.category || inferCostGroupName(manualDraft.description, groups),
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
        category: manualDraft.category || inferCostGroupName(manualDraft.description, groups),
      }, false)).select();
    }

    insertError = insertResponse.error;
    if (insertError) {
      setError(insertError.message);
      return;
    }

    const insertedItem = insertResponse.data?.[0];
    if (insertedItem?.id && manualDraft.accountId && manualDraft.accountId !== defaultFamilyAccount.id) {
      await setSingleItemAllocation(insertedItem.id, manualDraft.accountId, amount);
    }

    setManualDraft(emptyDraft);
    await recalculateReceiptTotal(selectedReceipt);
    await loadReceipts();
  }

  async function patchItem(itemId, patch) {
    const receiptId = receipts.find((receipt) => (receipt.receipt_items || []).some((item) => item.id === itemId))?.id;
    const { error: updateError } = await supabase
      .from("receipt_items")
      .update(patch)
      .eq("id", itemId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    if (receiptId) {
      await recalculateReceiptTotal(receiptId);
    }

    await loadReceipts();
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

    const currentAlloc = primaryAccountByItemId.get(item.id);
    if (currentAlloc?.accountId) {
      await setSingleItemAllocation(item.id, currentAlloc.accountId, eurAmount);
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

      const currentAlloc = primaryAccountByItemId.get(item.id);
      if (currentAlloc?.accountId) {
        await setSingleItemAllocation(item.id, currentAlloc.accountId, eurAmount);
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

    for (const item of items) {
      const category = inferCostGroupName(item.description, groups);
      const { error: updateError } = await supabase
        .from("receipt_items")
        .update({ category })
        .eq("id", item.id);

      if (updateError) {
        setBusy(false);
        setError(updateError.message);
        return;
      }
    }

    setBusy(false);
    setSuccess("Kostengruppen wurden automatisch zugeordnet.");
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

    // iOS blockiert window.open nach async-Aufrufen — Link-Element verwenden
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    // PDFs als Download anbieten falls Browser kein In-App-Preview zeigt
    if (receipt.image_path.toLowerCase().endsWith(".pdf")) {
      a.download = receipt.merchant
        ? `${receipt.merchant}.pdf`
        : "beleg.pdf";
    }
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  const currentReceipt = receipts.find((r) => r.id === selectedReceipt) || null;

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

  if (!session?.user && !isEmailVerified) {
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
          <h2>Login per E-Mail-Link</h2>
          <p className="hint">Du erhältst einen sicheren Anmelde-Link per E-Mail.</p>
          <input
            type="email"
            placeholder="name@beispiel.de"
            value={authEmail}
            onChange={(e) => setAuthEmail(e.target.value)}
          />
          <div className="receipt-actions">
            <button className="btn" disabled={busy || !hasSetup || magicLinkBlocked} onClick={sendMagicLink}>
              {busy ? "Sende..." : magicLinkBlocked ? `Warte ${magicLinkCooldownSeconds}s` : "Anmelde-Link senden"}
            </button>
            <button className="btn secondary" disabled={busy || !hasSetup} onClick={checkApprovedEmail}>
              {busy ? "Prüfe..." : "Freigegebene E-Mail prüfen"}
            </button>
          </div>
          {!hasSetup && (
            <p className="hint error">
              Bitte zuerst .env mit Supabase-Werten konfigurieren.
            </p>
          )}
          <p className="hint">
            Wenn der Magic Link im anderen Browser aufgeht, prüfe die freigegebene E-Mail hier in diesem Fenster noch einmal.
          </p>
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
          <p>Belege scannen, KI auswerten, Haushaltsbuch automatisch pflegen.</p>
        </div>
        <div className="top-right-badges">
          <span className="version-badge">{APP_VERSION}</span>
          <button className="btn secondary mini-btn" onClick={signOut}>Abmelden</button>
        </div>
      </header>

      {!hasSetup && (
        <section className="panel setup-panel">
          <h2>Konfiguration fehlt</h2>
          <p className="hint error">
            Bitte in .env die Werte für VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY und
            VITE_DEFAULT_HOUSEHOLD_ID setzen.
          </p>
        </section>
      )}

      {isAdmin && (
        <section className="panel setup-panel" style={{ display: 'none' }}>
          <h2>Benutzerfreigaben</h2>
          <p className="hint">Neue Benutzer erscheinen hier automatisch nach ihrem ersten Login per E-Mail-Link und können dann freigegeben werden.</p>
          {!pendingUsers.length && <p className="hint">Keine offenen Freigaben.</p>}
          {!!pendingUsers.length && (
            <div className="receipt-list">
              {pendingUsers.map((entry) => (
                <div className="receipt-button" key={entry.user_id}>
                  <div>
                    <strong>{entry.email || entry.user_id}</strong>
                    <small>{formatReceiptDateTime({ created_at: entry.created_at })}</small>
                  </div>
                  <button className="btn secondary mini-btn" onClick={() => approveUser(entry.user_id)}>
                    Freigeben
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="workflow-stack">
        <article className="panel">
          <h2>1. Personenkonto auswählen</h2>
          <div className="upload-account-row">
            <div className="color-select-wrapper" style={buildColorInputStyle(selectedUploadAccount?.color)}>
              <select
                value={newReceiptAccountId}
                onChange={(e) => setNewReceiptAccountId(e.target.value)}
              >
                {accountOptions.map((account) => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
              </select>
            </div>
          </div>
        </article>

        <article className="panel">
          <h2>2. Beleg auswählen/Foto aufnehmen</h2>
          <div className="file-picker">
            <input
              id="receipt-file"
              className="file-input-hidden"
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
            />
            <label htmlFor="receipt-file" className="btn secondary file-trigger">
              Beleg auswählen/Foto aufnehmen
            </label>
            <p className="hint file-name">
              {selectedFile ? `Ausgewählt: ${selectedFile.name}` : "Noch keine Datei ausgewählt"}
            </p>
          </div>
          <button className="btn" disabled={!selectedFile || busy || !hasSetup} onClick={uploadAndExtract}>
            {busy ? "Analysiere..." : "Beleg per KI auswerten"}
          </button>
        </article>
      </section>

      {showCostGroupModal && (
        <div className="modal-backdrop" onClick={() => setShowCostGroupModal(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {costGroupModalView === "summary" && "Kostenübersicht"}
                {costGroupModalView === "groupDetails" && "Detaillierte Übersicht nach Kostengruppen"}
                {costGroupModalView === "accountDetails" && "Detaillierte Übersicht nach Personenkonten"}
                {costGroupModalView === "edit" && "Kostengruppen bearbeiten"}
                {costGroupModalView === "accounts" && "Personenkonten bearbeiten"}
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
                  <h3>Kostenübersicht nach Personenkonten</h3>
                  {!accountTotals.length && <p className="hint">Noch keine Kosten vorhanden.</p>}
                  {!!accountTotals.length && (
                    <div className="cost-group-summary-list">
                      {accountTotals.map((row) => (
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
                  <button className="btn secondary" onClick={() => setCostGroupModalView("accounts")}>Personenkonten bearbeiten</button>
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
                      <button className="btn secondary" disabled={busy} onClick={() => saveCostGroup(group.id)}>Speichern</button>
                      <button className="btn secondary" disabled={busy} onClick={() => deleteCostGroup(group.id)}>Löschen</button>
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
                    <button className="btn" disabled={busy} onClick={addCostGroup}>Hinzufügen</button>
                    <span className="table-action-placeholder" aria-hidden="true" />
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
                    Personenkonten-Tabelle noch nicht verfügbar: {accountCatalogMessage}
                  </p>
                )}

                {accountCatalogReady && !familyAccounts.length && (
                  <p className="hint">Noch keine Personenkonten angelegt. Füge unten eines hinzu.</p>
                )}

                {accountCatalogReady && (
                  <div className="account-edit-head">
                    <span>Name</span>
                    <span>Farbe</span>
                    <span>Typ</span>
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
                      <input
                        type="number"
                        value={draft.sortOrder}
                        onChange={(e) => updateAccountDraft(account.id, "sortOrder", e.target.value)}
                        placeholder="Sortierung"
                      />
                      <button className="btn secondary" disabled={busy} onClick={() => saveFamilyAccount(account.id)}>Speichern</button>
                      <button className="btn secondary" disabled={busy || account.account_type === "family"} onClick={() => deleteFamilyAccount(account)}>
                        Löschen
                      </button>
                    </div>
                  );
                })}

                {accountCatalogReady && (
                  <div className="account-new-row">
                    <input
                      value={newAccount.name}
                      onChange={(e) => setNewAccount((s) => ({ ...s, name: e.target.value }))}
                      placeholder="Neues Personenkonto"
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
                    <input
                      type="number"
                      value={newAccount.sortOrder}
                      onChange={(e) => setNewAccount((s) => ({ ...s, sortOrder: e.target.value }))}
                      placeholder="Sortierung"
                    />
                    <button className="btn" disabled={busy} onClick={addFamilyAccount}>Hinzufügen</button>
                    <span className="table-action-placeholder" aria-hidden="true" />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {error && <p className="hint error">{error}</p>}
      {success && <p className="hint success">{success}</p>}

      <section className="grid two workflow-stack">
        <article className="panel">
          <h2>3. Belege</h2>
          <div className="receipt-list">
            {receipts.map((receipt) => (
              <button
                key={receipt.id}
                className={`receipt-button ${receipt.id === selectedReceipt ? "active" : ""}`}
                onClick={() => setSelectedReceipt(receipt.id)}
              >
                <div>
                  <strong>{receipt.merchant || "Unbekannt"}</strong>
                  <small>
                    {formatReceiptDateTime(receipt)}{receipt.currency && receipt.currency !== "EUR" ? ` · ${receipt.currency}` : ""}
                  </small>
                </div>
                <div className="receipt-amounts">
                  <span className="receipt-amount-original">{formatReceiptOriginalTotal(receipt)}</span>
                  <span className="receipt-amount-eur">{euro.format(getReceiptEurTotal(receipt))}</span>
                </div>
              </button>
            ))}
            {!receipts.length && !busy && <p className="hint">Noch keine Belege vorhanden.</p>}
          </div>
          {!receiptItemCurrencyColumnsReady && (
            <p className="hint warning">
              Hinweis: Diese Datenbank läuft noch im alten EUR-Modus. Fremdwährung wird erst nach der Migration vollständig angezeigt.
            </p>
          )}
        </article>

        <article className="panel">
          <h2>4. Positionen</h2>
          {!currentReceipt && <p className="hint">Bitte links einen Beleg auswählen.</p>}
          {currentReceipt && (
            <>
              <div className="receipt-actions">
                <button
                  className="btn secondary"
                  disabled={busy || !currentReceipt.image_path || !canUseApp}
                  onClick={() => retryAnalysis(currentReceipt)}
                >
                  Erneut analysieren
                </button>
                <button
                  className="btn secondary"
                  disabled={previewBusy || !currentReceipt.image_path}
                  onClick={() => openReceiptPreview(currentReceipt)}
                >
                  {previewBusy ? "Öffne..." : "Beleg ansehen"}
                </button>
                <button
                  className="btn secondary"
                  disabled={busy || !currentReceipt.receipt_items?.length}
                  onClick={() => autoAssignCategories(currentReceipt)}
                >
                  Kostengruppen zuordnen
                </button>
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => deleteReceipt(currentReceipt)}
                >
                  Beleg löschen
                </button>
              </div>

              {!receiptItemCurrencyColumnsReady && (
                <p className="hint warning">
                  Währungsänderungen sind erst nach der Migration verfügbar. Aktuell werden Positionen als EUR geführt.
                </p>
              )}

              <div className="item-list">
                <div className="item-head">
                  <span>Beschreibung</span>
                  <span>Betrag</span>
                  <span>Kostengruppe</span>
                  <span>Personenkonto</span>
                  {receiptItemIgnoreColumnReady && <span>Aktion</span>}
                </div>
                {(currentReceipt.receipt_items || []).map((item) => (
                  <div className="item-row" key={item.id}>
                    <input
                      className="description-input"
                      value={item.description || ""}
                      title={item.description || ""}
                      onChange={(e) => patchItem(item.id, { description: e.target.value })}
                    />
                    <div className="amount-cell">
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
                      />
                      <select
                        className="currency-input"
                        value={normalizeCurrencyCode(item.currency || "EUR")}
                        onChange={(e) => updateItemCurrency(item, e.target.value)}
                        disabled={!receiptItemCurrencyColumnsReady}
                      >
                        {CURRENCY_OPTIONS.map((currency) => (
                          <option key={currency} value={currency}>{CURRENCY_SYMBOL[currency] ?? currency}</option>
                        ))}
                      </select>
                      {!receiptItemCurrencyColumnsReady && <span className="fallback-badge">€</span>}
                    </div>
                    <select
                      className="category-input cost-group-input"
                      value={item.category || ""}
                      onChange={(e) => patchItem(item.id, { category: e.target.value || null })}
                    >
                      <option value="">Keine Kostengruppe</option>
                      {activeCostGroups().map((group) => (
                        <option key={group.id || group.name} value={group.name}>{group.name}</option>
                      ))}
                    </select>
                    <select
                      className="category-input account-input"
                      value={primaryAccountByItemId.get(item.id)?.accountId || defaultFamilyAccount.id}
                      onChange={(e) => assignItemToAccount(item, e.target.value)}
                      disabled={!accountCatalogReady}
                    >
                      {accountOptions.map((account) => (
                        <option key={account.id} value={account.id}>{account.name}</option>
                      ))}
                    </select>
                    <button
                      className={`btn mini-btn ${item.is_ignored ? 'secondary' : ''}`}
                      title={item.is_ignored ? 'Diese Position wird nicht in der Kostenübersicht berücksichtigt' : 'Position ignorieren'}
                      onClick={() => toggleIgnoreItem(item)}
                      disabled={busy || !receiptItemIgnoreColumnReady}
                      style={!receiptItemIgnoreColumnReady ? { display: 'none' } : undefined}
                    >
                      {item.is_ignored ? '✓ Ignoriert' : 'Ignorieren'}
                    </button>
                  </div>
                ))}
              </div>

              {!accountCatalogReady && (
                <p className="hint error">
                  Personenkonten-Tabelle noch nicht verfügbar: {accountCatalogMessage}
                </p>
              )}

              <div className="manual-box">
                <h3>Position manuell hinzufügen</h3>
                <div className="item-row">
                  <input
                    className="description-input"
                    placeholder="Beschreibung"
                    value={manualDraft.description}
                    onChange={(e) => setManualDraft((s) => ({ ...s, description: e.target.value }))}
                  />
                  <div className="amount-cell">
                    <input
                      className="amount-input"
                      type="number"
                      step="0.01"
                      placeholder="Betrag"
                      value={manualDraft.amount}
                      onChange={(e) => setManualDraft((s) => ({ ...s, amount: e.target.value }))}
                    />
                    <select
                      className="currency-input"
                      value={manualDraft.currency || "EUR"}
                      onChange={(e) => setManualDraft((s) => ({ ...s, currency: e.target.value }))}
                      disabled={!receiptItemCurrencyColumnsReady}
                    >
                      {CURRENCY_OPTIONS.map((currency) => (
                        <option key={currency} value={currency}>{CURRENCY_SYMBOL[currency] ?? currency}</option>
                      ))}
                    </select>
                  </div>
                  <select
                    className="category-input cost-group-input"
                    value={manualDraft.category || ""}
                    onChange={(e) => setManualDraft((s) => ({ ...s, category: e.target.value }))}
                  >
                    <option value="">Keine Kostengruppe</option>
                    {activeCostGroups().map((group) => (
                      <option key={group.id || group.name} value={group.name}>{group.name}</option>
                    ))}
                  </select>
                  <select
                    className="category-input account-input"
                    value={manualDraft.accountId || defaultFamilyAccount.id}
                    onChange={(e) => setManualDraft((s) => ({ ...s, accountId: e.target.value }))}
                    disabled={!accountCatalogReady}
                  >
                    {accountOptions.map((account) => (
                      <option key={account.id} value={account.id}>{account.name}</option>
                    ))}
                  </select>
                </div>
                <button className="btn secondary" onClick={addManualItem}>Hinzufügen</button>
              </div>
            </>
          )}
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
          <h2>5. Kostenübersicht</h2>
          <div className="totals">
            <div className="total-card main">
              <span>Haushaltsbuch</span>
              <strong>{euro.format(mainAccountTotal)}</strong>
            </div>
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
            <h3>Kostenübersicht nach Personenkonten</h3>
            {!accountTotals.length && <p className="hint">Noch keine Kosten vorhanden.</p>}
            {!!accountTotals.length && (
              <div className="cost-group-summary-list">
                {accountTotals.map((row) => (
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
        </article>
      </section>
    </div>
  );
}

export default App;
