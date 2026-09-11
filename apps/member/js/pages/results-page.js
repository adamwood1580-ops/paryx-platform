(function () {
    "use strict";

    const P = window.ParyxMember;
    const state = { clubs: [], results: [] };

    const elements = {
        filter: document.getElementById("resultsClubFilter"),
        message: document.getElementById("resultsMessage"),
        count: document.getElementById("resultsCount"),
        list: document.getElementById("resultsList"),
        dialog: document.getElementById("resultDialog"),
        dialogClub: document.getElementById("resultDialogClub"),
        dialogTitle: document.getElementById("resultDialogTitle"),
        dialogMeta: document.getElementById("resultDialogMeta"),
        closeDialog: document.getElementById("closeResultDialog"),
        playerSummary: document.getElementById("resultPlayerSummary"),
        leaderboard: document.getElementById("resultLeaderboard"),
        awardsSection: document.getElementById("resultAwardsSection"),
        awards: document.getElementById("resultAwards")
    };

    function showMessage(text, type) {
        elements.message.textContent = text;
        elements.message.className = `notice ${type || ""}`;
        elements.message.hidden = false;
    }

    function clearMessage() {
        elements.message.hidden = true;
    }

    function titleCase(value) {
        return String(value || "")
            .replaceAll("_", " ")
            .replace(/\b\w/g, function (character) { return character.toUpperCase(); });
    }

    function ordinal(value) {
        const number = Number(value);
        if (!Number.isFinite(number) || number < 1) return "—";
        const mod100 = number % 100;
        const suffix = mod100 >= 11 && mod100 <= 13
            ? "th"
            : number % 10 === 1
                ? "st"
                : number % 10 === 2
                    ? "nd"
                    : number % 10 === 3
                        ? "rd"
                        : "th";
        return `${number}${suffix}`;
    }

    function money(value, currency) {
        return new Intl.NumberFormat("en-GB", {
            style: "currency",
            currency: String(currency || "GBP")
        }).format(Number(value || 0));
    }

    function scoreText(result, format) {
        if (!result) return "";
        const pieces = [];
        if (result.placing) pieces.push(ordinal(result.placing));
        if (result.points !== null && result.points !== undefined) pieces.push(`${result.points} pts`);
        if (result.nett_score !== null && result.nett_score !== undefined) pieces.push(`Nett ${result.nett_score}`);
        if (result.gross_score !== null && result.gross_score !== undefined) pieces.push(`Gross ${result.gross_score}`);
        if (!pieces.length && result.result_text) pieces.push(result.result_text);
        return pieces.join(" · ") || titleCase(format);
    }

    function renderFilter() {
        const selected = elements.filter.value;
        elements.filter.innerHTML = '<option value="">All linked clubs</option>' + state.clubs.map(function (club) {
            return `<option value="${P.escapeHtml(club.club_id)}">${P.escapeHtml(club.club_name)}</option>`;
        }).join("");
        if (state.clubs.some(function (club) { return club.club_id === selected; })) {
            elements.filter.value = selected;
        }
    }

    function renderResults() {
        elements.count.textContent = `${state.results.length} result${state.results.length === 1 ? "" : "s"}`;

        if (!state.results.length) {
            elements.list.innerHTML = `
                <div class="empty">
                    No confirmed competition results are available for the selected club yet.
                </div>
            `;
            return;
        }

        elements.list.innerHTML = state.results.map(function (row) {
            const myResult = row.player_result;
            const awardTotal = Number(row.player_award_total || 0);
            const myCopy = myResult
                ? `You · ${scoreText(myResult, row.competition_format)}`
                : "View full leaderboard";

            return `
                <button class="card result-card" type="button" data-result-id="${P.escapeHtml(row.competition_id)}">
                    <div class="result-card__top">
                        <div>
                            <p class="kicker">${P.escapeHtml(row.club_name)}</p>
                            <h3>${P.escapeHtml(row.competition_name)}</h3>
                            <p class="meta">${P.escapeHtml(P.longDay(row.competition_date))} · ${P.escapeHtml(titleCase(row.competition_format))}</p>
                        </div>
                        ${row.is_qualifier ? '<span class="badge">Qualifier</span>' : ''}
                    </div>
                    <div class="result-card__player ${myResult ? "result-card__player--matched" : ""}">
                        <span>${P.escapeHtml(myCopy)}</span>
                        ${awardTotal > 0 ? `<strong>+${P.escapeHtml(money(awardTotal, row.currency_code))}</strong>` : `<small>${P.escapeHtml(`${row.result_count || 0} players`)}</small>`}
                    </div>
                </button>
            `;
        }).join("");
    }

    async function loadResults() {
        clearMessage();
        elements.list.innerHTML = '<div class="empty">Loading confirmed results…</div>';
        try {
            const data = await P.rpc("player_list_competition_results", {
                p_club_id: elements.filter.value || null,
                p_limit: 50,
                p_offset: 0
            });
            state.results = Array.isArray(data) ? data : [];
            renderResults();
        } catch (error) {
            state.results = [];
            renderResults();
            showMessage(P.readableError(error), "error");
        }
    }

    function leaderboardScore(row) {
        const bits = [];
        if (row.points !== null && row.points !== undefined) bits.push(`${row.points} pts`);
        if (row.nett_score !== null && row.nett_score !== undefined) bits.push(`Nett ${row.nett_score}`);
        if (row.gross_score !== null && row.gross_score !== undefined) bits.push(`Gross ${row.gross_score}`);
        if (!bits.length && row.result_text) bits.push(row.result_text);
        return bits.join(" · ") || "—";
    }

    function renderDetail(data) {
        const competition = data?.competition || {};
        const leaderboard = Array.isArray(data?.leaderboard) ? data.leaderboard : [];
        const awards = Array.isArray(data?.awards) ? data.awards : [];
        const mine = leaderboard.find(function (row) { return Boolean(row.is_me); });
        const myAwards = awards.filter(function (award) { return Boolean(award.is_me); });

        elements.dialogClub.textContent = competition.club_name || "Competition result";
        elements.dialogTitle.textContent = competition.name || "Result";
        elements.dialogMeta.textContent = `${P.longDay(competition.competition_date)} · ${titleCase(competition.competition_format)}`;

        if (mine || myAwards.length) {
            const total = myAwards.reduce(function (sum, award) { return sum + Number(award.amount || 0); }, 0);
            elements.playerSummary.innerHTML = `
                <article class="card result-player-summary">
                    <p class="kicker">Your result</p>
                    <h3>${P.escapeHtml(mine ? scoreText(mine, competition.competition_format) : "Competition award")}</h3>
                    ${myAwards.length ? `<p class="meta">${P.escapeHtml(myAwards.map(function (award) { return award.label || titleCase(award.award_type); }).join(" · "))}</p>` : ""}
                    ${total > 0 ? `<strong class="result-player-summary__credit">+${P.escapeHtml(money(total, competition.currency_code))} Club Credit</strong>` : ""}
                </article>
            `;
        } else {
            elements.playerSummary.innerHTML = "";
        }

        elements.leaderboard.innerHTML = leaderboard.length ? leaderboard.map(function (row) {
            return `
                <div class="leaderboard-row ${row.is_me ? "leaderboard-row--me" : ""}">
                    <span class="leaderboard-row__place">${P.escapeHtml(row.placing ? ordinal(row.placing) : "—")}</span>
                    <div>
                        <strong>${P.escapeHtml(row.player_name || "Player")}${row.is_me ? " · You" : ""}</strong>
                        <span>${P.escapeHtml(leaderboardScore(row))}</span>
                    </div>
                </div>
            `;
        }).join("") : '<div class="empty">No leaderboard rows are available.</div>';

        if (!awards.length) {
            elements.awardsSection.hidden = true;
            elements.awards.innerHTML = "";
        } else {
            elements.awardsSection.hidden = false;
            elements.awards.innerHTML = awards.map(function (award) {
                return `
                    <div class="result-award ${award.is_me ? "result-award--me" : ""}">
                        <div>
                            <strong>${P.escapeHtml(award.label || titleCase(award.award_type))}</strong>
                            <span>${P.escapeHtml(award.recipient_name || "Member")}${award.is_me ? " · You" : ""}</span>
                        </div>
                        <strong>${P.escapeHtml(Number(award.amount || 0) > 0 ? money(award.amount, award.currency_code || competition.currency_code) : "Award")}</strong>
                    </div>
                `;
            }).join("");
        }
    }

    async function openResult(id) {
        elements.dialogTitle.textContent = "Loading result…";
        elements.dialogMeta.textContent = "";
        elements.playerSummary.innerHTML = "";
        elements.leaderboard.innerHTML = '<div class="empty">Loading leaderboard…</div>';
        elements.awardsSection.hidden = true;
        elements.dialog.showModal();
        try {
            const data = await P.rpc("player_get_competition_result", {
                p_competition_id: id
            });
            renderDetail(data);
        } catch (error) {
            elements.leaderboard.innerHTML = `<div class="notice error">${P.escapeHtml(P.readableError(error))}</div>`;
        }
    }

    function bind() {
        elements.filter.addEventListener("change", loadResults);
        elements.list.addEventListener("click", function (event) {
            const button = event.target.closest("[data-result-id]");
            if (button) openResult(button.dataset.resultId);
        });
        elements.closeDialog.addEventListener("click", function () {
            elements.dialog.close();
        });
    }

    P.ready.then(async function (context) {
        state.clubs = Array.isArray(context.memberClubs) ? context.memberClubs : [];
        renderFilter();
        bind();
        await loadResults();
    }).catch(function (error) {
        elements.list.innerHTML = `<div class="notice error">${P.escapeHtml(P.readableError(error))}</div>`;
    });
})();
