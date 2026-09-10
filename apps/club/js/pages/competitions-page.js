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

    const ENTRY_STATUS_LABELS = {
        entered: "Entered",
        completed: "Completed",
        no_return: "No return",
        disqualified: "Disqualified",
        withdrawn: "Withdrawn"
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
        memberSearchTimer: null,
        listSearchTimer: null
    };

    const $ = (id) => document.getElementById(id);
    const elements = {
        clubName: $("competitionClubName"), error: $("competitionError"), success: $("competitionSuccess"),
        upcoming: $("competitionUpcoming"), open: $("competitionOpen"), pending: $("competitionPending"), completed: $("competitionCompleted"),
        newButton: $("newCompetitionButton"), search: $("competitionSearch"), statusFilter: $("competitionStatusFilter"), fromDate: $("competitionFromDate"), toDate: $("competitionToDate"), refresh: $("competitionRefreshButton"), list: $("competitionList"),
        dialog: $("competitionDialog"), closeDialog: $("closeCompetitionDialog"), dialogTitle: $("competitionDialogTitle"), dialogMeta: $("competitionDialogMeta"),
        form: $("competitionForm"), calendarEvent: $("competitionCalendarEvent"), name: $("competitionName"), date: $("competitionDate"), format: $("competitionFormat"), section: $("competitionSection"), status: $("competitionStatus"), qualifier: $("competitionQualifier"), notes: $("competitionNotes"), save: $("saveCompetitionButton"), deleteButton: $("deleteCompetitionButton"),
        entrantsSection: $("competitionEntrantsSection"), entryControls: $("competitionEntryControls"), entryCount: $("competitionEntryCount"), memberSearch: $("competitionMemberSearch"), memberResults: $("competitionMemberResults"), manualEntryForm: $("competitionManualEntryForm"), manualName: $("competitionManualName"), entries: $("competitionEntries"),
        prizesSection: $("competitionPrizesSection"), addPrize: $("addPrizeButton"), prizes: $("competitionPrizes"), savePrizes: $("savePrizesButton"),
        confirmSection: $("competitionConfirmSection"), confirmTitle: $("competitionConfirmationTitle"), confirmText: $("competitionConfirmationText"), confirmButton: $("confirmResultsButton"), reopenButton: $("reopenResultsButton")
    };

    function client() {
        if (window.supabaseClient && typeof window.supabaseClient.rpc === "function") return window.supabaseClient;
        throw new Error("The Paryx data service is unavailable.");
    }

    function esc(value) {
        return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
    }

    function clearMessages() {
        elements.error.hidden = true; elements.error.textContent = "";
        elements.success.hidden = true; elements.success.textContent = "";
    }

    function showError(error) {
        console.error("Paryx Competitions error:", error);
        elements.error.hidden = false;
        elements.error.textContent = error?.message || error?.details || "Competition management could not complete this action.";
    }

    function showSuccess(message) {
        elements.success.hidden = false;
        elements.success.textContent = message;
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
                <span>${Number(row.entry_count || 0)} entrants</span>
                <span>${Number(row.completed_result_count || 0)} results</span>
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
        [elements.calendarEvent, elements.format, elements.status, elements.notes].forEach((input) => input.disabled = !editable);
        setLinkedEventState();
        elements.save.hidden = !editable;
        elements.deleteButton.hidden = !(editable && state.selectedCompetitionId);
        elements.entryControls.hidden = !editable;
        elements.addPrize.hidden = !editable;
        elements.savePrizes.hidden = !editable;
        elements.confirmSection.hidden = !(state.selectedCompetitionId && state.canConfirm);
        elements.confirmButton.hidden = confirmed;
        elements.reopenButton.hidden = !confirmed;
        elements.confirmTitle.textContent = confirmed ? "Results confirmed" : "Confirm final results";
        elements.confirmText.textContent = confirmed ? "Results are locked. Reopen them before making corrections." : "Confirming results locks entrant results and the prize structure.";
    }

    function resetDialog() {
        state.selectedCompetitionId = null;
        state.selectedCompetition = null;
        state.entries = [];
        state.prizes = [];
        elements.dialogTitle.textContent = "New competition";
        elements.dialogMeta.textContent = "Create the competition before adding entrants or prizes.";
        elements.calendarEvent.value = "";
        elements.name.value = "";
        elements.date.value = dateInputValue(new Date());
        elements.format.value = "stableford";
        elements.section.value = "club";
        elements.status.value = "draft";
        elements.qualifier.checked = false;
        elements.notes.value = "";
        elements.entrantsSection.hidden = true;
        elements.prizesSection.hidden = true;
        elements.confirmSection.hidden = true;
        elements.memberSearch.value = "";
        elements.memberResults.hidden = true;
        elements.memberResults.innerHTML = "";
        elements.manualName.value = "";
        renderCalendarOptions();
        renderEntries();
        renderPrizes();
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
        elements.dialogMeta.textContent = c.results_confirmed_at ? `Results confirmed ${formatDate(String(c.results_confirmed_at).slice(0, 10))}` : "Manage setup, entrants, results and prize values.";
        elements.calendarEvent.value = c.club_event_id || "";
        elements.name.value = c.name || "";
        elements.date.value = c.competition_date || "";
        elements.format.value = c.competition_format || "stableford";
        elements.section.value = c.section || "club";
        elements.status.value = c.status || "draft";
        elements.qualifier.checked = c.is_qualifier === true;
        elements.notes.value = c.notes || "";
        elements.entrantsSection.hidden = false;
        elements.prizesSection.hidden = false;
        renderEntries();
        renderPrizes();
        applyPermissions();
    }

    async function saveCompetition(event) {
        event.preventDefault();
        if (!state.canManage) return;
        clearMessages();
        elements.save.disabled = true;
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
            await Promise.all([loadSummary(), loadList(), loadCalendarEvents()]);
            await openCompetition(saved.competition_id);
            showSuccess("Competition saved.");
        } catch (error) {
            showError(error);
        } finally {
            elements.save.disabled = false;
        }
    }

    async function deleteCompetition() {
        if (!state.canManage || !state.selectedCompetitionId) return;
        if (!window.confirm("Delete this competition? Entrants, results and prize setup will also be deleted.")) return;
        clearMessages();
        try {
            const { error } = await client().rpc("competition_delete", { p_competition_id: state.selectedCompetitionId });
            if (error) throw error;
            elements.dialog.close();
            await Promise.all([loadSummary(), loadList(), loadCalendarEvents()]);
            showSuccess("Competition deleted.");
        } catch (error) { showError(error); }
    }

    async function searchMembers() {
        if (!state.canManage || !state.selectedCompetitionId) return;
        const query = elements.memberSearch.value.trim();
        if (!query) {
            elements.memberResults.hidden = true;
            elements.memberResults.innerHTML = "";
            return;
        }
        const { data, error } = await client().rpc("competition_search_members", { p_club_id: state.clubId, p_search: query });
        if (error) throw error;
        renderMemberResults(Array.isArray(data) ? data : []);
    }

    function renderMemberResults(rows) {
        elements.memberResults.hidden = false;
        if (!rows.length) {
            elements.memberResults.innerHTML = '<div class="competition-empty">No active members match.</div>';
            return;
        }
        const existing = new Set(state.entries.filter((e) => e.membership_id).map((e) => e.membership_id));
        elements.memberResults.innerHTML = rows.map((member) => {
            const added = existing.has(member.membership_id);
            return `<button class="competition-member-result" type="button" data-member-add="${esc(member.membership_id)}" ${added ? "disabled" : ""}>
                <span><strong>${esc(member.display_name)}</strong><small>${esc([member.membership_number ? `Member ${member.membership_number}` : null, member.email].filter(Boolean).join(" · "))}</small></span>
                <strong>${added ? "Added" : "Add"}</strong></button>`;
        }).join("");
    }

    async function addMember(membershipId) {
        const { error } = await client().rpc("competition_add_member_entry", { p_competition_id: state.selectedCompetitionId, p_membership_id: membershipId });
        if (error) throw error;
        elements.memberSearch.value = "";
        elements.memberResults.hidden = true;
        await reloadDetailData();
    }

    async function addManualEntrant(event) {
        event.preventDefault();
        if (!state.canManage || !state.selectedCompetitionId) return;
        const name = elements.manualName.value.trim();
        if (!name) return;
        try {
            const { error } = await client().rpc("competition_add_manual_entry", { p_competition_id: state.selectedCompetitionId, p_entrant_name: name });
            if (error) throw error;
            elements.manualName.value = "";
            await reloadDetailData();
        } catch (error) { showError(error); }
    }

    function renderEntries() {
        elements.entryCount.textContent = `${state.entries.length} entrant${state.entries.length === 1 ? "" : "s"}`;
        if (!state.entries.length) {
            elements.entries.innerHTML = '<tr><td colspan="8"><div class="competition-empty">No entrants yet.</div></td></tr>';
            return;
        }
        const locked = Boolean(state.selectedCompetition?.results_confirmed_at) || !state.canManage;
        elements.entries.innerHTML = state.entries.map((entry) => `<tr data-entry-row="${esc(entry.entry_id)}">
            <td><div class="competition-entry-name"><strong>${esc(entry.entrant_name)}</strong><small>${esc(entry.entry_type === "member" ? (entry.membership_number ? `Member ${entry.membership_number}` : "Club member") : "Manual entrant")}</small></div></td>
            <td><select data-entry-field="entry_status" ${locked ? "disabled" : ""}>${Object.keys(ENTRY_STATUS_LABELS).map((status) => `<option value="${status}" ${entry.entry_status === status ? "selected" : ""}>${ENTRY_STATUS_LABELS[status]}</option>`).join("")}</select></td>
            <td><input data-entry-field="gross_score" type="number" min="0" step="1" value="${esc(entry.gross_score ?? "")}" ${locked ? "disabled" : ""} /></td>
            <td><input data-entry-field="nett_score" type="number" min="0" step="1" value="${esc(entry.nett_score ?? "")}" ${locked ? "disabled" : ""} /></td>
            <td><input data-entry-field="points" type="number" min="0" step="1" value="${esc(entry.points ?? "")}" ${locked ? "disabled" : ""} /></td>
            <td><input data-entry-field="placing" type="number" min="1" max="999" step="1" value="${esc(entry.placing ?? "")}" ${locked ? "disabled" : ""} /></td>
            <td><input data-entry-field="result_text" type="text" maxlength="300" value="${esc(entry.result_text ?? "")}" placeholder="Optional" ${locked ? "disabled" : ""} /></td>
            <td><div class="competition-row-actions">${locked ? "" : `<button class="competition-mini-button" type="button" data-entry-save="${esc(entry.entry_id)}">Save</button><button class="competition-mini-button competition-mini-button--danger" type="button" data-entry-remove="${esc(entry.entry_id)}">Remove</button>`}</div></td>
        </tr>`).join("");
    }

    function rowValue(row, field) {
        const value = row.querySelector(`[data-entry-field="${field}"]`)?.value;
        return value === undefined || value === null || String(value).trim() === "" ? null : value;
    }

    function rowNumber(row, field) {
        const value = rowValue(row, field);
        if (value === null) return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function entryPayloadFromRow(row, entryId) {
        return {
            p_entry_id: entryId,
            p_entry_status: rowValue(row, "entry_status") || "entered",
            p_gross_score: rowNumber(row, "gross_score"),
            p_nett_score: rowNumber(row, "nett_score"),
            p_points: rowNumber(row, "points"),
            p_placing: rowNumber(row, "placing"),
            p_result_text: rowValue(row, "result_text")
        };
    }

    async function persistEntryPayload(payload) {
        const { error } = await client().rpc(
            "competition_save_entry_result",
            payload
        );
        if (error) throw error;
    }

    async function saveEntry(entryId) {
        const row = elements.entries.querySelector(`[data-entry-row="${CSS.escape(entryId)}"]`);
        if (!row) return;
        await persistEntryPayload(entryPayloadFromRow(row, entryId));
        await reloadDetailData();
        showSuccess("Entrant result saved.");
    }

    function collectEntryPayloads() {
        return Array.from(
            elements.entries.querySelectorAll("[data-entry-row]")
        ).map((row) => {
            const entryId = row.dataset.entryRow;
            return entryPayloadFromRow(row, entryId);
        });
    }

    function validateConfirmationEntries(payloads) {
        const completedWithPlace = payloads.filter((payload) =>
            payload.p_entry_status === "completed" &&
            Number.isInteger(payload.p_placing) &&
            payload.p_placing >= 1
        );

        if (!completedWithPlace.length) {
            throw new Error(
                "Set at least one entrant to Completed and give them a Place before confirming results."
            );
        }

        const seenPlaces = new Set();
        for (const payload of payloads) {
            if (payload.p_placing === null) continue;

            if (!Number.isInteger(payload.p_placing) || payload.p_placing < 1) {
                throw new Error("Every placing must be a whole number of 1 or higher.");
            }

            if (["withdrawn", "disqualified", "no_return"].includes(payload.p_entry_status)) {
                throw new Error(
                    "Withdrawn, disqualified or no-return entrants cannot hold a placing."
                );
            }

            if (seenPlaces.has(payload.p_placing)) {
                throw new Error(`Place ${payload.p_placing} is assigned to more than one entrant.`);
            }
            seenPlaces.add(payload.p_placing);
        }
    }

    async function saveAllEntriesBeforeConfirmation(payloads) {
        /*
         * Clear stored places first. This makes changing/swapping existing
         * placings safe because the RPC checks for duplicate stored places.
         */
        for (const payload of payloads) {
            await persistEntryPayload({
                ...payload,
                p_placing: null
            });
        }

        for (const payload of payloads) {
            await persistEntryPayload(payload);
        }
    }

    async function removeEntry(entryId) {
        if (!window.confirm("Remove this entrant from the competition?")) return;
        const { error } = await client().rpc("competition_remove_entry", { p_entry_id: entryId });
        if (error) throw error;
        await reloadDetailData();
    }

    function renderPrizes() {
        if (!state.prizes.length) {
            elements.prizes.innerHTML = '<div class="competition-empty">No prize values set.</div>';
            return;
        }
        const locked = Boolean(state.selectedCompetition?.results_confirmed_at) || !state.canManage;
        elements.prizes.innerHTML = state.prizes.map((prize, index) => `<div class="competition-prize-row" data-prize-index="${index}">
            <label class="competition-field"><span>Place</span><input data-prize-field="placing" type="number" min="1" max="20" step="1" value="${esc(prize.placing)}" ${locked ? "disabled" : ""} /></label>
            <label class="competition-field"><span>Label</span><input data-prize-field="label" type="text" maxlength="100" value="${esc(prize.label || `${ordinal(prize.placing)} place`)}" ${locked ? "disabled" : ""} /></label>
            <label class="competition-field"><span>Value</span><input data-prize-field="amount" type="number" min="0" step="0.01" value="${esc(Number(prize.amount || 0).toFixed(2))}" ${locked ? "disabled" : ""} /></label>
            ${locked ? "" : `<button class="competition-mini-button competition-mini-button--danger" type="button" data-prize-remove="${index}">Remove</button>`}
        </div>`).join("");
    }

    function addPrizeRow() {
        if (!state.canManage) return;
        const existing = state.prizes.map((p) => Number(p.placing));
        let placing = 1; while (existing.includes(placing)) placing += 1;
        state.prizes.push({ placing, label: `${ordinal(placing)} place`, amount: 0, currency_code: state.selectedCompetition?.currency_code || "GBP" });
        renderPrizes();
    }

    function collectPrizes() {
        return Array.from(elements.prizes.querySelectorAll("[data-prize-index]")).map((row) => ({
            placing: Number(row.querySelector('[data-prize-field="placing"]')?.value),
            label: String(row.querySelector('[data-prize-field="label"]')?.value || "").trim(),
            amount: Number(row.querySelector('[data-prize-field="amount"]')?.value || 0)
        })).filter((p) => Number.isInteger(p.placing) && p.placing > 0 && Number.isFinite(p.amount) && p.amount >= 0);
    }

    async function savePrizes() {
        if (!state.canManage || !state.selectedCompetitionId) return;
        const prizes = collectPrizes();
        const seen = new Set();
        for (const prize of prizes) {
            if (prize.placing > 20) { showError(new Error("Prize placing must be between 1 and 20.")); return; }
            if (seen.has(prize.placing)) { showError(new Error("Each prize place can only be used once.")); return; }
            seen.add(prize.placing);
        }
        elements.savePrizes.disabled = true;
        try {
            const { error } = await client().rpc("competition_save_prizes", { p_competition_id: state.selectedCompetitionId, p_prizes: prizes });
            if (error) throw error;
            await reloadDetailData();
            showSuccess("Prize structure saved.");
        } catch (error) { showError(error); }
        finally { elements.savePrizes.disabled = false; }
    }

    async function confirmResults() {
        if (!state.canConfirm || !state.selectedCompetitionId) return;

        clearMessages();

        const entryPayloads = collectEntryPayloads();
        const prizes = collectPrizes();

        try {
            validateConfirmationEntries(entryPayloads);

            const seenPrizePlaces = new Set();
            for (const prize of prizes) {
                if (prize.placing > 20) {
                    throw new Error("Prize placing must be between 1 and 20.");
                }
                if (seenPrizePlaces.has(prize.placing)) {
                    throw new Error("Each prize place can only be used once.");
                }
                seenPrizePlaces.add(prize.placing);
            }
        } catch (error) {
            showError(error);
            return;
        }

        if (!window.confirm(
            "Confirm these as the final competition results? Current entrant results and prizes will be saved first, then locked."
        )) return;

        const originalText = elements.confirmButton.textContent;
        elements.confirmButton.disabled = true;
        elements.confirmButton.textContent = "Confirming…";

        try {
            /* Save what is currently on screen before final confirmation. */
            await saveAllEntriesBeforeConfirmation(entryPayloads);

            const prizeResult = await client().rpc(
                "competition_save_prizes",
                {
                    p_competition_id: state.selectedCompetitionId,
                    p_prizes: prizes
                }
            );
            if (prizeResult.error) throw prizeResult.error;

            const { error } = await client().rpc(
                "competition_confirm_results",
                { p_competition_id: state.selectedCompetitionId }
            );
            if (error) throw error;

            await Promise.all([
                reloadDetailData(),
                loadSummary(),
                loadList()
            ]);
            showSuccess("Competition results confirmed and completed.");
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
            showSuccess("Competition results reopened.");
        } catch (error) { showError(error); }
    }

    async function reloadDetailData() {
        const { data, error } = await client().rpc("competition_get_detail", { p_competition_id: state.selectedCompetitionId });
        if (error) throw error;
        const detail = Array.isArray(data) ? data[0] : data;
        state.selectedCompetition = detail.competition || {};
        state.entries = Array.isArray(detail.entries) ? detail.entries : [];
        state.prizes = Array.isArray(detail.prizes) ? detail.prizes : [];
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
            if (button && !button.disabled) addMember(button.dataset.memberAdd).catch(showError);
        });
        elements.manualEntryForm.addEventListener("submit", addManualEntrant);
        elements.entries.addEventListener("click", (event) => {
            const saveButton = event.target.closest("[data-entry-save]");
            if (saveButton) { saveEntry(saveButton.dataset.entrySave).catch(showError); return; }
            const removeButton = event.target.closest("[data-entry-remove]");
            if (removeButton) removeEntry(removeButton.dataset.entryRemove).catch(showError);
        });
        elements.addPrize.addEventListener("click", addPrizeRow);
        elements.prizes.addEventListener("click", (event) => {
            const button = event.target.closest("[data-prize-remove]");
            if (!button) return;
            const index = Number(button.dataset.prizeRemove);
            if (Number.isInteger(index)) { state.prizes.splice(index, 1); renderPrizes(); }
        });
        elements.savePrizes.addEventListener("click", savePrizes);
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
