(function () {
    "use strict";

    const elements = {
        error: document.getElementById("maintenanceError"),
        success: document.getElementById("maintenanceSuccess"),
        ownerOnly: document.getElementById("ownerOnlyPanel"),
        workspace: document.getElementById("resetWorkspace"),
        keepEmail: document.getElementById("keepAccountEmail"),
        reason: document.getElementById("resetReason"),
        previewButton: document.getElementById("previewResetButton"),
        previewPanel: document.getElementById("previewPanel"),
        previewKeep: document.getElementById("previewKeepAccount"),
        previewStats: document.getElementById("previewStats"),
        readyStatus: document.getElementById("resetReadyStatus"),
        runButton: document.getElementById("runResetButton")
    };

    let state = {
        preview: null,
        previewEmail: ""
    };

    function clearMessages() {
        if (elements.error) {
            elements.error.hidden = true;
            elements.error.textContent = "";
        }

        if (elements.success) {
            elements.success.hidden = true;
            elements.success.textContent = "";
        }
    }

    function showError(error) {
        console.error("Paryx demo reset:", error);

        if (!elements.error) {
            return;
        }

        elements.error.textContent =
            error?.message || String(error || "Demo reset failed.");
        elements.error.hidden = false;
    }

    function showSuccess(message) {
        if (!elements.success) {
            return;
        }

        elements.success.textContent = message;
        elements.success.hidden = false;
    }

    function cleanEmail() {
        return String(elements.keepEmail?.value || "")
            .trim()
            .toLowerCase();
    }

    function formatMoney(value) {
        const amount = Number(value || 0);

        return new Intl.NumberFormat("en-GB", {
            style: "currency",
            currency: "GBP"
        }).format(Number.isFinite(amount) ? amount : 0);
    }

    function stat(label, value, danger = false) {
        return `
            <article class="console-reset-stat${danger ? " console-reset-stat--danger" : ""}">
                <span>${label}</span>
                <strong>${value}</strong>
            </article>
        `;
    }

    function renderPreview(preview) {
        if (!elements.previewPanel || !elements.previewStats) {
            return;
        }

        elements.previewKeep.textContent =
            `Preserved account: ${preview.keep_email || "—"}`;

        elements.previewStats.innerHTML = [
            stat("Auth accounts removed", Number(preview.auth_accounts_to_delete || 0), true),
            stat("Club members removed", Number(preview.club_memberships_to_delete || 0), true),
            stat("Bookings removed", Number(preview.bookings_to_delete || 0), true),
            stat("Credit accounts", Number(preview.club_credit_accounts_to_delete || 0), true),
            stat("Credit transactions", Number(preview.club_credit_transactions_to_delete || 0), true),
            stat("Credit balance cleared", formatMoney(preview.club_credit_balance_to_clear), true),
            stat("Competition entries", Number(preview.competition_entries_to_delete || 0), true),
            stat("Competition prizes", Number(preview.competition_prizes_to_delete || 0), true),
            stat("External result rows", Number(preview.competition_external_results_to_delete || 0), true),
            stat("Result imports", Number(preview.competition_result_imports_to_delete || 0), true),
            stat("CSV ingest files", Number(preview.competition_ingest_files_to_delete || 0), true),
            stat("Competition definitions kept", Number(preview.competition_definitions_preserved || 0)),
            stat("Notifications", Number(preview.notifications_to_delete || 0), true),
            stat("Tee alerts", Number(preview.tee_time_alerts_to_delete || 0), true),
            stat("Import batches", Number(preview.member_import_batches_to_delete || 0), true),
            stat("Old audit rows", Number(preview.audit_rows_to_replace || 0), true)
        ].join("");

        elements.previewPanel.hidden = false;
        elements.runButton.disabled = false;

        if (elements.readyStatus) {
            elements.readyStatus.textContent =
                "Preview complete. Review the figures below, then run the reset when ready.";
        }
    }

    async function previewReset() {
        clearMessages();

        const email = cleanEmail();

        if (!email) {
            showError(new Error("Enter the account that must be preserved."));
            elements.keepEmail?.focus();
            return;
        }

        elements.previewButton.disabled = true;
        elements.previewButton.textContent = "Checking…";

        try {
            const { data, error } =
                await window.supabaseClient.rpc(
                    "platform_demo_reset_preview",
                    { p_keep_email: email }
                );

            if (error) {
                throw error;
            }

            state.preview = data || null;
            state.previewEmail = email;
            renderPreview(data || {});
        } catch (error) {
            state.preview = null;
            state.previewEmail = "";
            elements.previewPanel.hidden = true;
            elements.runButton.disabled = true;

            if (elements.readyStatus) {
                elements.readyStatus.textContent =
                    "Preview failed. Correct the issue and run Preview again.";
            }

            showError(error);
        } finally {
            elements.previewButton.disabled = false;
            elements.previewButton.textContent = "Preview reset";
        }
    }

    async function runReset() {
        clearMessages();

        const email = cleanEmail();
        const reason = String(elements.reason?.value || "").trim();

        if (!state.preview || state.previewEmail !== email) {
            showError(new Error("Run Preview again before resetting this account set."));
            return;
        }

        if (!reason) {
            showError(new Error("Enter an audit reason before running the reset."));
            elements.reason?.focus();
            return;
        }

        const accountCount =
            Number(state.preview.auth_accounts_to_delete || 0);
        const memberCount =
            Number(state.preview.club_memberships_to_delete || 0);
        const credit =
            formatMoney(state.preview.club_credit_balance_to_clear);

        const first = window.confirm(
            "DESTRUCTIVE DEMO RESET\n\n" +
            `Preserve: ${email}\n` +
            `Delete Auth accounts: ${accountCount}\n` +
            `Delete club member records: ${memberCount}\n` +
            `Clear Club Credit: ${credit}\n\n` +
            "Bookings, result history, imports, notifications and development audit history will also be cleared.\n\n" +
            "Club/course/tee-time/calendar configuration will be preserved.\n\n" +
            "Continue?"
        );

        if (!first) {
            return;
        }

        const confirmation = window.prompt(
            "FINAL CONFIRMATION\n\nType RESET DEMO DATA exactly to continue."
        );

        if (confirmation !== "RESET DEMO DATA") {
            showError(new Error("Reset cancelled: confirmation phrase did not match."));
            return;
        }

        elements.runButton.disabled = true;
        elements.runButton.textContent = "Resetting…";
        elements.previewButton.disabled = true;

        try {
            const { data, error } =
                await window.supabaseClient.rpc(
                    "platform_demo_reset",
                    {
                        p_keep_email: email,
                        p_confirmation: confirmation,
                        p_reason: reason
                    }
                );

            if (error) {
                throw error;
            }

            state.preview = null;
            state.previewEmail = "";
            elements.previewPanel.hidden = true;

            showSuccess(
                `Demo environment reset complete. ${data?.auth_accounts_deleted ?? accountCount} Auth account(s) removed; ${email} preserved.`
            );

            window.setTimeout(
                function () {
                    window.location.href = "dashboard.html";
                },
                1800
            );
        } catch (error) {
            showError(error);
        } finally {
            elements.runButton.disabled = !state.preview;
            elements.runButton.textContent = "Reset demo environment";
            elements.previewButton.disabled = false;
        }
    }

    async function initialise() {
        try {
            const context = await window.ParyxConsole.ready;
            const role = String(context?.access?.role || "");

            if (role !== "platform_owner") {
                elements.ownerOnly.hidden = false;
                elements.workspace.hidden = true;
                return;
            }

            elements.ownerOnly.hidden = true;
            elements.workspace.hidden = false;

            elements.previewButton?.addEventListener("click", previewReset);
            elements.runButton?.addEventListener("click", runReset);

            elements.keepEmail?.addEventListener("input", function () {
                state.preview = null;
                state.previewEmail = "";
                elements.previewPanel.hidden = true;
                elements.runButton.disabled = true;

                if (elements.readyStatus) {
                    elements.readyStatus.textContent =
                        "Account changed. Run Preview again to unlock the reset.";
                }

                clearMessages();
            });
        } catch (error) {
            showError(error);
        }
    }

    initialise();
})();
