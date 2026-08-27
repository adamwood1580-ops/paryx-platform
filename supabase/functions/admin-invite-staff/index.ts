import { createClient } from "npm:@supabase/supabase-js@2";

const ADMIN_ROLES = new Set([
    "manager",
    "club_admin"
]);

const STAFF_ROLES = new Set([
    "starter",
    "reception",
    "professional",
    "greenkeeper",
    "manager",
    "club_admin"
]);

const ELEVATED_ROLES = new Set([
    "manager",
    "club_admin"
]);

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods":
        "POST, OPTIONS"
};

function responseJson(
    body: unknown,
    status = 200
) {
    return new Response(
        JSON.stringify(body),
        {
            status,
            headers: {
                ...corsHeaders,
                "Content-Type":
                    "application/json"
            }
        }
    );
}

function cleanText(value: unknown) {
    const text =
        String(value || "")
            .trim();

    return text || null;
}

function normaliseEmail(value: unknown) {
    return String(value || "")
        .trim()
        .toLowerCase();
}

function getSecretKey() {
    const secretMap =
        Deno.env.get(
            "SUPABASE_SECRET_KEYS"
        );

    if (secretMap) {
        try {
            const parsed =
                JSON.parse(
                    secretMap
                );

            const key =
                parsed?.default;

            if (
                typeof key ===
                    "string" &&
                key.trim()
            ) {
                return key.trim();
            }
        } catch {
            // Fall back below.
        }
    }

    const legacy =
        Deno.env.get(
            "SUPABASE_SERVICE_ROLE_KEY"
        );

    if (
        legacy &&
        legacy.trim()
    ) {
        return legacy.trim();
    }

    throw new Error(
        "No Supabase server secret is available to the Edge Function."
    );
}

function getBearerToken(
    request: Request
) {
    const header =
        request.headers.get(
            "Authorization"
        ) || "";

    const match =
        header.match(
            /^Bearer\s+(.+)$/i
        );

    return (
        match?.[1]?.trim() ||
        ""
    );
}

function redirectAllowed(
    value: string | null
) {
    if (!value) {
        return null;
    }

    try {
        const url =
            new URL(value);

        const isProduction =
            url.protocol ===
                "https:" &&
            url.hostname ===
                "www.paryx.co.uk";

        const isDevelopment =
            url.protocol ===
                "https:" &&
            url.hostname ===
                "adamwood1580-ops.github.io" &&
            url.pathname.startsWith(
                "/paryx-platform/"
            );

        const correctPage =
            url.pathname.endsWith(
                "/apps/club/html/set-password.html"
            );

        if (
            correctPage &&
            (
                isProduction ||
                isDevelopment
            )
        ) {
            return url.toString();
        }
    } catch {
        // Invalid redirect.
    }

    return null;
}

async function findUserByEmail(
    admin: any,
    email: string
) {
    let page =
        1;

    const perPage =
        1000;

    while (page <= 25) {
        const {
            data,
            error
        } =
            await admin.auth.admin
                .listUsers({
                    page,
                    perPage
                });

        if (error) {
            throw error;
        }

        const users =
            data?.users || [];

        const match =
            users.find(
                (user: any) =>
                    normaliseEmail(
                        user.email
                    ) === email
            );

        if (match) {
            return match;
        }

        if (
            users.length <
            perPage
        ) {
            return null;
        }

        page += 1;
    }

    throw new Error(
        "The Auth user directory is too large for this staff invitation operation."
    );
}

async function ensureProfile(
    admin: any,
    userId: string,
    firstName: string,
    lastName: string
) {
    const {
        data: current,
        error: readError
    } =
        await admin
            .from("profiles")
            .select(
                "id, first_name, last_name, display_name"
            )
            .eq(
                "id",
                userId
            )
            .maybeSingle();

    if (readError) {
        throw readError;
    }

    const displayName =
        `${firstName} ${lastName}`
            .trim();

    if (!current) {
        const {
            error
        } =
            await admin
                .from("profiles")
                .insert({
                    id:
                        userId,
                    first_name:
                        firstName,
                    last_name:
                        lastName,
                    display_name:
                        displayName
                });

        if (error) {
            throw error;
        }

        return;
    }

    const patch:
        Record<string, unknown> =
        {};

    if (
        !cleanText(
            current.first_name
        )
    ) {
        patch.first_name =
            firstName;
    }

    if (
        !cleanText(
            current.last_name
        )
    ) {
        patch.last_name =
            lastName;
    }

    if (
        !cleanText(
            current.display_name
        )
    ) {
        patch.display_name =
            displayName;
    }

    if (
        !Object.keys(patch)
            .length
    ) {
        return;
    }

    patch.updated_at =
        new Date()
            .toISOString();

    const {
        error
    } =
        await admin
            .from("profiles")
            .update(patch)
            .eq(
                "id",
                userId
            );

    if (error) {
        throw error;
    }
}

Deno.serve(
    async (
        request: Request
    ) => {
        if (
            request.method ===
            "OPTIONS"
        ) {
            return new Response(
                "ok",
                {
                    headers:
                        corsHeaders
                }
            );
        }

        if (
            request.method !==
            "POST"
        ) {
            return responseJson(
                {
                    error:
                        "Method not allowed."
                },
                405
            );
        }

        try {
            const supabaseUrl =
                Deno.env.get(
                    "SUPABASE_URL"
                );

            if (!supabaseUrl) {
                throw new Error(
                    "SUPABASE_URL is unavailable."
                );
            }

            const admin =
                createClient(
                    supabaseUrl,
                    getSecretKey(),
                    {
                        auth: {
                            autoRefreshToken:
                                false,
                            persistSession:
                                false
                        }
                    }
                );

            const token =
                getBearerToken(
                    request
                );

            if (!token) {
                return responseJson(
                    {
                        error:
                            "Authentication required."
                    },
                    401
                );
            }

            const {
                data: {
                    user: caller
                },
                error:
                    callerError
            } =
                await admin.auth
                    .getUser(
                        token
                    );

            if (
                callerError ||
                !caller
            ) {
                return responseJson(
                    {
                        error:
                            "Authentication required."
                    },
                    401
                );
            }

            const body =
                await request.json();

            const clubId =
                cleanText(
                    body?.clubId
                );

            const firstName =
                cleanText(
                    body?.firstName
                );

            const lastName =
                cleanText(
                    body?.lastName
                );

            const email =
                normaliseEmail(
                    body?.email
                );

            const role =
                String(
                    body?.role || ""
                )
                    .trim()
                    .toLowerCase();

            const redirectTo =
                redirectAllowed(
                    cleanText(
                        body?.redirectTo
                    )
                );

            if (
                !clubId ||
                !firstName ||
                !lastName ||
                !email ||
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
                    .test(email)
            ) {
                return responseJson(
                    {
                        error:
                            "Club, first name, last name and a valid email are required."
                    },
                    400
                );
            }

            if (
                !STAFF_ROLES.has(
                    role
                )
            ) {
                return responseJson(
                    {
                        error:
                            "Invalid ClubHub role."
                    },
                    400
                );
            }

            if (!redirectTo) {
                return responseJson(
                    {
                        error:
                            "The ClubHub activation redirect is not allowed."
                    },
                    400
                );
            }

            const {
                data:
                    actorMembership,
                error:
                    actorError
            } =
                await admin
                    .from(
                        "club_memberships"
                    )
                    .select(
                        "id, role"
                    )
                    .eq(
                        "profile_id",
                        caller.id
                    )
                    .eq(
                        "club_id",
                        clubId
                    )
                    .eq(
                        "status",
                        "active"
                    )
                    .maybeSingle();

            if (
                actorError ||
                !actorMembership ||
                !ADMIN_ROLES.has(
                    actorMembership.role
                )
            ) {
                return responseJson(
                    {
                        error:
                            "Admin access required."
                    },
                    403
                );
            }

            if (
                actorMembership.role !==
                    "club_admin" &&
                ELEVATED_ROLES.has(
                    role
                )
            ) {
                return responseJson(
                    {
                        error:
                            "A Club Admin is required to grant Manager or Club Admin access."
                    },
                    403
                );
            }

            let targetUser =
                await findUserByEmail(
                    admin,
                    email
                );

            const userAlreadyExisted =
                Boolean(
                    targetUser
                );

            if (!targetUser) {
                const {
                    data:
                        inviteData,
                    error:
                        inviteError
                } =
                    await admin.auth.admin
                        .inviteUserByEmail(
                            email,
                            {
                                redirectTo,
                                data: {
                                    first_name:
                                        firstName,
                                    last_name:
                                        lastName,
                                    display_name:
                                        `${firstName} ${lastName}`
                                            .trim()
                                }
                            }
                        );

                if (inviteError) {
                    throw inviteError;
                }

                targetUser =
                    inviteData?.user ||
                    null;

                if (!targetUser) {
                    throw new Error(
                        "Supabase did not return the invited user."
                    );
                }
            }

            if (
                targetUser.id ===
                caller.id
            ) {
                return responseJson(
                    {
                        error:
                            "Use another Club Admin to change your own access."
                    },
                    400
                );
            }

            await ensureProfile(
                admin,
                targetUser.id,
                firstName,
                lastName
            );

            const {
                data:
                    existingMembership,
                error:
                    membershipReadError
            } =
                await admin
                    .from(
                        "club_memberships"
                    )
                    .select(
                        "id, membership_number, membership_type, status, role, joined_at, is_primary"
                    )
                    .eq(
                        "profile_id",
                        targetUser.id
                    )
                    .eq(
                        "club_id",
                        clubId
                    )
                    .maybeSingle();

            if (
                membershipReadError
            ) {
                throw membershipReadError;
            }

            if (
                existingMembership?.role ===
                    "club_admin" &&
                actorMembership.role !==
                    "club_admin"
            ) {
                return responseJson(
                    {
                        error:
                            "A Club Admin is required to manage another Club Admin."
                    },
                    403
                );
            }

            const accountConfirmed =
                Boolean(
                    targetUser
                        .email_confirmed_at ||
                    targetUser
                        .confirmed_at ||
                    targetUser
                        .last_sign_in_at
                );

            const status =
                accountConfirmed
                    ? "active"
                    : "invited";

            let membershipId:
                string;

            if (
                existingMembership
            ) {
                const {
                    data,
                    error
                } =
                    await admin
                        .from(
                            "club_memberships"
                        )
                        .update({
                            membership_type:
                                [
                                    "visitor",
                                    "guest"
                                ].includes(
                                    existingMembership
                                        .membership_type
                                )
                                    ? "staff"
                                    : existingMembership
                                        .membership_type,
                            status,
                            role,
                            joined_at:
                                status ===
                                    "active"
                                    ? (
                                        existingMembership
                                            .joined_at ||
                                        new Date()
                                            .toISOString()
                                            .slice(
                                                0,
                                                10
                                            )
                                    )
                                    : existingMembership
                                        .joined_at,
                            updated_at:
                                new Date()
                                    .toISOString()
                        })
                        .eq(
                            "id",
                            existingMembership.id
                        )
                        .select("id")
                        .single();

                if (error) {
                    throw error;
                }

                membershipId =
                    data.id;
            } else {
                const {
                    data:
                        primary,
                    error:
                        primaryError
                } =
                    await admin
                        .from(
                            "club_memberships"
                        )
                        .select("id")
                        .eq(
                            "profile_id",
                            targetUser.id
                        )
                        .eq(
                            "is_primary",
                            true
                        )
                        .maybeSingle();

                if (primaryError) {
                    throw primaryError;
                }

                const {
                    data,
                    error
                } =
                    await admin
                        .from(
                            "club_memberships"
                        )
                        .insert({
                            profile_id:
                                targetUser.id,
                            club_id:
                                clubId,
                            membership_number:
                                null,
                            membership_type:
                                "staff",
                            status,
                            role,
                            joined_at:
                                status ===
                                    "active"
                                    ? new Date()
                                        .toISOString()
                                        .slice(
                                            0,
                                            10
                                        )
                                    : null,
                            is_primary:
                                !primary
                        })
                        .select("id")
                        .single();

                if (error) {
                    throw error;
                }

                membershipId =
                    data.id;
            }

            return responseJson(
                {
                    ok: true,
                    invited:
                        !userAlreadyExisted,
                    linkedExistingAccount:
                        userAlreadyExisted,
                    membershipId,
                    profileId:
                        targetUser.id,
                    email,
                    role,
                    status
                }
            );
        } catch (error) {
            console.error(
                "admin-invite-staff failed:",
                error
            );

            return responseJson(
                {
                    error:
                        error instanceof Error
                            ? error.message
                            : "Staff invitation failed."
                },
                500
            );
        }
    }
);
