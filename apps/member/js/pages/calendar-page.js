(function () {
    "use strict";

    const P = window.ParyxMember;
    const params = new URLSearchParams(window.location.search);
    const requestedClubId = params.get("club");
    const requestedCompetitionId = params.get("competition");
    const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(params.get("date") || ""))
        ? params.get("date")
        : null;

    const elements = {
        club: document.getElementById("calendarClub"),
        filters: document.getElementById("filters"),
        events: document.getElementById("events"),
        status: document.getElementById("calendarStatus"),
        monthLabel: document.getElementById("calendarMonthLabel"),
        previousMonth: document.getElementById("calendarPreviousMonth"),
        nextMonth: document.getElementById("calendarNextMonth"),
        noMembership: document.getElementById("calendarNoMembership"),
        memberContent: document.getElementById("calendarMemberContent"),
        message: document.getElementById("calendarMessage")
    };

    const SECTION_LABELS = {
        club: "Club",
        mens: "Men",
        seniors: "Seniors",
        ladies: "Ladies"
    };

    const state = {
        clubs: [],
        events: [],
        section: "all",
        month: requestedDate
            ? new Date(`${requestedDate}T12:00:00`)
            : new Date(),
        loading: false,
        actionCompetitionId: null,
        focusHandled: false
    };

    state.month = new Date(state.month.getFullYear(), state.month.getMonth(), 1);

    function titleCase(value) {
        return String(value || "")
            .replaceAll("_", " ")
            .replace(/\b\w/g, function (character) {
                return character.toUpperCase();
            });
    }

    function startOfMonth(date) {
        return new Date(date.getFullYear(), date.getMonth(), 1);
    }

    function endOfMonth(date) {
        return new Date(date.getFullYear(), date.getMonth() + 1, 0);
    }

    function monthLabel(date) {
        return new Intl.DateTimeFormat("en-GB", {
            month: "long",
            year: "numeric"
        }).format(date);
    }

    function showMessage(text, type) {
        elements.message.textContent = text;
        elements.message.className = `notice ${type || ""}`;
        elements.message.hidden = false;
    }

    function clearMessage() {
        elements.message.hidden = true;
        elements.message.textContent = "";
    }

    function changeMonth(offset) {
        state.month = new Date(
            state.month.getFullYear(),
            state.month.getMonth() + offset,
            1
        );
        loadEvents();
    }

    function eventMeta(event) {
        const time = event.start_time
            ? P.shortTime(event.start_time)
            : String(event.time_text || "").trim();

        const location = [event.course_name, event.venue]
            .filter(Boolean)
            .join(" · ");

        return [time, location].filter(Boolean).join(" · ");
    }

    function filteredEvents() {
        if (state.section === "all") return state.events;
        return state.events.filter(function (event) {
            return event.section === state.section;
        });
    }

    function renderMonthHeading() {
        elements.monthLabel.textContent = monthLabel(state.month);
    }

    function competitionControls(event) {
        if (event.event_type !== "competition" || !event.competition_id) {
            return "";
        }

        const count = Number(event.entry_count || 0);
        const status = String(event.competition_status || "");
        const entryStatus = String(event.entry_status || "");
        const meta = [
            event.competition_format ? titleCase(event.competition_format) : null,
            `${count} ${count === 1 ? "entry" : "entries"}`
        ].filter(Boolean).join(" · ");

        let action = "";
        let badge = "";

        if (event.can_withdraw) {
            badge = '<span class="competition-entry-badge competition-entry-badge--entered">Entered</span>';
            action = `<button class="button secondary competition-entry-action" type="button" data-withdraw-competition="${P.escapeHtml(event.competition_id)}">Withdraw</button>`;
        } else if (event.can_enter) {
            action = `<button class="button competition-entry-action" type="button" data-enter-competition="${P.escapeHtml(event.competition_id)}">Enter competition</button>`;
        } else if (entryStatus === "entered") {
            badge = '<span class="competition-entry-badge competition-entry-badge--entered">Entered</span>';
        } else if (entryStatus === "withdrawn") {
            badge = '<span class="competition-entry-badge">Withdrawn</span>';
        } else if (status === "closed" || status === "results_pending" || status === "completed") {
            badge = '<span class="competition-entry-badge">Entries closed</span>';
        } else if (status === "open") {
            badge = '<span class="competition-entry-badge">Open</span>';
        }

        return `
            <div class="competition-entry-panel">
                <div class="competition-entry-panel__meta">
                    <span>${P.escapeHtml(meta)}</span>
                    ${badge}
                </div>
                ${action}
            </div>
        `;
    }

    function renderEvents() {
        renderMonthHeading();
        if (!state.clubs.length) return;

        const rows = filteredEvents();

        if (state.loading) {
            elements.status.textContent = "Loading fixtures…";
            elements.events.innerHTML = '<div class="empty">Loading club calendar…</div>';
            return;
        }

        const sectionText = state.section === "all"
            ? "All"
            : (SECTION_LABELS[state.section] || state.section);

        elements.status.textContent = `${rows.length} ${rows.length === 1 ? "fixture" : "fixtures"} · ${sectionText}`;

        if (!rows.length) {
            elements.events.innerHTML = `
                <div class="empty">
                    No published ${state.section === "all" ? "" : `${P.escapeHtml(sectionText).toLowerCase()} `}
                    events in ${P.escapeHtml(monthLabel(state.month))}.
                </div>
            `;
            return;
        }

        elements.events.innerHTML = rows.map(function (event) {
            const meta = eventMeta(event);
            const section = SECTION_LABELS[event.section] || event.section || "Club";
            const focused = requestedCompetitionId && event.competition_id === requestedCompetitionId;

            return `
                <article class="calendar-event ${focused ? "calendar-event--focus" : ""}" ${event.competition_id ? `data-competition-card="${P.escapeHtml(event.competition_id)}"` : ""}>
                    <div class="calendar-date">
                        <strong>${P.escapeHtml(P.formatDay(event.event_date, { day: "numeric" }))}</strong>
                        <span>${P.escapeHtml(P.formatDay(event.event_date, { weekday: "short" }))}</span>
                    </div>
                    <div class="calendar-event__body">
                        <div class="calendar-event__heading">
                            <h3>${P.escapeHtml(event.title)}</h3>
                            <span class="calendar-event__section" data-section="${P.escapeHtml(event.section || "club")}">${P.escapeHtml(section)}</span>
                        </div>
                        ${meta ? `<p>${P.escapeHtml(meta)}</p>` : ""}
                        ${event.location_type && !event.venue ? `<p class="calendar-event__secondary">${P.escapeHtml(event.location_type)}</p>` : ""}
                        ${competitionControls(event)}
                    </div>
                </article>
            `;
        }).join("");

        if (requestedCompetitionId && !state.focusHandled) {
            const focused = Array.from(elements.events.querySelectorAll("[data-competition-card]")).find(function (item) {
                return item.dataset.competitionCard === requestedCompetitionId;
            });
            if (focused) {
                state.focusHandled = true;
                window.setTimeout(function () {
                    focused.scrollIntoView({ behavior: "smooth", block: "center" });
                }, 80);
            }
        }
    }

    async function loadEvents() {
        if (!elements.club.value) {
            state.events = [];
            renderEvents();
            return;
        }

        clearMessage();
        state.loading = true;
        renderEvents();

        try {
            const data = await P.rpc("player_get_calendar_events_v2", {
                p_club_id: elements.club.value,
                p_from_date: P.isoDate(startOfMonth(state.month)),
                p_to_date: P.isoDate(endOfMonth(state.month))
            });
            state.events = P.rows(data);
            P.setSelectedClubId(elements.club.value);
        } catch (error) {
            state.events = [];
            elements.status.textContent = "";
            elements.events.innerHTML = `<div class="notice error">${P.escapeHtml(P.readableError(error))}</div>`;
            return;
        } finally {
            state.loading = false;
        }

        renderEvents();
    }

    function chooseInitialClub() {
        if (requestedClubId) {
            const requested = state.clubs.find(function (club) {
                return club.club_id === requestedClubId;
            });
            if (requested) return requested;
        }

        const savedClubId = P.selectedClubId();
        const savedClub = state.clubs.find(function (club) {
            return club.club_id === savedClubId;
        });
        const primaryClub = state.clubs.find(function (club) {
            return Boolean(club.is_primary);
        });
        return savedClub || primaryClub || state.clubs[0] || null;
    }

    function renderClubSelector() {
        if (!state.clubs.length) {
            elements.club.innerHTML = '<option value="">No linked member clubs</option>';
            elements.noMembership.hidden = false;
            elements.memberContent.hidden = true;
            return;
        }

        elements.noMembership.hidden = true;
        elements.memberContent.hidden = false;
        elements.club.innerHTML = state.clubs.map(function (club) {
            return `<option value="${P.escapeHtml(club.club_id)}">${P.escapeHtml(club.club_name)}</option>`;
        }).join("");

        const initialClub = chooseInitialClub();
        if (initialClub) elements.club.value = initialClub.club_id;
    }

    async function enterCompetition(id) {
        if (state.actionCompetitionId) return;
        if (!window.confirm("Enter this competition?")) return;

        state.actionCompetitionId = id;
        try {
            await P.rpc("player_enter_competition", { p_competition_id: id });
            showMessage("Competition entry confirmed.", "success");
            window.dispatchEvent(new CustomEvent("paryx:notifications-changed"));
            await loadEvents();
        } catch (error) {
            showMessage(P.readableError(error), "error");
        } finally {
            state.actionCompetitionId = null;
        }
    }

    async function withdrawCompetition(id) {
        if (state.actionCompetitionId) return;
        if (!window.confirm("Withdraw your entry from this competition?")) return;

        state.actionCompetitionId = id;
        try {
            await P.rpc("player_withdraw_competition", { p_competition_id: id });
            showMessage("Competition entry withdrawn.", "success");
            window.dispatchEvent(new CustomEvent("paryx:notifications-changed"));
            await loadEvents();
        } catch (error) {
            showMessage(P.readableError(error), "error");
        } finally {
            state.actionCompetitionId = null;
        }
    }

    function bindControls() {
        elements.filters.addEventListener("click", function (event) {
            const button = event.target.closest("[data-section]");
            if (!button) return;

            state.section = button.dataset.section || "all";
            elements.filters.querySelectorAll("[data-section]").forEach(function (item) {
                item.classList.toggle("active", item === button);
            });
            renderEvents();
        });

        elements.events.addEventListener("click", function (event) {
            const enter = event.target.closest("[data-enter-competition]");
            const withdraw = event.target.closest("[data-withdraw-competition]");
            if (enter) enterCompetition(enter.dataset.enterCompetition);
            else if (withdraw) withdrawCompetition(withdraw.dataset.withdrawCompetition);
        });

        elements.club.addEventListener("change", loadEvents);
        elements.previousMonth.addEventListener("click", function () { changeMonth(-1); });
        elements.nextMonth.addEventListener("click", function () { changeMonth(1); });
    }

    P.ready.then(async function (context) {
        state.clubs = Array.isArray(context.memberClubs) ? context.memberClubs : [];
        bindControls();
        renderClubSelector();
        renderMonthHeading();
        if (state.clubs.length) await loadEvents();
    }).catch(function (error) {
        elements.memberContent.hidden = false;
        elements.events.innerHTML = `<div class="notice error">${P.escapeHtml(P.readableError(error))}</div>`;
    });
})();
