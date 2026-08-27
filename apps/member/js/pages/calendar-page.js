(function () {
    "use strict";

    const P =
        window.ParyxMember;

    const elements = {
        club:
            document.getElementById(
                "calendarClub"
            ),

        filters:
            document.getElementById(
                "filters"
            ),

        events:
            document.getElementById(
                "events"
            ),

        status:
            document.getElementById(
                "calendarStatus"
            ),

        monthLabel:
            document.getElementById(
                "calendarMonthLabel"
            ),

        previousMonth:
            document.getElementById(
                "calendarPreviousMonth"
            ),

        nextMonth:
            document.getElementById(
                "calendarNextMonth"
            ),

        noMembership:
            document.getElementById(
                "calendarNoMembership"
            ),

        memberContent:
            document.getElementById(
                "calendarMemberContent"
            )
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
        month:
            new Date(
                new Date().getFullYear(),
                new Date().getMonth(),
                1
            ),
        loading: false
    };

    function startOfMonth(date) {
        return new Date(
            date.getFullYear(),
            date.getMonth(),
            1
        );
    }

    function endOfMonth(date) {
        return new Date(
            date.getFullYear(),
            date.getMonth() + 1,
            0
        );
    }

    function changeMonth(offset) {
        state.month =
            new Date(
                state.month.getFullYear(),
                state.month.getMonth() +
                    offset,
                1
            );

        loadEvents();
    }

    function monthLabel(date) {
        return new Intl.DateTimeFormat(
            "en-GB",
            {
                month: "long",
                year: "numeric"
            }
        ).format(date);
    }

    function eventMeta(event) {
        const time =
            event.start_time
                ? P.shortTime(
                    event.start_time
                )
                : String(
                    event.time_text ||
                    ""
                ).trim();

        const location =
            [
                event.course_name,
                event.venue
            ]
                .filter(Boolean)
                .join(" · ");

        return [
            time,
            location
        ]
            .filter(Boolean)
            .join(" · ");
    }

    function filteredEvents() {
        if (
            state.section ===
            "all"
        ) {
            return state.events;
        }

        return state.events.filter(
            function (event) {
                return (
                    event.section ===
                    state.section
                );
            }
        );
    }

    function renderMonthHeading() {
        elements.monthLabel.textContent =
            monthLabel(
                state.month
            );
    }

    function renderEvents() {
        renderMonthHeading();

        if (
            !state.clubs.length
        ) {
            return;
        }

        const rows =
            filteredEvents();

        if (
            state.loading
        ) {
            elements.status.textContent =
                "Loading fixtures…";

            elements.events.innerHTML = `
                <div class="empty">
                    Loading club calendar…
                </div>
            `;

            return;
        }

        const sectionText =
            state.section === "all"
                ? "All"
                : (
                    SECTION_LABELS[
                        state.section
                    ] ||
                    state.section
                );

        elements.status.textContent =
            `${rows.length} ${
                rows.length === 1
                    ? "fixture"
                    : "fixtures"
            } · ${sectionText}`;

        if (!rows.length) {
            elements.events.innerHTML = `
                <div class="empty">
                    No published ${
                        state.section === "all"
                            ? ""
                            : `${P.escapeHtml(
                                sectionText
                            ).toLowerCase()} `
                    }events in ${P.escapeHtml(
                        monthLabel(
                            state.month
                        )
                    )}.
                </div>
            `;

            return;
        }

        elements.events.innerHTML =
            rows
                .map(
                    function (event) {
                        const meta =
                            eventMeta(
                                event
                            );

                        const section =
                            SECTION_LABELS[
                                event.section
                            ] ||
                            event.section ||
                            "Club";

                        return `
                            <article class="calendar-event">
                                <div class="calendar-date">
                                    <strong>
                                        ${P.escapeHtml(
                                            P.formatDay(
                                                event.event_date,
                                                {
                                                    day: "numeric"
                                                }
                                            )
                                        )}
                                    </strong>

                                    <span>
                                        ${P.escapeHtml(
                                            P.formatDay(
                                                event.event_date,
                                                {
                                                    weekday: "short"
                                                }
                                            )
                                        )}
                                    </span>
                                </div>

                                <div class="calendar-event__body">
                                    <div class="calendar-event__heading">
                                        <h3>
                                            ${P.escapeHtml(
                                                event.title
                                            )}
                                        </h3>

                                        <span
                                            class="calendar-event__section"
                                            data-section="${P.escapeHtml(
                                                event.section ||
                                                "club"
                                            )}"
                                        >
                                            ${P.escapeHtml(
                                                section
                                            )}
                                        </span>
                                    </div>

                                    ${
                                        meta
                                            ? `
                                                <p>
                                                    ${P.escapeHtml(
                                                        meta
                                                    )}
                                                </p>
                                            `
                                            : ""
                                    }

                                    ${
                                        event.location_type &&
                                        !event.venue
                                            ? `
                                                <p class="calendar-event__secondary">
                                                    ${P.escapeHtml(
                                                        event.location_type
                                                    )}
                                                </p>
                                            `
                                            : ""
                                    }
                                </div>
                            </article>
                        `;
                    }
                )
                .join("");
    }

    async function loadEvents() {
        if (
            !elements.club.value
        ) {
            state.events =
                [];

            renderEvents();
            return;
        }

        state.loading =
            true;

        renderEvents();

        try {
            const from =
                startOfMonth(
                    state.month
                );

            const to =
                endOfMonth(
                    state.month
                );

            const data =
                await P.rpc(
                    "member_get_calendar_events",
                    {
                        p_club_id:
                            elements.club.value,

                        p_from_date:
                            P.isoDate(
                                from
                            ),

                        p_to_date:
                            P.isoDate(
                                to
                            )
                    }
                );

            state.events =
                P.rows(data);

            P.setSelectedClubId(
                elements.club.value
            );
        } catch (error) {
            state.events =
                [];

            elements.status.textContent =
                "";

            elements.events.innerHTML = `
                <div class="notice error">
                    ${P.escapeHtml(
                        P.readableError(
                            error
                        )
                    )}
                </div>
            `;

            return;
        } finally {
            state.loading =
                false;
        }

        renderEvents();
    }

    function chooseInitialClub() {
        const savedClubId =
            P.selectedClubId();

        const savedClub =
            state.clubs.find(
                function (club) {
                    return (
                        club.club_id ===
                        savedClubId
                    );
                }
            );

        const primaryClub =
            state.clubs.find(
                function (club) {
                    return Boolean(
                        club.is_primary
                    );
                }
            );

        return (
            savedClub ||
            primaryClub ||
            state.clubs[0] ||
            null
        );
    }

    function renderClubSelector() {
        if (
            !state.clubs.length
        ) {
            elements.club.innerHTML = `
                <option value="">
                    No linked member clubs
                </option>
            `;

            elements.noMembership.hidden =
                false;

            elements.memberContent.hidden =
                true;

            return;
        }

        elements.noMembership.hidden =
            true;

        elements.memberContent.hidden =
            false;

        elements.club.innerHTML =
            state.clubs
                .map(
                    function (club) {
                        return `
                            <option
                                value="${P.escapeHtml(
                                    club.club_id
                                )}"
                            >
                                ${P.escapeHtml(
                                    club.club_name
                                )}
                            </option>
                        `;
                    }
                )
                .join("");

        const initialClub =
            chooseInitialClub();

        if (initialClub) {
            elements.club.value =
                initialClub.club_id;
        }
    }

    function bindControls() {
        elements.filters
            .addEventListener(
                "click",
                function (event) {
                    const button =
                        event.target.closest(
                            "[data-section]"
                        );

                    if (!button) {
                        return;
                    }

                    state.section =
                        button.dataset.section ||
                        "all";

                    elements.filters
                        .querySelectorAll(
                            "[data-section]"
                        )
                        .forEach(
                            function (item) {
                                item.classList.toggle(
                                    "active",
                                    item ===
                                        button
                                );
                            }
                        );

                    renderEvents();
                }
            );

        elements.club
            .addEventListener(
                "change",
                loadEvents
            );

        elements.previousMonth
            .addEventListener(
                "click",
                function () {
                    changeMonth(-1);
                }
            );

        elements.nextMonth
            .addEventListener(
                "click",
                function () {
                    changeMonth(1);
                }
            );
    }

    P.ready
        .then(
            async function (context) {
                state.clubs =
                    Array.isArray(
                        context.memberClubs
                    )
                        ? context.memberClubs
                        : [];

                bindControls();
                renderClubSelector();
                renderMonthHeading();

                if (
                    state.clubs.length
                ) {
                    await loadEvents();
                }
            }
        )
        .catch(
            function (error) {
                elements.memberContent.hidden =
                    false;

                elements.events.innerHTML = `
                    <div class="notice error">
                        ${P.escapeHtml(
                            P.readableError(
                                error
                            )
                        )}
                    </div>
                `;
            }
        );
})();
