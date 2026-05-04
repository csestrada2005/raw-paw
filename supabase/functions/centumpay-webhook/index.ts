import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function verifyHMAC(
  message: string,
  secret: string,
  receivedAuth: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(message)),
  );
  const hex = Array.from(sig)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex === receivedAuth;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("CENTUMPAY_API_KEY")!;
    const apiSecret = Deno.env.get("CENTUMPAY_API_SECRET")!;

    const body = await req.json();
    console.log("CentumPay webhook received:", JSON.stringify(body));

    const { event, amount, currency, status, token, auth, order_id } = body;

    // Verify HMAC signature
    const msg = apiKey + event + amount + currency + status + token;
    const isValid = await verifyHMAC(msg, apiSecret, auth);

    if (!isValid) {
      console.error("Invalid webhook signature");
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (!order_id) {
      console.error("Webhook missing order_id - cannot safely match order");
      return new Response(
        JSON.stringify({ received: true, warning: "missing order_id" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (status === "approved") {
      const { error } = await supabase
        .from("orders")
        .update({
          payment_status: "paid",
          status: "confirmed",
          updated_at: new Date().toISOString(),
        })
        .eq("order_number", order_id)
        .eq("payment_method", "tarjeta");

      if (error) {
        console.error("Error updating order:", error);
      } else {
        console.log("Order marked as paid via webhook:", order_id);

        // Activate any pending subscription tied to that order's user
        const { data: orderRow } = await supabase
          .from("orders")
          .select("user_id")
          .eq("order_number", order_id)
          .maybeSingle();

        if (orderRow?.user_id) {
          await supabase
            .from("subscriptions")
            .update({ status: "active", updated_at: new Date().toISOString() })
            .eq("user_id", orderRow.user_id)
            .eq("status", "pending_payment");
        }
      }
    } else if (status === "declined" || status === "rejected" || status === "failed") {
      const { error } = await supabase
        .from("orders")
        .update({
          payment_status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("order_number", order_id)
        .eq("payment_method", "tarjeta");

      if (error) console.error("Error updating failed order:", error);
      else console.log("Order marked as failed via webhook:", order_id);
    }

    return new Response(
      JSON.stringify({ received: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response(
      JSON.stringify({ error: "Webhook processing error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
