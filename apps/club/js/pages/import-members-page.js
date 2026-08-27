(function () {
    "use strict";

    // Paryx staff application namespace.
    window.Paryx = window.Paryx || {};

    const IMPORT_FUNCTION =
        "admin-import-members";

    const CHUNK_SIZE = 25;
    const PREVIEW_LIMIT = 100;

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

    const MEMBERSHIP_TYPE_ALIASES = {
        "full": "member",
        "full member": "member",
        "adult": "member",
        "adult member": "member",
        "standard": "member",
        "standard member": "member"
    };

    const HEADER_ALIASES = {
        first_name: [
            "first_name",
            "firstname",
            "first name",
            "forename"
        ],
        last_name: [
            "last_name",
            "lastname",
            "last name",
            "surname"
        ],
        email: [
            "email",
            "email_address",
            "email address"
        ],
        membership_number: [
            "membership_number",
            "membershipnumber",
            "membership number",
            "member_number",
            "member number",
            "membership_no",
            "membership no"
        ],
        membership_type: [
            "membership_type",
            "membershiptype",
            "membership type",
            "member_type",
            "member type"
        ],
        handicap_index: [
            "handicap_index",
            "handicapindex",
            "handicap index",
            "handicap",
            "hi"
        ]
    };

    const elements = {};

    const state = {
        initialised: false,
        clubId: null,
        filename: null,
        rows: [],
        validRows: [],
        validationErrors: 0,
        importing: false,
        results: []
    };

    function cacheElements() {
        elements.clubName =
            document.getElementById("importClubName");

        elements.error =
            document.getElementById("importError");

        elements.template =
            document.getElementById("downloadTemplateBtn");

        elements.fileInput =
            document.getElementById("memberCsvInput");

        elements.fileName =
            document.getElementById("selectedCsvName");

        elements.validationSection =
            document.getElementById("validationSection");

        elements.validationTotal =
            document.getElementById("validationTotal");

        elements.validationReady =
            document.getElementById("validationReady");

        elements.validationErrors =
            document.getElementById("validationErrors");

        elements.validationNotice =
            document.getElementById("validationNotice");

        elements.previewBody =
            document.getElementById("memberPreviewBody");

        elements.previewLimit =
            document.getElementById("previewLimitNotice");

        elements.actionSection =
            document.getElementById("importActionSection");

        elements.startImport =
            document.getElementById("startImportBtn");

        elements.progress =
            document.getElementById("importProgress");

        elements.progressBar =
            document.getElementById("importProgressBar");

        elements.progressText =
            document.getElementById("importProgressText");

        elements.resultsSection =
            document.getElementById("importResultsSection");

        elements.resultSummary =
            document.getElementById("importResultSummary");

        elements.resultImported =
            document.getElementById("resultImported");

        elements.resultExisting =
            document.getElementById("resultExisting");

        elements.resultFailed =
            document.getElementById("resultFailed");

        elements.resultList =
            document.getElementById("importResultList");

        elements.newImport =
            document.getElementById("newImportBtn");
    }

    function getClient() {
        if (
            window.supabaseClient &&
            window.supabaseClient.functions &&
            typeof window.supabaseClient.functions.invoke ===
                "function"
        ) {
            return window.supabaseClient;
        }

        throw new Error(
            "The Paryx data service is unavailable."
        );
    }

    function getReadableError(error) {
        if (!error) {
            return "An unknown error occurred.";
        }

        if (
            typeof error.message === "string" &&
            error.message.trim()
        ) {
            return error.message.trim();
        }

        if (
            typeof error.details === "string" &&
            error.details.trim()
        ) {
            return error.details.trim();
        }

        return String(error);
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function cleanHeader(value) {
        return String(value || "")
            .replace(/^\uFEFF/, "")
            .trim()
            .toLowerCase()
            .replace(/[.\-]+/g, " ")
            .replace(/\s+/g, " ");
    }

    function canonicalHeader(value) {
        const cleaned = cleanHeader(value);

        for (
            const [canonical, aliases]
            of Object.entries(HEADER_ALIASES)
        ) {
            if (
                aliases.some(
                    function (alias) {
                        return cleanHeader(alias) === cleaned;
                    }
                )
            ) {
                return canonical;
            }
        }

        return cleaned
            .replaceAll(" ", "_");
    }

    function parseCsv(text) {
        const rows = [];
        let row = [];
        let field = "";
        let inQuotes = false;

        const source =
            String(text || "")
                .replace(/^\uFEFF/, "");

        for (
            let index = 0;
            index < source.length;
            index += 1
        ) {
            const character = source[index];
            const next = source[index + 1];

            if (character === '"') {
                if (inQuotes && next === '"') {
                    field += '"';
                    index += 1;
                } else {
                    inQuotes = !inQuotes;
                }

                continue;
            }

            if (character === "," && !inQuotes) {
                row.push(field);
                field = "";
                continue;
            }

            if (
                (character === "\n" || character === "\r") &&
                !inQuotes
            ) {
                if (
                    character === "\r" &&
                    next === "\n"
                ) {
                    index += 1;
                }

                row.push(field);
                field = "";

                if (
                    row.some(
                        function (value) {
                            return String(value).trim() !== "";
                        }
                    )
                ) {
                    rows.push(row);
                }

                row = [];
                continue;
            }

            field += character;
        }

        row.push(field);

        if (
            row.some(
                function (value) {
                    return String(value).trim() !== "";
                }
            )
        ) {
            rows.push(row);
        }

        if (inQuotes) {
            throw new Error(
                "The CSV contains an unclosed quoted field."
            );
        }

        return rows;
    }

    function normaliseEmail(value) {
        return String(value || "")
            .trim()
            .toLowerCase();
    }

    function normaliseMembershipType(value) {
        const raw =
            String(value || "member")
                .trim()
                .toLowerCase()
                .replace(/[_-]+/g, " ")
                .replace(/\s+/g, " ");

        return (
            MEMBERSHIP_TYPE_ALIASES[raw] ||
            raw
        );
    }

    async function readFileText(file) {
        if (
            file &&
            typeof file.text === "function"
        ) {
            try {
                return await file.text();
            } catch (error) {
                console.warn(
                    "File.text() failed; falling back to FileReader.",
                    error
                );
            }
        }

        return await new Promise(
            function (resolve, reject) {
                const reader =
                    new FileReader();

                reader.addEventListener(
                    "load",
                    function () {
                        resolve(
                            String(reader.result || "")
                        );
                    },
                    { once: true }
                );

                reader.addEventListener(
                    "error",
                    function () {
                        reject(
                            reader.error ||
                            new Error(
                                "The selected CSV could not be read."
                            )
                        );
                    },
                    { once: true }
                );

                reader.readAsText(file);
            }
        );
    }

    function parseHandicap(value) {
        const text = String(value || "").trim();

        if (!text) {
            return null;
        }

        const number = Number(text);

        return Number.isFinite(number)
            ? number
            : NaN;
    }

    function validateRows(csvRows) {
        if (!csvRows.length) {
            throw new Error(
                "The CSV file is empty."
            );
        }

        const headers =
            csvRows[0].map(canonicalHeader);

        const required = [
            "first_name",
            "last_name",
            "email"
        ];

        const missingHeaders =
            required.filter(
                function (header) {
                    return !headers.includes(header);
                }
            );

        if (missingHeaders.length) {
            throw new Error(
                "Missing required columns: " +
                missingHeaders.join(", ") +
                "."
            );
        }

        const rows = [];

        for (
            let index = 1;
            index < csvRows.length;
            index += 1
        ) {
            const source = csvRows[index];
            const values = {};

            headers.forEach(
                function (header, columnIndex) {
                    values[header] =
                        String(
                            source[columnIndex] ?? ""
                        ).trim();
                }
            );

            const row = {
                rowNumber: index + 1,
                firstName:
                    values.first_name || "",
                lastName:
                    values.last_name || "",
                email:
                    normaliseEmail(values.email),
                membershipNumber:
                    values.membership_number || "",
                membershipType:
                    normaliseMembershipType(
                        values.membership_type ||
                        "member"
                    ),
                handicapIndex:
                    parseHandicap(
                        values.handicap_index
                    ),
                errors: []
            };

            if (!row.firstName) {
                row.errors.push(
                    "First name is required."
                );
            }

            if (!row.lastName) {
                row.errors.push(
                    "Last name is required."
                );
            }

            if (
                !row.email ||
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
                    row.email
                )
            ) {
                row.errors.push(
                    "Valid email required."
                );
            }

            if (
                !ALLOWED_MEMBERSHIP_TYPES.has(
                    row.membershipType
                )
            ) {
                row.errors.push(
                    `Unknown membership type: ${row.membershipType}.`
                );
            }

            if (
                Number.isNaN(row.handicapIndex) ||
                (
                    row.handicapIndex !== null &&
                    (
                        row.handicapIndex < -10 ||
                        row.handicapIndex > 54
                    )
                )
            ) {
                row.errors.push(
                    "Handicap Index must be -10.0 to 54.0."
                );
            }

            rows.push(row);
        }

        const emailCounts = new Map();
        const membershipCounts = new Map();

        rows.forEach(
            function (row) {
                if (row.email) {
                    emailCounts.set(
                        row.email,
                        (emailCounts.get(row.email) || 0) + 1
                    );
                }

                const memberNumber =
                    row.membershipNumber
                        .trim()
                        .toLowerCase();

                if (memberNumber) {
                    membershipCounts.set(
                        memberNumber,
                        (membershipCounts.get(memberNumber) || 0) + 1
                    );
                }
            }
        );

        rows.forEach(
            function (row) {
                if (
                    row.email &&
                    emailCounts.get(row.email) > 1
                ) {
                    row.errors.push(
                        "Duplicate email in CSV."
                    );
                }

                const memberNumber =
                    row.membershipNumber
                        .trim()
                        .toLowerCase();

                if (
                    memberNumber &&
                    membershipCounts.get(memberNumber) > 1
                ) {
                    row.errors.push(
                        "Duplicate membership number in CSV."
                    );
                }
            }
        );

        return rows;
    }

    function clearError() {
        elements.error.hidden = true;
        elements.error.textContent = "";
    }

    function showError(error) {
        console.error(
            "Paryx member import error:",
            error
        );

        elements.error.hidden = false;
        elements.error.textContent =
            getReadableError(error);
    }

    function renderValidation() {
        const total = state.rows.length;
        const errorRows =
            state.rows.filter(
                function (row) {
                    return row.errors.length > 0;
                }
            );

        state.validationErrors =
            errorRows.length;

        state.validRows =
            state.rows.filter(
                function (row) {
                    return row.errors.length === 0;
                }
            );

        elements.validationSection.hidden = false;
        elements.actionSection.hidden = false;
        elements.resultsSection.hidden = true;

        elements.validationTotal.textContent =
            String(total);

        elements.validationReady.textContent =
            String(state.validRows.length);

        elements.validationErrors.textContent =
            String(errorRows.length);

        if (!total) {
            elements.validationNotice.className =
                "admin-validation-notice admin-validation-notice--error";

            elements.validationNotice.textContent =
                "No member rows were found in this CSV.";
        } else if (errorRows.length) {
            elements.validationNotice.className =
                "admin-validation-notice admin-validation-notice--error";

            elements.validationNotice.textContent =
                `${errorRows.length} row${errorRows.length === 1 ? "" : "s"} need attention before this file can be imported.`;
        } else {
            elements.validationNotice.className =
                "admin-validation-notice admin-validation-notice--ready";

            elements.validationNotice.textContent =
                `All ${total} member rows are ready to import.`;
        }

        elements.startImport.disabled =
            total === 0 ||
            errorRows.length > 0;

        renderPreview();
    }

    function renderPreview() {
        const previewRows =
            state.rows.slice(0, PREVIEW_LIMIT);

        elements.previewBody.innerHTML =
            previewRows
                .map(
                    function (row) {
                        const hasErrors =
                            row.errors.length > 0;

                        return `
                            <tr>
                                <td>${row.rowNumber}</td>

                                <td>
                                    ${escapeHtml(
                                        `${row.firstName} ${row.lastName}`.trim() || "—"
                                    )}
                                </td>

                                <td>${escapeHtml(row.email || "—")}</td>
                                <td>${escapeHtml(row.membershipNumber || "—")}</td>
                                <td>${escapeHtml(row.membershipType || "member")}</td>
                                <td>${escapeHtml(row.handicapIndex === null ? "—" : row.handicapIndex)}</td>

                                <td>
                                    <span class="admin-preview-status ${hasErrors ? "admin-preview-status--error" : "admin-preview-status--ready"}">
                                        ${hasErrors ? "Error" : "Ready"}
                                    </span>

                                    ${
                                        hasErrors
                                            ? `<small class="admin-preview-error">${escapeHtml(row.errors.join(" "))}</small>`
                                            : ""
                                    }
                                </td>
                            </tr>
                        `;
                    }
                )
                .join("");

        if (state.rows.length > PREVIEW_LIMIT) {
            elements.previewLimit.hidden = false;
            elements.previewLimit.textContent =
                `Showing the first ${PREVIEW_LIMIT} of ${state.rows.length} rows. All rows will be imported.`;
        } else {
            elements.previewLimit.hidden = true;
            elements.previewLimit.textContent = "";
        }
    }

    async function handleFileSelected() {
        clearError();

        const file =
            elements.fileInput.files?.[0];

        if (!file) {
            resetImportState();
            return;
        }

        state.filename = file.name;
        elements.fileName.textContent =
            `${file.name} · Reading...`;

        try {
            const text =
                await readFileText(file);

            const parsed =
                parseCsv(text);

            state.rows =
                validateRows(parsed);

            elements.fileName.textContent =
                `${file.name} · ${state.rows.length} member row${state.rows.length === 1 ? "" : "s"} loaded`;

            renderValidation();
        } catch (error) {
            elements.fileName.textContent =
                `${file.name} · Could not load`;

            state.rows = [];
            state.validRows = [];
            state.validationErrors = 0;
            elements.validationSection.hidden = true;
            elements.actionSection.hidden = true;
            showError(error);
        }
    }

    function downloadTemplate() {
        const csv = [
            "first_name,last_name,email,membership_number,membership_type,handicap_index",
            "Adam,Wood,adam@example.com,00123,member,14.2"
        ].join("\n");

        const blob = new Blob(
            [csv],
            {
                type: "text/csv;charset=utf-8"
            }
        );

        const url =
            URL.createObjectURL(blob);

        const link =
            document.createElement("a");

        link.href = url;
        link.download =
            "paryx-member-import-template.csv";

        document.body.appendChild(link);
        link.click();
        link.remove();

        window.setTimeout(
            function () {
                URL.revokeObjectURL(url);
            },
            1000
        );
    }

    function toFunctionRow(row) {
        return {
            rowNumber: row.rowNumber,
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email,
            membershipNumber:
                row.membershipNumber || null,
            membershipType:
                row.membershipType || "member",
            handicapIndex:
                row.handicapIndex
        };
    }

    function updateProgress(processed, total) {
        const percentage =
            total > 0
                ? Math.min(
                    100,
                    Math.round(
                        processed / total * 100
                    )
                )
                : 0;

        elements.progressBar.style.width =
            `${percentage}%`;

        elements.progressText.textContent =
            `Processed ${processed} of ${total} members`;
    }

    async function invokeImportChunk(
        client,
        rows,
        batchId,
        isFinalChunk
    ) {
        /*
         * Imported golfers are global Paryx Player accounts.
         * Activate them in the player app rather than in the
         * ClubHub staff workspace.
         */
        const redirectTo =
            new URL(
                "../../member/html/set-password.html",
                window.location.href
            ).href;

        const {
            data,
            error
        } = await client.functions.invoke(
            IMPORT_FUNCTION,
            {
                body: {
                    clubId: state.clubId,
                    filename: state.filename,
                    totalRows:
                        state.validRows.length,
                    batchId,
                    rows:
                        rows.map(toFunctionRow),
                    isFinalChunk,
                    redirectTo
                }
            }
        );

        if (error) {
            throw error;
        }

        if (data?.error) {
            throw new Error(data.error);
        }

        if (!data?.batchId) {
            throw new Error(
                "The import service did not return an import batch."
            );
        }

        return data;
    }

    async function startImport() {
        if (
            state.importing ||
            !state.validRows.length ||
            state.validationErrors > 0
        ) {
            return;
        }

        const confirmed = window.confirm(
            `Import ${state.validRows.length} members and send invitations to new email addresses?`
        );

        if (!confirmed) {
            return;
        }

        state.importing = true;
        state.results = [];
        clearError();

        elements.startImport.disabled = true;
        elements.fileInput.disabled = true;
        elements.progress.hidden = false;
        elements.progressBar.style.width = "0%";
        updateProgress(0, state.validRows.length);

        try {
            const client = getClient();
            let batchId = null;
            let processed = 0;
            let latestSummary = null;

            for (
                let index = 0;
                index < state.validRows.length;
                index += CHUNK_SIZE
            ) {
                const chunk =
                    state.validRows.slice(
                        index,
                        index + CHUNK_SIZE
                    );

                const isFinalChunk =
                    index + CHUNK_SIZE >=
                    state.validRows.length;

                const data =
                    await invokeImportChunk(
                        client,
                        chunk,
                        batchId,
                        isFinalChunk
                    );

                batchId = data.batchId;
                latestSummary = data.summary;

                if (Array.isArray(data.results)) {
                    state.results.push(
                        ...data.results
                    );
                }

                processed += chunk.length;
                updateProgress(
                    processed,
                    state.validRows.length
                );
            }

            renderResults(latestSummary);
        } catch (error) {
            showError(error);
            elements.progressText.textContent =
                "Import stopped because an error occurred.";
        } finally {
            state.importing = false;
            elements.fileInput.disabled = false;

            if (state.validationErrors === 0) {
                elements.startImport.disabled = false;
            }
        }
    }

    function renderResults(summary) {
        const imported =
            Number(summary?.imported || 0);

        const existing =
            Number(summary?.existing || 0);

        const failed =
            Number(summary?.failed || 0);

        elements.resultsSection.hidden = false;
        elements.resultImported.textContent =
            String(imported);
        elements.resultExisting.textContent =
            String(existing);
        elements.resultFailed.textContent =
            String(failed);

        elements.resultSummary.textContent =
            failed > 0
                ? "Import finished with some rows requiring attention."
                : "All member rows were processed successfully.";

        elements.resultList.innerHTML =
            state.results
                .map(
                    function (result) {
                        const cssStatus =
                            result.status === "failed"
                                ? "failed"
                                : result.status === "existing"
                                    ? "existing"
                                    : "success";

                        const icon =
                            result.status === "failed"
                                ? "!"
                                : result.status === "existing"
                                    ? "↔"
                                    : "✓";

                        return `
                            <div class="admin-import-result-row admin-import-result-row--${cssStatus}">
                                <span class="admin-import-result-row__status">
                                    ${icon}
                                </span>

                                <div>
                                    <strong>
                                        Row ${escapeHtml(result.rowNumber)} · ${escapeHtml(result.email)}
                                    </strong>

                                    <small>
                                        ${escapeHtml(result.message || result.status)}
                                    </small>
                                </div>
                            </div>
                        `;
                    }
                )
                .join("");

        elements.resultsSection.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }

    function resetImportState() {
        state.filename = null;
        state.rows = [];
        state.validRows = [];
        state.validationErrors = 0;
        state.results = [];
        state.importing = false;

        elements.fileInput.value = "";
        elements.fileInput.disabled = false;
        elements.fileName.textContent =
            "No file selected";
        elements.validationSection.hidden = true;
        elements.actionSection.hidden = true;
        elements.resultsSection.hidden = true;
        elements.progress.hidden = true;
        elements.progressBar.style.width = "0%";
        elements.startImport.disabled = true;

        clearError();
    }

    function bindControls() {
        elements.template.addEventListener(
            "click",
            downloadTemplate
        );

        elements.fileInput.addEventListener(
            "change",
            handleFileSelected
        );

        elements.startImport.addEventListener(
            "click",
            startImport
        );

        elements.newImport.addEventListener(
            "click",
            function () {
                resetImportState();
                window.scrollTo({
                    top: 0,
                    behavior: "smooth"
                });
            }
        );
    }

    async function loadAdminContext() {
        if (!window.Paryx.clubContext) {
            throw new Error(
                "Paryx club context is unavailable."
            );
        }

        const clubContext =
            await window.Paryx
                .clubContext
                .ready;

        const activeClub =
            clubContext?.activeClub ||
            window.Paryx
                .clubContext
                .getActiveClub();

        if (
            !activeClub?.id ||
            !window.Paryx
                .clubContext
                .isAdminRole(
                    activeClub.role
                )
        ) {
            throw new Error(
                "Admin access required."
            );
        }

        state.clubId =
            activeClub.id;

        elements.clubName.textContent =
            activeClub.name ||
            "Your club";
    }

    async function initialise() {
        if (state.initialised) {
            return;
        }

        state.initialised = true;
        cacheElements();
        bindControls();

        try {
            if (!window.Paryx.ready) {
                throw new Error(
                    "Paryx has not finished initialising."
                );
            }

            const context =
                await window.Paryx.ready;

            await loadAdminContext();
        } catch (error) {
            const message =
                getReadableError(error)
                    .toLowerCase();

            if (
                message.includes(
                    "admin access required"
                ) ||
                message.includes(
                    "staff club access required"
                )
            ) {
                window.location.replace(
                    "login.html?reason=access"
                );
                return;
            }

            showError(error);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initialise,
            { once: true }
        );
    } else {
        initialise();
    }
})();
