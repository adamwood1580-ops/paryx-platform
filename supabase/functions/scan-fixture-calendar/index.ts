import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument } from "npm:pdf-lib@1.17.1";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function jsonResponse(
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

function bearerToken(request: Request) {
    const header =
        request.headers.get(
            "Authorization"
        ) || "";

    const match =
        header.match(
            /^Bearer\s+(.+)$/i
        );

    return match?.[1]?.trim() || "";
}

function extractResponseText(
    response: any
) {
    const parts: string[] = [];

    for (
        const item
        of response?.output || []
    ) {
        if (item?.type !== "message") {
            continue;
        }

        for (
            const content
            of item?.content || []
        ) {
            if (
                content?.type ===
                    "output_text" &&
                typeof content.text ===
                    "string"
            ) {
                parts.push(
                    content.text
                );
            }
        }
    }

    return parts.join("\n").trim();
}

function cleanText(value: unknown) {
    const text =
        String(value ?? "").trim();

    return text || null;
}

function cleanTime(value: unknown) {
    const text = cleanText(value);

    if (!text) {
        return null;
    }

    const match =
        text.match(
            /^(\d{1,2}):(\d{2})(?::\d{2})?$/
        );

    if (!match) {
        return null;
    }

    const hour = Number(match[1]);
    const minute = Number(match[2]);

    if (
        hour < 0 ||
        hour > 23 ||
        minute < 0 ||
        minute > 59
    ) {
        return null;
    }

    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function bytesFromDataUrl(
    dataUrl: string
) {
    const comma = dataUrl.indexOf(",");

    if (comma < 0) {
        return new Uint8Array();
    }

    const raw = atob(
        dataUrl.slice(comma + 1)
    );

    const bytes =
        new Uint8Array(raw.length);

    for (
        let index = 0;
        index < raw.length;
        index += 1
    ) {
        bytes[index] =
            raw.charCodeAt(index);
    }

    return bytes;
}


function bytesToBase64(
    bytes: Uint8Array
) {
    let binary = "";
    const chunkSize = 0x8000;

    for (
        let offset = 0;
        offset < bytes.length;
        offset += chunkSize
    ) {
        const chunk = bytes.subarray(
            offset,
            Math.min(
                offset + chunkSize,
                bytes.length
            )
        );

        binary += String.fromCharCode(
            ...chunk
        );
    }

    return btoa(binary);
}

async function singlePagePdfDataUrl(
    sourcePdf: PDFDocument,
    pageIndex: number
) {
    const outputPdf =
        await PDFDocument.create();

    const [copiedPage] =
        await outputPdf.copyPages(
            sourcePdf,
            [pageIndex]
        );

    outputPdf.addPage(copiedPage);

    const bytes =
        await outputPdf.save({
            useObjectStreams: false
        });

    return `data:application/pdf;base64,${bytesToBase64(bytes)}`;
}

async function sha256Hex(
    value: Uint8Array | string
) {
    const bytes =
        typeof value === "string"
            ? new TextEncoder().encode(value)
            : value;

    const digest =
        await crypto.subtle.digest(
            "SHA-256",
            bytes
        );

    return Array.from(
        new Uint8Array(digest)
    )
        .map(function (byte) {
            return byte
                .toString(16)
                .padStart(2, "0");
        })
        .join("");
}

const fixtureCalendarSchema = {
    type: "object",
    additionalProperties: false,
    required: [
        "calendar_title",
        "calendar_year",
        "events",
        "warnings"
    ],
    properties: {
        calendar_title: {
            type: [
                "string",
                "null"
            ]
        },
        calendar_year: {
            type: [
                "integer",
                "null"
            ]
        },
        events: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: [
                    "event_date",
                    "start_time",
                    "end_time",
                    "time_text",
                    "title",
                    "section",
                    "event_type",
                    "location_type",
                    "venue",
                    "notes",
                    "is_qualifier",
                    "course_closed",
                    "course_closed_start_time",
                    "course_closed_end_time",
                    "source_text",
                    "source_page",
                    "warning"
                ],
                properties: {
                    event_date: {
                        type: "string"
                    },
                    start_time: {
                        type: [
                            "string",
                            "null"
                        ]
                    },
                    end_time: {
                        type: [
                            "string",
                            "null"
                        ]
                    },
                    time_text: {
                        type: [
                            "string",
                            "null"
                        ]
                    },
                    title: {
                        type: "string"
                    },
                    section: {
                        type: "string",
                        enum: [
                            "club",
                            "mens",
                            "seniors",
                            "ladies"
                        ]
                    },
                    event_type: {
                        type: "string",
                        enum: [
                            "competition",
                            "roll_up",
                            "fixture",
                            "social",
                            "course_event",
                            "other"
                        ]
                    },
                    location_type: {
                        type: [
                            "string",
                            "null"
                        ],
                        enum: [
                            "home",
                            "away",
                            null
                        ]
                    },
                    venue: {
                        type: [
                            "string",
                            "null"
                        ]
                    },
                    notes: {
                        type: [
                            "string",
                            "null"
                        ]
                    },
                    is_qualifier: {
                        type: "boolean"
                    },
                    course_closed: {
                        type: "boolean"
                    },
                    course_closed_start_time: {
                        type: [
                            "string",
                            "null"
                        ]
                    },
                    course_closed_end_time: {
                        type: [
                            "string",
                            "null"
                        ]
                    },
                    source_text: {
                        type: [
                            "string",
                            "null"
                        ]
                    },
                    source_page: {
                        type: [
                            "integer",
                            "null"
                        ]
                    },
                    warning: {
                        type: [
                            "string",
                            "null"
                        ]
                    }
                }
            }
        },
        warnings: {
            type: "array",
            items: {
                type: "string"
            }
        }
    }
};

Deno.serve(
    async function (request) {
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
            return jsonResponse(
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

            const anonKey =
                Deno.env.get(
                    "SUPABASE_ANON_KEY"
                );

            const openAiKey =
                Deno.env.get(
                    "OPENAI_API_KEY"
                );

            const model =
                Deno.env.get(
                    "OPENAI_FIXTURE_MODEL"
                ) ||
                "gpt-5.6";

            if (
                !supabaseUrl ||
                !anonKey
            ) {
                throw new Error(
                    "Supabase function environment is incomplete."
                );
            }

            if (!openAiKey) {
                return jsonResponse(
                    {
                        error:
                            "Fixture scanning is not configured. Add OPENAI_API_KEY to the Supabase Edge Function secrets."
                    },
                    503
                );
            }

            const token =
                bearerToken(request);

            if (!token) {
                return jsonResponse(
                    {
                        error:
                            "Authentication required."
                    },
                    401
                );
            }

            const client =
                createClient(
                    supabaseUrl,
                    anonKey,
                    {
                        global: {
                            headers: {
                                Authorization:
                                    `Bearer ${token}`
                            }
                        }
                    }
                );

            const {
                data: userData,
                error: userError
            } =
                await client.auth.getUser(
                    token
                );

            if (
                userError ||
                !userData?.user
            ) {
                return jsonResponse(
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
                String(
                    body?.clubId || ""
                ).trim();

            const fileName =
                String(
                    body?.fileName ||
                    "fixture-calendar.pdf"
                ).trim();

            const pdfDataUrl =
                String(
                    body?.pdfDataUrl || ""
                ).trim();

            const yearHint =
                Number(
                    body?.yearHint || 0
                );

            const mode =
                String(
                    body?.mode || ""
                ).trim();

            const pageNumber =
                Number(
                    body?.pageNumber || 0
                );

            if (!clubId) {
                return jsonResponse(
                    {
                        error:
                            "Club is required."
                    },
                    400
                );
            }

            if (
                !/^data:application\/pdf;base64,/i
                    .test(pdfDataUrl)
            ) {
                return jsonResponse(
                    {
                        error:
                            "A PDF fixture calendar is required."
                    },
                    400
                );
            }

            if (
                pdfDataUrl.length >
                18_000_000
            ) {
                return jsonResponse(
                    {
                        error:
                            "The fixture calendar PDF is too large for direct scanning."
                    },
                    413
                );
            }

            const {
                data: allowed,
                error: accessError
            } =
                await client.rpc(
                    "user_can_manage_club",
                    {
                        p_club_id:
                            clubId
                    }
                );

            if (
                accessError ||
                allowed !== true
            ) {
                return jsonResponse(
                    {
                        error:
                            "Club management access required."
                    },
                    403
                );
            }

            const pdfBytes =
                bytesFromDataUrl(
                    pdfDataUrl
                );

            let sourcePdf: PDFDocument;

            try {
                sourcePdf =
                    await PDFDocument.load(
                        pdfBytes,
                        {
                            ignoreEncryption:
                                true
                        }
                    );
            } catch (error) {
                console.error(
                    "Fixture PDF could not be opened:",
                    error
                );

                return jsonResponse(
                    {
                        error:
                            "Paryx could not open this fixture PDF."
                    },
                    400
                );
            }

            const pageCount =
                sourcePdf.getPageCount();

            const documentHash =
                await sha256Hex(
                    pdfBytes
                );

            if (mode === "inspect") {
                return jsonResponse({
                    meta: {
                        pageCount,
                        documentHash:
                            documentHash.slice(
                                0,
                                16
                            )
                    }
                });
            }

            if (mode !== "page") {
                return jsonResponse(
                    {
                        error:
                            "This fixture scanner now works page by page. Refresh Paryx and try the import again."
                    },
                    400
                );
            }

            if (
                !Number.isInteger(pageNumber) ||
                pageNumber < 1 ||
                pageNumber > pageCount
            ) {
                return jsonResponse(
                    {
                        error:
                            "A valid PDF page number is required."
                    },
                    400
                );
            }

            const pagePdfDataUrl =
                await singlePagePdfDataUrl(
                    sourcePdf,
                    pageNumber - 1
                );

            const prompt = `
You are extracting one page from a golf-club fixture calendar PDF for Paryx.

This request contains original PDF page ${pageNumber} of ${pageCount}. Read this page completely and create one event record for every distinct fixture/event printed in a dated calendar cell. A title/cover page may legitimately contain no dated events.

${
    Number.isInteger(yearHint) &&
    yearHint >= 2000 &&
    yearHint <= 2100
        ? `The administrator expects the calendar year to be ${yearHint}. Use the PDF itself as the authority if it clearly shows a different year.`
        : "Determine the year from the PDF."
}

Important extraction rules:
1. Do not invent events or unreadable details. Preserve uncertainty in warning fields.
2. Dates must be ISO YYYY-MM-DD and must match the day cell/month shown in the PDF.
3. If a cell contains multiple events, return each as a separate event.
4. start_time and end_time must be 24-hour HH:MM when explicitly printed. If only one time is printed, set start_time and leave end_time null.
5. If wording such as "Time TBC" is printed, preserve it in time_text and leave numeric times null unless another explicit event time is present.
6. section must be club, mens, seniors or ladies. Use the PDF legend, text colour and surrounding context. In the supplied-style fixture lists, blue commonly represents Club, black Men, green Seniors and red Ladies; trust the actual PDF legend first.
7. event_type classification:
   - roll_up for roll-ups;
   - fixture for matches against another club, especially (H)/(A) fixtures;
   - competition for medals, cups, trophies, stablefords, scrambles, foursomes, championships and similar golf competitions;
   - social for AGM, dinner, presentation, coffee morning and clearly social/non-golf events;
   - course_event for operational/course-only items;
   - other only when none of those fit.
8. location_type is home for explicit (H)/home fixtures and away for explicit (A)/away fixtures. Otherwise null. Put the named external club/course in venue where visible.
9. is_qualifier is true only when the event is explicitly marked (Q) or otherwise explicitly shown as a qualifier.
10. course_closed is true only when the PDF explicitly says the course is closed. Extract the closure window separately into course_closed_start_time/course_closed_end_time where printed. Do not replace the event's own start/end time with the closure window.
11. Keep useful secondary text in notes, but do not duplicate the title unnecessarily.
12. source_text should preserve the concise printed wording that led to this event. source_page must be ${pageNumber}, the original 1-based PDF page number.
13. Ignore calendar headings, slogans, legends, day numbers and decorative text unless they are actual dated events.
14. Preserve names and spellings as printed. Do not silently correct competition or person names.
15. Return every dated event visible on this page, not a sample. Do not attempt to infer events from pages that are not present in this request.

The output is a draft. A club administrator will review and edit all rows before anything is saved.
            `.trim();

            const openAiResponse =
                await fetch(
                    "https://api.openai.com/v1/responses",
                    {
                        method: "POST",
                        headers: {
                            "Authorization":
                                `Bearer ${openAiKey}`,
                            "Content-Type":
                                "application/json"
                        },
                        body:
                            JSON.stringify({
                                model,
                                store: false,
                                input: [
                                    {
                                        role: "user",
                                        content: [
                                            {
                                                type:
                                                    "input_file",
                                                filename:
                                                    `${fileName || "fixture-calendar.pdf"}-page-${pageNumber}.pdf`,
                                                file_data:
                                                    pagePdfDataUrl,
                                                detail:
                                                    "high"
                                            },
                                            {
                                                type:
                                                    "input_text",
                                                text:
                                                    prompt
                                            }
                                        ]
                                    }
                                ],
                                text: {
                                    format: {
                                        type:
                                            "json_schema",
                                        name:
                                            "paryx_fixture_calendar_extraction",
                                        strict:
                                            true,
                                        schema:
                                            fixtureCalendarSchema
                                    }
                                }
                            })
                    }
                );

            const rawOpenAi =
                await openAiResponse.text();

            let openAiBody: any = null;

            try {
                openAiBody =
                    rawOpenAi
                        ? JSON.parse(rawOpenAi)
                        : null;
            } catch {
                openAiBody = null;
            }

            if (!openAiResponse.ok) {
                console.error(
                    "OpenAI fixture extraction error:",
                    openAiResponse.status,
                    rawOpenAi
                );

                return jsonResponse(
                    {
                        error:
                            openAiBody?.error?.message ||
                            "OpenAI could not scan this fixture calendar."
                    },
                    502
                );
            }

            const responseText =
                extractResponseText(
                    openAiBody
                );

            if (!responseText) {
                return jsonResponse(
                    {
                        error:
                            "The fixture scan returned no structured data."
                    },
                    502
                );
            }

            let extraction: any;

            try {
                extraction =
                    JSON.parse(
                        responseText
                    );
            } catch (error) {
                console.error(
                    "Fixture extraction JSON parse failed:",
                    error,
                    responseText
                );

                return jsonResponse(
                    {
                        error:
                            "The fixture scan returned invalid structured data."
                    },
                    502
                );
            }

            const events =
                Array.isArray(
                    extraction?.events
                )
                    ? extraction.events
                    : [];

            const normalisedEvents: any[] = [];

            for (
                let index = 0;
                index < events.length;
                index += 1
            ) {
                const event =
                    events[index] || {};

                const eventDate =
                    cleanText(
                        event.event_date
                    );

                const title =
                    cleanText(
                        event.title
                    );

                if (
                    !eventDate ||
                    !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) ||
                    !title
                ) {
                    continue;
                }

                const sourceBasis = [
                    documentHash,
                    eventDate,
                    cleanTime(event.start_time) || "",
                    cleanText(event.time_text) || "",
                    cleanText(event.section) || "",
                    title,
                    String(event.source_page || ""),
                    cleanText(event.source_text) || "",
                    String(index)
                ].join("|");

                const eventHash =
                    await sha256Hex(
                        sourceBasis
                    );

                normalisedEvents.push({
                    event_date:
                        eventDate,
                    start_time:
                        cleanTime(
                            event.start_time
                        ),
                    end_time:
                        cleanTime(
                            event.end_time
                        ),
                    time_text:
                        cleanText(
                            event.time_text
                        ),
                    title,
                    section:
                        event.section,
                    event_type:
                        event.event_type,
                    location_type:
                        event.location_type ||
                        null,
                    venue:
                        cleanText(
                            event.venue
                        ),
                    notes:
                        cleanText(
                            event.notes
                        ),
                    is_qualifier:
                        event.is_qualifier ===
                        true,
                    course_closed:
                        event.course_closed ===
                        true,
                    course_closed_start_time:
                        cleanTime(
                            event.course_closed_start_time
                        ),
                    course_closed_end_time:
                        cleanTime(
                            event.course_closed_end_time
                        ),
                    source_text:
                        cleanText(
                            event.source_text
                        ),
                    source_page:
                        pageNumber,
                    warning:
                        cleanText(
                            event.warning
                        ),
                    source_key:
                        `pdf:${eventHash}`
                });
            }

            return jsonResponse({
                extraction: {
                    calendar_title:
                        cleanText(
                            extraction?.calendar_title
                        ),
                    calendar_year:
                        Number.isInteger(
                            extraction?.calendar_year
                        )
                            ? extraction.calendar_year
                            : null,
                    events:
                        normalisedEvents,
                    warnings:
                        Array.isArray(
                            extraction?.warnings
                        )
                            ? extraction.warnings
                            : []
                },
                meta: {
                    model,
                    pageNumber,
                    pageCount,
                    eventCount:
                        normalisedEvents.length,
                    documentHash:
                        documentHash.slice(
                            0,
                            16
                        )
                }
            });
        } catch (error) {
            console.error(
                "Paryx fixture scan failed:",
                error
            );

            return jsonResponse(
                {
                    error:
                        error instanceof Error
                            ? error.message
                            : "Fixture scanning failed."
                },
                500
            );
        }
    }
);
