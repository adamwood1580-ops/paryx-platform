import { createClient } from "npm:@supabase/supabase-js@^2";
import { corsHeaders as supabaseCorsHeaders } from "npm:@supabase/supabase-js@^2/cors";

const BRANDING_BUCKET = "club-branding";
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const SETTINGS_ROLES = new Set([
    "greenkeeper",
    "manager",
    "club_admin"
]);

const MIME_EXTENSIONS: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp"
};

const corsHeaders = {
    ...supabaseCorsHeaders,
    "Access-Control-Allow-Methods": "POST, OPTIONS"
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
    return text || "";
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
            // Fall through to the legacy service-role key.
        }
    }

    const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (legacy && legacy.trim()) {
        return legacy.trim();
    }

    throw new Error(
        "No Supabase server secret is available to the Edge Function."
    );
}

function getBearerToken(request: Request) {
    const header = request.headers.get("Authorization") || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || "";
}

function isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value
    );
}

function decodeBase64(value: string) {
    let binary = "";

    try {
        binary = atob(value);
    } catch {
        throw new Error("The uploaded logo data is invalid.");
    }

    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
}

async function ensureBrandingBucket(admin: ReturnType<typeof createClient>) {
    const { data, error } = await admin.storage.getBucket(BRANDING_BUCKET);

    if (!error && data) {
        return;
    }

    const { error: createError } = await admin.storage.createBucket(
        BRANDING_BUCKET,
        {
            public: true,
            fileSizeLimit: MAX_LOGO_BYTES,
            allowedMimeTypes: Object.keys(MIME_EXTENSIONS)
        }
    );

    if (
        createError &&
        !/already exists|duplicate/i.test(createError.message || "")
    ) {
        throw createError;
    }
}

async function requireBrandingAccess(
    admin: ReturnType<typeof createClient>,
    userId: string,
    clubId: string
) {
    const {
        data: membership,
        error: membershipError
    } = await admin
        .from("club_memberships")
        .select("role, status")
        .eq("profile_id", userId)
        .eq("club_id", clubId)
        .eq("status", "active")
        .maybeSingle();

    if (membershipError) {
        throw membershipError;
    }

    const role = cleanText(membership?.role).toLowerCase();

    if (!membership || !SETTINGS_ROLES.has(role)) {
        return false;
    }

    const {
        data: club,
        error: clubError
    } = await admin
        .from("clubs")
        .select("id")
        .eq("id", clubId)
        .eq("is_active", true)
        .maybeSingle();

    if (clubError) {
        throw clubError;
    }

    return Boolean(club);
}

Deno.serve(async (request: Request) => {
    if (request.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    if (request.method !== "POST") {
        return responseJson({ error: "Method not allowed." }, 405);
    }

    try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL");

        if (!supabaseUrl) {
            throw new Error("SUPABASE_URL is unavailable.");
        }

        const admin = createClient(
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
            data: { user },
            error: userError
        } = await admin.auth.getUser(token);

        if (userError || !user) {
            return responseJson({ error: "Authentication required." }, 401);
        }

        const body = await request.json();
        const action = cleanText(body?.action).toLowerCase();
        const clubId = cleanText(body?.clubId);

        if (!isUuid(clubId)) {
            return responseJson({ error: "A valid club is required." }, 400);
        }

        if (!(await requireBrandingAccess(admin, user.id, clubId))) {
            return responseJson(
                { error: "Club branding access required." },
                403
            );
        }

        await ensureBrandingBucket(admin);

        if (action === "delete") {
            const path = cleanText(body?.path);

            if (!path || !path.startsWith(`${clubId}/`)) {
                return responseJson(
                    { error: "The logo path does not belong to this club." },
                    400
                );
            }

            const { error } = await admin.storage
                .from(BRANDING_BUCKET)
                .remove([path]);

            if (error) {
                throw error;
            }

            return responseJson({ ok: true, path });
        }

        if (action !== "upload") {
            return responseJson(
                { error: "Unsupported club-logo action." },
                400
            );
        }

        const mimeType = cleanText(body?.mimeType).toLowerCase();
        const extension = MIME_EXTENSIONS[mimeType];

        if (!extension) {
            return responseJson(
                { error: "Club logo must be a PNG, JPG or WebP image." },
                400
            );
        }

        const base64 = cleanText(body?.base64);

        if (!base64) {
            return responseJson({ error: "No club logo was supplied." }, 400);
        }

        const bytes = decodeBase64(base64);

        if (!bytes.length) {
            return responseJson({ error: "The club logo is empty." }, 400);
        }

        if (bytes.length > MAX_LOGO_BYTES) {
            return responseJson(
                { error: "Club logo must be 2 MB or smaller." },
                400
            );
        }

        const path =
            `${clubId}/logo-${Date.now()}-${crypto.randomUUID()}.${extension}`;

        const { error: uploadError } = await admin.storage
            .from(BRANDING_BUCKET)
            .upload(path, bytes, {
                contentType: mimeType,
                cacheControl: "3600",
                upsert: false
            });

        if (uploadError) {
            throw uploadError;
        }

        return responseJson({
            ok: true,
            path,
            size: bytes.length,
            contentType: mimeType
        });
    } catch (error) {
        console.error("Paryx club-logo upload error:", error);

        return responseJson(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Club logo upload failed."
            },
            500
        );
    }
});
