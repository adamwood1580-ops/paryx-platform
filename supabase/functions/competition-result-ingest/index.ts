import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAX_RESULT_ROWS = 1000;
const MANAGE_ROLES = new Set(["manager", "club_admin"]);

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-paryx-bridge-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
        }
    });
}

function getSecretKey() {
    const secretMap = Deno.env.get("SUPABASE_SECRET_KEYS");
    if (secretMap) {
        try {
            const parsed = JSON.parse(secretMap);
            if (typeof parsed?.default === "string" && parsed.default.trim()) {
                return parsed.default.trim();
            }
        } catch {
            // Fall through to the legacy variable.
        }
    }
    const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (legacy && legacy.trim()) return legacy.trim();
    throw new Error("No Supabase server secret is available to the Edge Function.");
}

function cleanText(value: unknown) {
    const text = String(value ?? "").trim();
    return text || null;
}

function getBearerToken(request: Request) {
    const header = request.headers.get("Authorization") || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || "";
}

function bytesToHex(bytes: Uint8Array) {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text: string) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return bytesToHex(new Uint8Array(digest));
}

function randomDeviceToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return `pb_${bytesToHex(bytes)}`;
}

function canonicalHeader(value: string) {
    return value
        .replace(/^\uFEFF/, "")
        .trim()
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

const aliases = {
    placing: new Set([
        "position", "pos", "place", "placing", "finish position", "finishing position",
        "finishing pos", "rank", "result position"
    ]),
    player: new Set([
        "player", "player name", "competitor", "competitor name", "member", "member name",
        "name", "golfer", "golfer name"
    ]),
    firstName: new Set(["first name", "firstname", "forename", "given name"]),
    lastName: new Set(["last name", "lastname", "surname", "family name"]),
    membershipNumber: new Set([
        "membership number", "member number", "membership no", "member no", "membership number no",
        "club number", "member id", "membership id"
    ]),
    externalPlayerId: new Set(["player id", "competitor id", "clubv1 player id", "person id"]),
    externalResultId: new Set(["result id", "entry id", "competition result id"]),
    gross: new Set(["gross", "gross score", "gross total"]),
    nett: new Set(["nett", "net", "nett score", "net score", "nett total", "net total"]),
    points: new Set(["points", "stableford points", "pts"]),
    resultText: new Set(["result", "result text", "score", "score result"])
};

type ParsedCsv = {
    headerRow: number;
    results: Array<Record<string, unknown>>;
    detectedDate: string | null;
    detectedName: string | null;
};

function countDelimiterOutsideQuotes(line: string, delimiter: string) {
    let count = 0;
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
        if (line[i] === '"') {
            if (quoted && line[i + 1] === '"') i += 1;
            else quoted = !quoted;
        } else if (!quoted && line[i] === delimiter) {
            count += 1;
        }
    }
    return count;
}

function detectDelimiter(text: string) {
    const lines = text.split(/\r?\n/).slice(0, 20).filter((line) => line.trim());
    const choices = [",", ";", "\t"];
    let best = ",";
    let bestScore = -1;
    for (const delimiter of choices) {
        const counts = lines.map((line) => countDelimiterOutsideQuotes(line, delimiter));
        const positive = counts.filter((count) => count > 0);
        const score = positive.length ? positive.reduce((a, b) => a + b, 0) / positive.length : 0;
        if (score > bestScore) {
            best = delimiter;
            bestScore = score;
        }
    }
    return best;
}

function parseDelimited(text: string, delimiter: string) {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        const next = text[i + 1];
        if (ch === '"') {
            if (quoted && next === '"') {
                field += '"';
                i += 1;
            } else {
                quoted = !quoted;
            }
            continue;
        }
        if (ch === delimiter && !quoted) {
            row.push(field);
            field = "";
            continue;
        }
        if ((ch === "\n" || ch === "\r") && !quoted) {
            if (ch === "\r" && next === "\n") i += 1;
            row.push(field);
            field = "";
            if (row.some((value) => value.trim() !== "")) rows.push(row);
            row = [];
            continue;
        }
        field += ch;
    }

    row.push(field);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    if (quoted) throw new Error("The CSV contains an unclosed quoted field.");
    return rows;
}

function findIndex(headers: string[], set: Set<string>) {
    return headers.findIndex((header) => set.has(header));
}

function findHeaderRow(rows: string[][]) {
    const max = Math.min(rows.length, 30);
    for (let i = 0; i < max; i += 1) {
        const headers = rows[i].map(canonicalHeader);
        const placing = findIndex(headers, aliases.placing);
        const player = findIndex(headers, aliases.player);
        const first = findIndex(headers, aliases.firstName);
        const last = findIndex(headers, aliases.lastName);
        if (placing >= 0 && (player >= 0 || (first >= 0 && last >= 0))) {
            return i;
        }
    }
    return -1;
}

function parseInteger(value: string | undefined) {
    const text = String(value ?? "").trim();
    if (!text) return null;
    const match = text.match(/-?\d+/);
    if (!match) return null;
    const number = Number(match[0]);
    return Number.isInteger(number) ? number : null;
}

function fieldIndex(headers: string[], set: Set<string>) {
    return findIndex(headers, set);
}

function cell(row: string[], index: number) {
    return index >= 0 ? String(row[index] ?? "").trim() : "";
}

function extractDate(text: string) {
    const iso = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
    if (iso) {
        const [, y, m, d] = iso;
        return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    const uk = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
    if (uk) {
        const [, d, m, y] = uk;
        return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    return null;
}

function inferCompetitionName(rows: string[][], headerRow: number, filename: string) {
    const candidates = rows.slice(0, headerRow).map((row) => row.join(" ").trim()).filter(Boolean);
    for (const candidate of candidates) {
        const value = candidate.replace(/\s+/g, " ").trim();
        if (value.length < 4 || value.length > 140) continue;
        if (/^(report|results?|competition results?|printed|generated|date)\b/i.test(value)) continue;
        if (extractDate(value)) continue;
        return value;
    }
    return filename
        .replace(/\.csv$/i, "")
        .replace(/[_-]+/g, " ")
        .replace(/\b(results?|competition|export|clubv1)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim() || null;
}

function parseClubV1Csv(csvText: string, filename: string): ParsedCsv {
    const delimiter = detectDelimiter(csvText);
    const rows = parseDelimited(csvText.replace(/^\uFEFF/, ""), delimiter);
    if (!rows.length) throw new Error("The CSV is empty.");

    const headerRow = findHeaderRow(rows);
    if (headerRow < 0) {
        throw new Error("Paryx could not find a finishing-position and player-name header in this CSV. A genuine ClubV1 sample is needed to add this export layout.");
    }

    const headers = rows[headerRow].map(canonicalHeader);
    const idx = {
        placing: fieldIndex(headers, aliases.placing),
        player: fieldIndex(headers, aliases.player),
        first: fieldIndex(headers, aliases.firstName),
        last: fieldIndex(headers, aliases.lastName),
        membershipNumber: fieldIndex(headers, aliases.membershipNumber),
        externalPlayerId: fieldIndex(headers, aliases.externalPlayerId),
        externalResultId: fieldIndex(headers, aliases.externalResultId),
        gross: fieldIndex(headers, aliases.gross),
        nett: fieldIndex(headers, aliases.nett),
        points: fieldIndex(headers, aliases.points),
        resultText: fieldIndex(headers, aliases.resultText)
    };

    const results: Array<Record<string, unknown>> = [];
    for (const row of rows.slice(headerRow + 1)) {
        const placing = parseInteger(cell(row, idx.placing));
        const explicitPlayer = cell(row, idx.player);
        const playerName = explicitPlayer || [cell(row, idx.first), cell(row, idx.last)].filter(Boolean).join(" ");
        if (!playerName || placing === null) continue;
        if (placing < 1) continue;

        const gross = parseInteger(cell(row, idx.gross));
        const nett = parseInteger(cell(row, idx.nett));
        const points = parseInteger(cell(row, idx.points));
        let resultText = cleanText(cell(row, idx.resultText));
        if (!resultText) {
            if (points !== null) resultText = `${points} pts`;
            else if (nett !== null && gross !== null) resultText = `Gross ${gross} · Nett ${nett}`;
            else if (nett !== null) resultText = `Nett ${nett}`;
            else if (gross !== null) resultText = `Gross ${gross}`;
        }

        results.push({
            external_result_id: cleanText(cell(row, idx.externalResultId)),
            external_player_id: cleanText(cell(row, idx.externalPlayerId)),
            membership_number: cleanText(cell(row, idx.membershipNumber)),
            player_name: playerName,
            finishing_position: placing,
            gross_score: gross,
            nett_score: nett,
            points,
            result_text: resultText
        });
        if (results.length > MAX_RESULT_ROWS) {
            throw new Error(`The CSV contains more than ${MAX_RESULT_ROWS} result rows.`);
        }
    }

    if (!results.length) {
        throw new Error("No placed players were found below the detected CSV header.");
    }

    const metadataText = [filename, ...rows.slice(0, Math.min(headerRow + 1, 15)).map((row) => row.join(" "))].join(" ");
    return {
        headerRow: headerRow + 1,
        results,
        detectedDate: extractDate(metadataText),
        detectedName: inferCompetitionName(rows, headerRow, filename)
    };
}

function normalizeForMatch(value: string | null | undefined) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\b(golf|club|competition|results?|result|the|and)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function nameScore(a: string | null | undefined, b: string | null | undefined) {
    const left = normalizeForMatch(a);
    const right = normalizeForMatch(b);
    if (!left || !right) return 0;
    if (left === right) return 1;
    if (left.includes(right) || right.includes(left)) return 0.88;
    const l = new Set(left.split(" ").filter(Boolean));
    const r = new Set(right.split(" ").filter(Boolean));
    const intersection = [...l].filter((token) => r.has(token)).length;
    const union = new Set([...l, ...r]).size;
    return union ? intersection / union : 0;
}

async function userForRequest(service: ReturnType<typeof createClient>, request: Request) {
    const token = getBearerToken(request);
    if (!token) throw new Error("Authenticated ClubHub session required.");
    const { data, error } = await service.auth.getUser(token);
    if (error || !data.user) throw new Error("Authenticated ClubHub session required.");
    return data.user;
}

async function requireClubRole(service: ReturnType<typeof createClient>, userId: string, clubId: string, roles: Set<string>) {
    const { data, error } = await service
        .from("club_memberships")
        .select("role,status")
        .eq("club_id", clubId)
        .eq("profile_id", userId)
        .eq("status", "active")
        .maybeSingle();
    if (error || !data || !roles.has(String(data.role))) {
        throw new Error("Club Admin or Manager access required.");
    }
}

async function ensureClubV1Integration(service: ReturnType<typeof createClient>, clubId: string) {
    const { error } = await service
        .from("club_competition_result_integrations")
        .upsert({
            club_id: clubId,
            provider: "clubv1",
            is_enabled: true,
            updated_at: new Date().toISOString()
        }, { onConflict: "club_id,provider" });
    if (error) throw error;
}

async function resolveCompetition(
    service: ReturnType<typeof createClient>,
    clubId: string,
    explicitCompetitionId: string | null,
    parsed: ParsedCsv,
    filename: string
) {
    if (explicitCompetitionId) {
        const { data, error } = await service
            .from("club_competitions")
            .select("id,club_id,name,competition_date,results_confirmed_at")
            .eq("id", explicitCompetitionId)
            .eq("club_id", clubId)
            .maybeSingle();
        if (error || !data) throw new Error("The selected competition was not found for this club.");
        if (data.results_confirmed_at) throw new Error("This competition has already been confirmed.");
        return data;
    }

    let query = service
        .from("club_competitions")
        .select("id,club_id,name,competition_date,results_confirmed_at")
        .eq("club_id", clubId)
        .is("results_confirmed_at", null)
        .order("competition_date", { ascending: false })
        .limit(30);

    if (parsed.detectedDate) {
        query = query.eq("competition_date", parsed.detectedDate);
    } else {
        const now = new Date();
        const from = new Date(now.getTime() - 4 * 86400000).toISOString().slice(0, 10);
        const to = new Date(now.getTime() + 1 * 86400000).toISOString().slice(0, 10);
        query = query.gte("competition_date", from).lte("competition_date", to);
    }

    const { data, error } = await query;
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 1) return rows[0];
    if (!rows.length) return null;

    const hint = parsed.detectedName || filename;
    const ranked = rows
        .map((row) => ({ row, score: nameScore(hint, row.name) }))
        .sort((a, b) => b.score - a.score);

    if (ranked[0].score >= 0.72 && (ranked.length === 1 || ranked[0].score - ranked[1].score >= 0.18)) {
        return ranked[0].row;
    }
    return null;
}

async function validateBridgeToken(service: ReturnType<typeof createClient>, token: string) {
    if (!token || !token.startsWith("pb_")) throw new Error("Valid Paryx Bridge credential required.");
    const hash = await sha256Hex(token);
    const { data, error } = await service
        .from("club_competition_bridge_devices")
        .select("id,club_id,device_name,is_active")
        .eq("token_hash", hash)
        .eq("is_active", true)
        .maybeSingle();
    if (error || !data) throw new Error("Paryx Bridge credential is invalid or revoked.");
    await service.from("club_competition_bridge_devices").update({
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    }).eq("id", data.id);
    return data;
}

async function stageAndImport(
    service: ReturnType<typeof createClient>,
    params: {
        clubId: string;
        competitionId: string | null;
        bridgeDeviceId: string | null;
        sourceMethod: "manual_upload" | "windows_bridge";
        filename: string;
        csvText: string;
    }
) {
    const size = new TextEncoder().encode(params.csvText).length;
    if (size <= 0) throw new Error("The CSV file is empty.");
    if (size > MAX_CSV_BYTES) throw new Error("The CSV is larger than the 2 MB competition-import limit.");

    const hash = await sha256Hex(params.csvText);
    const parsed = parseClubV1Csv(params.csvText, params.filename);
    const competition = await resolveCompetition(service, params.clubId, params.competitionId, parsed, params.filename);

    const stageBase = {
        club_id: params.clubId,
        competition_id: competition?.id || null,
        bridge_device_id: params.bridgeDeviceId,
        provider: "clubv1",
        source_method: params.sourceMethod,
        source_filename: params.filename,
        source_file_sha256: hash,
        source_size_bytes: size,
        detected_competition_name: parsed.detectedName,
        detected_competition_date: parsed.detectedDate,
        detected_header_row: parsed.headerRow,
        normalized_result_count: parsed.results.length,
        normalized_results: parsed.results,
        raw_csv: competition ? null : params.csvText,
        ingest_status: competition ? "received" : "needs_review",
        ingest_error: competition ? null : "Paryx could not safely identify one competition for this file. Import it manually from the correct competition or provide a ClubV1 sample so its metadata can be mapped.",
        updated_at: new Date().toISOString()
    };

    const { data: existing } = await service
        .from("club_competition_ingest_files")
        .select("id,competition_id,ingest_status")
        .eq("club_id", params.clubId)
        .eq("source_file_sha256", hash)
        .maybeSingle();

    let ingestId: string;
    if (existing) {
        ingestId = existing.id;
        const { error } = await service
            .from("club_competition_ingest_files")
            .update(stageBase)
            .eq("id", ingestId);
        if (error) throw error;
        if (existing.ingest_status === "imported" && !params.competitionId) {
            return { ok: true, status: "duplicate", ingest_id: ingestId, result_count: parsed.results.length, matched_count: 0 };
        }
    } else {
        const { data, error } = await service
            .from("club_competition_ingest_files")
            .insert(stageBase)
            .select("id")
            .single();
        if (error || !data) throw error || new Error("CSV staging failed.");
        ingestId = data.id;
    }

    if (!competition) {
        return {
            ok: true,
            status: "needs_review",
            ingest_id: ingestId,
            result_count: parsed.results.length,
            detected_competition_name: parsed.detectedName,
            detected_competition_date: parsed.detectedDate
        };
    }

    await ensureClubV1Integration(service, params.clubId);
    const { error: updateCompetitionError } = await service
        .from("club_competitions")
        .update({
            result_provider: "clubv1",
            result_sync_status: "awaiting_results",
            result_sync_error: null,
            updated_at: new Date().toISOString()
        })
        .eq("id", competition.id);
    if (updateCompetitionError) throw updateCompetitionError;

    const rawPayload = {
        source_method: params.sourceMethod,
        source_filename: params.filename,
        source_file_sha256: hash,
        detected_competition_name: parsed.detectedName,
        detected_competition_date: parsed.detectedDate,
        detected_header_row: parsed.headerRow
    };

    const { data: imported, error: importError } = await service.rpc("competition_import_external_results", {
        p_competition_id: competition.id,
        p_provider: "clubv1",
        p_external_competition_id: null,
        p_provider_status: "csv_imported",
        p_results: parsed.results,
        p_raw_payload: rawPayload
    });
    if (importError) throw importError;

    const importObject = Array.isArray(imported) ? imported[0] || {} : imported || {};
    await service.from("club_competition_ingest_files").update({
        competition_id: competition.id,
        ingest_status: "imported",
        raw_csv: null,
        ingest_error: null,
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    }).eq("id", ingestId);

    if (params.bridgeDeviceId) {
        await service.from("club_competition_bridge_devices").update({
            last_upload_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }).eq("id", params.bridgeDeviceId);
    }

    return {
        ok: true,
        status: "imported",
        ingest_id: ingestId,
        competition_id: competition.id,
        competition_name: competition.name,
        result_count: Number(importObject.result_count ?? parsed.results.length),
        matched_count: Number(importObject.matched_count ?? 0),
        unmatched_count: Number(importObject.unmatched_count ?? 0)
    };
}

Deno.serve(async (request: Request) => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return jsonResponse({ ok: false, error: "POST required." }, 405);

    try {
        const url = Deno.env.get("SUPABASE_URL");
        if (!url) throw new Error("SUPABASE_URL is unavailable.");
        const service = createClient(url, getSecretKey(), {
            auth: { persistSession: false, autoRefreshToken: false }
        });

        const body = await request.json().catch(() => ({}));
        const action = cleanText(body?.action);

        if (action === "create_bridge_device") {
            const clubId = cleanText(body?.club_id);
            const deviceName = cleanText(body?.device_name);
            if (!clubId || !deviceName) return jsonResponse({ ok: false, error: "club_id and device_name are required." }, 400);

            const user = await userForRequest(service, request);
            await requireClubRole(service, user.id, clubId, new Set(["club_admin"]));

            const token = randomDeviceToken();
            const hash = await sha256Hex(token);
            const { data: device, error } = await service
                .from("club_competition_bridge_devices")
                .insert({
                    club_id: clubId,
                    device_name: deviceName,
                    token_hash: hash,
                    created_by: user.id
                })
                .select("id")
                .single();
            if (error || !device) throw error || new Error("Bridge device could not be registered.");
            await ensureClubV1Integration(service, clubId);

            return jsonResponse({
                ok: true,
                device_id: device.id,
                config: {
                    bridge_version: 1,
                    endpoint: `${url}/functions/v1/competition-result-ingest`,
                    device_token: token,
                    watch_folder: "C:\\Paryx\\ClubV1Results",
                    poll_seconds: 30
                }
            });
        }

        if (action === "import_csv") {
            const competitionId = cleanText(body?.competition_id);
            const filename = cleanText(body?.filename) || "clubv1-results.csv";
            const csvText = String(body?.csv_text ?? "");
            if (!competitionId) return jsonResponse({ ok: false, error: "competition_id is required." }, 400);

            const { data: competition, error } = await service
                .from("club_competitions")
                .select("id,club_id")
                .eq("id", competitionId)
                .maybeSingle();
            if (error || !competition) return jsonResponse({ ok: false, error: "Competition not found." }, 404);

            const user = await userForRequest(service, request);
            await requireClubRole(service, user.id, competition.club_id, MANAGE_ROLES);

            const result = await stageAndImport(service, {
                clubId: competition.club_id,
                competitionId,
                bridgeDeviceId: null,
                sourceMethod: "manual_upload",
                filename,
                csvText
            });
            return jsonResponse(result);
        }

        if (action === "bridge_csv") {
            const token = request.headers.get("X-Paryx-Bridge-Token") || "";
            const device = await validateBridgeToken(service, token);
            const filename = cleanText(body?.filename) || "clubv1-results.csv";
            const csvText = String(body?.csv_text ?? "");

            const result = await stageAndImport(service, {
                clubId: device.club_id,
                competitionId: null,
                bridgeDeviceId: device.id,
                sourceMethod: "windows_bridge",
                filename,
                csvText
            });
            return jsonResponse(result);
        }

        return jsonResponse({ ok: false, error: "Unsupported action." }, 400);
    } catch (error) {
        console.error("competition-result-ingest failed", error);
        return jsonResponse({
            ok: false,
            error: error instanceof Error ? error.message : "Competition result import failed."
        });
    }
});
