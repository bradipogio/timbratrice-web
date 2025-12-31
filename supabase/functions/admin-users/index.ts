import { serve } from "https://deno.land/std@0.202.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ADMIN_EMAIL = (Deno.env.get("ADMIN_EMAIL") || "").trim().toLowerCase();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  if (!ADMIN_EMAIL) {
    return new Response(JSON.stringify({ error: "ADMIN_EMAIL non configurato" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  const verifyClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });
  const { data: userData, error: userErr } = await verifyClient.auth.getUser(token);
  const email = (userData?.user?.email || "").trim().toLowerCase();
  if (userErr || !email || email !== ADMIN_EMAIL) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  let body: any = null;
  try{
    body = await req.json();
  }catch{
    body = null;
  }

  const action = String(body?.action || "");
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  if (action === "list") {
    const perPage = 200;
    const maxPages = 5; // safety cap (1000 users)
    const users: unknown[] = [];
    let page = 1;
    let truncated = false;

    while (page <= maxPages) {
      const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      const batch = data.users || [];
      users.push(...batch);
      if (batch.length < perPage) break;
      page += 1;
    }
    if (page > maxPages) truncated = true;

    return new Response(JSON.stringify({ users, truncated }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  if (action === "create") {
    const emailIn = String(body?.email || "").trim();
    const password = String(body?.password || "").trim();
    if (!emailIn || !password) {
      return new Response(JSON.stringify({ error: "Email e password obbligatorie" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
    const { data, error } = await adminClient.auth.admin.createUser({
      email: emailIn,
      password,
      email_confirm: true
    });
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
    return new Response(JSON.stringify({ user: data.user }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  if (action === "update") {
    const id = String(body?.id || "").trim();
    const emailIn = String(body?.email || "").trim();
    const password = String(body?.password || "").trim();
    if (!id) {
      return new Response(JSON.stringify({ error: "ID mancante" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
    const payload: Record<string, string | boolean> = {};
    if (emailIn) payload.email = emailIn;
    if (password) payload.password = password;
    if (emailIn) payload.email_confirm = true;
    if (Object.keys(payload).length === 0) {
      return new Response(JSON.stringify({ error: "Nessun campo da aggiornare" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
    const { data, error } = await adminClient.auth.admin.updateUserById(id, payload);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
    return new Response(JSON.stringify({ user: data.user }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  return new Response(JSON.stringify({ error: "Action non valida" }), {
    status: 400,
    headers: { "Content-Type": "application/json", ...corsHeaders }
  });
});
