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
const APP_VERSION = "v0.4.0";
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
  if (receipt?.receipt_date) {
    const baseTime = `${receipt.receipt_date}T`;
    const aiTime = receipt?.receipt_time || receipt?.ai_raw_json?.receiptTime || null;
    if (aiTime) {
      return dateTimeDE.format(new Date(`${baseTime}${aiTime}:00`));
    }
    return dateDE.format(new Date(receipt.receipt_date));
  }

  if (receipt?.created_at) {
    return dateTimeDE.format(new Date(receipt.created_at));
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
  const [selectedCostCenterForReceipt, setSelectedCostCenterForReceipt] = useState(null);
  const [amountDrafts, setAmountDrafts] = useState({});
  const [showCostGroupModal, setShowCostGroupModal] = useState(false);
  const [costGroupModalView, setCostGroupModalView] = useState("summary");
  const [showCostCenterModal, setShowCostCenterModal] = useState(false);
  const [costCenterDrafts, setCostCenterDrafts] = useState({});
  const [newCostCenter, setNewCostCenter] = useState({ name: "", color: "#18b6a3", sort_order: 100 });
  const [newReceiptCostCenterId, setNewReceiptCostCenterId] = useState(null); // Kostenträger (wer trägt die Kosten)
  const [newPaymentAccountId, setNewPaymentAccountId] = useState(null); // Zahlungskonto für neuen Beleg
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
  const [hideSettlementReceipts, setHideSettlementReceipts] = useState(true);
  const [receiptSearchText, setReceiptSearchText] = useState("");
  const [receiptMonthFilter, setReceiptMonthFilter] = useState("current");
  const exchangeRateCache = useRef(new Map());
  const repairedItemIds = useRef(new Set());

  const magicLinkCooldownMsLeft = Math.max(0, Number(magicLinkCooldownUntil || 0) - magicLinkNow);
  const magicLinkCooldownSeconds = Math.ceil(magicLinkCooldownMsLeft / 1000);
  const magicLinkBlocked = magicLinkCooldownSeconds > 0;

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
      .sort((a, b) => {
        const accountA = accountById.get(a.id) || (a.id === defaultFamilyAccount.id ? defaultFamilyAccount : null);
        const accountB = accountById.get(b.id) || (b.id === defaultFamilyAccount.id ? defaultFamilyAccount : null);
        const sortA = accountA?.sort_order ?? 999;
        const sortB = accountB?.sort_order ?? 999;
        return sortA - sortB;
      });
  }, [receipts, familyAccounts, itemAllocations]);

  // Totals by Cost Centers (Kostenträger) - new system using assigned_cost_center_id
  const costCenterTotals = useMemo(() => {
    const costCenterById = new Map(costCenters.map((cc) => [cc.id, cc]));
    const totals = new Map();

    for (const receipt of receipts) {
      for (const item of receipt.receipt_items || []) {
        if (item.is_ignored === true) continue;
        const itemAmount = Number(item.amount || 0);
        
        // Use assigned_cost_center_id if available
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
  }, [receipts, costCenters]);

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

  // Cost Centers (Kostenträger - wer trägt die Kosten?)
  const costCenterOptions = useMemo(() => {
    let next = [...costCenters];
    if (!next.length && costCenters.length === 0) {
      // Fallback: if costCenters not loaded, use empty
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

  const selectedUploadCostCenter = useMemo(() => {
    if (!newReceiptCostCenterId) return null;
    return costCenterOptions.find((cc) => cc.id === newReceiptCostCenterId) || null;
  }, [costCenterOptions, newReceiptCostCenterId]);

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
    loadCostCenters();
  }, [canUseApp]);

  useEffect(() => {
    // Set cost center selection when receipt changes
    if (selectedReceipt && receipts?.length > 0) {
      const receipt = receipts.find((r) => r.id === selectedReceipt);
      if (receipt?.receipt_items?.length > 0) {
        const firstItemCostCenter = receipt.receipt_items[0]?.assigned_cost_center_id;
        setSelectedCostCenterForReceipt(firstItemCostCenter || null);
      } else {
        setSelectedCostCenterForReceipt(null);
      }
    } else {
      setSelectedCostCenterForReceipt(null);
    }
  }, [selectedReceipt, receipts]);

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
      console.log(`  Receipt ${i} (${receipt.merchant}, ${receipt.payment_account_id.slice(0, 8)}...): ${receipt.receipt_items?.length || 0} items`);
      receipt.receipt_items?.forEach((item, j) => {
        console.log(`    Item ${j}: ${item.id.slice(0, 8)}... = ${item.description} (${item.amount} ${item.currency})`);
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

    const { data, error: allocError } = await supabase
      .from("receipt_item_allocations")
      .select("receipt_item_id, account_id, amount")
      .in("receipt_item_id", itemIds);

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

  async function assignItemToCostCenter(item, costCenterId) {
    try {
      const patchData = costCenterId 
        ? { assigned_cost_center_id: costCenterId }
        : { assigned_cost_center_id: null };
      
      console.log("Assigning cost center:", { itemId: item.id, costCenterId, patchData });
      
      await patchItem(item.id, patchData);
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
    const ok = await setSingleItemAllocation(item.id, accountId, Number(item.amount || 0));
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

    // Note: For now, we don't pass defaultCostCenterId to OCR analysis
    const result = await analyzeReceipt(receiptId, storagePath);
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      await loadReceipts();
      return;
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
    if (insertedItem?.id && manualDraft.accountId) {
      await assignItemToCostCenter(insertedItem, manualDraft.accountId);
    }

    setManualDraft(emptyDraft);
    await recalculateReceiptTotal(selectedReceipt);
    await loadReceipts();
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
      return;
    }

    if (!data || data.length === 0) {
      setError("Keine Zeilen aktualisiert - möglicherweise existiert das Item nicht");
      console.warn("patchItem: No rows affected", { itemId, patch });
      return;
    }

    if (receiptId) {
      await recalculateReceiptTotal(receiptId);
    }

    await loadReceipts();
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

    // First check merchant name, then fall back to item descriptions
    const merchantCategory = inferCostGroupName(receipt.merchant || "", groups);
    console.log(`[autoAssignCategories] Merchant: "${receipt.merchant}" → Category: "${merchantCategory}"`);

    for (const item of items) {
      const category = merchantCategory || inferCostGroupName(item.description, groups);
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
          <p>Belege scannen, KI-Auswertung, Haushaltsbuch</p>
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
                Nach der Setup können Sie Kostenträger auswählen und speichern.
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

      {!selectedReceipt && (
        <article className="panel">
          {/* Section 1 */}
          <div className="receipt-form-section">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <h2 style={{ margin: 0 }}>1. Kosten für (Kostenträger)</h2>
              <button className="btn secondary" onClick={() => setShowCostCenterModal(true)}>
                Kostenträger bearbeiten
              </button>
            </div>
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
          </div>

          {/* Section 2 */}
          <div className="receipt-form-section">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <h2 style={{ margin: 0 }}>2. Zahlung von (Zahlungskonto)</h2>
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
          </div>

          {/* Section 3 */}
          <div>
            <h2>3. Beleg erfassen</h2>
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
            <button className="btn" disabled={!selectedFile || busy || !hasSetup} onClick={uploadAndExtract}>
              {busy ? "Analysiere..." : "Beleg per KI auswerten"}
            </button>
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
                    Kostenträger-Tabelle noch nicht verfügbar: {accountCatalogMessage}
                  </p>
                )}

                {accountCatalogReady && !familyAccounts.length && (
                  <p className="hint">Noch keine Kostenträger angelegt. Füge unten eines hinzu.</p>
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
                        type="number"
                        value={draft.sort_order}
                        onChange={(e) => updateCostCenterDraft(center.id, "sort_order", e.target.value)}
                        placeholder="Sortierung"
                      />
                      <button className="btn secondary" disabled={busy} onClick={() => saveCostCenter(center.id)}>Speichern</button>
                      <button className="btn secondary" disabled={busy} onClick={() => deleteCostCenter(center.id)}>Löschen</button>
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
                    type="number"
                    value={newCostCenter.sort_order}
                    onChange={(e) => setNewCostCenter((s) => ({ ...s, sort_order: e.target.value }))}
                    placeholder="Sortierung"
                  />
                  <button className="btn" disabled={busy} onClick={addNewCostCenter}>Hinzufügen</button>
                  <span className="table-action-placeholder" aria-hidden="true" />
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

      <section className="grid two workflow-stack">
        <article className="panel">
          <div className="section-header-with-button">
            <h2 style={{ margin: 0 }}>Belege</h2>
            <button
              className="btn secondary"
              onClick={() => setSelectedReceipt(null)}
            >
              Neuer Beleg
            </button>
          </div>
          
          {/* Receipt Filters */}
          <div style={{ marginTop: "12px", marginBottom: "12px", paddingBottom: "8px", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <input
                type="text"
                placeholder="Beleg suchen..."
                value={receiptSearchText}
                onChange={(e) => setReceiptSearchText(e.target.value)}
                style={{ width: "100%", padding: "6px 10px", border: "1px solid #ccc", borderRadius: "4px" }}
              />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <select
                  value={receiptMonthFilter}
                  onChange={(e) => setReceiptMonthFilter(e.target.value)}
                  style={{ padding: "4px 8px", border: "1px solid #ccc", borderRadius: "4px", fontSize: "0.9rem", height: "32px" }}
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
          
          {currentReceipt && (
            <div className="receipt-actions" style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "4px", marginTop: "-4px" }}>
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
                style={{ gridColumn: "span 2" }}
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
              <div className={`color-select-wrapper ${!currentReceipt.payment_account_id ? 'missing-required' : ''}`} style={{ gridColumn: "span 3", ...(!currentReceipt.payment_account_id ? { border: "2px solid rgba(0,0,0,0.2)", borderRadius: "12px", backgroundColor: "transparent", color: "#10243e" } : buildColorInputStyle((paymentAccountOptions.find((a) => a.id === currentReceipt.payment_account_id) || {}).color)) }}>
                <select
                  value={currentReceipt.payment_account_id || ""}
                  onChange={(e) => patchReceipt(currentReceipt.id, { payment_account_id: e.target.value || null })}
                  disabled={busy}
                  title="Zahlungskonto"
                >
                  <option value="">-- Zahlungskonto --</option>
                  {paymentAccountOptions.map((account) => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
              </div>
              <div className={`color-select-wrapper ${!selectedCostCenterForReceipt ? 'missing-required' : ''}`} style={{ gridColumn: "span 3", ...(!selectedCostCenterForReceipt ? { border: "2px solid rgba(0,0,0,0.2)", borderRadius: "12px", backgroundColor: "transparent", color: "#10243e" } : buildColorInputStyle((costCenterOptions.find((cc) => cc.id === selectedCostCenterForReceipt) || {}).color)) }}>
                <select
                  value={selectedCostCenterForReceipt || ""}
                  onChange={(e) => {
                    setSelectedCostCenterForReceipt(e.target.value || null);
                    if (e.target.value) {
                      changeCostCenterForAllItems(e.target.value);
                    }
                  }}
                  disabled={busy}
                  title="Kostenträger"
                >
                  <option value="">-- Kostenträger --</option>
                  {costCenterOptions.map((costCenter) => (
                    <option key={costCenter.id} value={costCenter.id}>{costCenter.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <div className="receipt-list">
            {filteredReceipts.map((receipt) => {
              const paymentAccountColor = (paymentAccountOptions.find((a) => a.id === receipt.payment_account_id) || {}).color;
              const firstItemCostCenterId = receipt.receipt_items?.[0]?.assigned_cost_center_id;
              const costCenterColor = firstItemCostCenterId ? (costCenters.find((cc) => cc.id === firstItemCostCenterId) || {}).color : null;
              
              return (
              <button
                key={receipt.id}
                className={`receipt-button ${receipt.id === selectedReceipt ? "active" : ""}`}
                onClick={() => setSelectedReceipt(receipt.id)}
                style={receipt.payment_account_id ? buildColorInputStyle(paymentAccountColor) : {}}
              >
                <div>
                  <strong>
                    {receipt.merchant || "Unbekannt"}
                    {receipt.image_path?.toLowerCase().endsWith(".pdf") && <span className="badge-pdf">PDF</span>}
                  </strong>
                  <small>
                    {formatReceiptDateTime(receipt)}{receipt.currency && receipt.currency !== "EUR" ? ` · ${receipt.currency}` : ""}
                  </small>
                  {receipt.id !== selectedReceipt && (
                    <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                      {paymentAccountColor && (
                        <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: paymentAccountColor, display: "inline-block" }} title="Zahlungskonto" />
                      )}
                      {costCenterColor && (
                        <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: costCenterColor, display: "inline-block" }} title="Kostenträger" />
                      )}
                    </div>
                  )}
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
        </article>

        <article className="panel">
          <div className="section-header-with-button">
            <h2 style={{ margin: 0 }}>Positionen Beleg</h2>
            <button
              className="btn secondary"
              disabled={busy || !currentReceipt?.receipt_items?.length}
              onClick={() => autoAssignCategories(currentReceipt)}
              style={{ padding: "6px 8px", fontSize: "0.85rem" }}
            >
              Kostengruppen zuordnen
            </button>
          </div>
          
          {currentReceipt && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "12px", alignItems: "center", marginBottom: "12px" }}>
              <div className="receipt-info" style={{ margin: 0 }}>
                <strong>{currentReceipt.merchant || "Unbekannt"}</strong>
                <small>{formatReceiptDateTime(currentReceipt)}</small>
              </div>
              <button
                className="btn secondary"
                disabled={busy || !currentReceipt?.receipt_items?.length}
                onClick={() => transferCostCenterToAll(currentReceipt)}
                title="Kostenträger der ersten Position auf alle übertragen"
              >
                Kostenträg. übernehm.
              </button>
            </div>
          )}

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
                  <div key={item.id} className="receipt-item" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px", paddingBottom: "8px", borderBottom: "1px solid rgba(0,0,0,0.05)", minWidth: 0 }}>
                    {/* Left column: Description and Amount */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
                      {/* Row 1: Description with delete button */}
                      <div style={{ display: "flex", gap: "4px", alignItems: "flex-start", minWidth: 0, height: "40px" }}>
                        <input
                          className="description-input"
                          value={item.description || ""}
                          title={item.description || ""}
                          onChange={(e) => patchItem(item.id, { description: e.target.value })}
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
                          style={{ width: "32px", minWidth: 0, height: "100%", flexShrink: 0 }}
                        >
                          {CURRENCY_OPTIONS.map((currency) => (
                            <option key={currency} value={currency}>{CURRENCY_SYMBOL[currency] ?? currency}</option>
                          ))}
                        </select>
                        {!receiptItemCurrencyColumnsReady && <span className="fallback-badge">€</span>}
                      </div>
                    </div>
                    
                    {/* Right column: Cost Group and Cost Center */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
                      {/* Row 1: Cost Group */}
                      <div className={`color-select-wrapper ${!item.category ? 'missing-required' : ''}`} style={!item.category ? { border: "2px solid rgba(0,0,0,0.2)", borderRadius: "12px", backgroundColor: "transparent", color: "#10243e", height: "40px", minWidth: 0, display: "flex", alignItems: "center" } : {...buildColorInputStyle(
                        activeCostGroups().find(g => g.name === item.category)?.color
                      ), height: "40px", minWidth: 0, display: "flex", alignItems: "center"}}>
                        <select
                          className="category-input cost-group-input"
                          value={item.category || ""}
                          onChange={(e) => patchItem(item.id, { category: e.target.value || null })}
                        >
                          <option value="">- Kostengruppe -</option>
                          {activeCostGroups().map((group) => (
                            <option key={group.id || group.name} value={group.name}>{group.name}</option>
                          ))}
                        </select>
                      </div>
                      
                      {/* Row 2: Cost Center */}
                      <div className={`color-select-wrapper ${!assignedCostCenterByItemId.get(item.id) ? 'missing-required' : ''}`} style={!assignedCostCenterByItemId.get(item.id) ? { border: "2px solid rgba(0,0,0,0.2)", borderRadius: "12px", backgroundColor: "transparent", color: "#10243e", height: "40px", minWidth: 0, display: "flex", alignItems: "center" } : {...buildColorInputStyle(
                        costCenterOptions.find(cc => cc.id === assignedCostCenterByItemId.get(item.id))?.color
                      ), height: "40px", minWidth: 0, display: "flex", alignItems: "center"}}>
                        <select
                          className={`category-input account-input`}
                          value={assignedCostCenterByItemId.get(item.id) || ""}
                          onChange={(e) => assignItemToCostCenter(item, e.target.value || null)}
                          disabled={!costCenterOptions.length}
                          title="Kostenträger"
                        >
                          <option value="">- Kostenträger -</option>
                          {costCenterOptions.map((costCenter) => (
                            <option key={costCenter.id} value={costCenter.id}>{costCenter.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {!accountCatalogReady && (
                <p className="hint error">
                  Kostenträger-Tabelle noch nicht verfügbar: {accountCatalogMessage}
                </p>
              )}

              <div className="manual-box">
                <h3>Position manuell hinzufügen</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px", paddingBottom: "8px", borderBottom: "1px solid rgba(0,0,0,0.05)", minWidth: 0 }}>
                  {/* Left column */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1, minWidth: 0 }}>
                    {/* Row 1: Description */}
                    <input
                      className="description-input"
                      placeholder="Beschreibung"
                      value={manualDraft.description}
                      onChange={(e) => setManualDraft((s) => ({ ...s, description: e.target.value }))}
                      style={{ minHeight: "32px", flex: 1, minWidth: 0 }}
                    />
                    
                    {/* Row 2: Amount with currency */}
                    <div className="amount-cell" style={{ display: "flex", gap: "4px", minHeight: "32px", flex: 1, minWidth: 0 }}>
                      <input
                        className="amount-input"
                        type="number"
                        step="0.01"
                        placeholder="Betrag"
                        value={manualDraft.amount}
                        onChange={(e) => setManualDraft((s) => ({ ...s, amount: e.target.value }))}
                        style={{ width: "100px", minWidth: 0 }}
                      />
                      <select
                        className="currency-input"
                        value={manualDraft.currency || "EUR"}
                        onChange={(e) => setManualDraft((s) => ({ ...s, currency: e.target.value }))}
                        disabled={!receiptItemCurrencyColumnsReady}
                        style={{ width: "70px", minWidth: 0 }}
                      >
                        {CURRENCY_OPTIONS.map((currency) => (
                          <option key={currency} value={currency}>{CURRENCY_SYMBOL[currency] ?? currency}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  
                  {/* Right column */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1, minWidth: 0 }}>
                    {/* Row 1: Cost Group */}
                    <div className={`color-select-wrapper ${!manualDraft.category && manualDraft.description ? 'missing-required' : ''}`} style={!manualDraft.category && manualDraft.description ? { border: "2px solid rgba(0,0,0,0.2)", borderRadius: "12px", backgroundColor: "transparent", color: "#10243e", minHeight: "32px" } : (!manualDraft.category ? { border: "none", borderRadius: "12px", backgroundColor: "transparent", color: "#10243e", minHeight: "32px" } : {...buildColorInputStyle(activeCostGroups().find(g => g.name === manualDraft.category)?.color), minHeight: "32px"})}>
                      <select
                        className="category-input cost-group-input"
                        value={manualDraft.category || ""}
                        onChange={(e) => setManualDraft((s) => ({ ...s, category: e.target.value }))}
                      >
                        <option value="">- Kostengruppe -</option>
                        {activeCostGroups().map((group) => (
                          <option key={group.id || group.name} value={group.name}>{group.name}</option>
                        ))}
                      </select>
                    </div>
                    
                    {/* Row 2: Cost Center */}
                    <div className={`color-select-wrapper ${!manualDraft.accountId && manualDraft.description ? 'missing-required' : ''}`} style={!manualDraft.accountId && manualDraft.description ? { border: "2px solid rgba(0,0,0,0.2)", borderRadius: "12px", backgroundColor: "transparent", color: "#10243e", minHeight: "32px" } : (!manualDraft.accountId ? { border: "none", borderRadius: "12px", backgroundColor: "transparent", color: "#10243e", minHeight: "32px" } : {...buildColorInputStyle(costCenterOptions.find(cc => cc.id === manualDraft.accountId)?.color), minHeight: "32px"})}>
                      <select
                        className="category-input account-input"
                        value={manualDraft.accountId || ""}
                        onChange={(e) => setManualDraft((s) => ({ ...s, accountId: e.target.value }))}
                        disabled={!accountCatalogReady || !costCenterOptions.length}
                        title="Kostenträger"
                      >
                        <option value="">- Kostenträger -</option>
                        {costCenterOptions.map((costCenter) => (
                          <option key={costCenter.id} value={costCenter.id}>{costCenter.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                <button className="btn secondary" onClick={addManualItem} style={{ marginBottom: "16px" }}>Hinzufügen</button>
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h2 style={{ margin: 0 }}>Haushaltsbuch</h2>
            <div style={{ display: "flex", gap: "8px" }}>
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
          </div>
          <div className="totals">
            <div className="total-card main">
              <span>Gesamtausgaben:</span>
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
        </article>

        <article className="panel">
          <h2>Verrechnung</h2>
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
              // If total_amount is 0/null, calculate from items instead
              for (const receipt of receipts) {
                const accountId = receipt.payment_account_id || defaultFamilyAccount.id;
                let amount = receipt.total_amount || 0;
                if (amount === 0) {
                  // Fallback: sum the items
                  amount = (receipt.receipt_items || []).reduce((sum, item) => {
                    if (item.is_ignored === true) return sum;
                    return sum + Number(item.amount || 0);
                  }, 0);
                }
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
                    <p style={{ color: "red", fontSize: "0.9em", marginTop: "8px", padding: "8px", backgroundColor: "#ffe0e0", borderRadius: "4px" }}>
                      ⚠️ Summe der Konten ({euro.format(summedTotal)}) ≠ Gesamtausgaben ({euro.format(mainTotal)})
                    </p>
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
                let amount = receipt.total_amount || 0;
                if (amount === 0) {
                  amount = (receipt.receipt_items || []).reduce((sum, item) => {
                    if (item.is_ignored === true) return sum;
                    return sum + Number(item.amount || 0);
                  }, 0);
                }
                zahlungen[accountId] = (zahlungen[accountId] || 0) + amount;
              }
              
              // 2. KOSTENTRÄGER: Sum items by their assigned_cost_center_id
              // Then map back to the family_account that has that cost_center_id
              const kostentraegerPerCostCenter = {}; // costCenterId -> amount
              for (const receipt of receipts) {
                for (const item of (receipt.receipt_items || [])) {
                  if (item.is_ignored === true) continue;
                  const ccId = item.assigned_cost_center_id;
                  if (ccId) {
                    kostentraegerPerCostCenter[ccId] = (kostentraegerPerCostCenter[ccId] || 0) + Number(item.amount || 0);
                  }
                }
              }
              
              // Map cost centers back to accounts
              const kostentraegerPerAccount = {}; // accountId -> amount
              for (const account of accounts) {
                kostentraegerPerAccount[account.id] = 0;
              }
              kostentraegerPerAccount[defaultFamilyAccount.id] = 0;
              
              // Sum by account based on which cost_center belongs to which account
              for (const account of accounts) {
                const ccId = account.cost_center_id;
                if (ccId && kostentraegerPerCostCenter[ccId]) {
                  kostentraegerPerAccount[account.id] = kostentraegerPerCostCenter[ccId];
                }
              }
              // Also check default family account's cost center
              if (defaultFamilyAccount.cost_center_id && kostentraegerPerCostCenter[defaultFamilyAccount.cost_center_id]) {
                kostentraegerPerAccount[defaultFamilyAccount.id] = kostentraegerPerCostCenter[defaultFamilyAccount.cost_center_id];
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
                  <div style={{ display: "grid", gap: "8px" }}>
                    {debtors.map(debtor => {
                      const validCreditors = creditors.filter(creditor => {
                        // Only show if creditor has a valid account with cost_center
                        return creditor.account?.cost_center_id;
                      });
                      
                      if (!validCreditors.length) return null;
                      
                      return (
                        <div key={`settlement-${debtor.id}`} style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
                          <strong style={{ color: debtor.color }}>{debtor.name}</strong>
                          <span>→</span>
                          {validCreditors.map(creditor => (
                            <button
                              key={`settlement-${debtor.id}-${creditor.id}`}
                              className="btn secondary mini-btn"
                              disabled={busy}
                              onClick={() => createSettlementReceipt(debtor.account, creditor.account, creditor.amount)}
                              title={`${debtor.name} zahlt ${creditor.amount}€ an ${creditor.name}`}
                            >
                              {creditor.name} {euro.format(creditor.amount)}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
          </div>
        </article>
      </section>
    </div>
  );
}

export default App;
