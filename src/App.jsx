import { useEffect, useMemo, useState } from "react";
import { defaultHouseholdId, isSupabaseConfigured, supabase } from "./lib/supabase";

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const dateTimeDE = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "short",
  timeStyle: "short",
});
const dateDE = new Intl.DateTimeFormat("de-DE", { dateStyle: "short" });
const APP_VERSION = "v0.3.0";
const ACCESS_EMAIL_KEY = "bonbox_access_email";

const defaultCostGroups = [
  {
    id: "grp-food",
    name: "Lebensmittel",
    color: "#18b6a3",
    keywords: ["aldi", "lidl", "rewe", "edeka", "netto", "supermarkt", "lebensmittel", "bäckerei", "baeckerei"],
  },
  {
    id: "grp-restaurant",
    name: "Essen & Trinken",
    color: "#0f9f8d",
    keywords: ["restaurant", "cafe", "café", "bar", "pizza", "burger", "liefer", "imbiss"],
  },
  {
    id: "grp-mobility",
    name: "Mobilität",
    color: "#456279",
    keywords: ["tank", "shell", "aral", "uber", "taxi", "bahn", "db", "ticket", "park"],
  },
  {
    id: "grp-home",
    name: "Haushalt",
    color: "#ff6b57",
    keywords: ["dm", "rossmann", "haushalt", "reinigung", "drogerie", "toilettenpapier"],
  },
  {
    id: "grp-health",
    name: "Gesundheit",
    color: "#eb5a46",
    keywords: ["apotheke", "arzt", "medikament", "medizin", "praxis"],
  },
  {
    id: "grp-leisure",
    name: "Freizeit",
    color: "#10243e",
    keywords: ["kino", "museum", "event", "sport", "training", "verein"],
  },
];

const emptyDraft = {
  description: "",
  quantity: 1,
  amount: "",
  is_gift: false,
};

function sumItems(receipts, gift) {
  return receipts.reduce((acc, receipt) => {
    const chunk = (receipt.receipt_items || []).reduce((rowAcc, item) => {
      if (Boolean(item.is_gift) !== gift) return rowAcc;
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
    return dateDE.format(new Date(`${receipt.receipt_date}T00:00:00`));
  }

  return "-";
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

function App() {
  const householdId = defaultHouseholdId;
  const [receipts, setReceipts] = useState([]);
  const [costGroups, setCostGroups] = useState([]);
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [selectedFile, setSelectedFile] = useState(null);
  const [manualDraft, setManualDraft] = useState(emptyDraft);
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [showCostGroupModal, setShowCostGroupModal] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [accessEmail, setAccessEmail] = useState("");
  const [costGroupDrafts, setCostGroupDrafts] = useState({});
  const [costGroupCatalogReady, setCostGroupCatalogReady] = useState(true);
  const [costGroupCatalogMessage, setCostGroupCatalogMessage] = useState("");
  const [newCostGroup, setNewCostGroup] = useState({
    name: "",
    color: "#18b6a3",
    keywordsText: "",
    sortOrder: 100,
  });

  const mainAccountTotal = useMemo(() => sumItems(receipts, false), [receipts]);
  const giftAccountTotal = useMemo(() => sumItems(receipts, true), [receipts]);

  const costGroupTotals = useMemo(() => {
    const groups = activeCostGroups();
    const colorByName = new Map(groups.map((group) => [group.name, group.color]));
    const totals = new Map();

    for (const receipt of receipts) {
      for (const item of receipt.receipt_items || []) {
        if (Boolean(item.is_gift)) continue;
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

  const hasSetup = isSupabaseConfigured && householdId;

  useEffect(() => {
    const saved = localStorage.getItem(ACCESS_EMAIL_KEY) || "";
    setAccessEmail(saved);
    setEmailInput(saved);
  }, []);

  useEffect(() => {
    if (!hasSetup) return;
    loadReceipts();
    loadCostGroups();
  }, [hasSetup]);

  function activeCostGroups() {
    return costGroups.length ? costGroups : defaultCostGroups;
  }

  function saveEmailAccess() {
    const value = String(emailInput || "").trim().toLowerCase();
    if (!value || !value.includes("@")) {
      setError("Bitte eine gültige E-Mail-Adresse eingeben.");
      return;
    }

    localStorage.setItem(ACCESS_EMAIL_KEY, value);
    setAccessEmail(value);
    setError("");
    setSuccess("Zugang per E-Mail aktiviert.");
  }

  function resetEmailAccess() {
    localStorage.removeItem(ACCESS_EMAIL_KEY);
    setAccessEmail("");
    setSuccess("");
  }

  async function loadReceipts() {
    setBusy(true);
    setError("");

    const { data, error: queryError } = await supabase
      .from("receipts")
      .select("id, merchant, receipt_date, total_amount, currency, image_path, ai_status, created_at, receipt_items(id, description, quantity, amount, is_gift, category)")
      .eq("household_id", householdId)
      .order("receipt_date", { ascending: false })
      .order("created_at", { ascending: false });

    setBusy(false);

    if (queryError) {
      setError(queryError.message);
      return;
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

  function updateCostGroupDraft(groupId, key, value) {
    setCostGroupDrafts((prev) => ({
      ...prev,
      [groupId]: {
        ...(prev[groupId] || {}),
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

  async function analyzeReceipt(receiptId, imagePath, options = {}) {
    const { replaceItems = false } = options;

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
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const groups = activeCostGroups();

    const receiptUpdate = await supabase
      .from("receipts")
      .update({
        merchant: parsed.merchant || "Unbekannt",
        receipt_date: parsed.receiptDate || new Date().toISOString().slice(0, 10),
        total_amount: Number(parsed.totalAmount || 0),
        currency: parsed.currency || "EUR",
        ai_status: "done",
        ai_raw_json: parsed,
      })
      .eq("id", receiptId);

    if (receiptUpdate.error) {
      return { ok: false, message: receiptUpdate.error.message };
    }

    if (replaceItems) {
      const { error: deleteError } = await supabase
        .from("receipt_items")
        .delete()
        .eq("receipt_id", receiptId);

      if (deleteError) {
        return { ok: false, message: deleteError.message };
      }
    }

    if (items.length) {
      const rows = items.map((item, index) => ({
        receipt_id: receiptId,
        position: index + 1,
        description: String(item.description || `Position ${index + 1}`),
        quantity: Number(item.quantity || 1),
        amount: Number(item.amount || 0),
        category: inferCostGroupName(item.description, groups),
        is_gift: false,
      }));

      const insertItems = await supabase.from("receipt_items").insert(rows);
      if (insertItems.error) {
        return { ok: false, message: insertItems.error.message };
      }
    }

    return { ok: true };
  }

  async function uploadAndExtract() {
    if (!selectedFile || !hasSetup) return;
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

    const result = await analyzeReceipt(receiptId, storagePath);
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
    if (!receipt?.id || !receipt?.image_path || !hasSetup) return;

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

  async function addManualItem() {
    if (!selectedReceipt) return;

    const groups = activeCostGroups();

    const row = {
      receipt_id: selectedReceipt,
      description: manualDraft.description || "Neue Position",
      quantity: Number(manualDraft.quantity || 1),
      amount: Number(manualDraft.amount || 0),
      category: inferCostGroupName(manualDraft.description, groups),
      is_gift: Boolean(manualDraft.is_gift),
    };

    const { error: insertError } = await supabase.from("receipt_items").insert(row);
    if (insertError) {
      setError(insertError.message);
      return;
    }

    setManualDraft(emptyDraft);
    await loadReceipts();
  }

  async function patchItem(itemId, patch) {
    const { error: updateError } = await supabase
      .from("receipt_items")
      .update(patch)
      .eq("id", itemId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    await loadReceipts();
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

    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  const currentReceipt = receipts.find((r) => r.id === selectedReceipt) || null;

  if (!accessEmail) {
    return (
      <div className="page">
        <header className="hero">
          <img src="/bonbon-logo.svg" alt="BonBox" className="hero-logo" />
          <div>
            <h1>BonBox</h1>
            <p>Bitte mit E-Mail anmelden, um dein Haushaltsbuch zu öffnen.</p>
          </div>
          <span className="version-badge">{APP_VERSION}</span>
        </header>

        <section className="panel setup-panel">
          <h2>Zugang mit E-Mail</h2>
          <p className="hint">Diese E-Mail wird lokal auf diesem Gerät gespeichert.</p>
          <input
            type="email"
            placeholder="name@beispiel.de"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
          />
          <button className="btn" onClick={saveEmailAccess}>Weiter</button>
          {error && <p className="hint error">{error}</p>}
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
          <span className="email-badge">{accessEmail}</span>
          <span className="version-badge">{APP_VERSION}</span>
          <button className="btn secondary mini-btn" onClick={resetEmailAccess}>E-Mail wechseln</button>
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

      <section className="grid two">
        <article className="panel">
          <h2>Neuen Beleg erfassen</h2>
          <p className="hint">Foto oder Scan auswählen und von der KI auslesen lassen.</p>
          <div className="file-picker">
            <div className="file-options">
              <div className="file-option">
                <input
                  id="receipt-camera"
                  className="file-input-hidden"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                />
                <label htmlFor="receipt-camera" className="btn secondary file-trigger">
                  Foto aufnehmen
                </label>
                <span className="file-option-note">Kamera direkt öffnen</span>
              </div>

              <div className="file-option">
                <input
                  id="receipt-photos"
                  className="file-input-hidden"
                  type="file"
                  accept="image/*"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                />
                <label htmlFor="receipt-photos" className="btn secondary file-trigger">
                  Aus Fotomediathek wählen
                </label>
                <span className="file-option-note">Ein Bild aus Fotos importieren</span>
              </div>

              <div className="file-option">
                <input
                  id="receipt-files"
                  className="file-input-hidden"
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                />
                <label htmlFor="receipt-files" className="btn secondary file-trigger">
                  Aus Dateien importieren
                </label>
                <span className="file-option-note">Für PDF oder gespeicherte Scans</span>
              </div>
            </div>
            <p className="hint file-name">
              {selectedFile ? `Ausgewählt: ${selectedFile.name}` : "Noch keine Datei ausgewählt"}
            </p>
          </div>
          <button className="btn" disabled={!selectedFile || busy || !hasSetup} onClick={uploadAndExtract}>
            {busy ? "Analysiere..." : "Beleg per KI auswerten"}
          </button>
        </article>

        <article
          className="panel overview-panel"
          role="button"
          tabIndex={0}
          onClick={() => setShowCostGroupModal(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setShowCostGroupModal(true);
            }
          }}
        >
          <h2>Kostenübersicht</h2>
          <div className="totals">
            <div className="total-card main">
              <span>Haushaltsbuch</span>
              <strong>{euro.format(mainAccountTotal)}</strong>
            </div>
            <div className="total-card gift">
              <span>Geschenke</span>
              <strong>{euro.format(giftAccountTotal)}</strong>
            </div>
          </div>

          <div className="cost-group-summary">
            <h3>Kostenübersicht nach Kostengruppen</h3>
            {!costGroupTotals.length && <p className="hint">Noch keine Positionen mit Kosten vorhanden.</p>}
            {!!costGroupTotals.length && (
              <div className="cost-group-summary-list">
                {costGroupTotals.map((row) => (
                  <div className="cost-group-summary-row" key={row.name}>
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
            <p className="hint">Tippe in diese Karte, um den Kostengruppen-Katalog zu öffnen.</p>
          </div>
        </article>
      </section>

      {showCostGroupModal && (
        <div className="modal-backdrop" onClick={() => setShowCostGroupModal(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Kostengruppen-Katalog</h3>
              <button className="btn secondary" onClick={() => setShowCostGroupModal(false)}>Schließen</button>
            </div>

            {!costGroupCatalogReady && (
              <p className="hint error">
                Katalog-Tabelle noch nicht verfügbar: {costGroupCatalogMessage}
              </p>
            )}

            {costGroupCatalogReady && !costGroups.length && (
              <p className="hint">Noch keine Kostengruppen angelegt. Füge unten eine hinzu.</p>
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
                  <input
                    value={draft.color}
                    onChange={(e) => updateCostGroupDraft(group.id, "color", e.target.value)}
                    placeholder="#18b6a3"
                  />
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
                <input
                  value={newCostGroup.color}
                  onChange={(e) => setNewCostGroup((s) => ({ ...s, color: e.target.value }))}
                  placeholder="#18b6a3"
                />
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
              </div>
            )}
          </div>
        </div>
      )}

      {error && <p className="hint error">{error}</p>}
      {success && <p className="hint success">{success}</p>}

      <section className="grid two">
        <article className="panel">
          <h2>Belege</h2>
          <div className="receipt-list">
            {receipts.map((receipt) => (
              <button
                key={receipt.id}
                className={`receipt-button ${receipt.id === selectedReceipt ? "active" : ""}`}
                onClick={() => setSelectedReceipt(receipt.id)}
              >
                <div>
                  <strong>{receipt.merchant || "Unbekannt"}</strong>
                  <small>{formatReceiptDateTime(receipt)}</small>
                </div>
                <span>{euro.format(Number(receipt.total_amount || 0))}</span>
              </button>
            ))}
            {!receipts.length && !busy && <p className="hint">Noch keine Belege vorhanden.</p>}
          </div>
        </article>

        <article className="panel">
          <h2>Positionen</h2>
          {!currentReceipt && <p className="hint">Bitte links einen Beleg auswählen.</p>}
          {currentReceipt && (
            <>
              <div className="receipt-actions">
                <button
                  className="btn secondary"
                  disabled={busy || !currentReceipt.image_path || !hasSetup}
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
              </div>

              <div className="item-list">
                <div className="item-head">
                  <span>Beschreibung</span>
                  <span>Betrag</span>
                  <span>Kostengruppe</span>
                  <span>Geschenk</span>
                </div>
                {(currentReceipt.receipt_items || []).map((item) => (
                  <div className="item-row" key={item.id}>
                    <input
                      value={item.description || ""}
                      onChange={(e) => patchItem(item.id, { description: e.target.value })}
                    />
                    <input
                      className="amount-input"
                      type="number"
                      step="0.01"
                      value={item.amount}
                      onChange={(e) => patchItem(item.id, { amount: Number(e.target.value || 0) })}
                    />
                    <select
                      className="category-input"
                      value={item.category || ""}
                      onChange={(e) => patchItem(item.id, { category: e.target.value || null })}
                    >
                      <option value="">Keine Kostengruppe</option>
                      {activeCostGroups().map((group) => (
                        <option key={group.id || group.name} value={group.name}>{group.name}</option>
                      ))}
                    </select>
                    <label className="gift-cell" aria-label="Geschenk markieren">
                      <input
                        type="checkbox"
                        checked={Boolean(item.is_gift)}
                        onChange={(e) => patchItem(item.id, { is_gift: e.target.checked })}
                      />
                    </label>
                  </div>
                ))}
              </div>

              <div className="manual-box">
                <h3>Position manuell hinzufügen</h3>
                <input
                  placeholder="Beschreibung"
                  value={manualDraft.description}
                  onChange={(e) => setManualDraft((s) => ({ ...s, description: e.target.value }))}
                />
                <div className="manual-grid">
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Betrag"
                    value={manualDraft.amount}
                    onChange={(e) => setManualDraft((s) => ({ ...s, amount: e.target.value }))}
                  />
                  <label className="gift-toggle">
                    <input
                      type="checkbox"
                      checked={manualDraft.is_gift}
                      onChange={(e) => setManualDraft((s) => ({ ...s, is_gift: e.target.checked }))}
                    />
                    Geschenk
                  </label>
                </div>
                <button className="btn secondary" onClick={addManualItem}>Hinzufügen</button>
              </div>
            </>
          )}
        </article>
      </section>
    </div>
  );
}

export default App;
