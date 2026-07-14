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
    const openaiModel = Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini";

    if (!supabaseUrl || !serviceRole || !openaiApiKey) {
      return new Response(JSON.stringify({ error: "Umgebungsvariablen fehlen" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRole);

    const signed = await admin.storage
      .from("receipts")
      .createSignedUrl(imagePath, 60);

    if (signed.error || !signed.data?.signedUrl) {
      return new Response(JSON.stringify({ error: signed.error?.message || "Signed URL Fehler" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = [
      "Extrahiere den Kassenbon als JSON.",
      "Erkenne die Originalwährung zuverlässig. Türkische Lira immer als TRY ausgeben.",
      "Antwortformat exakt:",
      '{"merchant":"...","receiptDate":"YYYY-MM-DD","totalAmount":0,"currency":"EUR","items":[{"description":"...","quantity":1,"amount":0}]}',
      "Werte amount/quantity immer in Originalwährung.",
      "Keinen zusätzlichen Text ausgeben."
    ].join("\n");

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
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
              { type: "image_url", image_url: { url: signed.data.signedUrl } }
            ]
          }
        ]
      }),
    });

    if (!aiResponse.ok) {
      const failText = await aiResponse.text();
      return new Response(JSON.stringify({ error: `OpenAI Fehler: ${failText}` }), {
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
