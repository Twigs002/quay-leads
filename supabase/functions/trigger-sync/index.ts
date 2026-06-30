// Edge Function: trigger-sync
// =================================================================
// Browser → this function → GitHub workflow_dispatch
// Lets the dashboard fire a fresh sync on-demand without leaking a
// GitHub PAT to the client.
//
// Flow:
//   1. Verify the caller is an authenticated Supabase user
//   2. Verify the staff row has is_super OR is_admin
//   3. POST to GitHub's workflow_dispatch endpoint for sync.yml
//   4. Return { ok, run_url, triggered_by }
//
// Secrets required (set with `supabase secrets set`):
//   GITHUB_TOKEN  — fine-grained PAT scoped to Twigs002/quay-leads,
//                   "Actions: Read and write" permission
//
// Deploy:
//   supabase functions deploy trigger-sync --project-ref dqszbqiimbfvmmnpgpsb

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const REPO_OWNER = "Twigs002";
const REPO_NAME = "quay-leads";
const WORKFLOW_FILE = "sync.yml";

// Pinned to the production Pages origin + localhost for dev. Defense
// in depth — auth gate is the real lock, but a CORS allowlist removes
// one easy way for a hostile page to enumerate the function.
const ALLOWED_ORIGINS = new Set([
  "https://twigs002.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

function corsFor(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://twigs002.github.io";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsFor(origin), "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsFor(origin) });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, origin);
  }

  // 1. Auth header
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Missing Authorization header" }, 401, origin);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN");

  if (!GITHUB_TOKEN) {
    return json({ error: "GITHUB_TOKEN secret not configured" }, 500, origin);
  }

  // 2. Verify Supabase JWT belongs to a real user
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user) {
    return json({ error: "Not authenticated" }, 401, origin);
  }
  const userId = userRes.user.id;

  // 3. Check staff role (service-role client to bypass RLS for the lookup)
  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: staff, error: staffErr } = await adminClient
    .from("staff")
    .select("id, name, is_super, is_admin, active")
    .eq("auth_user_id", userId)
    .maybeSingle();

  if (staffErr || !staff) {
    return json({ error: "No staff record for this account" }, 403, origin);
  }
  if (staff.active === false) {
    return json({ error: "Account is disabled" }, 403, origin);
  }
  if (!staff.is_super && !staff.is_admin) {
    return json({ error: "Superuser access required" }, 403, origin);
  }

  // 4. Fire GitHub workflow_dispatch
  const dispatchUrl =
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const ghRes = await fetch(dispatchUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: "main",
      inputs: { reason: `triggered by ${staff.id} from the dashboard` },
    }),
  });

  if (!ghRes.ok) {
    const text = await ghRes.text();
    return json(
      { error: `GitHub API ${ghRes.status}`, detail: text.slice(0, 500) },
      502, origin,
    );
  }

  // GitHub's dispatch endpoint returns 204 No Content with no body.
  // We give the browser a deterministic URL to watch for the new run.
  const runsUrl =
    `https://github.com/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}`;
  return json({
    ok: true,
    triggered_by: staff.id,
    triggered_by_name: staff.name,
    run_url: runsUrl,
    message:
      "Sync queued on GitHub Actions. New data will land in ~90 seconds.",
  }, 200, origin);
});
