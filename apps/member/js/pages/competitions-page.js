(function () {
    "use strict";

    const P = window.ParyxMember;
    const parameters = new URLSearchParams(window.location.search);
    const requestedClubId = parameters.get("club");
    const requestedCompetitionId = parameters.get("competition");

    const elements = {
        noMembership: document.getElementById("competitionNoMembership"),
        content: document.getElementById("competitionContent"),
        club: document.getElementById("competitionClub"),
        filters: document.getElementById("competitionFilters"),
        list: document.getElementById("competitionList"),
        count: document.getElementById("competitionCount"),
        message: document.getElementById("competitionMessage")
    };

    const state = {
        clubs: [],
        rows: [],
        clubId: null,
        filter: "upcoming",
        busyCompetitionId: null
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

    const SECTION_LABELS = {
        club: "Club",
        mens: "Men",
        seniors: "Seniors",
        ladies: "Ladies"
    };

    function showMessage(text, type) {
        elements.message.textContent = text;
        elements.message.className = `notice ${type || ""}`;
        elements.message.hidden = false;
    }

    function clearMessage() {
        elements.message.hidden = true;
        elements.message.textContent = "";
    }

    function dateFromNow(days) {
        const date = new Date();
        date.setDate(date.getDate() + days);
        return P.isoDate(date);
    }

    function entryLabel(row) {
        const stateName = String(row.entry_state || "");

        if (stateName === "entered") return "Entered";
        if (stateName === "completed") return "Completed";
        if (stateName === "full") return "Full";
        if (stateName === "not_open") return "Not open";
        if (stateName === "club_managed_team") return "Team entry";
        if (stateName === "club_managed") return "Club entry";
        if (stateName === "withdrawn") return "Re-enter";
        if (stateName === "open") return "Enter";
        return "Closed";
    }

    function statusClass(row) {
        const stateName = String(row.entry_state || "");
        if (stateName === "entered") return " competition-entry-pill--entered";
        if (stateName === "open" || stateName === "withdrawn") return " competition-entry-pill--open";
        if (stateName === "full") return " competition-entry-pill--full";
        return "";
    }

    function canWithdraw(row) {
        return row.my_entry_status === "entered" && row.competition_status === "open";
    }

    function rowVisible(row) {
        if (state.filter === "open") {
            return row.entry_state === "open" || row.entry_state === "withdrawn";
        }

        if (state.filter === "entered") {
            return row.my_entry_status === "entered";
        }

        return true;
    }

    function renderClubs() {
        elements.club.innerHTML = state.clubs.map(function (club) {
            return `<option value="${P.escapeHtml(club.club_id)}">${P.escapeHtml(club.club_name)}</option>`;
        }).join("");

        if (state.clubId) {
            elements.club.value = state.clubId;
        }
    }

    function renderRows() {
        const rows = state.rows.filter(rowVisible);
        elements.count.textContent = `${rows.length} ${rows.length === 1 ? "competition" : "competitions"}`;

        if (!rows.length) {
            elements.list.innerHTML = `
                <div class="empty">
                    No competitions match this view.
                </div>
            `;
            return;
        }

        elements.list.innerHTML = rows.map(function (row) {
            const busy = state.busyCompetitionId === row.competition_id;
            const format = FORMAT_LABELS[row.competition_format] || row.competition_format;
            const section = SECTION_LABELS[row.section] || row.section || "Club";
            const maxText = row.max_entries
                ? `${row.entry_count || 0}/${row.max_entries} entries`
                : `${row.entry_count || 0} entered`;
            const isRequested = requestedCompetitionId === row.competition_id;

            return `
                <article class="card competition-player-card ${isRequested ? "competition-player-card--focus" : ""}">
                    <div class="competition-player-card__top">
                        <div>
                            <p class="kicker">${P.escapeHtml(row.club_name)}</p>
                            <h3>${P.escapeHtml(row.competition_name)}</h3>
                            <p class="meta">${P.escapeHtml(P.longDay(row.competition_date))} · ${P.escapeHtml(format)} · ${P.escapeHtml(section)}</p>
                        </div>
                        ${row.is_qualifier ? '<span class="badge">Qualifier</span>' : ""}
                    </div>

                    <div class="competition-player-card__status">
                        <span class="competition-entry-pill${statusClass(row)}">${P.escapeHtml(entryLabel(row))}</span>
                        <small>${P.escapeHtml(maxText)}</small>
                    </div>

                    <p class="competition-player-card__message">${P.escapeHtml(row.entry_message || "")}</p>

                    <div class="competition-player-card__actions">
                        ${row.can_enter ? `
                            <button
                                class="button"
                                type="button"
                                data-enter-competition="${P.escapeHtml(row.competition_id)}"
                                ${busy ? "disabled" : ""}
                            >${busy ? "Working…" : (row.my_entry_status === "withdrawn" ? "Re-enter" : "Enter competition")}</button>
                        ` : ""}

                        ${canWithdraw(row) ? `
                            <button
                                class="button secondary"
                                type="button"
                                data-withdraw-competition="${P.escapeHtml(row.competition_id)}"
                                ${busy ? "disabled" : ""}
                            >${busy ? "Working…" : "Withdraw"}</button>
                        ` : ""}
                    </div>
                </article>
            `;
        }).join("");
    }

    async function loadRows() {
        if (!state.clubId) return;

        clearMessage();
        elements.list.innerHTML = '<div class="empty">Loading competitions…</div>';

        try {
            const data = await P.rpc("player_list_competitions", {
                p_club_id: state.clubId,
                p_from_date: P.isoDate(new Date()),
                p_to_date: dateFromNow(180),
                p_filter: null
            });

            state.rows = P.rows(data);
            renderRows();
        } catch (error) {
            state.rows = [];
            renderRows();
            showMessage(P.readableError(error), "error");
        }
    }

    async function enterCompetition(id) {
        const row = state.rows.find(function (item) {
            return item.competition_id === id;
        });

        if (!row) return;

        const confirmed = window.confirm(
            `Enter ${row.competition_name} on ${P.longDay(row.competition_date)}?`
        );

        if (!confirmed) return;

        state.busyCompetitionId = id;
        renderRows();
        clearMessage();

        try {
            await P.rpc("player_enter_competition", {
                p_competition_id: id
            });
            showMessage("Competition entry confirmed.", "success");
            window.dispatchEvent(new Event("paryx:notifications-changed"));
            await loadRows();
        } catch (error) {
            showMessage(P.readableError(error), "error");
        } finally {
            state.busyCompetitionId = null;
            renderRows();
        }
    }

    async function withdrawCompetition(id) {
        const row = state.rows.find(function (item) {
            return item.competition_id === id;
        });

        if (!row) return;

        const confirmed = window.confirm(
            `Withdraw from ${row.competition_name}? If entry remains open you can re-enter later.`
        );

        if (!confirmed) return;

        state.busyCompetitionId = id;
        renderRows();
        clearMessage();

        try {
            await P.rpc("player_withdraw_competition", {
                p_competition_id: id
            });
            showMessage("Competition entry withdrawn.", "success");
            window.dispatchEvent(new Event("paryx:notifications-changed"));
            await loadRows();
        } catch (error) {
            showMessage(P.readableError(error), "error");
        } finally {
            state.busyCompetitionId = null;
            renderRows();
        }
    }

    function bind() {
        elements.club.addEventListener("change", function () {
            state.clubId = elements.club.value || null;
            if (state.clubId) P.setSelectedClubId(state.clubId);
            loadRows();
        });

        elements.filters.addEventListener("click", function (event) {
            const button = event.target.closest("[data-filter]");
            if (!button) return;

            state.filter = button.dataset.filter || "upcoming";
            elements.filters.querySelectorAll("[data-filter]").forEach(function (item) {
                item.classList.toggle("active", item === button);
            });
            renderRows();
        });

        elements.list.addEventListener("click", function (event) {
            const enterButton = event.target.closest("[data-enter-competition]");
            if (enterButton) {
                enterCompetition(enterButton.dataset.enterCompetition);
                return;
            }

            const withdrawButton = event.target.closest("[data-withdraw-competition]");
            if (withdrawButton) {
                withdrawCompetition(withdrawButton.dataset.withdrawCompetition);
            }
        });
    }

    P.ready.then(async function (context) {
        state.clubs = Array.isArray(context.memberClubs) ? context.memberClubs : [];

        if (!state.clubs.length) {
            elements.noMembership.hidden = false;
            elements.content.hidden = true;
            return;
        }

        const requested = state.clubs.find(function (club) {
            return club.club_id === requestedClubId;
        });
        const saved = state.clubs.find(function (club) {
            return club.club_id === P.selectedClubId();
        });
        const primary = state.clubs.find(function (club) {
            return Boolean(club.is_primary);
        });

        state.clubId = requested?.club_id || saved?.club_id || primary?.club_id || state.clubs[0].club_id;
        P.setSelectedClubId(state.clubId);

        renderClubs();
        bind();
        await loadRows();

        if (requestedCompetitionId) {
            window.setTimeout(function () {
                const focus = document.querySelector(".competition-player-card--focus");
                focus?.scrollIntoView({ behavior: "smooth", block: "center" });
            }, 120);
        }
    }).catch(function (error) {
        elements.content.innerHTML = `<div class="notice error">${P.escapeHtml(P.readableError(error))}</div>`;
    });
})();
