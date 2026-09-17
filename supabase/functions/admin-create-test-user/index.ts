import { createClient } from "npm:@supabase/supabase-js@^2";
import { corsHeaders as supabaseCorsHeaders } from "npm:@supabase/supabase-js@^2/cors";

const STAFF_ROLES = new Set([
    "starter",
    "reception",
    "professional",
    "greenkeeper",
    "manager",
    "club_admin"
]);

const corsHeaders = {
    ...supabaseCorsHeaders,
    "Access-Control-Allow-Methods":
        "POST, OPTIONS"
};

function responseJson(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
        }
    });
}

function cleanText(value: unknown) {
    const text = String(value || "").trim();
    return text || null;
}

function normaliseEmail(value: unknown) {
    return String(value || "").trim().toLowerCase();
}

function featureEnabled() {
    return String(
        Deno.env.get("PARYX_TEST_USER_CREATION_ENABLED") || ""
    ).trim().toLowerCase() === "true";
}

function isClearlyTestEmail(email: string) {
    const atIndex = email.indexOf("@");
    if (atIndex <= 0) return false;
    return email.slice(0, atIndex).includes("+test");
}

function getSecretKey() {
    const secretMap = Deno.env.get("SUPABASE_SECRET_KEYS");

    if (secretMap) {
        try {
            const parsed = JSON.parse(secretMap);
            const key = parsed?.default;
            if (typeof key === "string" && key.trim()) {
                return key.trim();
            }
        } catch {
            // Fall back below.
        }
    }

    const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (legacy && legacy.trim()) return legacy.trim();

    throw new Error(
        "No Supabase server secret is available to the Edge Function."
    );
}

function getBearerToken(request: Request) {
    const header = request.headers.get("Authorization") || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || "";
}

Deno.serve(async (request: Request) => {
    if (request.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    if (request.method !== "POST") {
        return responseJson({ error: "Method not allowed." }, 405);
    }

    let admin: any = null;
    let createdUserId = "";

    try {
        if (!featureEnabled()) {
            return responseJson(
                { error: "Test login creation is disabled on the server." },
                403
            );
        }

        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        if (!supabaseUrl) {
            throw new Error("SUPABASE_URL is unavailable.");
        }

        admin = createClient(
            supabaseUrl,
            getSecretKey(),
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false,
                    detectSessionInUrl: false
                }
            }
        );

        const token = getBearerToken(request);
        if (!token) {
            return responseJson({ error: "Authentication required." }, 401);
        }

        const {
            data: { user: caller },
            error: callerError
        } = await admin.auth.getUser(token);

        if (callerError || !caller) {
            return responseJson({ error: "Authentication required." }, 401);
        }

        const { data: platformAccess, error: platformAccessError } =
            await admin
                .from("platform_users")
                .select("role, is_active")
                .eq("user_id", caller.id)
                .eq("role", "platform_owner")
                .eq("is_active", true)
                .maybeSingle();

        if (platformAccessError) throw platformAccessError;
        if (!platformAccess) {
            return responseJson(
                { error: "Platform Owner access required." },
                403
            );
        }

        const body = await request.json();
        const firstName = cleanText(body?.firstName);
        const lastName = cleanText(body?.lastName);
        const email = normaliseEmail(body?.email);
        const password = String(body?.password || "");
        const clubId = cleanText(body?.clubId);
        const role = String(body?.role || "").trim().toLowerCase();

        if (
            !firstName ||
            !lastName ||
            !email ||
            !clubId ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        ) {
            return responseJson(
                {
                    error:
                        "First name, last name, valid email and club are required."
                },
                400
            );
        }

        if (!isClearlyTestEmail(email)) {
            return responseJson(
                {
                    error:
                        "Use a clearly marked test email containing +test before the @ symbol, for example name+test1@example.com."
                },
                400
            );
        }

        if (password.length < 8) {
            return responseJson(
                { error: "The test password must contain at least 8 characters." },
                400
            );
        }

        if (!STAFF_ROLES.has(role)) {
            return responseJson({ error: "Invalid ClubHub role." }, 400);
        }

        const { data: club, error: clubError } = await admin
            .from("clubs")
            .select("id, name, is_active")
            .eq("id", clubId)
            .maybeSingle();

        if (clubError) throw clubError;
        if (!club || club.is_active === false) {
            return responseJson({ error: "The selected club is not active." }, 400);
        }

        const displayName = `${firstName} ${lastName}`.trim();

        const { data: created, error: createError } =
            await admin.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
                user_metadata: {
                    first_name: firstName,
                    last_name: lastName,
                    display_name: displayName,
                    paryx_test_account: true,
                    paryx_test_scope: "clubhub_smoke"
                }
            });

        if (createError) {
            const message =
                createError.message || "ClubHub test login could not be created.";
            const status = /already|registered|exists/i.test(message) ? 409 : 400;
            return responseJson({ error: message }, status);
        }

        const targetUser = created?.user;
        if (!targetUser?.id) {
            throw new Error("Supabase did not return the new test user.");
        }
        createdUserId = targetUser.id;

        const now = new Date().toISOString();
        const today = now.slice(0, 10);

        const { error: profileError } = await admin
            .from("profiles")
            .upsert(
                {
                    id: targetUser.id,
                    first_name: firstName,
                    last_name: lastName,
                    display_name: displayName,
                    updated_at: now
                },
                { onConflict: "id" }
            );

        if (profileError) throw profileError;

        const { data: membership, error: membershipError } = await admin
            .from("club_memberships")
            .insert({
                profile_id: targetUser.id,
                club_id: clubId,
                membership_number: null,
                membership_type: "staff",
                status: "active",
                role,
                joined_at: today,
                is_primary: true,
                club_first_name: firstName,
                club_last_name: lastName,
                club_display_name: displayName,
                club_email: email
            })
            .select("id")
            .single();

        if (membershipError) throw membershipError;

        const { error: playerLinkError } = await admin
            .from("club_membership_player_links")
            .upsert(
                {
                    membership_id: membership.id,
                    club_id: clubId,
                    profile_id: targetUser.id,
                    link_method: "platform_support",
                    updated_at: now
                },
                { onConflict: "membership_id" }
            );

        if (playerLinkError) throw playerLinkError;

        const { error: auditError } = await admin
            .from("platform_audit_log")
            .insert({
                actor_user_id: caller.id,
                actor_role: "platform_owner",
                action: "clubhub_test_user_created",
                club_id: clubId,
                target_user_id: targetUser.id,
                details: {
                    email,
                    display_name: displayName,
                    email_confirmed: true,
                    club_name: club.name,
                    clubhub_role: role,
                    membership_id: membership.id,
                    console_access_granted: false,
                    test_only: true
                }
            });

        if (auditError) throw auditError;

        return responseJson({
            userId: targetUser.id,
            membershipId: membership.id,
            email,
            displayName,
            emailConfirmed: true,
            clubId,
            clubName: club.name,
            role,
            clubhubAccess: true,
            consoleAccess: false,
            testOnly: true
        });
    } catch (error) {
        console.error("Create ClubHub test login failed:", error);

        if (admin && createdUserId) {
            try {
                await admin.auth.admin.deleteUser(createdUserId);
            } catch (cleanupError) {
                console.error(
                    "Could not roll back failed ClubHub test-user creation:",
                    cleanupError
                );
            }
        }

        return responseJson(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "ClubHub test login could not be created."
            },
            500
        );
    }
});
