(function () {
    "use strict";

    const P = window.ParyxMember;

    const state = {
        clubs: [],
        games: [],
        days: 7,
        visibleLimit: 12,
        selectedGame: null,
        loading: false
    };

    const elements = {
        club: document.getElementById("findGameClub"),
        party: document.getElementById("findGamePartySize"),
        range: document.getElementById("findGameRange"),
        summary: document.getElementById("findGameSummary"),
        results: document.getElementById("findGameResults"),
        message: document.getElementById("findGameMessage"),
        refresh: document.getElementById("refreshFindGame"),
        dialog: document.getElementById("joinGameDialog"),
        form: document.getElementById("joinGameForm"),
        meta: document.getElementById("joinGameMeta"),
        detail: document.getElementById("joinGameDetail"),
        bookingId: document.getElementById("joinGameBookingId"),
        close: document.getElementById("closeJoinGame"),
        back: document.getElementById("backJoinGame"),
        confirm: document.getElementById("confirmJoinGame")
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

    function addDays(date, days) {
        const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        next.setDate(next.getDate() + days);
        return next;
    }

    function renderClubOptions() {
        const selected = elements.club.value;
        elements.club.innerHTML = '<option value="">Any Paryx club</option>' + state.clubs.map(function (club) {
            const where = [club.town_city, club.county_region].filter(Boolean).join(", ");
            return `<option value="${P.escapeHtml(club.club_id)}">${P.escapeHtml(club.club_name)}${where ? ` · ${P.escapeHtml(where)}` : ""}</option>`;
        }).join("");
        if (state.clubs.some(function (club) { return club.club_id === selected; })) {
            elements.club.value = selected;
        }
    }

    async function loadClubs() {
        state.clubs = P.rows(await P.rpc("player_list_clubs_v2", { p_search: null }));
        renderClubOptions();
    }

    function gameCard(game) {
        const spaces = Number(game.spaces_remaining || 0);
        const players = Number(game.player_count || 0);
        const requested = Number(elements.party.value || 1);
        return `
            <button class="find-game-card" type="button" data-game-id="${P.escapeHtml(game.booking_id)}">
                <div class="find-game-card__time">
                    <strong>${P.escapeHtml(P.shortTime(game.start_time))}</strong>
                    <span>${P.escapeHtml(`${spaces} ${spaces === 1 ? "space" : "spaces"}`)}</span>
                </div>
                <p class="find-game-card__date">${P.escapeHtml(P.formatDay(game.play_date))}</p>
                <h3>${P.escapeHtml(game.club_name)}</h3>
                <p class="find-game-card__course">${P.escapeHtml(game.course_name)}</p>
                <div class="find-game-card__footer">
                    <span>${P.escapeHtml(`${players} ${players === 1 ? "player" : "players"}`)}</span>
                    <div class="find-game-card__footer-actions">
                        ${game.is_member_club ? '<span class="badge">Your club</span>' : ''}
                        <strong>Join ${requested}</strong>
                    </div>
                </div>
            </button>
        `;
    }

    function renderGames() {
        const total = state.games.length;
        const requested = Number(elements.party.value || 1);
        elements.summary.textContent = total
            ? `${total} joinable ${total === 1 ? "game" : "games"} with at least ${requested} ${requested === 1 ? "place" : "places"}`
            : `No joinable games with ${requested} ${requested === 1 ? "place" : "places"} in this period`;

        if (!total) {
            elements.results.innerHTML = '<div class="empty find-game-grid__empty">No matching games right now. Try a longer date range, another club or fewer places.</div>';
            return;
        }

        const visible = state.games.slice(0, state.visibleLimit);
        const remaining = Math.max(0, total - visible.length);
        elements.results.innerHTML = visible.map(gameCard).join("") + (remaining > 0
            ? `<button type="button" class="player-more-times find-game-more" data-show-more>Show ${Math.min(12, remaining)} more<span>${remaining} more game${remaining === 1 ? "" : "s"} available</span></button>`
            : "");
    }

    async function loadGames() {
        if (state.loading) return;
        state.loading = true;
        clearMessage();
        elements.summary.textContent = "Looking for available games…";
        elements.results.innerHTML = '<div class="empty find-game-grid__empty">Loading games…</div>';

        const today = new Date();
        const from = P.isoDate(today);
        const to = P.isoDate(addDays(today, state.days - 1));

        try {
            state.games = P.rows(await P.rpc("player_find_games", {
                p_from_date: from,
                p_to_date: to,
                p_club_id: elements.club.value || null,
                p_min_spaces: Number(elements.party.value || 1),
                p_limit: 100,
                p_offset: 0
            }));
            state.visibleLimit = 12;
            renderGames();
        } catch (error) {
            state.games = [];
            renderGames();
            showMessage(P.readableError(error), "error");
        } finally {
            state.loading = false;
        }
    }

    function openGame(id) {
        const game = state.games.find(function (item) {
            return item.booking_id === id;
        });
        if (!game) return;

        state.selectedGame = game;
        const party = Number(elements.party.value || 1);
        elements.bookingId.value = game.booking_id;
        elements.meta.textContent = `${P.longDay(game.play_date)} · ${P.shortTime(game.start_time)}`;
        elements.detail.textContent = `${game.club_name} · ${game.course_name} · Join with ${party} ${party === 1 ? "player" : "players"}.`;
        elements.confirm.textContent = `Join ${party === 1 ? "game" : `with ${party}`}`;
        elements.dialog.showModal();
    }

    async function joinGame(event) {
        event.preventDefault();
        const game = state.selectedGame;
        if (!game) return;

        elements.confirm.disabled = true;
        try {
            await P.rpc("member_join_booking", {
                p_booking_id: game.booking_id,
                p_player_count: Number(elements.party.value || 1)
            });
            elements.dialog.close();
            state.selectedGame = null;
            showMessage("You joined the game. It is now in My bookings.", "success");
            window.dispatchEvent(new CustomEvent("paryx:notifications-changed"));
            await loadGames();
        } catch (error) {
            showMessage(P.readableError(error), "error");
        } finally {
            elements.confirm.disabled = false;
        }
    }

    function bind() {
        elements.club.addEventListener("change", loadGames);
        elements.party.addEventListener("change", loadGames);
        elements.refresh.addEventListener("click", loadGames);

        elements.range.addEventListener("click", function (event) {
            const button = event.target.closest("[data-days]");
            if (!button) return;
            state.days = Number(button.dataset.days || 7);
            elements.range.querySelectorAll("[data-days]").forEach(function (item) {
                item.classList.toggle("active", item === button);
            });
            loadGames();
        });

        elements.results.addEventListener("click", function (event) {
            const more = event.target.closest("[data-show-more]");
            if (more) {
                state.visibleLimit += 12;
                renderGames();
                return;
            }
            const card = event.target.closest("[data-game-id]");
            if (card) openGame(card.dataset.gameId);
        });

        elements.close.addEventListener("click", function () { elements.dialog.close(); });
        elements.back.addEventListener("click", function () { elements.dialog.close(); });
        elements.form.addEventListener("submit", joinGame);
    }

    P.ready.then(async function () {
        bind();
        await loadClubs();
        await loadGames();
    }).catch(function (error) {
        elements.results.innerHTML = `<div class="notice error find-game-grid__empty">${P.escapeHtml(P.readableError(error))}</div>`;
    });
})();
