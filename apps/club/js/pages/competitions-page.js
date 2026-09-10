(function () {
    "use strict";

    window.Paryx = window.Paryx || {};

    const MANAGE_ROLES = new Set(["professional", "manager", "club_admin"]);
    const CONFIRM_ROLES = new Set(["manager", "club_admin"]);

    const STATUS_LABELS = {
        draft: "Draft",
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


    const state = {
        clubId: null,
        clubName: null,
        role: null,
        canManage: false,
        canConfirm: false,
        selectedCompetitionId: null,
        selectedCompetition: null,
        calendarEvents: [],
        entries: [],
        prizes: [],
        verifiedResults: [],
        memberMatches: [],
        memberSearchTimer: null,
        listSearchTimer: null
    };

    const $ = (id) => document.getElementById(id);
    const elements = {
        clubName: $("competitionClubName"), error: $("competitionError"), success: $("competitionSuccess"), dialogError: $("competitionDialogError"), dialogSuccess: $("competitionDialogSuccess"),
        upcoming: $("competitionUpcoming"), open: $("competitionOpen"), pending: $("competitionPending"), completed: $("competitionCompleted"),
        newButton: $("newCompetitionButton"), search: $("competitionSearch"), statusFilter: $("competitionStatusFilter"), fromDate: $("competitionFromDate"), toDate: $("competitionToDate"), refresh: $("competitionRefreshButton"), list: $("competitionList"),
        dialog: $("competitionDialog"), closeDialog: $("closeCompetitionDialog"), dialogTitle: $("competitionDialogTitle"), dialogMeta: $("competitionDialogMeta"),
        form: $("competitionForm"), calendarEvent: $("competitionCalendarEvent"), name: $("competitionName"), date: $("competitionDate"), format: $("competitionFormat"), section: $("competitionSection"), status: $("competitionStatus"), qualifier: $("competitionQualifier"), notes: $("competitionNotes"), save: $("saveCompetitionButton"), deleteButton: $("deleteCompetitionButton"),
        resultsSection: $("competitionResultsSection"), resultControls: $("competitionResultControls"), resultCount: $("competitionResultCount"), memberSearch: $("competitionMemberSearch"), memberResults: $("competitionMemberResults"), results: $("competitionVerifiedResults"), saveResults: $("saveVerifiedResultsButton"),
        confirmSection: $("competitionConfirmSection"), confirmTitle: $("competitionConfirmationTitle"), confirmText: $("competitionConfirmationText"), verificationLabel: $("competitionVerificationLabel"), verifiedCheckbox: $("competitionResultsVerified"), confirmButton: $("confirmResultsButton"), reopenButton: $("reopenResultsButton")
    };

    function client() {
        if (window.supabaseClient && typeof window.supabaseClient.rpc === "function") return window.supabaseClient;
        throw new Error("The Paryx data service is unavailable.");
    }

    function esc(value) {
        return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
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

    function activeMessageTarget(pageElement, dialogElement) {
        return elements.dialog?.open && dialogElement
            ? dialogElement
            : pageElement;
    }

    function showError(error) {
        console.error("Paryx Competitions error:", error);
        const target = activeMessageTarget(elements.error, elements.dialogError);
        if (!target) return;
        target.hidden = false;
        target.textContent = error?.message || error?.details || "Competition management could not complete this action.";
        target.scrollIntoView({ block: "nearest" });
    }

    function showSuccess(message) {
        const target = activeMessageTarget(elements.success, elements.dialogSuccess);
        if (!target) return;
        target.hidden = false;
        target.textContent = message;
        target.scrollIntoView({ block: "nearest" });
    }

    function dateInputValue(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }

    function formatDate(value) {
        if (!value) return "—";
        const date = new Date(`${value}T12:00:00`);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
    }

    function formatMoney(value, currency = "GBP") {
        return new Intl.NumberFormat("en-GB", { style: "currency", currency: String(currency || "GBP") }).format(Number(value || 0));
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

    function statusClass(status) {
        if (status === "open") return "competition-state-pill--open";
        if (status === "closed" || status === "results_pending") return "competition-state-pill--pending";
        if (status === "completed") return "competition-state-pill--completed";
        if (status === "cancelled") return "competition-state-pill--cancelled";
        return "";
    }

    function setDefaultDateRange() {
        const now = new Date();
        const from = new Date(now); from.setDate(from.getDate() - 90);
        const to = new Date(now); to.setDate(to.getDate() + 365);
        elements.fromDate.value = dateInputValue(from);
        elements.toDate.value = dateInputValue(to);
    }

    async function loadSummary() {
        const { data, error } = await client().rpc("competition_get_summary", { p_club_id: state.clubId });
        if (error) throw error;
        const s = Array.isArray(data) ? (data[0] || {}) : (data || {});
        elements.upcoming.textContent = String(Number(s.upcoming_count || 0));
        elements.open.textContent = String(Number(s.open_count || 0));
        elements.pending.textContent = String(Number(s.results_pending_count || 0));
        elements.completed.textContent = String(Number(s.completed_30d_count || 0));
    }

    async function loadCalendarEvents() {
        const now = new Date();
        const from = new Date(now.getFullYear() - 1, 0, 1);
        const to = new Date(now.getFullYear() + 2, 11, 31);
        const { data, error } = await client().rpc("competition_get_calendar_events", {
            p_club_id: state.clubId,
            p_from_date: dateInputValue(from),
            p_to_date: dateInputValue(to)
        });
        if (error) throw error;
        state.calendarEvents = Array.isArray(data) ? data : [];
        renderCalendarOptions();
    }

    function renderCalendarOptions() {
        const current = elements.calendarEvent.value;
        elements.calendarEvent.innerHTML = '<option value="">Not linked to calendar</option>' + state.calendarEvents.map((event) => `
            <option value="${esc(event.event_id)}" ${event.linked_competition_id && event.linked_competition_id !== state.selectedCompetitionId ? "disabled" : ""}>
                ${esc(`${formatDate(event.event_date)} — ${event.title}`)}${event.linked_competition_id && event.linked_competition_id !== state.selectedCompetitionId ? " — Linked" : ""}
            </option>`).join("");
        if (current && state.calendarEvents.some((event) => event.event_id === current)) elements.calendarEvent.value = current;
    }

    async function loadList() {
        elements.list.innerHTML = '<div class="competition-empty">Loading competitions...</div>';
        const { data, error } = await client().rpc("competition_list", {
            p_club_id: state.clubId,
            p_from_date: elements.fromDate.value,
            p_to_date: elements.toDate.value,
            p_status: elements.statusFilter.value || null,
            p_search: elements.search.value.trim() || null
        });
        if (error) throw error;
        renderList(Array.isArray(data) ? data : []);
    }

    function renderList(rows) {
        if (!rows.length) {
            elements.list.innerHTML = '<div class="competition-empty">No competitions match the selected filters.</div>';
            return;
        }
        elements.list.innerHTML = rows.map((row) => `
            <div class="competition-row">
                <div><strong>${esc(row.name)}</strong><small>${esc(FORMAT_LABELS[row.competition_format] || row.competition_format)} · ${esc(row.section_label)}${row.is_qualifier ? " · Qualifier" : ""}</small></div>
                <span>${esc(formatDate(row.competition_date))}</span>
                <span class="competition-state-pill ${statusClass(row.status)}">${esc(STATUS_LABELS[row.status] || row.status)}</span>
                <span>${Number(row.completed_result_count || 0)} verified place${Number(row.completed_result_count || 0) === 1 ? "" : "s"}</span>
                <span>Manual verification</span>
                <span>${esc(formatMoney(row.prize_total, row.currency_code))}</span>
                <button class="competition-button competition-button--secondary" type="button" data-competition-open="${esc(row.competition_id)}">Open</button>
            </div>`).join("");
    }

    function linkedEvent() {
        return state.calendarEvents.find((item) => item.event_id === elements.calendarEvent.value) || null;
    }

    function setLinkedEventState() {
        const event = linkedEvent();
        const linked = Boolean(event);
        if (linked) {
            elements.name.value = event.title || "";
            elements.date.value = event.event_date || "";
            elements.section.value = event.section || "club";
            elements.qualifier.checked = event.is_qualifier === true;
        }
        const confirmed = Boolean(state.selectedCompetition?.results_confirmed_at);
        [elements.name, elements.date, elements.section, elements.qualifier].forEach((input) => {
            input.disabled = linked || !state.canManage || confirmed;
        });
    }

    function applyPermissions() {
        const confirmed = Boolean(state.selectedCompetition?.results_confirmed_at);
        const editable = state.canManage && !confirmed;
        const hasAwardedCredit = state.prizes.some((prize) => Boolean(prize.credit_transaction_id));

        [elements.calendarEvent, elements.format, elements.status, elements.notes].forEach((input) => input.disabled = !editable);
        setLinkedEventState();
        elements.save.hidden = !editable;
        elements.deleteButton.hidden = !(editable && state.selectedCompetitionId);
        elements.resultControls.hidden = !editable;
        elements.saveResults.hidden = !editable;
        elements.confirmSection.hidden = !(state.selectedCompetitionId && state.canConfirm);
        elements.confirmButton.hidden = confirmed;
        elements.verificationLabel.hidden = confirmed;
        elements.reopenButton.hidden = !(confirmed && !hasAwardedCredit);
        elements.verifiedCheckbox.disabled = !editable;

        if (confirmed) {
            elements.confirmTitle.textContent = "Results confirmed";
            elements.confirmText.textContent = hasAwardedCredit
                ? "Competition prizes have been posted to Club Credit and the result is locked. Credit corrections should be made through Club Credit."
                : "The verified result is locked. No Club Credit was awarded, so a Manager or Club Admin may reopen it if required.";
        } else {
            elements.confirmTitle.textContent = "Confirm & award credit";
            elements.confirmText.textContent = "Confirming saves the verified placings, posts every positive prize directly to Club Credit, and locks the competition.";
        }
    }

    function resetDialog() {
        state.selectedCompetitionId = null;
        state.selectedCompetition = null;
        state.entries = [];
        state.prizes = [];
        state.verifiedResults = [];
        state.memberMatches = [];
        elements.dialogTitle.textContent = "New competition";
        elements.dialogMeta.textContent = "Create the competition, then verify prize results from HowDidiDo / ClubV1.";
        elements.calendarEvent.value = "";
        elements.name.value = "";
        elements.date.value = dateInputValue(new Date());
        elements.format.value = "stableford";
        elements.section.value = "club";
        elements.status.value = "draft";
        elements.qualifier.checked = false;
        elements.notes.value = "";
        elements.resultsSection.hidden = true;
        elements.confirmSection.hidden = true;
        elements.memberSearch.value = "";
        elements.memberResults.hidden = true;
        elements.memberResults.innerHTML = "";
        elements.verifiedCheckbox.checked = false;
        renderCalendarOptions();
        renderVerifiedResults();
        applyPermissions();
    }

    function openNewCompetition() {
        clearMessages();
        resetDialog();
        elements.dialog.showModal();
        elements.name.focus();
    }

    async function openCompetition(competitionId) {
        clearMessages();
        if (!elements.dialog.open) elements.dialog.showModal();
        elements.dialogTitle.textContent = "Loading…";
        try {
            const { data, error } = await client().rpc("competition_get_detail", { p_competition_id: competitionId });
            if (error) throw error;
            const detail = Array.isArray(data) ? data[0] : data;
            if (!detail) throw new Error("Competition details were not returned.");
            state.selectedCompetitionId = competitionId;
            state.selectedCompetition = detail.competition || {};
            state.entries = Array.isArray(detail.entries) ? detail.entries : [];
            state.prizes = Array.isArray(detail.prizes) ? detail.prizes : [];
            state.verifiedResults = deriveVerifiedResults();
            state.memberMatches = [];
            renderCalendarOptions();
            renderDetail();
        } catch (error) {
            elements.dialog.close();
            showError(error);
        }
    }

    function renderDetail() {
        const c = state.selectedCompetition;
        elements.dialogTitle.textContent = c.name || "Competition";
        elements.dialogMeta.textContent = c.results_confirmed_at
            ? `Results confirmed ${formatDate(String(c.results_confirmed_at).slice(0, 10))}`
            : "Verify final prize placings from HowDidiDo / ClubV1 and award Club Credit.";
        elements.calendarEvent.value = c.club_event_id || "";
        elements.name.value = c.name || "";
        elements.date.value = c.competition_date || "";
        elements.format.value = c.competition_format || "stableford";
        elements.section.value = c.section || "club";
        elements.status.value = c.status || "draft";
        elements.qualifier.checked = c.is_qualifier === true;
        elements.notes.value = c.notes || "";
        elements.resultsSection.hidden = false;
        elements.verifiedCheckbox.checked = false;
        renderVerifiedResults();
        applyPermissions();
    }

    async function saveCompetition(event) {
        event.preventDefault();
        if (!state.canManage) return;
        clearMessages();
        elements.save.disabled = true;

        const wasExistingCompetition = Boolean(state.selectedCompetitionId);
        const pendingResults = wasExistingCompetition
            ? collectVerifiedResults()
            : [];

        try {
            const { data, error } = await client().rpc("competition_save", {
                p_club_id: state.clubId,
                p_competition_id: state.selectedCompetitionId,
                p_club_event_id: elements.calendarEvent.value || null,
                p_name: elements.name.value.trim(),
                p_competition_date: elements.date.value,
                p_competition_format: elements.format.value,
                p_section: elements.section.value,
                p_status: elements.status.value,
                p_is_qualifier: elements.qualifier.checked,
                p_notes: elements.notes.value.trim() || null
            });
            if (error) throw error;

            const saved = Array.isArray(data) ? data[0] : data;
            state.selectedCompetitionId = saved.competition_id;

            if (wasExistingCompetition) {
                await persistVerifiedResults(false, pendingResults);
            }

            await Promise.all([loadSummary(), loadList(), loadCalendarEvents()]);
            await openCompetition(saved.competition_id);
            showSuccess(
                wasExistingCompetition
                    ? "Competition and verified results saved."
                    : "Competition saved. You can now add the verified prize results."
            );
        } catch (error) {
            showError(error);
        } finally {
            elements.save.disabled = false;
        }
    }

    async function deleteCompetition() {
        if (!state.canManage || !state.selectedCompetitionId) return;
        if (!window.confirm("Delete this competition? Its verified result setup will also be deleted.")) return;
        clearMessages();
        try {
            const { error } = await client().rpc("competition_delete", { p_competition_id: state.selectedCompetitionId });
            if (error) throw error;
            elements.dialog.close();
            await Promise.all([loadSummary(), loadList(), loadCalendarEvents()]);
            showSuccess("Competition deleted.");
        } catch (error) { showError(error); }
    }

    function deriveVerifiedResults() {
        const prizeByPlace = new Map(
            state.prizes.map((prize) => [Number(prize.placing), prize])
        );

        return state.entries
            .filter((entry) => entry.membership_id && Number(entry.placing) > 0)
            .map((entry) => {
                const placing = Number(entry.placing);
                const prize = prizeByPlace.get(placing) || {};
                return {
                    membership_id: entry.membership_id,
                    display_name: entry.entrant_name || "Club member",
                    email: entry.entrant_email || "",
                    membership_number: entry.membership_number || "",
                    placing,
                    amount: Number(prize.amount || 0),
                    label: prize.label || `${ordinal(placing)} place`,
                    credit_transaction_id: prize.credit_transaction_id || null
                };
            })
            .sort((a, b) => a.placing - b.placing);
    }

    function nextAvailablePlace() {
        const used = new Set(state.verifiedResults.map((result) => Number(result.placing)));
        let place = 1;
        while (used.has(place) && place <= 20) place += 1;
        return Math.min(place, 20);
    }

    async function searchMembers() {
        if (!state.canManage || !state.selectedCompetitionId) return;
        const query = elements.memberSearch.value.trim();
        if (!query) {
            state.memberMatches = [];
            elements.memberResults.hidden = true;
            elements.memberResults.innerHTML = "";
            return;
        }

        const { data, error } = await client().rpc(
            "competition_search_members",
            { p_club_id: state.clubId, p_search: query }
        );
        if (error) throw error;

        state.memberMatches = Array.isArray(data) ? data : [];
        renderMemberResults();
    }

    function renderMemberResults() {
        const rows = state.memberMatches;
        elements.memberResults.hidden = false;

        if (!rows.length) {
            elements.memberResults.innerHTML = '<div class="competition-empty">No active members match.</div>';
            return;
        }

        const existing = new Set(
            state.verifiedResults.map((result) => result.membership_id)
        );
        const nextPlace = nextAvailablePlace();

        elements.memberResults.innerHTML = rows.map((member) => {
            const added = existing.has(member.membership_id);
            return `<button class="competition-member-result" type="button" data-member-add="${esc(member.membership_id)}" ${added ? "disabled" : ""}>
                <span>
                    <strong>${esc(member.display_name)}</strong>
                    <small>${esc([
                        member.membership_number ? `Member ${member.membership_number}` : null,
                        member.email
                    ].filter(Boolean).join(" · "))}</small>
                </span>
                <strong>${added ? "Added" : `Add as ${ordinal(nextPlace)}`}</strong>
            </button>`;
        }).join("");
    }

    function addVerifiedMember(membershipId) {
        const member = state.memberMatches.find(
            (item) => item.membership_id === membershipId
        );
        if (!member) return;

        if (state.verifiedResults.some((result) => result.membership_id === membershipId)) {
            return;
        }

        const placing = nextAvailablePlace();
        state.verifiedResults.push({
            membership_id: member.membership_id,
            display_name: member.display_name || "Club member",
            email: member.email || "",
            membership_number: member.membership_number || "",
            placing,
            amount: 0,
            label: `${ordinal(placing)} place`,
            credit_transaction_id: null
        });
        state.verifiedResults.sort((a, b) => Number(a.placing) - Number(b.placing));

        elements.memberSearch.value = "";
        state.memberMatches = [];
        elements.memberResults.hidden = true;
        elements.memberResults.innerHTML = "";
        renderVerifiedResults();
    }

    function renderVerifiedResults() {
        const results = state.verifiedResults;
        const confirmed = Boolean(state.selectedCompetition?.results_confirmed_at);
        const locked = confirmed || !state.canManage;
        const currency = state.selectedCompetition?.currency_code || "GBP";

        elements.resultCount.textContent = `${results.length} place${results.length === 1 ? "" : "s"}`;

        if (!results.length) {
            elements.results.innerHTML = '<tr><td colspan="6"><div class="competition-empty">No verified prize places yet. Search for the winning member above.</div></td></tr>';
            return;
        }

        elements.results.innerHTML = results.map((result, index) => {
            const awarded = Boolean(result.credit_transaction_id);
            return `<tr data-result-row="${index}">
                <td>
                    <input data-result-field="placing" type="number" min="1" max="20" step="1" value="${esc(result.placing)}" ${locked ? "disabled" : ""} aria-label="Competition placing" />
                </td>
                <td>
                    <div class="competition-entry-name">
                        <strong>${esc(result.display_name)}</strong>
                        <small>${esc(result.membership_number ? `Member ${result.membership_number}` : "Club member")}</small>
                    </div>
                </td>
                <td>
                    <div class="competition-credit-input">
                        <span>${esc(currency === "GBP" ? "£" : currency)}</span>
                        <input data-result-field="amount" type="number" min="0" step="0.01" value="${esc(Number(result.amount || 0).toFixed(2))}" ${locked ? "disabled" : ""} aria-label="Club Credit amount" />
                    </div>
                </td>
                <td>
                    <input data-result-field="label" type="text" maxlength="100" value="${esc(result.label || `${ordinal(result.placing)} place`)}" ${locked ? "disabled" : ""} aria-label="Prize label" />
                </td>
                <td>
                    <span class="competition-state-pill ${awarded ? "competition-state-pill--completed" : ""}">${awarded ? "Credit awarded" : (confirmed ? "Confirmed" : "Pending")}</span>
                </td>
                <td>${locked ? "" : `<button class="competition-mini-button competition-mini-button--danger" type="button" data-result-remove="${index}">Remove</button>`}</td>
            </tr>`;
        }).join("");
    }

    function collectVerifiedResults() {
        const rows = Array.from(elements.results.querySelectorAll("[data-result-row]"));
        return rows.map((row) => {
            const index = Number(row.dataset.resultRow);
            const source = state.verifiedResults[index];
            const placing = Number(row.querySelector('[data-result-field="placing"]')?.value);
            const amount = Number(row.querySelector('[data-result-field="amount"]')?.value || 0);
            const label = String(row.querySelector('[data-result-field="label"]')?.value || "").trim();
            return {
                membership_id: source?.membership_id || null,
                placing,
                amount,
                label: label || `${ordinal(placing)} place`
            };
        });
    }

    function validateVerifiedResults(results, forConfirmation = false) {
        if (forConfirmation && !results.length) {
            throw new Error("Add at least one verified prize result before confirming.");
        }

        const places = new Set();
        const members = new Set();

        for (const result of results) {
            if (!result.membership_id) {
                throw new Error("Every result must be assigned to a club member.");
            }
            if (!Number.isInteger(result.placing) || result.placing < 1 || result.placing > 20) {
                throw new Error("Every placing must be a whole number between 1 and 20.");
            }
            if (!Number.isFinite(result.amount) || result.amount < 0) {
                throw new Error("Club Credit values must be zero or greater.");
            }
            if (places.has(result.placing)) {
                throw new Error(`Place ${result.placing} is assigned more than once.`);
            }
            if (members.has(result.membership_id)) {
                throw new Error("The same member cannot occupy more than one place.");
            }
            places.add(result.placing);
            members.add(result.membership_id);
        }
    }

    async function persistVerifiedResults(confirmResults = false, suppliedResults = null) {
        if (!state.selectedCompetitionId) {
            throw new Error("Save the competition before entering verified results.");
        }

        const results = suppliedResults || collectVerifiedResults();
        validateVerifiedResults(results, confirmResults);

        const { data, error } = await client().rpc(
            "competition_save_verified_awards",
            {
                p_competition_id: state.selectedCompetitionId,
                p_results: results,
                p_confirm: confirmResults === true
            }
        );
        if (error) throw error;
        return Array.isArray(data) ? data[0] : data;
    }

    async function saveVerifiedResults() {
        if (!state.canManage || !state.selectedCompetitionId) return;
        clearMessages();
        elements.saveResults.disabled = true;

        try {
            await persistVerifiedResults(false);
            await Promise.all([reloadDetailData(), loadSummary(), loadList()]);
            showSuccess("Verified competition results saved. No credit has been awarded yet.");
        } catch (error) {
            showError(error);
        } finally {
            elements.saveResults.disabled = false;
        }
    }

    async function confirmResults() {
        if (!state.canConfirm || !state.selectedCompetitionId) return;
        clearMessages();

        if (!elements.verifiedCheckbox.checked) {
            showError(new Error(
                "Confirm that you have checked the placings against HowDidiDo / ClubV1 first."
            ));
            return;
        }

        let results;
        try {
            results = collectVerifiedResults();
            validateVerifiedResults(results, true);
        } catch (error) {
            showError(error);
            return;
        }

        const total = results.reduce((sum, result) => sum + Number(result.amount || 0), 0);
        const currency = state.selectedCompetition?.currency_code || "GBP";
        const creditedMembers = results.filter((result) => Number(result.amount || 0) > 0).length;
        const confirmationText = creditedMembers
            ? `Confirm these verified results and award ${formatMoney(total, currency)} of Club Credit across ${creditedMembers} member${creditedMembers === 1 ? "" : "s"}? This cannot be automatically reopened after credit is posted.`
            : "Confirm these verified results with no Club Credit award?";

        if (!window.confirm(confirmationText)) return;

        const originalText = elements.confirmButton.textContent;
        elements.confirmButton.disabled = true;
        elements.confirmButton.textContent = "Awarding credit…";

        try {
            const result = await persistVerifiedResults(true, results);
            await Promise.all([reloadDetailData(), loadSummary(), loadList()]);
            const awarded = Number(result?.awarded_transactions || 0);
            showSuccess(
                awarded > 0
                    ? `Competition completed. Club Credit awarded to ${awarded} member${awarded === 1 ? "" : "s"}.`
                    : "Competition results confirmed and completed."
            );
        } catch (error) {
            showError(error);
        } finally {
            elements.confirmButton.disabled = false;
            elements.confirmButton.textContent = originalText;
        }
    }

    async function reopenResults() {
        if (!state.canConfirm || !state.selectedCompetitionId) return;
        if (!window.confirm("Reopen these results for correction?")) return;
        try {
            const { error } = await client().rpc("competition_reopen_results", { p_competition_id: state.selectedCompetitionId });
            if (error) throw error;
            await Promise.all([reloadDetailData(), loadSummary(), loadList()]);
            showSuccess("Verified results reopened for correction.");
        } catch (error) { showError(error); }
    }

    async function reloadDetailData() {
        const { data, error } = await client().rpc("competition_get_detail", { p_competition_id: state.selectedCompetitionId });
        if (error) throw error;
        const detail = Array.isArray(data) ? data[0] : data;
        state.selectedCompetition = detail.competition || {};
        state.entries = Array.isArray(detail.entries) ? detail.entries : [];
        state.prizes = Array.isArray(detail.prizes) ? detail.prizes : [];
        state.verifiedResults = deriveVerifiedResults();
        renderDetail();
    }

    function bind() {
        elements.newButton.addEventListener("click", openNewCompetition);
        elements.closeDialog.addEventListener("click", () => elements.dialog.close());
        elements.form.addEventListener("submit", saveCompetition);
        elements.deleteButton.addEventListener("click", deleteCompetition);
        elements.calendarEvent.addEventListener("change", setLinkedEventState);
        elements.refresh.addEventListener("click", () => Promise.all([loadSummary(), loadList()]).catch(showError));
        elements.search.addEventListener("input", () => {
            window.clearTimeout(state.listSearchTimer);
            state.listSearchTimer = window.setTimeout(() => loadList().catch(showError), 200);
        });
        [elements.statusFilter, elements.fromDate, elements.toDate].forEach((el) => el.addEventListener("change", () => loadList().catch(showError)));
        elements.list.addEventListener("click", (event) => {
            const button = event.target.closest("[data-competition-open]");
            if (button) openCompetition(button.dataset.competitionOpen);
        });
        elements.memberSearch.addEventListener("input", () => {
            window.clearTimeout(state.memberSearchTimer);
            state.memberSearchTimer = window.setTimeout(() => searchMembers().catch(showError), 180);
        });
        elements.memberResults.addEventListener("click", (event) => {
            const button = event.target.closest("[data-member-add]");
            if (button && !button.disabled) addVerifiedMember(button.dataset.memberAdd);
        });
        elements.results.addEventListener("input", (event) => {
            const row = event.target.closest("[data-result-row]");
            if (!row) return;
            const index = Number(row.dataset.resultRow);
            const result = state.verifiedResults[index];
            if (!result) return;

            if (event.target.matches('[data-result-field="placing"]')) {
                const placing = Number(event.target.value);
                result.placing = Number.isFinite(placing) ? placing : null;
            } else if (event.target.matches('[data-result-field="amount"]')) {
                const amount = Number(event.target.value);
                result.amount = Number.isFinite(amount) ? amount : 0;
            } else if (event.target.matches('[data-result-field="label"]')) {
                result.label = event.target.value;
            }
        });
        elements.results.addEventListener("click", (event) => {
            const button = event.target.closest("[data-result-remove]");
            if (!button) return;
            const index = Number(button.dataset.resultRemove);
            if (!Number.isInteger(index)) return;
            state.verifiedResults.splice(index, 1);
            renderVerifiedResults();
        });
        elements.saveResults.addEventListener("click", saveVerifiedResults);
        elements.confirmButton.addEventListener("click", confirmResults);
        elements.reopenButton.addEventListener("click", reopenResults);
    }

    async function initialise() {
        bind(); setDefaultDateRange();
        try {
            await window.Paryx.ready;
            if (!window.Paryx.clubContext) throw new Error("Paryx club context is unavailable.");
            const ctx = await window.Paryx.clubContext.ready;
            const activeClub = ctx?.activeClub || window.Paryx.clubContext.getActiveClub();
            if (!activeClub?.id) throw new Error("No active club is selected.");
            state.clubId = activeClub.id;
            state.clubName = activeClub.name || "Your club";
            state.role = activeClub.role || null;
            state.canManage = MANAGE_ROLES.has(state.role);
            state.canConfirm = CONFIRM_ROLES.has(state.role);
            elements.clubName.textContent = state.clubName;
            elements.newButton.hidden = !state.canManage;
            await Promise.all([loadSummary(), loadCalendarEvents(), loadList()]);
        } catch (error) { showError(error); }
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialise, { once: true });
    else initialise();
})();
