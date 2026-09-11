(function () {
    "use strict";

    const P = window.ParyxMember;

    const elements = {
        search: document.getElementById("gameSearch"),
        days: document.getElementById("gameDays"),
        spaces: document.getElementById("gameSpaces"),
        myClubs: document.getElementById("gameMyClubs"),
        list: document.getElementById("gameList"),
        count: document.getElementById("gameCount"),
        message: document.getElementById("gameMessage"),
        dialog: document.getElementById("joinGameDialog"),
        form: document.getElementById("joinGameForm"),
        meta: document.getElementById("joinGameMeta"),
        bookingId: document.getElementById("joinGameBookingId"),
        party: document.getElementById("joinGameParty"),
        close: document.getElementById("closeJoinGame"),
        back: document.getElementById("backJoinGame"),
        confirm: document.getElementById("confirmJoinGame")
    };

    const state = {
        rows: [],
        timer: null,
        loading: false
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

    function addDays(days) {
        const date = new Date();
        date.setDate(date.getDate() + Number(days || 0));
        return P.isoDate(date);
    }

    function locationText(row) {
        return [row.town_city, row.county_region]
            .filter(Boolean)
            .join(", ");
    }

    function renderRows() {
        elements.count.textContent = `${state.rows.length} ${state.rows.length === 1 ? "game" : "games"}`;

        if (state.loading) {
            elements.list.innerHTML = '<div class="empty">Looking for joinable games…</div>';
            return;
        }

        if (!state.rows.length) {
            elements.list.innerHTML = `
                <div class="empty">
                    No joinable tee times match these filters. Try a wider date range or fewer places.
                </div>
            `;
            return;
        }

        elements.list.innerHTML = state.rows.map(function (row) {
            const spaces = Number(row.spaces_remaining || 0);
            const playerCount = Number(row.player_count || 0);
            const location = locationText(row);
            const bookingLink = `booking.html?club=${encodeURIComponent(row.club_id)}&course=${encodeURIComponent(row.course_id)}&date=${encodeURIComponent(row.play_date)}`;

            return `
                <article class="card find-game-card">
                    <div class="find-game-card__date">
                        <strong>${P.escapeHtml(P.shortTime(row.start_time))}</strong>
                        <span>${P.escapeHtml(P.formatDay(row.play_date, { weekday: "short", day: "numeric", month: "short" }))}</span>
                    </div>

                    <div class="find-game-card__body">
                        <div class="find-game-card__heading">
                            <div>
                                <h3>${P.escapeHtml(row.club_name)}</h3>
                                <p class="meta">${P.escapeHtml(row.course_name)}${location ? ` · ${P.escapeHtml(location)}` : ""}</p>
                            </div>
                            ${row.is_member_club ? '<span class="badge">Member club</span>' : ""}
                        </div>

                        <div class="find-game-card__capacity">
                            <span>${P.escapeHtml(`${playerCount} ${playerCount === 1 ? "player" : "players"} booked`)}</span>
                            <strong>${P.escapeHtml(`${spaces} ${spaces === 1 ? "space" : "spaces"} free`)}</strong>
                        </div>

                        <div class="find-game-card__actions">
                            <button
                                class="button"
                                type="button"
                                data-join-game="${P.escapeHtml(row.booking_id)}"
                            >
                                Join
                            </button>
                            <a class="button secondary" href="${P.escapeHtml(bookingLink)}">
                                Tee sheet
                            </a>
                        </div>
                    </div>
                </article>
            `;
        }).join("");
    }

    async function loadGames() {
        state.loading = true;
        renderRows();
        clearMessage();

        try {
            const data = await P.rpc("player_find_games", {
                p_from_date: P.isoDate(new Date()),
                p_to_date: addDays(elements.days.value),
                p_search: elements.search.value.trim() || null,
                p_min_spaces: Number(elements.spaces.value || 1),
                p_my_clubs_only: elements.myClubs.checked,
                p_limit: 100,
                p_offset: 0
            });

            state.rows = P.rows(data);
        } catch (error) {
            state.rows = [];
            showMessage(P.readableError(error), "error");
        } finally {
            state.loading = false;
            renderRows();
        }
    }

    function openJoinDialog(id) {
        const row = state.rows.find(function (item) {
            return item.booking_id === id;
        });

        if (!row) return;

        const spaces = Math.max(1, Math.min(Number(row.spaces_remaining || 1), 4));
        elements.bookingId.value = row.booking_id;
        elements.meta.textContent = `${row.club_name} · ${P.longDay(row.play_date)} · ${P.shortTime(row.start_time)}`;
        elements.party.innerHTML = Array.from({ length: spaces }, function (_, index) {
            const count = index + 1;
            return `<option value="${count}">${count} ${count === 1 ? "player" : "players"}</option>`;
        }).join("");
        elements.dialog.showModal();
    }

    async function joinGame(event) {
        event.preventDefault();
        const id = elements.bookingId.value;
        if (!id) return;

        elements.confirm.disabled = true;
        elements.confirm.textContent = "Joining…";
        clearMessage();

        try {
            await P.rpc("player_join_game", {
                p_booking_id: id,
                p_player_count: Number(elements.party.value || 1)
            });

            elements.dialog.close();
            showMessage("You joined the game. It is now in My bookings.", "success");
            window.dispatchEvent(new Event("paryx:notifications-changed"));
            await loadGames();
        } catch (error) {
            showMessage(P.readableError(error), "error");
        } finally {
            elements.confirm.disabled = false;
            elements.confirm.textContent = "Join game";
        }
    }

    function scheduleLoad() {
        window.clearTimeout(state.timer);
        state.timer = window.setTimeout(loadGames, 280);
    }

    function bind() {
        elements.search.addEventListener("input", scheduleLoad);
        elements.days.addEventListener("change", loadGames);
        elements.spaces.addEventListener("change", loadGames);
        elements.myClubs.addEventListener("change", loadGames);

        elements.list.addEventListener("click", function (event) {
            const button = event.target.closest("[data-join-game]");
            if (button) openJoinDialog(button.dataset.joinGame);
        });

        elements.close.addEventListener("click", function () {
            elements.dialog.close();
        });
        elements.back.addEventListener("click", function () {
            elements.dialog.close();
        });
        elements.form.addEventListener("submit", joinGame);
    }

    P.ready.then(async function () {
        bind();
        await loadGames();
    }).catch(function (error) {
        showMessage(P.readableError(error), "error");
        state.loading = false;
        renderRows();
    });
})();
