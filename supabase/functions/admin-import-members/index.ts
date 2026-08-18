import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_MEMBERSHIP_TYPES = new Set([
    "member",
    "junior",
    "student",
    "social",
    "corporate",
    "visitor",
    "guest",
    "staff"
]);

const ADMIN_ROLES = new Set([
    "manager",
    "club_admin"
]);

const MAX_ROWS_PER_REQUEST = 50;

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
};

type ImportRow = {
    rowNumber: number;
    firstName: string;
    lastName: string;
    email: string;
    membershipNumber?: string | null;
    membershipType?: string | null;
    handicapIndex?: number | null;
};

type ImportResult = {
    rowNumber: number;
    email: string;
    status: "imported" | "existing" | "failed";
    message: string;
    profileId?: string | null;
    membershipId?: string | null;
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
                "Content-Type": "application/json"
            }
        }
    );
}

function normaliseEmail(value: unknown) {
    return String(value || "")
        .trim()
        .toLowerCase();
}

function cleanText(value: unknown) {
    const text = String(value || "").trim();
    return text || null;
}

function getSecretKey() {
    const secretMap =
        Deno.env.get("SUPABASE_SECRET_KEYS");

    if (secretMap) {
        try {
            const parsed = JSON.parse(secretMap);
            const key = parsed?.default;

            if (typeof key === "string" && key.trim()) {
                return key.trim();
            }
        } catch {
            // Fall back to the legacy environment variable below.
        }
    }

    const legacy =
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (legacy && legacy.trim()) {
        return legacy.trim();
    }

    throw new Error(
        "No Supabase server secret is available to the Edge Function."
    );
}

function getBearerToken(request: Request) {
    const header =
        request.headers.get("Authorization") || "";

    const match =
        header.match(/^Bearer\s+(.+)$/i);

    return match?.[1]?.trim() || "";
}

function validateImportRow(row: ImportRow) {
    const errors: string[] = [];

    const email = normaliseEmail(row.email);
    const firstName = cleanText(row.firstName);
    const lastName = cleanText(row.lastName);
    const membershipType =
        String(row.membershipType || "member")
            .trim()
            .toLowerCase();

    if (!firstName) {
        errors.push("First name is required.");
    }

    if (!lastName) {
        errors.push("Last name is required.");
    }

    if (
        !email ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
        errors.push("A valid email address is required.");
    }

    if (!ALLOWED_MEMBERSHIP_TYPES.has(membershipType)) {
        errors.push(
            `Unsupported membership type: ${membershipType}.`
        );
    }

    if (
        row.handicapIndex !== null &&
        row.handicapIndex !== undefined
    ) {
        const handicap = Number(row.handicapIndex);

        if (
            !Number.isFinite(handicap) ||
            handicap < -10 ||
            handicap > 54
        ) {
            errors.push(
                "Handicap Index must be between -10.0 and 54.0."
            );
        }
    }

    return {
        errors,
        email,
        firstName,
        lastName,
        membershipType,
        membershipNumber:
            cleanText(row.membershipNumber),
        handicapIndex:
            row.handicapIndex === null ||
            row.handicapIndex === undefined ||
            String(row.handicapIndex).trim() === ""
                ? null
                : Number(row.handicapIndex)
    };
}

async function listAllAuthUsers(admin: any) {
    const users: any[] = [];
    let page = 1;
    const perPage = 1000;

    while (true) {
        const {
            data,
            error
        } = await admin.auth.admin.listUsers({
            page,
            perPage
        });

        if (error) {
            throw error;
        }

        const pageUsers = data?.users || [];
        users.push(...pageUsers);

        if (pageUsers.length < perPage) {
            break;
        }

        page += 1;

        if (page > 25) {
            throw new Error(
                "The Auth user directory is too large for this import operation."
            );
        }
    }

    return users;
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
    } = await admin
        .from("profiles")
        .select(
            "id, first_name, last_name, display_name"
        )
        .eq("id", userId)
        .maybeSingle();

    if (readError) {
        throw readError;
    }

    const displayName =
        `${firstName} ${lastName}`.trim();

    if (!current) {
        const {
            error: insertError
        } = await admin
            .from("profiles")
            .insert({
                id: userId,
                first_name: firstName,
                last_name: lastName,
                display_name: displayName
            });

        if (insertError) {
            throw insertError;
        }

        return;
    }

    const patch: Record<string, unknown> = {};

    if (!cleanText(current.first_name)) {
        patch.first_name = firstName;
    }

    if (!cleanText(current.last_name)) {
        patch.last_name = lastName;
    }

    if (!cleanText(current.display_name)) {
        patch.display_name = displayName;
    }

    if (!Object.keys(patch).length) {
        return;
    }

    patch.updated_at = new Date().toISOString();

    const {
        error: updateError
    } = await admin
        .from("profiles")
        .update(patch)
        .eq("id", userId);

    if (updateError) {
        throw updateError;
    }
}

async function ensureHandicap(
    admin: any,
    userId: string,
    handicapIndex: number | null
) {
    if (handicapIndex === null) {
        return "";
    }

    const {
        data: existing,
        error: readError
    } = await admin
        .from("player_handicaps")
        .select(
            "id, verification_status"
        )
        .eq("profile_id", userId)
        .maybeSingle();

    if (readError) {
        throw readError;
    }

    if (
        existing?.verification_status ===
        "verified"
    ) {
        return " Verified handicap preserved.";
    }

    const now = new Date().toISOString();

    if (existing) {
        const {
            error: updateError
        } = await admin
            .from("player_handicaps")
            .update({
                handicap_index: handicapIndex,
                governing_body: "manual",
                verification_status: "pending",
                last_checked_at: now,
                updated_at: now
            })
            .eq("id", existing.id);

        if (updateError) {
            throw updateError;
        }

        return " Handicap awaiting verification.";
    }

    const {
        error: insertError
    } = await admin
        .from("player_handicaps")
        .insert({
            profile_id: userId,
            governing_body: "manual",
            handicap_index: handicapIndex,
            verification_status: "pending",
            last_checked_at: now
        });

    if (insertError) {
        throw insertError;
    }

    return " Handicap awaiting verification.";
}

async function ensureMembership(
    admin: any,
    clubId: string,
    user: any,
    membershipNumber: string | null,
    membershipType: string,
    existingMembership: any | null
) {
    const accountIsConfirmed = Boolean(
        user?.email_confirmed_at ||
        user?.confirmed_at ||
        user?.last_sign_in_at
    );

    if (existingMembership) {
        let nextStatus =
            existingMembership.status;

        if (
            accountIsConfirmed &&
            ["invited", "pending"].includes(
                existingMembership.status
            )
        ) {
            nextStatus = "active";
        }

        const {
            data,
            error
        } = await admin
            .from("club_memberships")
            .update({
                membership_number:
                    existingMembership.membership_number ||
                    membershipNumber,
                membership_type:
                    existingMembership.membership_type ||
                    membershipType,
                status: nextStatus,
                joined_at:
                    nextStatus === "active"
                        ? existingMembership.joined_at ||
                          new Date()
                              .toISOString()
                              .slice(0, 10)
                        : existingMembership.joined_at,
                updated_at:
                    new Date().toISOString()
            })
            .eq("id", existingMembership.id)
            .select(
                "id, status, role, is_primary"
            )
            .single();

        if (error) {
            throw error;
        }

        return data;
    }

    const {
        data: primaryMembership,
        error: primaryError
    } = await admin
        .from("club_memberships")
        .select("id")
        .eq("profile_id", user.id)
        .eq("is_primary", true)
        .maybeSingle();

    if (primaryError) {
        throw primaryError;
    }

    const status =
        accountIsConfirmed
            ? "active"
            : "invited";

    const {
        data,
        error
    } = await admin
        .from("club_memberships")
        .insert({
            profile_id: user.id,
            club_id: clubId,
            membership_number: membershipNumber,
            membership_type: membershipType,
            status,
            role: "member",
            joined_at:
                status === "active"
                    ? new Date()
                        .toISOString()
                        .slice(0, 10)
                    : null,
            is_primary: !primaryMembership
        })
        .select(
            "id, status, role, is_primary"
        )
        .single();

    if (error) {
        throw error;
    }

    return data;
}

Deno.serve(async (request) => {
    if (request.method === "OPTIONS") {
        return new Response("ok", {
            headers: corsHeaders
        });
    }

    if (request.method !== "POST") {
        return responseJson(
            { error: "Method not allowed." },
            405
        );
    }

    try {
        const supabaseUrl =
            Deno.env.get("SUPABASE_URL");

        if (!supabaseUrl) {
            throw new Error(
                "SUPABASE_URL is unavailable."
            );
        }

        const secretKey = getSecretKey();

        const admin = createClient(
            supabaseUrl,
            secretKey,
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            }
        );

        const token = getBearerToken(request);

        if (!token) {
            return responseJson(
                { error: "Authentication required." },
                401
            );
        }

        const {
            data: { user: caller },
            error: callerError
        } = await admin.auth.getUser(token);

        if (callerError || !caller) {
            return responseJson(
                { error: "Authentication required." },
                401
            );
        }

        const body = await request.json();

        const clubId =
            cleanText(body?.clubId);

        const filename =
            cleanText(body?.filename);

        const redirectTo =
            cleanText(body?.redirectTo);

        const totalRows =
            Math.max(
                0,
                Number(body?.totalRows || 0)
            );

        const isFinalChunk =
            body?.isFinalChunk === true;

        const rows =
            Array.isArray(body?.rows)
                ? body.rows as ImportRow[]
                : [];

        if (!clubId) {
            return responseJson(
                { error: "Club ID is required." },
                400
            );
        }

        if (!rows.length) {
            return responseJson(
                { error: "No member rows were supplied." },
                400
            );
        }

        if (rows.length > MAX_ROWS_PER_REQUEST) {
            return responseJson(
                {
                    error:
                        `A maximum of ${MAX_ROWS_PER_REQUEST} rows can be imported per request.`
                },
                400
            );
        }

        const {
            data: adminMembership,
            error: adminMembershipError
        } = await admin
            .from("club_memberships")
            .select("id, role")
            .eq("profile_id", caller.id)
            .eq("club_id", clubId)
            .eq("status", "active")
            .maybeSingle();

        if (
            adminMembershipError ||
            !adminMembership ||
            !ADMIN_ROLES.has(
                adminMembership.role
            )
        ) {
            return responseJson(
                { error: "Admin access required." },
                403
            );
        }

        let batchId =
            cleanText(body?.batchId);

        if (batchId) {
            const {
                data: batch,
                error: batchError
            } = await admin
                .from("member_import_batches")
                .select(
                    "id, club_id, created_by, status"
                )
                .eq("id", batchId)
                .maybeSingle();

            if (
                batchError ||
                !batch ||
                batch.club_id !== clubId ||
                batch.created_by !== caller.id
            ) {
                return responseJson(
                    { error: "Import batch is invalid." },
                    400
                );
            }
        } else {
            const {
                data: batch,
                error: batchError
            } = await admin
                .from("member_import_batches")
                .insert({
                    club_id: clubId,
                    created_by: caller.id,
                    source_filename: filename,
                    total_rows: totalRows,
                    status: "processing"
                })
                .select("id")
                .single();

            if (batchError) {
                throw batchError;
            }

            batchId = batch.id;
        }

        const authUsers =
            await listAllAuthUsers(admin);

        const usersByEmail = new Map(
            authUsers
                .filter((user) => user.email)
                .map((user) => [
                    normaliseEmail(user.email),
                    user
                ])
        );

        const {
            data: clubMemberships,
            error: membershipsError
        } = await admin
            .from("club_memberships")
            .select(
                "id, profile_id, membership_number, membership_type, status, role, joined_at, is_primary"
            )
            .eq("club_id", clubId);

        if (membershipsError) {
            throw membershipsError;
        }

        const membershipByProfile = new Map(
            (clubMemberships || []).map(
                (membership: any) => [
                    membership.profile_id,
                    membership
                ]
            )
        );

        const membershipNumberOwner = new Map<string, string>();

        for (const membership of clubMemberships || []) {
            const number =
                cleanText(membership.membership_number);

            if (number) {
                membershipNumberOwner.set(
                    number.toLowerCase(),
                    membership.profile_id
                );
            }
        }

        const seenEmails = new Set<string>();
        const seenMembershipNumbers = new Set<string>();
        const results: ImportResult[] = [];

        for (const rawRow of rows) {
            const rowNumber =
                Number(rawRow?.rowNumber || 0);

            const validation =
                validateImportRow(rawRow);

            let result: ImportResult;

            try {
                if (!Number.isInteger(rowNumber) || rowNumber <= 0) {
                    throw new Error(
                        "CSV row number is invalid."
                    );
                }

                if (validation.errors.length) {
                    throw new Error(
                        validation.errors.join(" ")
                    );
                }

                if (seenEmails.has(validation.email)) {
                    throw new Error(
                        "Duplicate email address in this import chunk."
                    );
                }

                seenEmails.add(validation.email);

                if (validation.membershipNumber) {
                    const membershipKey =
                        validation.membershipNumber.toLowerCase();

                    if (
                        seenMembershipNumbers.has(
                            membershipKey
                        )
                    ) {
                        throw new Error(
                            "Duplicate membership number in this import chunk."
                        );
                    }

                    seenMembershipNumbers.add(
                        membershipKey
                    );
                }

                let targetUser =
                    usersByEmail.get(
                        validation.email
                    ) || null;

                const userAlreadyExisted =
                    Boolean(targetUser);

                if (!targetUser) {
                    const inviteOptions: any = {
                        data: {
                            first_name:
                                validation.firstName,
                            last_name:
                                validation.lastName,
                            display_name:
                                `${validation.firstName} ${validation.lastName}`.trim()
                        }
                    };

                    if (redirectTo) {
                        inviteOptions.redirectTo =
                            redirectTo;
                    }

                    const {
                        data: inviteData,
                        error: inviteError
                    } = await admin.auth.admin
                        .inviteUserByEmail(
                            validation.email,
                            inviteOptions
                        );

                    if (inviteError) {
                        throw inviteError;
                    }

                    targetUser =
                        inviteData?.user || null;

                    if (!targetUser) {
                        throw new Error(
                            "Supabase did not return the invited user."
                        );
                    }

                    usersByEmail.set(
                        validation.email,
                        targetUser
                    );
                }

                const existingMembership =
                    membershipByProfile.get(
                        targetUser.id
                    ) || null;

                if (validation.membershipNumber) {
                    const membershipOwner =
                        membershipNumberOwner.get(
                            validation.membershipNumber
                                .toLowerCase()
                        );

                    if (
                        membershipOwner &&
                        membershipOwner !==
                            targetUser.id
                    ) {
                        throw new Error(
                            `Membership number ${validation.membershipNumber} is already assigned to another member.`
                        );
                    }
                }

                await ensureProfile(
                    admin,
                    targetUser.id,
                    validation.firstName!,
                    validation.lastName!
                );

                const membership =
                    await ensureMembership(
                        admin,
                        clubId,
                        targetUser,
                        validation.membershipNumber,
                        validation.membershipType,
                        existingMembership
                    );

                membershipByProfile.set(
                    targetUser.id,
                    {
                        ...(existingMembership || {}),
                        ...membership,
                        profile_id: targetUser.id,
                        membership_number:
                            validation.membershipNumber,
                        membership_type:
                            validation.membershipType
                    }
                );

                if (validation.membershipNumber) {
                    membershipNumberOwner.set(
                        validation.membershipNumber
                            .toLowerCase(),
                        targetUser.id
                    );
                }

                const handicapMessage =
                    await ensureHandicap(
                        admin,
                        targetUser.id,
                        validation.handicapIndex
                    );

                const status =
                    userAlreadyExisted
                        ? "existing"
                        : "imported";

                const accountMessage =
                    userAlreadyExisted
                        ? "Existing Paryx account linked to this club."
                        : "Invitation sent and member created.";

                result = {
                    rowNumber,
                    email: validation.email,
                    status,
                    message:
                        accountMessage +
                        handicapMessage,
                    profileId: targetUser.id,
                    membershipId: membership.id
                };
            } catch (error) {
                result = {
                    rowNumber:
                        rowNumber ||
                        Number(rawRow?.rowNumber || 1),
                    email:
                        validation.email ||
                        normaliseEmail(rawRow?.email),
                    status: "failed",
                    message:
                        error instanceof Error
                            ? error.message
                            : String(error),
                    profileId: null,
                    membershipId: null
                };
            }

            results.push(result);

            const rawSource = rows.find(
                (item) =>
                    Number(item.rowNumber) ===
                    result.rowNumber
            );

            const validatedSource =
                rawSource
                    ? validateImportRow(rawSource)
                    : null;

            const {
                error: auditError
            } = await admin
                .from("member_import_rows")
                .upsert(
                    {
                        batch_id: batchId,
                        row_number:
                            result.rowNumber,
                        email:
                            result.email ||
                            "unknown@example.invalid",
                        first_name:
                            validatedSource?.firstName,
                        last_name:
                            validatedSource?.lastName,
                        membership_number:
                            validatedSource?.membershipNumber,
                        membership_type:
                            validatedSource?.membershipType,
                        handicap_index:
                            validatedSource?.handicapIndex,
                        result_status:
                            result.status,
                        result_message:
                            result.message,
                        profile_id:
                            result.profileId || null,
                        membership_id:
                            result.membershipId || null
                    },
                    {
                        onConflict:
                            "batch_id,row_number"
                    }
                );

            if (auditError) {
                console.error(
                    "Could not write import audit row:",
                    auditError
                );
            }
        }

        const {
            data: allBatchRows,
            error: batchRowsError
        } = await admin
            .from("member_import_rows")
            .select("result_status")
            .eq("batch_id", batchId);

        if (batchRowsError) {
            throw batchRowsError;
        }

        const importedCount =
            (allBatchRows || []).filter(
                (row: any) =>
                    row.result_status === "imported"
            ).length;

        const existingCount =
            (allBatchRows || []).filter(
                (row: any) =>
                    row.result_status === "existing"
            ).length;

        const failedCount =
            (allBatchRows || []).filter(
                (row: any) =>
                    row.result_status === "failed"
            ).length;

        const batchStatus =
            isFinalChunk
                ? failedCount > 0
                    ? "partial"
                    : "completed"
                : "processing";

        const {
            error: batchUpdateError
        } = await admin
            .from("member_import_batches")
            .update({
                imported_count: importedCount,
                existing_count: existingCount,
                failed_count: failedCount,
                status: batchStatus,
                completed_at:
                    isFinalChunk
                        ? new Date().toISOString()
                        : null
            })
            .eq("id", batchId);

        if (batchUpdateError) {
            throw batchUpdateError;
        }

        return responseJson({
            batchId,
            results,
            summary: {
                imported: importedCount,
                existing: existingCount,
                failed: failedCount,
                processed:
                    importedCount +
                    existingCount +
                    failedCount,
                total: totalRows,
                status: batchStatus
            }
        });
    } catch (error) {
        console.error(
            "admin-import-members failed:",
            error
        );

        return responseJson(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : String(error)
            },
            500
        );
    }
});
