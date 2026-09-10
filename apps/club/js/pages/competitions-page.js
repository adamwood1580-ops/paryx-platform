(function () {
    "use strict";

    window.Paryx = window.Paryx || {};

    const MANAGE_ROLES = new Set(["professional", "manager", "club_admin"]);
    const CONFIRM_ROLES = new Set(["manager", "club_admin"]);

    const STATUS_LABELS = {
        draft: "Scheduled",
        open: "Open",
        closed: "Closed",
        results_pending: "Results pending",
        completed: "Completed",
        cancelled: "Cancelled"
    };

    const FORMAT_LABELS = {
        stableford: "Stableford",
        stroke_play: "Stroke play",
        match_play: "Match play",
        fourball: "Fourball",
        greensomes: "Greensomes",
        texas_scramble: "Texas Scramble",
        other: "Other"
    };

    const PLACE_AWARD_TYPES = [
        ["", "No prize"],
        ["winner", "Winner"],
        ["runner_up", "Runner-up"],
        ["third_place", "Third place"],
        ["place_prize", "Place prize"],
        ["best_gross", "Best gross"],
        ["division", "Division prize"],
        ["other", "Other prize"]
    ];

    const SPECIAL_AWARD_TYPES = [
        ["nearest_pin", "Nearest the pin"],
        ["longest_drive", "Longest drive"],
        ["twos", "Two's prize"],
        ["best_gross", "Best gross"],
        ["division", "Division prize"],
        ["other", "Other prize"]
    ];

    const state = {
        clubId: null,
        clubName: null,
        role: null,
        canManage: false,
        canConfirm: false,
        rangeMode: "current",
        listRows: [],
        integration: null,
        calendarEvents: [],
        selectedCompetitionId: null,
        selectedCompetition: null,
        externalResults: [],
        awards: [],
        manualPlaceAwards: [],
        specialAwards: [],
        memberMatches: {
            manual: [],
            special: []
        },
        memberSearchTimers: {
            manual: null,
            special: null
        },
        matchTargetExternalResultId: null,
        matchMemberMatches: [],
        matchSearchTimer: null,
        listSearchTimer: null
    };

    const $ = (id) => document.getElementById(id);

    const elements = {
        clubName: $("competitionClubName"),
        error: $("competitionError"),
        success: $("competitionSuccess"),
        dialogError: $("competitionDialogError"),
        dialogSuccess: $("competitionDialogSuccess"),
        syncCalendar: $("competitionSyncCalendarButton"),
        currentCount: $("competitionCurrentCount"),
        awaitingCount: $("competitionAwaitingCount"),
        readyCount: $("competitionReadyCount"),
        completedCount: $("competitionCompletedCount"),
        rangeLabel: $("competitionRangeLabel"),
        rangeCurrent: $("competitionRangeCurrent"),
        rangePrevious: $("competitionRangePrevious"),
        rangeFuture: $("competitionRangeFuture"),
        search: $("competitionSearch"),
        statusFilter: $("competitionStatusFilter"),
        fromDate: $("competitionFromDate"),
        toDate: $("competitionToDate"),
        refresh: $("competitionRefreshButton"),
        providerBanner: $("competitionProviderBanner"),
        providerTitle: $("competitionProviderTitle"),
        providerText: $("competitionProviderText"),
        providerState: $("competitionProviderState"),
        list: $("competitionList"),
        dialog: $("competitionDialog"),
        closeDialog: $("closeCompetitionDialog"),
        dialogTitle: $("competitionDialogTitle"),
        dialogMeta: $("competitionDialogMeta"),
        form: $("competitionForm"),
        calendarEvent: $("competitionCalendarEvent"),
        name: $("competitionName"),
        date: $("competitionDate"),
        format: $("competitionFormat"),
        section: $("competitionSection"),
        status: $("competitionStatus"),
        qualifier: $("competitionQualifier"),
        notes: $("competitionNotes"),
        saveCompetition: $("saveCompetitionButton"),
        externalSection: $("competitionExternalResultsSection"),
        externalTitle: $("competitionExternalResultsTitle"),
        externalText: $("competitionExternalResultsText"),
        externalState: $("competitionExternalResultsState"),
        externalWrap: $("competitionExternalResultsWrap"),
        externalEmpty: $("competitionExternalEmpty"),
        externalResults: $("competitionExternalResults"),
        externalMatchPanel: $("competitionExternalMatchPanel"),
        externalMatchTarget: $("competitionExternalMatchTarget"),
        externalMatchCancel: $("competitionExternalMatchCancel"),
        externalMatchSearch: $("competitionExternalMatchSearch"),
        externalMatchResults: $("competitionExternalMatchResults"),
        manualSection: $("competitionManualResultsSection"),
        manualCount: $("competitionManualResultCount"),
        memberSearch: $("competitionMemberSearch"),
        memberResults: $("competitionMemberResults"),
        manualResults: $("competitionManualResults"),
        specialSection: $("competitionSpecialPrizesSection"),
        specialCount: $("competitionSpecialPrizeCount"),
        specialMemberSearch: $("competitionSpecialMemberSearch"),
        specialMemberResults: $("competitionSpecialMemberResults"),
        specialPrizes: $("competitionSpecialPrizes"),
        saveAwardsSection: $("competitionSaveAwardsSection"),
        awardTotal: $("competitionAwardTotal"),
        saveAwards: $("saveCompetitionAwardsButton"),
        confirmSection: $("competitionConfirmSection"),
        confirmTitle: $("competitionConfirmationTitle"),
        confirmText: $("competitionConfirmationText"),
        verificationLabel: $("competitionVerificationLabel"),
        verifiedCheckbox: $("competitionResultsVerified"),
        confirmButton: $("confirmResultsButton"),
        reopenButton: $("reopenResultsButton"),
        csvImportPanel: $("competitionCsvImportPanel"),
        csvFile: $("competitionCsvFile"),
        csvChooseButton: $("competitionCsvChooseButton"),
        csvStatus: $("competitionCsvStatus"),
        bridgeConfigButton: $("competitionBridgeConfigButton")
    };

    function client() {
        if (window.supabaseClient && typeof window.supabaseClient.rpc === "function") {
            return window.supabaseClient;
        }
        throw new Error("The Paryx data service is unavailable.");
    }

    function esc(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function clearMessages() {
        [elements.error, elements.dialogError].forEach((item) => {
            if (!item) return;
            item.hidden = true;
            item.textContent = "";
        });
        [elements.success, elements.dialogSuccess].forEach((item) => {
            if (!item) return;
            item.hidden = true;
            item.textContent = "";
        });
    }

    function messageTarget(pageElement, dialogElement) {
        return elements.dialog?.open && dialogElement ? dialogElement : pageElement;
    }

    function showError(error) {
        console.error("Paryx Competitions error:", error);
        const target = messageTarget(elements.error, elements.dialogError);
        if (!target) return;
        target.hidden = false;
        target.textContent = error?.message || error?.details || "Competition management could not complete this action.";
        target.scrollIntoView({ block: "nearest" });
    }

    function showSuccess(message) {
        const target = messageTarget(elements.success, elements.dialogSuccess);
        if (!target) return;
        target.hidden = false;
        target.textContent = message;
        target.scrollIntoView({ block: "nearest" });
    }

    function dateInputValue(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    function addDays(date, days) {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
    }

    function formatDate(value) {
        if (!value) return "—";
        const date = new Date(`${value}T12:00:00`);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric"
        }).format(date);
    }

    function formatDateTime(value) {
        if (!value) return "Not yet";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat("en-GB", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit"
        }).format(date);
    }

    function formatMoney(value, currency = "GBP") {
        return new Intl.NumberFormat("en-GB", {
            style: "currency",
            currency: String(currency || "GBP")
        }).format(Number(value || 0));
    }

    function ordinal(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return "";
        if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
        if (n % 10 === 1) return `${n}st`;
        if (n % 10 === 2) return `${n}nd`;
        if (n % 10 === 3) return `${n}rd`;
        return `${n}th`;
    }

    function uniqueKey(prefix) {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return `${prefix}:${window.crypto.randomUUID()}`;
        }
        return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    }

    function normaliseRpcObject(data) {
        if (Array.isArray(data) && data.length === 1 && data[0] && !Array.isArray(data[0])) {
            return data[0];
        }
        return data || {};
    }

    function normaliseRpcArray(data) {
        if (Array.isArray(data)) return data;
        return [];
    }

    function statusClass(status) {
        if (status === "open") return "competition-state-pill--open";
        if (status === "closed" || status === "results_pending") return "competition-state-pill--pending";
        if (status === "completed") return "competition-state-pill--completed";
        if (status === "cancelled" || status === "error") return "competition-state-pill--cancelled";
        return "";
    }

    function syncStatusLabel(row) {
        const status = row?.result_sync_status;
        const provider = String(row?.result_provider || "manual").toLowerCase();
        if (row?.results_confirmed_at || row?.status === "completed") return "Completed";
        if (status === "imported") return "Results imported";
        if (status === "partial_match") return "Needs member match";
        if (status === "error") return "Sync error";
        if (provider === "clubv1" && status === "awaiting_results") return "Awaiting ClubV1";
        if (provider !== "manual" && status === "awaiting_results") return "Awaiting provider";
        return "Manual fallback";
    }

    function syncStatusClass(row) {
        const status = row?.result_sync_status;
        if (row?.results_confirmed_at || row?.status === "completed") return "competition-state-pill--completed";
        if (status === "imported") return "competition-state-pill--open";
        if (status === "partial_match" || status === "awaiting_results") return "competition-state-pill--pending";
        if (status === "error") return "competition-state-pill--cancelled";
        return "";
    }

    function providerName(provider) {
        const value = String(provider || "manual").toLowerCase();
        if (value === "clubv1") return "ClubV1";
        if (value === "manual") return "Manual";
        return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Manual";
    }

    function setRange(mode, reload = true) {
        const today = new Date();
        state.rangeMode = mode;

        if (mode === "current") {
            elements.fromDate.value = dateInputValue(addDays(today, -3));
            elements.toDate.value = dateInputValue(addDays(today, 3));
        } else if (mode === "previous") {
            elements.fromDate.value = dateInputValue(addDays(today, -1825));
            elements.toDate.value = dateInputValue(addDays(today, -4));
        } else if (mode === "future") {
            elements.fromDate.value = dateInputValue(addDays(today, 4));
            elements.toDate.value = dateInputValue(addDays(today, 1825));
        }

        [
            [elements.rangeCurrent, "current"],
            [elements.rangePrevious, "previous"],
            [elements.rangeFuture, "future"]
        ].forEach(([button, name]) => button.classList.toggle("is-active", mode === name));

        renderRangeLabel();
        if (reload && state.clubId) loadList().catch(showError);
    }

    function renderRangeLabel() {
        const from = formatDate(elements.fromDate.value);
        const to = formatDate(elements.toDate.value);
        const prefix = state.rangeMode === "current"
            ? "Current working window"
            : state.rangeMode === "previous"
                ? "Previous competitions"
                : state.rangeMode === "future"
                    ? "Future competitions"
                    : "Custom range";
        elements.rangeLabel.textContent = `${prefix}: ${from} – ${to}`;
    }

    async function syncCalendar(showMessage = false) {
        if (!state.canManage) return;
        const originalText = elements.syncCalendar.textContent;
        elements.syncCalendar.disabled = true;
        elements.syncCalendar.textContent = "Syncing…";
        try {
            const { error } = await client().rpc("competition_sync_calendar", {
                p_club_id: state.clubId
            });
            if (error) throw error;
            if (showMessage) showSuccess("Competition records synced from the Paryx calendar.");
        } finally {
            elements.syncCalendar.disabled = false;
            elements.syncCalendar.textContent = originalText;
        }
    }

    async function loadIntegration() {
        const { data, error } = await client().rpc("competition_get_result_integration", {
            p_club_id: state.clubId
        });
        if (error) throw error;
        state.integration = normaliseRpcObject(data);
        renderProviderBanner();
    }

    function renderProviderBanner() {
        const integration = state.integration || {};
        const enabled = integration.enabled === true;

        elements.providerBanner.classList.toggle("competition-provider-banner--connected", enabled);
        elements.providerTitle.textContent = "ClubV1 results";
        elements.providerState.textContent = enabled ? "CSV / API ready" : "CSV ready";
        elements.providerState.className = "competition-state-pill competition-state-pill--open";
        elements.providerText.textContent = enabled
            ? (integration.last_sync_at
                ? `ClubV1 result import is enabled. Last result sync ${formatDateTime(integration.last_sync_at)}. CSV and future API results use the same import engine.`
                : "ClubV1 result import is enabled. CSV is available now; an official API adapter can use the same result engine later.")
            : "ClubV1 CSV import is available now. The same result engine is ready for official API access later.";

        if (elements.bridgeConfigButton) {
            elements.bridgeConfigButton.hidden = state.role !== "club_admin";
        }
    }

    async function loadCalendarEvents() {
        const now = new Date();
        const from = new Date(now.getFullYear() - 5, 0, 1);
        const to = new Date(now.getFullYear() + 5, 11, 31);
        const { data, error } = await client().rpc("competition_get_calendar_events", {
            p_club_id: state.clubId,
            p_from_date: dateInputValue(from),
            p_to_date: dateInputValue(to)
        });
        if (error) throw error;
        state.calendarEvents = normaliseRpcArray(data);
        renderCalendarOptions();
    }

    function renderCalendarOptions() {
        const current = state.selectedCompetition?.club_event_id || elements.calendarEvent.value;
        elements.calendarEvent.innerHTML = '<option value="">Not linked</option>' + state.calendarEvents.map((event) => (
            `<option value="${esc(event.event_id)}">${esc(`${formatDate(event.event_date)} — ${event.title}`)}</option>`
        )).join("");
        if (current) elements.calendarEvent.value = current;
    }

    async function loadList() {
        elements.list.innerHTML = '<div class="competition-empty">Loading competitions...</div>';
        const { data, error } = await client().rpc("competition_list_v2", {
            p_club_id: state.clubId,
            p_from_date: elements.fromDate.value,
            p_to_date: elements.toDate.value,
            p_status: elements.statusFilter.value || null,
            p_search: elements.search.value.trim() || null
        });
        if (error) throw error;
        state.listRows = normaliseRpcArray(data);
        renderList();
        renderSummary();
    }

    function renderSummary() {
        const rows = state.listRows;
        elements.currentCount.textContent = String(rows.length);
        elements.awaitingCount.textContent = String(rows.filter((row) =>
            !row.results_confirmed_at && row.result_sync_status === "awaiting_results"
        ).length);
        elements.readyCount.textContent = String(rows.filter((row) =>
            !row.results_confirmed_at && ["imported", "partial_match"].includes(row.result_sync_status)
        ).length);
        elements.completedCount.textContent = String(rows.filter((row) =>
            Boolean(row.results_confirmed_at) || row.status === "completed"
        ).length);
    }

    function renderList() {
        const rows = state.listRows;
        if (!rows.length) {
            elements.list.innerHTML = '<div class="competition-empty">No competitions match this range and search.</div>';
            return;
        }

        elements.list.innerHTML = rows.map((row) => {
            const imported = Number(row.external_result_count || 0);
            const unmatched = Number(row.unmatched_result_count || 0);
            const provider = providerName(row.result_provider);
            const providerDetail = imported > 0
                ? `${provider} · ${imported} result${imported === 1 ? "" : "s"}${unmatched ? ` · ${unmatched} unmatched` : ""}`
                : row.result_provider === "manual"
                    ? "Manual result fallback"
                    : `${provider} result feed`;

            return `<div class="competition-row competition-row--api">
                <div class="competition-row__name">
                    <strong>${esc(row.name)}</strong>
                    <small>${esc(FORMAT_LABELS[row.competition_format] || row.competition_format)} · ${esc(row.section_label)}${row.is_qualifier ? " · Qualifier" : ""}</small>
                </div>
                <span>${esc(formatDate(row.competition_date))}</span>
                <span class="competition-state-pill ${statusClass(row.status)}">${esc(STATUS_LABELS[row.status] || row.status)}</span>
                <div>
                    <span class="competition-state-pill ${syncStatusClass(row)}">${esc(syncStatusLabel(row))}</span>
                    <small>${esc(providerDetail)}</small>
                </div>
                <span>${esc(formatMoney(row.prize_total, row.currency_code))}</span>
                <button class="competition-button competition-button--secondary" type="button" data-competition-open="${esc(row.competition_id)}">Open</button>
            </div>`;
        }).join("");
    }

    async function openCompetition(competitionId) {
        clearMessages();
        if (!elements.dialog.open) elements.dialog.showModal();
        elements.dialogTitle.textContent = "Loading…";
        try {
            const { data, error } = await client().rpc("competition_get_detail_v2", {
                p_competition_id: competitionId
            });
            if (error) throw error;
            const detail = normaliseRpcObject(data);
            if (!detail?.competition) throw new Error("Competition details were not returned.");

            state.selectedCompetitionId = competitionId;
            state.selectedCompetition = detail.competition || {};
            state.externalResults = Array.isArray(detail.external_results) ? detail.external_results : [];
            state.awards = Array.isArray(detail.awards) ? detail.awards : [];
            state.manualPlaceAwards = state.awards
                .filter((award) => !award.source_external_result_key && !award.external_result_id && Number(award.placing) > 0)
                .map(copyAward);
            state.specialAwards = state.awards
                .filter((award) => !award.source_external_result_key && !award.external_result_id && (award.placing === null || award.placing === undefined))
                .map(copyAward);
            state.memberMatches.manual = [];
            state.memberMatches.special = [];
            state.matchTargetExternalResultId = null;
            state.matchMemberMatches = [];
            elements.externalMatchPanel.hidden = true;
            elements.externalMatchSearch.value = "";

            renderCalendarOptions();
            renderDetail();
        } catch (error) {
            elements.dialog.close();
            showError(error);
        }
    }

    function copyAward(award) {
        return {
            award_key: award.award_key || uniqueKey("award"),
            award_type: award.award_type || "other",
            membership_id: award.recipient_membership_id || award.membership_id || null,
            display_name: award.recipient_name || "Club member",
            membership_number: award.recipient_membership_number || "",
            placing: award.placing === null || award.placing === undefined ? null : Number(award.placing),
            amount: Number(award.amount || 0),
            label: award.label || "",
            external_result_id: award.external_result_id || null,
            source_external_result_key: award.source_external_result_key || null,
            credit_transaction_id: award.credit_transaction_id || null
        };
    }

    function renderDetail() {
        const competition = state.selectedCompetition;
        const confirmed = Boolean(competition.results_confirmed_at);

        elements.dialogTitle.textContent = competition.name || "Competition";
        elements.dialogMeta.textContent = confirmed
            ? `Completed · verified ${formatDateTime(competition.results_verified_at || competition.results_confirmed_at)}`
            : `${formatDate(competition.competition_date)} · ${providerName(competition.result_provider)} result workflow`;

        elements.calendarEvent.value = competition.club_event_id || "";
        elements.name.value = competition.name || "";
        elements.date.value = competition.competition_date || "";
        elements.format.value = competition.competition_format || "other";
        elements.section.value = competition.section || "club";
        elements.status.value = competition.status || "draft";
        elements.qualifier.checked = competition.is_qualifier === true;
        elements.notes.value = competition.notes || "";
        elements.verifiedCheckbox.checked = false;

        renderExternalResults();
        renderManualPlaceAwards();
        renderSpecialAwards();
        renderAwardTotal();
        applyPermissions();
    }

    function applyPermissions() {
        const confirmed = Boolean(state.selectedCompetition?.results_confirmed_at);
        const editable = state.canManage && !confirmed;
        const hasCredit = state.awards.some((award) => Boolean(award.credit_transaction_id));

        elements.format.disabled = !editable;
        elements.status.disabled = !editable;
        elements.notes.disabled = !editable;
        elements.saveCompetition.hidden = !editable;
        elements.memberSearch.disabled = !editable || state.externalResults.length > 0;
        elements.specialMemberSearch.disabled = !editable;
        elements.saveAwards.hidden = !editable;
        elements.confirmButton.hidden = confirmed || !state.canConfirm;
        elements.verificationLabel.hidden = confirmed || !state.canConfirm;
        elements.verifiedCheckbox.disabled = !editable;
        elements.reopenButton.hidden = !(confirmed && state.canConfirm && !hasCredit);

        elements.manualSection.hidden = state.externalResults.length > 0;
        if (elements.csvImportPanel) elements.csvImportPanel.hidden = !state.canConfirm || confirmed;
        if (elements.csvChooseButton) elements.csvChooseButton.disabled = !state.canConfirm || confirmed;

        if (confirmed) {
            elements.confirmTitle.textContent = "Competition completed";
            elements.confirmText.textContent = hasCredit
                ? "The verified prize allocation has been posted to Club Credit and is locked."
                : "The result has been confirmed with no Club Credit posted.";
        } else {
            elements.confirmTitle.textContent = "Confirm results & award credit";
            elements.confirmText.textContent = state.externalResults.length > 0
                ? "Use the imported finish positions, check them against HowDidiDo, then confirm the prize allocation."
                : "External results are not available yet. Manual finishing-place fallback can be used after checking HowDidiDo / ClubV1.";
        }
    }

    function resultDisplay(result) {
        if (result.result_text) return result.result_text;
        const parts = [];
        if (result.points !== null && result.points !== undefined) parts.push(`${result.points} pts`);
        if (result.nett_score !== null && result.nett_score !== undefined) parts.push(`Nett ${result.nett_score}`);
        if (result.gross_score !== null && result.gross_score !== undefined) parts.push(`Gross ${result.gross_score}`);
        return parts.join(" · ") || "—";
    }

    function awardForExternalResult(result) {
        return state.awards.find((award) =>
            (award.source_external_result_key && award.source_external_result_key === result.external_result_key) ||
            (award.external_result_id && award.external_result_id === result.external_result_id)
        ) || null;
    }

    function optionsHtml(options, selectedValue, includeNoPrize = false) {
        const list = includeNoPrize ? PLACE_AWARD_TYPES : options;
        return list.map(([value, label]) => (
            `<option value="${esc(value)}" ${value === selectedValue ? "selected" : ""}>${esc(label)}</option>`
        )).join("");
    }

    function renderExternalResults() {
        const competition = state.selectedCompetition || {};
        const results = state.externalResults;
        const confirmed = Boolean(competition.results_confirmed_at);
        const locked = confirmed || !state.canManage;
        const provider = providerName(competition.result_provider);
        const currency = competition.currency_code || "GBP";

        elements.externalTitle.textContent = `${provider} official result`;

        if (!results.length) {
            elements.externalWrap.hidden = true;
            elements.externalEmpty.hidden = false;
            elements.externalState.textContent = competition.result_sync_status === "error" ? "Sync error" : "Awaiting results";
            elements.externalState.className = `competition-state-pill ${competition.result_sync_status === "error" ? "competition-state-pill--cancelled" : "competition-state-pill--pending"}`;
            elements.externalText.textContent = competition.result_provider === "manual"
                ? "No external provider is connected for this competition. The manual finishing-place fallback remains available."
                : `Paryx is ready for ${provider}. No result snapshot has been imported yet.`;
            elements.externalEmpty.textContent = competition.result_sync_error
                ? `Provider sync error: ${competition.result_sync_error}`
                : "No external result has been imported for this competition yet.";
            return;
        }

        elements.externalWrap.hidden = false;
        elements.externalEmpty.hidden = true;
        elements.externalState.textContent = competition.result_sync_status === "partial_match" ? "Needs matching" : "Results imported";
        elements.externalState.className = `competition-state-pill ${competition.result_sync_status === "partial_match" ? "competition-state-pill--pending" : "competition-state-pill--open"}`;
        elements.externalText.textContent = `${results.length} result${results.length === 1 ? "" : "s"} imported from ${provider}${competition.last_result_sync_at ? ` · last sync ${formatDateTime(competition.last_result_sync_at)}` : ""}. Finish positions are read-only.`;

        elements.externalResults.innerHTML = results.map((result) => {
            const saved = awardForExternalResult(result);
            const selectedType = saved?.award_type || "";
            const amount = Number(saved?.amount || 0);
            const matched = Boolean(result.membership_id);
            const disabled = locked || !matched;
            const matchHtml = matched
                ? `<strong>${esc(result.matched_name || result.player_name)}</strong><small>${esc(result.matched_membership_number ? `Member ${result.matched_membership_number}` : "Matched")}</small>`
                : `<strong class="competition-unmatched">Unmatched</strong><small>${esc(result.membership_number ? `Provider member ${result.membership_number}` : "No Paryx membership match")}</small>${locked ? "" : `<button class="competition-mini-button competition-match-button" type="button" data-external-match="${esc(result.external_result_id)}">Match member</button>`}`;

            return `<tr data-external-row="${esc(result.external_result_id)}" data-external-key="${esc(result.external_result_key)}" data-membership-id="${esc(result.membership_id || "")}" data-place="${esc(result.placing ?? "")}">
                <td><strong>${esc(result.placing ? ordinal(result.placing) : "—")}</strong></td>
                <td><div class="competition-entry-name"><strong>${esc(result.player_name)}</strong><small>${esc(result.membership_number ? `ClubV1 member ${result.membership_number}` : provider)}</small></div></td>
                <td>${esc(resultDisplay(result))}</td>
                <td><div class="competition-entry-name">${matchHtml}</div></td>
                <td><select data-external-field="award_type" ${disabled ? "disabled" : ""}>${optionsHtml(PLACE_AWARD_TYPES, selectedType, true)}</select></td>
                <td><div class="competition-credit-input"><span>${esc(currency === "GBP" ? "£" : currency)}</span><input data-external-field="amount" type="number" min="0" step="0.01" value="${esc(amount.toFixed(2))}" ${disabled || !selectedType ? "disabled" : ""} /></div></td>
            </tr>`;
        }).join("");
    }

    function openExternalMatch(externalResultId) {
        const result = state.externalResults.find((item) => item.external_result_id === externalResultId);
        if (!result || !state.canManage || state.selectedCompetition?.results_confirmed_at) return;
        state.matchTargetExternalResultId = externalResultId;
        state.matchMemberMatches = [];
        elements.externalMatchTarget.textContent = `Match ${result.player_name || "imported player"}`;
        elements.externalMatchSearch.value = "";
        elements.externalMatchResults.innerHTML = "";
        elements.externalMatchResults.hidden = true;
        elements.externalMatchPanel.hidden = false;
        elements.externalMatchSearch.focus();
    }

    function closeExternalMatch() {
        state.matchTargetExternalResultId = null;
        state.matchMemberMatches = [];
        elements.externalMatchPanel.hidden = true;
        elements.externalMatchSearch.value = "";
        elements.externalMatchResults.hidden = true;
        elements.externalMatchResults.innerHTML = "";
    }

    async function searchExternalMatchMembers() {
        if (!state.matchTargetExternalResultId) return;
        const query = elements.externalMatchSearch.value.trim();
        if (!query) {
            state.matchMemberMatches = [];
            elements.externalMatchResults.hidden = true;
            elements.externalMatchResults.innerHTML = "";
            return;
        }
        const { data, error } = await client().rpc("competition_search_members", {
            p_club_id: state.clubId,
            p_search: query
        });
        if (error) throw error;
        state.matchMemberMatches = normaliseRpcArray(data);
        elements.externalMatchResults.hidden = false;
        elements.externalMatchResults.innerHTML = state.matchMemberMatches.length
            ? state.matchMemberMatches.map((member) => `<button class="competition-member-result" type="button" data-external-match-member="${esc(member.membership_id)}"><span><strong>${esc(member.display_name)}</strong><small>${esc([member.membership_number ? `Member ${member.membership_number}` : null, member.email].filter(Boolean).join(" · "))}</small></span><strong>Link</strong></button>`).join("")
            : '<div class="competition-empty">No active members match.</div>';
    }

    async function linkExternalPlayer(membershipId) {
        if (!state.matchTargetExternalResultId || !membershipId) return;
        const target = state.externalResults.find((item) => item.external_result_id === state.matchTargetExternalResultId);
        const { error } = await client().rpc("competition_link_external_player", {
            p_external_result_id: state.matchTargetExternalResultId,
            p_membership_id: membershipId
        });
        if (error) throw error;
        closeExternalMatch();
        await Promise.all([reloadDetail(), loadList()]);
        showSuccess(`${target?.player_name || "Imported player"} linked to the Paryx member. Future imports can reuse this mapping.`);
    }

    function nextAvailablePlace() {
        const used = new Set(state.manualPlaceAwards.map((award) => Number(award.placing)));
        let place = 1;
        while (used.has(place) && place <= 20) place += 1;
        return Math.min(place, 20);
    }

    function defaultPlaceType(place) {
        if (place === 1) return "winner";
        if (place === 2) return "runner_up";
        if (place === 3) return "third_place";
        return "place_prize";
    }

    function labelForType(type, place) {
        switch (type) {
        case "winner": return "Winner";
        case "runner_up": return "Runner-up";
        case "third_place": return "Third place";
        case "place_prize": return place ? `${ordinal(place)} place` : "Place prize";
        case "best_gross": return "Best gross";
        case "nearest_pin": return "Nearest the pin";
        case "longest_drive": return "Longest drive";
        case "twos": return "Two's prize";
        case "division": return "Division prize";
        default: return "Competition prize";
        }
    }

    function renderManualPlaceAwards() {
        const awards = state.manualPlaceAwards;
        const confirmed = Boolean(state.selectedCompetition?.results_confirmed_at);
        const locked = confirmed || !state.canManage;
        const currency = state.selectedCompetition?.currency_code || "GBP";

        elements.manualCount.textContent = `${awards.length} place${awards.length === 1 ? "" : "s"}`;

        if (!awards.length) {
            elements.manualResults.innerHTML = '<tr><td colspan="5"><div class="competition-empty">No manual places entered.</div></td></tr>';
            return;
        }

        elements.manualResults.innerHTML = awards.map((award, index) => `<tr data-manual-row="${index}">
            <td><input data-manual-field="placing" type="number" min="1" max="20" step="1" value="${esc(award.placing)}" ${locked ? "disabled" : ""} /></td>
            <td><div class="competition-entry-name"><strong>${esc(award.display_name)}</strong><small>${esc(award.membership_number ? `Member ${award.membership_number}` : "Club member")}</small></div></td>
            <td><select data-manual-field="award_type" ${locked ? "disabled" : ""}>${optionsHtml(PLACE_AWARD_TYPES.filter(([value]) => value), award.award_type || defaultPlaceType(award.placing))}</select></td>
            <td><div class="competition-credit-input"><span>${esc(currency === "GBP" ? "£" : currency)}</span><input data-manual-field="amount" type="number" min="0" step="0.01" value="${esc(Number(award.amount || 0).toFixed(2))}" ${locked ? "disabled" : ""} /></div></td>
            <td>${locked ? "" : `<button class="competition-mini-button competition-mini-button--danger" type="button" data-manual-remove="${index}">Remove</button>`}</td>
        </tr>`).join("");
    }

    function renderSpecialAwards() {
        const awards = state.specialAwards;
        const confirmed = Boolean(state.selectedCompetition?.results_confirmed_at);
        const locked = confirmed || !state.canManage;
        const currency = state.selectedCompetition?.currency_code || "GBP";

        elements.specialCount.textContent = `${awards.length} prize${awards.length === 1 ? "" : "s"}`;

        if (!awards.length) {
            elements.specialPrizes.innerHTML = '<tr><td colspan="4"><div class="competition-empty">No additional prizes.</div></td></tr>';
            return;
        }

        elements.specialPrizes.innerHTML = awards.map((award, index) => `<tr data-special-row="${index}">
            <td><select data-special-field="award_type" ${locked ? "disabled" : ""}>${optionsHtml(SPECIAL_AWARD_TYPES, award.award_type || "nearest_pin")}</select></td>
            <td><div class="competition-entry-name"><strong>${esc(award.display_name)}</strong><small>${esc(award.membership_number ? `Member ${award.membership_number}` : "Club member")}</small></div></td>
            <td><div class="competition-credit-input"><span>${esc(currency === "GBP" ? "£" : currency)}</span><input data-special-field="amount" type="number" min="0" step="0.01" value="${esc(Number(award.amount || 0).toFixed(2))}" ${locked ? "disabled" : ""} /></div></td>
            <td>${locked ? "" : `<button class="competition-mini-button competition-mini-button--danger" type="button" data-special-remove="${index}">Remove</button>`}</td>
        </tr>`).join("");
    }

    async function searchMembers(mode) {
        if (!state.canManage || !state.selectedCompetitionId) return;
        const input = mode === "special" ? elements.specialMemberSearch : elements.memberSearch;
        const query = input.value.trim();
        const resultElement = mode === "special" ? elements.specialMemberResults : elements.memberResults;

        if (!query) {
            state.memberMatches[mode] = [];
            resultElement.hidden = true;
            resultElement.innerHTML = "";
            return;
        }

        const { data, error } = await client().rpc("competition_search_members", {
            p_club_id: state.clubId,
            p_search: query
        });
        if (error) throw error;
        state.memberMatches[mode] = normaliseRpcArray(data);
        renderMemberResults(mode);
    }

    function renderMemberResults(mode) {
        const rows = state.memberMatches[mode];
        const resultElement = mode === "special" ? elements.specialMemberResults : elements.memberResults;
        resultElement.hidden = false;

        if (!rows.length) {
            resultElement.innerHTML = '<div class="competition-empty">No active members match.</div>';
            return;
        }

        const manualExisting = new Set(state.manualPlaceAwards.map((award) => award.membership_id));
        const place = nextAvailablePlace();

        resultElement.innerHTML = rows.map((member) => {
            const alreadyPlaced = mode === "manual" && manualExisting.has(member.membership_id);
            const action = mode === "special"
                ? "Add prize"
                : alreadyPlaced
                    ? "Already placed"
                    : `Add as ${ordinal(place)}`;
            return `<button class="competition-member-result" type="button" data-member-mode="${mode}" data-member-add="${esc(member.membership_id)}" ${alreadyPlaced ? "disabled" : ""}>
                <span><strong>${esc(member.display_name)}</strong><small>${esc([member.membership_number ? `Member ${member.membership_number}` : null, member.email].filter(Boolean).join(" · "))}</small></span>
                <strong>${esc(action)}</strong>
            </button>`;
        }).join("");
    }

    function addMemberAward(mode, membershipId) {
        const member = state.memberMatches[mode].find((item) => item.membership_id === membershipId);
        if (!member) return;

        if (mode === "manual") {
            if (state.manualPlaceAwards.some((award) => award.membership_id === membershipId)) return;
            const placing = nextAvailablePlace();
            state.manualPlaceAwards.push({
                award_key: uniqueKey("manual-place"),
                award_type: defaultPlaceType(placing),
                membership_id: member.membership_id,
                display_name: member.display_name || "Club member",
                membership_number: member.membership_number || "",
                placing,
                amount: 0,
                label: labelForType(defaultPlaceType(placing), placing),
                external_result_id: null,
                source_external_result_key: null,
                credit_transaction_id: null
            });
            renderManualPlaceAwards();
            elements.memberSearch.value = "";
            elements.memberResults.hidden = true;
            state.memberMatches.manual = [];
        } else {
            state.specialAwards.push({
                award_key: uniqueKey("special"),
                award_type: "nearest_pin",
                membership_id: member.membership_id,
                display_name: member.display_name || "Club member",
                membership_number: member.membership_number || "",
                placing: null,
                amount: 0,
                label: "Nearest the pin",
                external_result_id: null,
                source_external_result_key: null,
                credit_transaction_id: null
            });
            renderSpecialAwards();
            elements.specialMemberSearch.value = "";
            elements.specialMemberResults.hidden = true;
            state.memberMatches.special = [];
        }

        renderAwardTotal();
    }

    function collectAwards() {
        const awards = [];

        if (state.externalResults.length > 0) {
            elements.externalResults.querySelectorAll("[data-external-row]").forEach((row) => {
                const awardType = row.querySelector('[data-external-field="award_type"]')?.value || "";
                const amount = Number(row.querySelector('[data-external-field="amount"]')?.value || 0);
                if (!awardType && amount <= 0) return;
                if (!awardType) throw new Error("Select a prize type for every credited finish position.");

                const externalResultId = row.dataset.externalRow;
                const sourceKey = row.dataset.externalKey;
                const membershipId = row.dataset.membershipId || null;
                const placingText = row.dataset.place;
                const placing = placingText ? Number(placingText) : null;

                if (!membershipId) {
                    throw new Error("A ClubV1 result must be matched to a Paryx member before Club Credit can be awarded.");
                }
                if (!Number.isFinite(amount) || amount < 0) {
                    throw new Error("Club Credit values must be zero or greater.");
                }

                awards.push({
                    award_key: `external:${sourceKey}`,
                    award_type: awardType,
                    membership_id: membershipId,
                    external_result_id: externalResultId,
                    source_external_result_key: sourceKey,
                    finishing_position: Number.isFinite(placing) ? placing : null,
                    amount,
                    label: labelForType(awardType, placing)
                });
            });
        } else {
            elements.manualResults.querySelectorAll("[data-manual-row]").forEach((row) => {
                const index = Number(row.dataset.manualRow);
                const source = state.manualPlaceAwards[index];
                if (!source) return;
                const placing = Number(row.querySelector('[data-manual-field="placing"]')?.value);
                const awardType = row.querySelector('[data-manual-field="award_type"]')?.value || "place_prize";
                const amount = Number(row.querySelector('[data-manual-field="amount"]')?.value || 0);

                if (!Number.isInteger(placing) || placing < 1 || placing > 20) {
                    throw new Error("Manual finishing places must be whole numbers between 1 and 20.");
                }
                if (!Number.isFinite(amount) || amount < 0) {
                    throw new Error("Club Credit values must be zero or greater.");
                }

                awards.push({
                    award_key: source.award_key,
                    award_type: awardType,
                    membership_id: source.membership_id,
                    external_result_id: null,
                    source_external_result_key: null,
                    finishing_position: placing,
                    amount,
                    label: labelForType(awardType, placing)
                });
            });
        }

        elements.specialPrizes.querySelectorAll("[data-special-row]").forEach((row) => {
            const index = Number(row.dataset.specialRow);
            const source = state.specialAwards[index];
            if (!source) return;
            const awardType = row.querySelector('[data-special-field="award_type"]')?.value || "nearest_pin";
            const amount = Number(row.querySelector('[data-special-field="amount"]')?.value || 0);
            if (!Number.isFinite(amount) || amount < 0) {
                throw new Error("Club Credit values must be zero or greater.");
            }
            awards.push({
                award_key: source.award_key,
                award_type: awardType,
                membership_id: source.membership_id,
                external_result_id: null,
                source_external_result_key: null,
                finishing_position: null,
                amount,
                label: labelForType(awardType, null)
            });
        });

        return awards;
    }

    function renderAwardTotal() {
        let total = 0;
        try {
            const externalAmounts = Array.from(elements.externalResults.querySelectorAll('[data-external-field="amount"]'));
            const manualAmounts = Array.from(elements.manualResults.querySelectorAll('[data-manual-field="amount"]'));
            const specialAmounts = Array.from(elements.specialPrizes.querySelectorAll('[data-special-field="amount"]'));
            total = [...externalAmounts, ...manualAmounts, ...specialAmounts]
                .reduce((sum, input) => sum + Math.max(0, Number(input.value || 0)), 0);
        } catch (error) {
            total = 0;
        }
        const currency = state.selectedCompetition?.currency_code || "GBP";
        elements.awardTotal.textContent = `${formatMoney(total, currency)} total Club Credit`;
        if (!state.selectedCompetition?.results_confirmed_at) {
            elements.confirmButton.textContent = total > 0
                ? `Confirm & award ${formatMoney(total, currency)}`
                : "Confirm results";
        }
    }

    function functionsClient() {
        const supabase = client();
        if (!supabase.functions || typeof supabase.functions.invoke !== "function") {
            throw new Error("The Paryx result-import service is unavailable.");
        }
        return supabase.functions;
    }

    async function importClubV1Csv(file) {
        if (!file || !state.selectedCompetitionId || !state.canConfirm) return;
        clearMessages();

        if (!/\.csv$/i.test(file.name || "")) {
            showError(new Error("Choose a ClubV1 CSV export."));
            return;
        }
        if (file.size > 2 * 1024 * 1024) {
            showError(new Error("The CSV is larger than the 2 MB competition-import limit."));
            return;
        }

        const originalText = elements.csvChooseButton.textContent;
        elements.csvChooseButton.disabled = true;
        elements.csvChooseButton.textContent = "Importing…";
        elements.csvStatus.textContent = file.name;

        try {
            const csvText = await file.text();
            const { data, error } = await functionsClient().invoke(
                "competition-result-ingest",
                {
                    body: {
                        action: "import_csv",
                        competition_id: state.selectedCompetitionId,
                        filename: file.name,
                        csv_text: csvText
                    }
                }
            );
            if (error) throw error;
            if (!data || data.ok !== true) {
                throw new Error(data?.error || "ClubV1 CSV import failed.");
            }

            await Promise.all([reloadDetail(), loadList(), loadIntegration()]);
            const matched = Number(data.matched_count || 0);
            const total = Number(data.result_count || 0);
            showSuccess(`ClubV1 CSV imported: ${total} result${total === 1 ? "" : "s"}, ${matched} matched to Paryx members.`);
            elements.csvStatus.textContent = `Imported ${file.name}`;
        } catch (error) {
            showError(error);
            elements.csvStatus.textContent = "Import failed";
        } finally {
            elements.csvChooseButton.disabled = false;
            elements.csvChooseButton.textContent = originalText;
            elements.csvFile.value = "";
        }
    }

    function downloadJson(filename, value) {
        const blob = new Blob([JSON.stringify(value, null, 2) + "\n"], {
            type: "application/json"
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async function createBridgeConfig() {
        if (state.role !== "club_admin" || !state.clubId) return;
        clearMessages();

        const deviceName = window.prompt(
            "Name this Windows Bridge device:",
            `${state.clubName || "Club"} ClubV1 Results PC`
        );
        if (!deviceName || !deviceName.trim()) return;

        if (!window.confirm(
            "Paryx will create a revocable device credential. It is downloaded once in the config file and should be installed on the authorised club PC only. Continue?"
        )) return;

        const originalText = elements.bridgeConfigButton.textContent;
        elements.bridgeConfigButton.disabled = true;
        elements.bridgeConfigButton.textContent = "Creating…";
        try {
            const { data, error } = await functionsClient().invoke(
                "competition-result-ingest",
                {
                    body: {
                        action: "create_bridge_device",
                        club_id: state.clubId,
                        device_name: deviceName.trim()
                    }
                }
            );
            if (error) throw error;
            if (!data || data.ok !== true || !data.config) {
                throw new Error(data?.error || "Bridge configuration could not be created.");
            }
            downloadJson("paryx-bridge-config.json", data.config);
            await loadIntegration();
            showSuccess("Windows Bridge config created. Treat the downloaded file as a secret and delete the download after installation.");
        } catch (error) {
            showError(error);
        } finally {
            elements.bridgeConfigButton.disabled = false;
            elements.bridgeConfigButton.textContent = originalText;
        }
    }

    async function saveCompetitionDetails(event) {
        event.preventDefault();
        if (!state.canManage || !state.selectedCompetitionId || state.selectedCompetition?.results_confirmed_at) return;
        clearMessages();
        elements.saveCompetition.disabled = true;
        try {
            const { error } = await client().rpc("competition_save", {
                p_club_id: state.clubId,
                p_competition_id: state.selectedCompetitionId,
                p_club_event_id: state.selectedCompetition.club_event_id || null,
                p_name: state.selectedCompetition.name,
                p_competition_date: state.selectedCompetition.competition_date,
                p_competition_format: elements.format.value,
                p_section: state.selectedCompetition.section || "club",
                p_status: elements.status.value,
                p_is_qualifier: state.selectedCompetition.is_qualifier === true,
                p_notes: elements.notes.value.trim() || null
            });
            if (error) throw error;
            state.selectedCompetition.competition_format = elements.format.value;
            state.selectedCompetition.status = elements.status.value;
            state.selectedCompetition.notes = elements.notes.value.trim() || null;
            await loadList();
            showSuccess("Competition details saved. Prize allocation has not been changed.");
        } catch (error) {
            showError(error);
        } finally {
            elements.saveCompetition.disabled = false;
        }
    }

    async function persistAwards(confirm = false) {
        const awards = collectAwards();
        if (confirm && !awards.length) {
            throw new Error("Add at least one prize before confirming this competition.");
        }

        const { data, error } = await client().rpc("competition_save_awards_v2", {
            p_competition_id: state.selectedCompetitionId,
            p_awards: awards,
            p_confirm: confirm,
            p_verified: confirm ? elements.verifiedCheckbox.checked : false
        });
        if (error) throw error;
        return normaliseRpcObject(data);
    }

    async function saveAwards() {
        if (!state.canManage || !state.selectedCompetitionId || state.selectedCompetition?.results_confirmed_at) return;
        clearMessages();
        elements.saveAwards.disabled = true;
        try {
            await persistAwards(false);
            await Promise.all([reloadDetail(), loadList()]);
            showSuccess("Prize allocation saved. No Club Credit has been awarded yet.");
        } catch (error) {
            showError(error);
        } finally {
            elements.saveAwards.disabled = false;
        }
    }

    async function confirmResults() {
        if (!state.canConfirm || !state.selectedCompetitionId || state.selectedCompetition?.results_confirmed_at) return;
        clearMessages();

        if (!elements.verifiedCheckbox.checked) {
            showError(new Error("Check the result against HowDidiDo / ClubV1 and tick the verification box before confirming."));
            return;
        }

        let awards;
        try {
            awards = collectAwards();
            if (!awards.length) throw new Error("Add at least one prize before confirming this competition.");
        } catch (error) {
            showError(error);
            return;
        }

        const total = awards.reduce((sum, award) => sum + Number(award.amount || 0), 0);
        const currency = state.selectedCompetition.currency_code || "GBP";
        const recipientCount = awards.filter((award) => Number(award.amount || 0) > 0).length;
        const text = recipientCount > 0
            ? `Confirm the verified result and award ${formatMoney(total, currency)} of Club Credit across ${recipientCount} prize${recipientCount === 1 ? "" : "s"}?`
            : "Confirm this verified result with no Club Credit value?";

        if (!window.confirm(text)) return;

        const originalText = elements.confirmButton.textContent;
        elements.confirmButton.disabled = true;
        elements.confirmButton.textContent = "Confirming…";
        try {
            const result = await persistAwards(true);
            await Promise.all([reloadDetail(), loadList()]);
            showSuccess(`Competition completed. ${Number(result.awarded_transactions || 0)} Club Credit transaction${Number(result.awarded_transactions || 0) === 1 ? "" : "s"} posted.`);
        } catch (error) {
            showError(error);
        } finally {
            elements.confirmButton.disabled = false;
            elements.confirmButton.textContent = originalText;
            renderAwardTotal();
        }
    }

    async function reopenResults() {
        if (!state.canConfirm || !state.selectedCompetitionId) return;
        if (!window.confirm("Reopen this zero-credit result for correction?")) return;
        try {
            const { error } = await client().rpc("competition_reopen_results", {
                p_competition_id: state.selectedCompetitionId
            });
            if (error) throw error;
            await Promise.all([reloadDetail(), loadList()]);
            showSuccess("Competition result reopened.");
        } catch (error) {
            showError(error);
        }
    }

    async function reloadDetail() {
        const { data, error } = await client().rpc("competition_get_detail_v2", {
            p_competition_id: state.selectedCompetitionId
        });
        if (error) throw error;
        const detail = normaliseRpcObject(data);
        state.selectedCompetition = detail.competition || {};
        state.externalResults = Array.isArray(detail.external_results) ? detail.external_results : [];
        state.awards = Array.isArray(detail.awards) ? detail.awards : [];
        state.manualPlaceAwards = state.awards
            .filter((award) => !award.source_external_result_key && !award.external_result_id && Number(award.placing) > 0)
            .map(copyAward);
        state.specialAwards = state.awards
            .filter((award) => !award.source_external_result_key && !award.external_result_id && (award.placing === null || award.placing === undefined))
            .map(copyAward);
        renderDetail();
    }

    function bind() {
        elements.closeDialog.addEventListener("click", () => elements.dialog.close());
        elements.form.addEventListener("submit", saveCompetitionDetails);
        elements.syncCalendar.addEventListener("click", async () => {
            clearMessages();
            try {
                await syncCalendar(true);
                await Promise.all([loadCalendarEvents(), loadList()]);
            } catch (error) {
                showError(error);
            }
        });
        elements.refresh.addEventListener("click", () => loadList().catch(showError));
        elements.rangeCurrent.addEventListener("click", () => setRange("current"));
        elements.rangePrevious.addEventListener("click", () => setRange("previous"));
        elements.rangeFuture.addEventListener("click", () => setRange("future"));

        elements.search.addEventListener("input", () => {
            window.clearTimeout(state.listSearchTimer);
            state.listSearchTimer = window.setTimeout(() => loadList().catch(showError), 220);
        });
        elements.statusFilter.addEventListener("change", () => loadList().catch(showError));
        [elements.fromDate, elements.toDate].forEach((input) => input.addEventListener("change", () => {
            state.rangeMode = "custom";
            [elements.rangeCurrent, elements.rangePrevious, elements.rangeFuture].forEach((button) => button.classList.remove("is-active"));
            renderRangeLabel();
            loadList().catch(showError);
        }));

        elements.list.addEventListener("click", (event) => {
            const button = event.target.closest("[data-competition-open]");
            if (button) openCompetition(button.dataset.competitionOpen);
        });

        elements.memberSearch.addEventListener("input", () => {
            window.clearTimeout(state.memberSearchTimers.manual);
            state.memberSearchTimers.manual = window.setTimeout(() => searchMembers("manual").catch(showError), 180);
        });
        elements.specialMemberSearch.addEventListener("input", () => {
            window.clearTimeout(state.memberSearchTimers.special);
            state.memberSearchTimers.special = window.setTimeout(() => searchMembers("special").catch(showError), 180);
        });

        [elements.memberResults, elements.specialMemberResults].forEach((resultElement) => {
            resultElement.addEventListener("click", (event) => {
                const button = event.target.closest("[data-member-add]");
                if (!button || button.disabled) return;
                addMemberAward(button.dataset.memberMode, button.dataset.memberAdd);
            });
        });

        elements.externalResults.addEventListener("click", (event) => {
            const button = event.target.closest("[data-external-match]");
            if (button) openExternalMatch(button.dataset.externalMatch);
        });
        elements.externalMatchCancel.addEventListener("click", closeExternalMatch);
        elements.externalMatchSearch.addEventListener("input", () => {
            window.clearTimeout(state.matchSearchTimer);
            state.matchSearchTimer = window.setTimeout(() => searchExternalMatchMembers().catch(showError), 180);
        });
        elements.externalMatchResults.addEventListener("click", (event) => {
            const button = event.target.closest("[data-external-match-member]");
            if (!button) return;
            linkExternalPlayer(button.dataset.externalMatchMember).catch(showError);
        });

        elements.externalResults.addEventListener("change", (event) => {
            const row = event.target.closest("[data-external-row]");
            if (!row) return;
            if (event.target.matches('[data-external-field="award_type"]')) {
                const amount = row.querySelector('[data-external-field="amount"]');
                if (amount) amount.disabled = !event.target.value || !state.canManage || Boolean(state.selectedCompetition?.results_confirmed_at);
            }
            renderAwardTotal();
        });
        elements.externalResults.addEventListener("input", renderAwardTotal);

        elements.manualResults.addEventListener("input", renderAwardTotal);
        elements.manualResults.addEventListener("change", renderAwardTotal);
        elements.manualResults.addEventListener("click", (event) => {
            const button = event.target.closest("[data-manual-remove]");
            if (!button) return;
            const index = Number(button.dataset.manualRemove);
            if (!Number.isInteger(index)) return;
            state.manualPlaceAwards.splice(index, 1);
            renderManualPlaceAwards();
            renderAwardTotal();
        });

        elements.specialPrizes.addEventListener("input", renderAwardTotal);
        elements.specialPrizes.addEventListener("change", renderAwardTotal);
        elements.specialPrizes.addEventListener("click", (event) => {
            const button = event.target.closest("[data-special-remove]");
            if (!button) return;
            const index = Number(button.dataset.specialRemove);
            if (!Number.isInteger(index)) return;
            state.specialAwards.splice(index, 1);
            renderSpecialAwards();
            renderAwardTotal();
        });

        elements.csvChooseButton.addEventListener("click", () => elements.csvFile.click());
        elements.csvFile.addEventListener("change", () => {
            const file = elements.csvFile.files && elements.csvFile.files[0];
            if (file) importClubV1Csv(file);
        });
        elements.bridgeConfigButton.addEventListener("click", createBridgeConfig);

        elements.saveAwards.addEventListener("click", saveAwards);
        elements.confirmButton.addEventListener("click", confirmResults);
        elements.reopenButton.addEventListener("click", reopenResults);
    }

    async function initialise() {
        bind();
        setRange("current", false);
        try {
            await window.Paryx.ready;
            if (!window.Paryx.clubContext) throw new Error("Paryx club context is unavailable.");
            const context = await window.Paryx.clubContext.ready;
            const activeClub = context?.activeClub || window.Paryx.clubContext.getActiveClub();
            if (!activeClub?.id) throw new Error("No active club is selected.");

            state.clubId = activeClub.id;
            state.clubName = activeClub.name || "Your club";
            state.role = activeClub.role || null;
            state.canManage = MANAGE_ROLES.has(state.role);
            state.canConfirm = CONFIRM_ROLES.has(state.role);
            elements.clubName.textContent = state.clubName;
            elements.syncCalendar.hidden = !state.canManage;

            if (state.canManage) {
                await syncCalendar(false);
            }

            await Promise.all([
                loadIntegration(),
                loadCalendarEvents(),
                loadList()
            ]);
        } catch (error) {
            showError(error);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialise, { once: true });
    } else {
        initialise();
    }
})();
