import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
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
      "Antwortformat exakt:",
      '{"merchant":"...","receiptDate":"YYYY-MM-DD","totalAmount":0,"currency":"EUR","items":[{"description":"...","quantity":1,"amount":0}]}',
      "Werte nur als Zahlen für amount/quantity.",
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

    return new Response(JSON.stringify(parsed), {
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
