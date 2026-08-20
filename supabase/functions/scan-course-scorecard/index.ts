import { createClient } from "npm:@supabase/supabase-js@2";

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

const scorecardSchema = {
    type: "object",
    additionalProperties: false,
    required: [
        "course_name",
        "holes_count",
        "holes",
        "tees",
        "warnings"
    ],
    properties: {
        course_name: {
            type: [
                "string",
                "null"
            ]
        },

        holes_count: {
            type: [
                "integer",
                "null"
            ]
        },

        holes: {
            type: "array",
            items: {
                type: "object",
                additionalProperties:
                    false,
                required: [
                    "hole_number",
                    "men_par",
                    "men_stroke_index",
                    "women_par",
                    "women_stroke_index"
                ],
                properties: {
                    hole_number: {
                        type: "integer"
                    },
                    men_par: {
                        type: [
                            "integer",
                            "null"
                        ]
                    },
                    men_stroke_index: {
                        type: [
                            "integer",
                            "null"
                        ]
                    },
                    women_par: {
                        type: [
                            "integer",
                            "null"
                        ]
                    },
                    women_stroke_index: {
                        type: [
                            "integer",
                            "null"
                        ]
                    }
                }
            }
        },

        tees: {
            type: "array",
            items: {
                type: "object",
                additionalProperties:
                    false,
                required: [
                    "name",
                    "colour",
                    "men_par",
                    "men_course_rating",
                    "men_slope",
                    "women_par",
                    "women_course_rating",
                    "women_slope",
                    "yardages"
                ],
                properties: {
                    name: {
                        type: "string"
                    },
                    colour: {
                        type: [
                            "string",
                            "null"
                        ]
                    },
                    men_par: {
                        type: [
                            "integer",
                            "null"
                        ]
                    },
                    men_course_rating: {
                        type: [
                            "number",
                            "null"
                        ]
                    },
                    men_slope: {
                        type: [
                            "integer",
                            "null"
                        ]
                    },
                    women_par: {
                        type: [
                            "integer",
                            "null"
                        ]
                    },
                    women_course_rating: {
                        type: [
                            "number",
                            "null"
                        ]
                    },
                    women_slope: {
                        type: [
                            "integer",
                            "null"
                        ]
                    },
                    yardages: {
                        type: "array",
                        items: {
                            type: "object",
                            additionalProperties:
                                false,
                            required: [
                                "hole_number",
                                "yards"
                            ],
                            properties: {
                                hole_number: {
                                    type:
                                        "integer"
                                },
                                yards: {
                                    type: [
                                        "integer",
                                        "null"
                                    ]
                                }
                            }
                        }
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
                    "OPENAI_SCORECARD_MODEL"
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
                            "Scorecard scanning is not configured. Add OPENAI_API_KEY to the Supabase Edge Function secrets."
                    },
                    503
                );
            }

            const token =
                bearerToken(
                    request
                );

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
                await client
                    .auth
                    .getUser(
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
                    body?.clubId ||
                    ""
                ).trim();

            const courseId =
                String(
                    body?.courseId ||
                    ""
                ).trim();

            const courseName =
                String(
                    body?.courseName ||
                    ""
                ).trim();

            const holeCount =
                Number(
                    body?.holeCount ||
                    18
                );

            const imageDataUrl =
                String(
                    body?.imageDataUrl ||
                    ""
                ).trim();

            if (
                !clubId ||
                !courseId
            ) {
                return jsonResponse(
                    {
                        error:
                            "Club and course are required."
                    },
                    400
                );
            }

            if (
                holeCount !== 9 &&
                holeCount !== 18
            ) {
                return jsonResponse(
                    {
                        error:
                            "Course must have 9 or 18 holes."
                    },
                    400
                );
            }

            if (
                !/^data:image\/(?:jpeg|png|webp);base64,/i
                    .test(
                        imageDataUrl
                    )
            ) {
                return jsonResponse(
                    {
                        error:
                            "A JPEG, PNG or WebP scorecard image is required."
                    },
                    400
                );
            }

            if (
                imageDataUrl.length >
                12_000_000
            ) {
                return jsonResponse(
                    {
                        error:
                            "The prepared scorecard image is too large."
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

            const {
                data: courseConfig,
                error: courseError
            } =
                await client.rpc(
                    "admin_get_course_configuration",
                    {
                        p_club_id:
                            clubId,
                        p_course_id:
                            courseId
                    }
                );

            if (
                courseError ||
                !courseConfig
            ) {
                return jsonResponse(
                    {
                        error:
                            "The selected course could not be verified."
                    },
                    400
                );
            }

            const prompt = `
You are extracting structured golf-course setup data from a photograph or scan of a printed golf scorecard.

The selected Paryx course is:
- name: ${courseName || "unknown"}
- configured holes: ${holeCount}

Read only values that are visible in the scorecard image.

Important rules:
1. Do not invent or estimate unreadable values. Use null and add a warning.
2. Hole numbers must refer to actual golf holes, not OUT / IN / TOTAL columns.
3. "SI", "Index", "H'cap", "Handicap" or similar rows may represent stroke index.
4. Extract every physical tee row you can identify (for example White, Yellow, Red, Blue, Black).
5. Tee yardage must be hole-by-hole. Do not put total yardage into a hole.
6. Course Rating and Slope should only be included when clearly associated with that tee and gender.
7. If a single PAR or stroke-index row is clearly intended for all players, it may be copied to both men and women. If that is uncertain, populate men only and add a warning.
8. If the image shows separate men's and women's par/index rows, keep them separate.
9. Ignore advertising, local rules, phone numbers and unrelated text.
10. Return data for at most ${holeCount} holes.
11. Preserve tee names/colours as printed.
12. The result will be reviewed by a golf-club administrator before it is saved.
            `.trim();

            const openAiResponse =
                await fetch(
                    "https://api.openai.com/v1/responses",
                    {
                        method:
                            "POST",

                        headers: {
                            "Authorization":
                                `Bearer ${openAiKey}`,
                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify({
                                model,

                                store:
                                    false,

                                input: [
                                    {
                                        role:
                                            "user",

                                        content: [
                                            {
                                                type:
                                                    "input_text",
                                                text:
                                                    prompt
                                            },
                                            {
                                                type:
                                                    "input_image",
                                                image_url:
                                                    imageDataUrl,
                                                detail:
                                                    "high"
                                            }
                                        ]
                                    }
                                ],

                                text: {
                                    format: {
                                        type:
                                            "json_schema",
                                        name:
                                            "paryx_scorecard_extraction",
                                        strict:
                                            true,
                                        schema:
                                            scorecardSchema
                                    }
                                }
                            })
                    }
                );

            const raw =
                await openAiResponse.json();

            if (
                !openAiResponse.ok
            ) {
                console.error(
                    "OpenAI scorecard extraction error:",
                    raw
                );

                return jsonResponse(
                    {
                        error:
                            raw?.error?.message ||
                            "The scorecard image-analysis service returned an error."
                    },
                    502
                );
            }

            const outputText =
                extractResponseText(
                    raw
                );

            if (!outputText) {
                return jsonResponse(
                    {
                        error:
                            "No structured scorecard data was returned."
                    },
                    502
                );
            }

            let extraction: any;

            try {
                extraction =
                    JSON.parse(
                        outputText
                    );
            } catch {
                console.error(
                    "Could not parse scorecard output:",
                    outputText
                );

                return jsonResponse(
                    {
                        error:
                            "The scorecard result could not be parsed."
                    },
                    502
                );
            }

            extraction.holes =
                (
                    extraction.holes ||
                    []
                )
                    .filter(
                        (hole: any) =>
                            Number(
                                hole.hole_number
                            ) >= 1 &&
                            Number(
                                hole.hole_number
                            ) <= holeCount
                    )
                    .sort(
                        (a: any, b: any) =>
                            Number(
                                a.hole_number
                            ) -
                            Number(
                                b.hole_number
                            )
                    );

            for (
                const tee
                of extraction.tees ||
                []
            ) {
                tee.yardages =
                    (
                        tee.yardages ||
                        []
                    )
                        .filter(
                            (item: any) =>
                                Number(
                                    item.hole_number
                                ) >= 1 &&
                                Number(
                                    item.hole_number
                                ) <= holeCount
                        )
                        .sort(
                            (a: any, b: any) =>
                                Number(
                                    a.hole_number
                                ) -
                                Number(
                                    b.hole_number
                                )
                        );
            }

            return jsonResponse({
                extraction,
                model
            });
        } catch (error) {
            console.error(
                "Paryx scorecard scan failure:",
                error
            );

            return jsonResponse(
                {
                    error:
                        error instanceof Error
                            ? error.message
                            : "Scorecard scanning failed."
                },
                500
            );
        }
    }
);
