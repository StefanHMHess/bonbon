/// <reference path="./shims.d.ts" />
/// <reference lib="deno.ns" />
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizeCurrencyCode(value: unknown) {
  const normalized = String(value || "EUR").trim().toUpperCase();
  if (normalized === "TL" || normalized === "₺" || normalized === "TRY") return "TRY";
  if (normalized === "EURO") return "EUR";
  return normalized || "EUR";
}

function roundMoney(value: unknown) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function getExchangeRateToEur(currency: string) {
  const normalized = normalizeCurrencyCode(currency);
  if (normalized === "EUR") return 1;

  const rateResponse = await fetch(`https://api.frankfurter.app/latest?from=${normalized}&to=EUR`);
  if (!rateResponse.ok) return 1;

  const rateJson = await rateResponse.json();
  const rate = Number(rateJson?.rates?.EUR || 1);
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
}

async function convertPdfToImage(
  admin: any,
  imagePath: string,
  cloudconvertApiKey: string
): Promise<string> {
  if (!cloudconvertApiKey) {
    throw new Error("CloudConvert API Key nicht konfiguriert");
  }

  console.log("Downloade PDF von Supabase:", imagePath);

  // PDF-Datei von Supabase Storage downloaden
  const { data, error } = await admin.storage
    .from("receipts")
    .download(imagePath);

  if (error || !data) {
    throw new Error(`Fehler beim PDF-Download: ${error?.message || "Unbekannter Fehler"}`);
  }

  console.log("PDF heruntergeladen, Größe:", data.size, "bytes");

  // PDF zu Base64 encodieren
  const buffer = await data.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binaryString = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  const base64Data = btoa(binaryString);

  console.log("Sende PDF zu CloudConvert (import/base64)...");

  // Job mit import/base64 erstellen (kein separater Upload nötig)
  const jobResponse = await fetch("https://api.cloudconvert.com/v2/jobs", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${cloudconvertApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tasks: {
        import_file: {
          operation: "import/base64",
          file: base64Data,
          filename: "receipt.pdf",
        },
        convert: {
          operation: "convert",
          input: "import_file",
          output_format: "jpg",
        },
        export: {
          operation: "export/url",
          input: "convert",
        },
      },
    }),
  });

  if (!jobResponse.ok) {
    const errorText = await jobResponse.text();
    console.error("CloudConvert Job Create Error:", jobResponse.status, errorText);
    throw new Error(`CloudConvert Fehler (${jobResponse.status}): ${errorText}`);
  }

  const jobData = await jobResponse.json();
  const jobId = jobData.data?.id;

  if (!jobId) {
    throw new Error("CloudConvert Job ID nicht erhalten");
  }

  console.log("✅ CloudConvert Job erstellt:", jobId);

  // Warte auf Fertigstellung (max 10 Minuten = 600 Sekunden = 1200 * 500ms)
  let attempts = 0;
  while (attempts < 1200) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    attempts++;

    const statusResponse = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobId}`, {
      headers: {
        "Authorization": `Bearer ${cloudconvertApiKey}`,
      },
    });

    if (!statusResponse.ok) {
      if (attempts % 10 === 0) {
        console.log(`Status Check ${attempts}: Fehler ${statusResponse.status}`);
      }
      continue;
    }

    const statusData = await statusResponse.json();
    const status = statusData.data?.status;

    if (attempts % 20 === 0 || status !== "waiting") {
      console.log(`Status Check ${attempts} (${Math.round(attempts * 500 / 1000)}s): ${status}`);
    }

    if (status === "finished") {
      const tasks = statusData.data?.tasks || [];
      const exportTask = tasks.find((t: any) => t.operation === "export/url");
      const imageUrl = exportTask?.result?.files?.[0]?.url;

      if (imageUrl) {
        console.log("✅ PDF erfolgreich konvertiert zu:", imageUrl);
        return imageUrl;
      } else {
        console.error("Keine konvertierte Datei in Tasks:", JSON.stringify(tasks));
        throw new Error("Keine konvertierte Datei erhalten");
      }
    } else if (status === "failed") {
      console.error("Job fehlgeschlagen, Details:", statusData);
      throw new Error(`CloudConvert Job fehlgeschlagen: ${statusData.data?.message || "Unbekannter Fehler"}`);
    }
  }

  throw new Error("CloudConvert Conversion Timeout (über 10 Minuten)");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { imagePath } = await req.json();
    if (!imagePath) {
      return new Response(JSON.stringify({ error: "imagePath fehlt" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY") || "";
    const cloudconvertApiKey = Deno.env.get("CLOUDCONVERT_API_KEY") || "";
    const openaiModel = Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini";

    if (!supabaseUrl || !serviceRole || !openaiApiKey) {
      return new Response(JSON.stringify({ error: "Umgebungsvariablen fehlen" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRole);

    const prompt = [
      "Extrahiere den Kassenbon als JSON.",
      "Erkenne die Originalwährung exakt. Für türkische Belege: TRY ausgeben. Achte auf Symbole wie ₺, TL, Lira.",
      "Erkenne Datum im Format YYYY-MM-DD und Uhrzeit im Format HH:MM oder HH:MM:SS.",
      "Antwortformat exakt:",
      '{"merchant":"...","receiptDate":"YYYY-MM-DD","receiptTime":"HH:MM","totalAmount":0,"currency":"EUR","items":[{"description":"...","quantity":1,"amount":0}]}',
      "Werte amount/quantity immer in Originalwährung.",
      "Für türkische Belege: currency muss TRY sein, auch wenn in Zahlen Punkte/Kommas anders formatiert.",
      "Keinen zusätzlichen Text ausgeben."
    ].join("\n");

    const isPdf = imagePath.toLowerCase().endsWith(".pdf");

    let aiResponse: Response;
    let imageUrlToUse: string;

    // Wenn PDF: zuerst zu Bild konvertieren
    if (isPdf) {
      if (!cloudconvertApiKey) {
        return new Response(JSON.stringify({ 
          error: "PDF-Konvertierung nicht konfiguriert. Bitte machen Sie einen Screenshot oder fotografieren Sie den Beleg stattdessen." 
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      try {
        console.log("Starte PDF-Konvertierung für:", imagePath);
        imageUrlToUse = await convertPdfToImage(admin, imagePath, cloudconvertApiKey);
      } catch (err) {
        console.error("PDF-Konvertierung fehlgeschlagen:", err);
        return new Response(JSON.stringify({ 
          error: `PDF-Konvertierung fehlgeschlagen: ${String(err)}` 
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      // Für Bilder: Signed URL erstellen
      const signed = await admin.storage
        .from("receipts")
        .createSignedUrl(imagePath, 60);

      if (signed.error || !signed.data?.signedUrl) {
        return new Response(JSON.stringify({ error: signed.error?.message || "Signed URL Fehler" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      imageUrlToUse = signed.data.signedUrl;
    }

    // OpenAI mit dem Bild (entweder direkt oder konvertiert)
    aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: openaiModel,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageUrlToUse } },
            ],
          },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const failText = await aiResponse.text();
      console.error("OpenAI API Error:", aiResponse.status, failText);
      return new Response(JSON.stringify({ error: `OpenAI Fehler (${aiResponse.status}): ${failText}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const completion = await aiResponse.json();
    const content = completion?.choices?.[0]?.message?.content || "{}";

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = {
        merchant: "Unbekannt",
        receiptDate: new Date().toISOString().slice(0, 10),
        totalAmount: 0,
        currency: "EUR",
        items: [],
      };
    }

    const currency = normalizeCurrencyCode(parsed.currency || "EUR");
    const exchangeRate = await getExchangeRateToEur(currency);
    const originalTotalAmount = roundMoney(parsed.totalAmount || 0);
    const totalAmount = roundMoney(originalTotalAmount * exchangeRate);
    const items = Array.isArray(parsed.items) ? parsed.items.map((item: any) => {
      const originalAmount = roundMoney(item?.amount || 0);
      return {
        ...item,
        currency,
        original_amount: originalAmount,
        exchange_rate: exchangeRate,
        amount: roundMoney(originalAmount * exchangeRate),
      };
    }) : [];

    return new Response(JSON.stringify({
      ...parsed,
      currency,
      originalTotalAmount,
      exchangeRate,
      totalAmount,
      items,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
