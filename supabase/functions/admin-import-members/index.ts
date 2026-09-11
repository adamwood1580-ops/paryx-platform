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
    membershipNumber: string;
    membershipType?: string | null;
    handicapIndex?: number | null;
};

type ImportResult = {
    rowNumber: number;
    email: string;
    status: "imported" | "existing" | "failed";
    message: string;
    membershipId?: string | null;
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

function normaliseEmail(value: unknown) {
    return String(value || "").trim().toLowerCase();
}

function normaliseMembershipNumber(value: unknown) {
    return String(value || "").trim().toLowerCase();
}

function cleanText(value: unknown) {
    const text = String(value || "").trim();
    return text || null;
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
            // Fall through to legacy service-role environment variable.
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

function validateImportRow(row: ImportRow) {
    const errors: string[] = [];
    const email = normaliseEmail(row.email);
    const firstName = cleanText(row.firstName);
    const lastName = cleanText(row.lastName);
    const membershipNumber = cleanText(row.membershipNumber);
    const membershipType = String(row.membershipType || "member")
        .trim()
        .toLowerCase();

    if (!firstName) {
        errors.push("First name is required.");
    }

    if (!lastName) {
        errors.push("Last name is required.");
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push("A valid club contact email is required.");
    }

    if (!membershipNumber) {
        errors.push("Membership number is required.");
    }

    if (!ALLOWED_MEMBERSHIP_TYPES.has(membershipType)) {
        errors.push(`Unsupported membership type: ${membershipType}.`);
    }

    let handicapIndex: number | null = null;

    if (
        row.handicapIndex !== null &&
        row.handicapIndex !== undefined &&
        String(row.handicapIndex).trim() !== ""
    ) {
        handicapIndex = Number(row.handicapIndex);

        if (
            !Number.isFinite(handicapIndex) ||
            handicapIndex < -10 ||
            handicapIndex > 54
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
        membershipNumber,
        membershipType,
        handicapIndex
    };
}

Deno.serve(async (request) => {
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
                    persistSession: false
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

        const body = await request.json();
        const clubId = cleanText(body?.clubId);
        const filename = cleanText(body?.filename);
        const totalRows = Math.max(0, Number(body?.totalRows || 0));
        const isFinalChunk = body?.isFinalChunk === true;
        const rows = Array.isArray(body?.rows)
            ? body.rows as ImportRow[]
            : [];

        if (!clubId) {
            return responseJson({ error: "Club ID is required." }, 400);
        }

        if (!rows.length) {
            return responseJson({ error: "No member rows were supplied." }, 400);
        }

        if (rows.length > MAX_ROWS_PER_REQUEST) {
            return responseJson({
                error:
                    `A maximum of ${MAX_ROWS_PER_REQUEST} rows can be imported per request.`
            }, 400);
        }

        // Staff authentication is still profile-based. Ordinary club members
        // do not need a Paryx profile after Identity v2.
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
            !ADMIN_ROLES.has(String(adminMembership.role))
        ) {
            return responseJson({ error: "Admin access required." }, 403);
        }

        let batchId = cleanText(body?.batchId);

        if (batchId) {
            const { data: batch, error: batchError } = await admin
                .from("member_import_batches")
                .select("id, club_id, created_by, status")
                .eq("id", batchId)
                .maybeSingle();

            if (
                batchError ||
                !batch ||
                batch.club_id !== clubId ||
                batch.created_by !== caller.id
            ) {
                return responseJson({ error: "Import batch is invalid." }, 400);
            }
        } else {
            const { data: batch, error: batchError } = await admin
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

        const { data: currentMemberships, error: membershipsError } =
            await admin
                .from("club_memberships")
                .select([
                    "id",
                    "profile_id",
                    "membership_number",
                    "membership_type",
                    "status",
                    "role",
                    "club_first_name",
                    "club_last_name",
                    "club_display_name",
                    "club_email",
                    "club_handicap_index",
                    "club_handicap_status"
                ].join(","))
                .eq("club_id", clubId);

        if (membershipsError) {
            throw membershipsError;
        }

        // One membership number should identify one club member. We do not
        // silently choose between legacy duplicates.
        const membershipsByNumber = new Map<string, any[]>();

        for (const membership of currentMemberships || []) {
            const key = normaliseMembershipNumber(
                membership.membership_number
            );

            if (!key) {
                continue;
            }

            const list = membershipsByNumber.get(key) || [];
            list.push(membership);
            membershipsByNumber.set(key, list);
        }

        const seenNumbers = new Set<string>();
        const results: ImportResult[] = [];

        for (const rawRow of rows) {
            const rowNumber = Number(rawRow?.rowNumber || 0);
            const validation = validateImportRow(rawRow);
            let result: ImportResult;

            try {
                if (!Number.isInteger(rowNumber) || rowNumber <= 0) {
                    throw new Error("CSV row number is invalid.");
                }

                if (validation.errors.length) {
                    throw new Error(validation.errors.join(" "));
                }

                const membershipKey = normaliseMembershipNumber(
                    validation.membershipNumber
                );

                if (seenNumbers.has(membershipKey)) {
                    throw new Error(
                        "Duplicate membership number in this import chunk."
                    );
                }

                seenNumbers.add(membershipKey);

                const matches = membershipsByNumber.get(membershipKey) || [];

                if (matches.length > 1) {
                    throw new Error(
                        `Membership number ${validation.membershipNumber} exists more than once at this club. Resolve the duplicate before importing.`
                    );
                }

                const displayName =
                    `${validation.firstName} ${validation.lastName}`.trim();

                let membershipId: string;
                let status: "imported" | "existing";
                let message: string;

                if (matches.length === 1) {
                    const existing = matches[0];

                    const update: Record<string, unknown> = {
                        club_first_name: validation.firstName,
                        club_last_name: validation.lastName,
                        club_display_name: displayName,
                        club_email: validation.email,
                        membership_type: validation.membershipType,
                        club_handicap_index: validation.handicapIndex,
                        club_handicap_status:
                            validation.handicapIndex === null
                                ? existing.club_handicap_status
                                : "pending",
                        updated_at: new Date().toISOString()
                    };

                    const { data, error } = await admin
                        .from("club_memberships")
                        .update(update)
                        .eq("id", existing.id)
                        .eq("club_id", clubId)
                        .select("id")
                        .single();

                    if (error) {
                        throw error;
                    }

                    membershipId = data.id;
                    status = "existing";
                    message =
                        "Existing club membership updated. No Paryx Player account was created or changed.";
                } else {
                    const { data, error } = await admin
                        .from("club_memberships")
                        .insert({
                            profile_id: null,
                            club_id: clubId,
                            membership_number: validation.membershipNumber,
                            membership_type: validation.membershipType,
                            status: "active",
                            role: "member",
                            joined_at: null,
                            is_primary: false,
                            club_first_name: validation.firstName,
                            club_last_name: validation.lastName,
                            club_display_name: displayName,
                            club_email: validation.email,
                            club_handicap_index: validation.handicapIndex,
                            club_handicap_status:
                                validation.handicapIndex === null
                                    ? null
                                    : "pending"
                        })
                        .select("id")
                        .single();

                    if (error) {
                        throw error;
                    }

                    membershipId = data.id;
                    status = "imported";
                    message =
                        "Active club membership created. No Paryx Player account or invitation was created.";

                    const newMembership = {
                        id: membershipId,
                        profile_id: null,
                        membership_number: validation.membershipNumber,
                        membership_type: validation.membershipType,
                        status: "active",
                        role: "member",
                        club_first_name: validation.firstName,
                        club_last_name: validation.lastName,
                        club_display_name: displayName,
                        club_email: validation.email,
                        club_handicap_index: validation.handicapIndex,
                        club_handicap_status:
                            validation.handicapIndex === null
                                ? null
                                : "pending"
                    };

                    membershipsByNumber.set(
                        membershipKey,
                        [newMembership]
                    );
                }

                result = {
                    rowNumber,
                    email: validation.email,
                    status,
                    message,
                    membershipId
                };
            } catch (error) {
                result = {
                    rowNumber:
                        rowNumber || Number(rawRow?.rowNumber || 1),
                    email:
                        validation.email || normaliseEmail(rawRow?.email),
                    status: "failed",
                    message:
                        error instanceof Error
                            ? error.message
                            : String(error),
                    membershipId: null
                };
            }

            results.push(result);

            const { error: auditError } = await admin
                .from("member_import_rows")
                .upsert({
                    batch_id: batchId,
                    row_number: result.rowNumber,
                    email:
                        result.email || "unknown@example.invalid",
                    first_name: validation.firstName,
                    last_name: validation.lastName,
                    membership_number:
                        validation.membershipNumber,
                    membership_type:
                        validation.membershipType,
                    handicap_index:
                        validation.handicapIndex,
                    result_status: result.status,
                    result_message: result.message,
                    membership_id:
                        result.membershipId || null
                }, {
                    onConflict: "batch_id,row_number"
                });

            if (auditError) {
                console.error(
                    "Could not write import audit row:",
                    auditError
                );
            }
        }

        const { data: allBatchRows, error: batchRowsError } = await admin
            .from("member_import_rows")
            .select("result_status")
            .eq("batch_id", batchId);

        if (batchRowsError) {
            throw batchRowsError;
        }

        const importedCount = (allBatchRows || []).filter(
            (row: any) => row.result_status === "imported"
        ).length;

        const existingCount = (allBatchRows || []).filter(
            (row: any) => row.result_status === "existing"
        ).length;

        const failedCount = (allBatchRows || []).filter(
            (row: any) => row.result_status === "failed"
        ).length;

        const batchStatus = isFinalChunk
            ? failedCount > 0
                ? "partial"
                : "completed"
            : "processing";

        const { error: batchUpdateError } = await admin
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
                    importedCount + existingCount + failedCount,
                total: totalRows,
                status: batchStatus
            }
        });
    } catch (error) {
        console.error("admin-import-members failed:", error);

        return responseJson({
            error:
                error instanceof Error
                    ? error.message
                    : String(error)
        }, 500);
    }
});
