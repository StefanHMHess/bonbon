import { useEffect, useMemo, useState } from "react";
import { defaultHouseholdId, isSupabaseConfigured, supabase } from "./lib/supabase";

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

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

function App() {
  const householdId = defaultHouseholdId;
  const [receipts, setReceipts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [selectedFile, setSelectedFile] = useState(null);
  const [manualDraft, setManualDraft] = useState(emptyDraft);
  const [selectedReceipt, setSelectedReceipt] = useState(null);

  const mainAccountTotal = useMemo(() => sumItems(receipts, false), [receipts]);
  const giftAccountTotal = useMemo(() => sumItems(receipts, true), [receipts]);

  const hasSetup = isSupabaseConfigured && householdId;

  useEffect(() => {
    if (!hasSetup) return;
    loadReceipts();
  }, [hasSetup]);

  async function loadReceipts() {
    setBusy(true);
    setError("");

    const { data, error: queryError } = await supabase
      .from("receipts")
      .select("id, merchant, receipt_date, total_amount, currency, image_path, created_at, receipt_items(id, description, quantity, amount, is_gift)")
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

    const aiResult = await supabase.functions.invoke("bonbon-extract-receipt", {
      body: { imagePath: storagePath },
    });

    if (aiResult.error) {
      await supabase
        .from("receipts")
        .update({ ai_status: "failed" })
        .eq("id", receiptId);
      setBusy(false);
      setError(`KI-Auswertung fehlgeschlagen: ${aiResult.error.message}`);
      await loadReceipts();
      return;
    }

    const parsed = aiResult.data || {};
    const items = Array.isArray(parsed.items) ? parsed.items : [];

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
      setBusy(false);
      setError(receiptUpdate.error.message);
      return;
    }

    if (items.length) {
      const rows = items.map((item, index) => ({
        receipt_id: receiptId,
        position: index + 1,
        description: String(item.description || `Position ${index + 1}`),
        quantity: Number(item.quantity || 1),
        amount: Number(item.amount || 0),
        is_gift: false,
      }));

      const insertItems = await supabase.from("receipt_items").insert(rows);
      if (insertItems.error) {
        setBusy(false);
        setError(insertItems.error.message);
        return;
      }
    }

    setSelectedFile(null);
    setBusy(false);
    setSuccess("Beleg wurde analysiert und ins Haushaltsbuch übernommen.");
    await loadReceipts();
    setSelectedReceipt(receiptId);
  }

  async function addManualItem() {
    if (!selectedReceipt) return;

    const row = {
      receipt_id: selectedReceipt,
      description: manualDraft.description || "Neue Position",
      quantity: Number(manualDraft.quantity || 1),
      amount: Number(manualDraft.amount || 0),
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

  const currentReceipt = receipts.find((r) => r.id === selectedReceipt) || null;

  return (
    <div className="page">
      <header className="hero">
        <img src="/bonbon-logo.svg" alt="BonBox" className="hero-logo" />
        <div>
          <h1>BonBox</h1>
          <p>Belege scannen, KI auswerten, Haushaltsbuch automatisch pflegen.</p>
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
            <input
              id="receipt-upload"
              className="file-input-hidden"
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
            />
            <label htmlFor="receipt-upload" className="btn secondary file-trigger">
              Beleg auswählen
            </label>
            <p className="hint file-name">
              {selectedFile ? `Ausgewählt: ${selectedFile.name}` : "Noch keine Datei ausgewählt"}
            </p>
          </div>
          <button className="btn" disabled={!selectedFile || busy || !hasSetup} onClick={uploadAndExtract}>
            {busy ? "Analysiere..." : "Beleg per KI auswerten"}
          </button>
        </article>

        <article className="panel">
          <h2>Kontenübersicht</h2>
          <div className="totals">
            <div className="total-card main">
              <span>Haushaltsbuch</span>
              <strong>{euro.format(mainAccountTotal)}</strong>
            </div>
            <div className="total-card gift">
              <span>Geschenke-Konto</span>
              <strong>{euro.format(giftAccountTotal)}</strong>
            </div>
          </div>
        </article>
      </section>

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
                  <small>{receipt.receipt_date}</small>
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
              <div className="item-list">
                {(currentReceipt.receipt_items || []).map((item) => (
                  <div className="item-row" key={item.id}>
                    <input
                      value={item.description || ""}
                      onChange={(e) => patchItem(item.id, { description: e.target.value })}
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={item.amount}
                      onChange={(e) => patchItem(item.id, { amount: Number(e.target.value || 0) })}
                    />
                    <label className="gift-toggle">
                      <input
                        type="checkbox"
                        checked={Boolean(item.is_gift)}
                        onChange={(e) => patchItem(item.id, { is_gift: e.target.checked })}
                      />
                      Geschenk
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
