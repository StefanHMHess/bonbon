import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

Deno.serve(async (req) => {
  try {
    // Get filename from query parameters
    const url = new URL(req.url);
    const filename = url.searchParams.get("file");

    if (!filename) {
      return new Response("Missing 'file' parameter", { status: 400 });
    }

    // Download file from Storage
    const { data, error } = await supabase.storage
      .from("receipts")
      .download(filename);

    if (error) {
      console.error("Storage download error:", error);
      return new Response("File not found", { status: 404 });
    }

    // Determine content type and disposition
    const isPdf = filename.toLowerCase().endsWith(".pdf");
    const contentType = isPdf ? "application/pdf" : "image/*";
    const disposition = isPdf ? "inline" : "inline"; // inline = display, attachment = download

    // Return file with inline disposition (forces display instead of download)
    return new Response(data, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${disposition}; filename="${filename}"`,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response("Internal server error", { status: 500 });
  }
});
