(function () {
    "use strict";

    window.Paryx = window.Paryx || {};

    const ADMIN_ROLES = new Set([
        "manager",
        "club_admin"
    ]);

    const SECTION_LABELS = {
        club: "Club",
        mens: "Men",
        seniors: "Seniors",
        ladies: "Ladies"
    };

    const TYPE_LABELS = {
        competition: "Competition",
        roll_up: "Roll-up",
        fixture: "Fixture",
        social: "Social",
        course_event: "Course event",
        other: "Other"
    };

    const state = {
        clubId: null,
        clubName: "",
        role: "",
        currentMonth: startOfMonth(new Date()),
        sectionFilter: "all",
        events: [],
        courses: [],
        importFile: null,
        importExtraction: null,
        initialised: false
    };

    const elements = {
        clubName: document.getElementById("calendarClubName"),
        error: document.getElementById("calendarError"),
        success: document.getElementById("calendarSuccess"),
        monthTitle: document.getElementById("calendarMonthTitle"),
        eventCount: document.getElementById("calendarEventCount"),
        loadStatus: document.getElementById("calendarLoadStatus"),
        grid: document.getElementById("calendarGrid"),
        agenda: document.getElementById("calendarAgenda"),
        previousMonth: document.getElementById("previousMonthButton"),
        nextMonth: document.getElementById("nextMonthButton"),
        today: document.getElementById("todayButton"),
        filters: document.getElementById("calendarFilters"),
        addEvent: document.getElementById("addEventButton"),
        importFixture: document.getElementById("importFixtureButton"),

        eventDialog: document.getElementById("eventDialog"),
        eventForm: document.getElementById("eventForm"),
        eventDialogTitle: document.getElementById("eventDialogTitle"),
        eventDialogClose: document.getElementById("eventDialogClose"),
        eventFormError: document.getElementById("eventFormError"),
        eventId: document.getElementById("eventId"),
        eventSourceKey: document.getElementById("eventSourceKey"),
        eventSourceText: document.getElementById("eventSourceText"),
        eventSourcePage: document.getElementById("eventSourcePage"),
        eventTitle: document.getElementById("eventTitle"),
        eventDate: document.getElementById("eventDate"),
        eventSection: document.getElementById("eventSection"),
        eventStartTime: document.getElementById("eventStartTime"),
        eventEndTime: document.getElementById("eventEndTime"),
        eventTimeText: document.getElementById("eventTimeText"),
        eventType: document.getElementById("eventType"),
        eventLocationType: document.getElementById("eventLocationType"),
        eventStatus: document.getElementById("eventStatus"),
        eventVenue: document.getElementById("eventVenue"),
        eventCourseId: document.getElementById("eventCourseId"),
        eventNotes: document.getElementById("eventNotes"),
        eventQualifier: document.getElementById("eventQualifier"),
        eventPublished: document.getElementById("eventPublished"),
        eventCourseClosed: document.getElementById("eventCourseClosed"),
        closureFields: document.getElementById("courseClosureFields"),
        eventCourseClosedStart: document.getElementById("eventCourseClosedStart"),
        eventCourseClosedEnd: document.getElementById("eventCourseClosedEnd"),
        deleteEvent: document.getElementById("deleteEventButton"),
        cancelEvent: document.getElementById("cancelEventButton"),
        saveEvent: document.getElementById("saveEventButton"),

        importDialog: document.getElementById("importDialog"),
        importDialogClose: document.getElementById("importDialogClose"),
        importError: document.getElementById("importError"),
        importPicker: document.getElementById("importPicker"),
        pdfInput: document.getElementById("fixturePdfInput"),
        fileSummary: document.getElementById("fixtureFileSummary"),
        fileName: document.getElementById("fixtureFileName"),
        fileSize: document.getElementById("fixtureFileSize"),
        yearHint: document.getElementById("fixtureYearHint"),
        scanFixture: document.getElementById("scanFixtureButton"),
        importProgress: document.getElementById("importProgress"),
        importProgressTitle: document.getElementById("importProgressTitle"),
        importProgressText: document.getElementById("importProgressText"),
        importReview: document.getElementById("importReview"),
        importReviewTitle: document.getElementById("importReviewTitle"),
        importReviewMeta: document.getElementById("importReviewMeta"),
        importWarnings: document.getElementById("importWarnings"),
        importReviewBody: document.getElementById("importReviewBody"),
        importSelectedCount: document.getElementById("importSelectedCount"),
        importReviewed: document.getElementById("importReviewedEventsButton"),
        useAnotherPdf: document.getElementById("useAnotherPdfButton")
    };

    function getClient() {
        if (
            window.supabaseClient &&
            typeof window.supabaseClient.rpc === "function"
        ) {
            return window.supabaseClient;
        }

        throw new Error(
            "The Paryx data service is unavailable."
        );
    }

    function getReadableError(error) {
        if (!error) {
            return "An unknown error occurred.";
        }

        if (
            typeof error.message === "string" &&
            error.message.trim()
        ) {
            return error.message.trim();
        }

        if (
            typeof error.details === "string" &&
            error.details.trim()
        ) {
            return error.details.trim();
        }

        return String(error);
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function startOfMonth(date) {
        return new Date(
            date.getFullYear(),
            date.getMonth(),
            1
        );
    }

    function addMonths(date, amount) {
        return new Date(
            date.getFullYear(),
            date.getMonth() + amount,
            1
        );
    }

    function isoDate(date) {
        const year = date.getFullYear();
        const month = String(
            date.getMonth() + 1
        ).padStart(2, "0");
        const day = String(
            date.getDate()
        ).padStart(2, "0");

        return `${year}-${month}-${day}`;
    }

    function parseIsoDate(value) {
        const match = String(value || "")
            .match(/^(\d{4})-(\d{2})-(\d{2})$/);

        if (!match) {
            return null;
        }

        return new Date(
            Number(match[1]),
            Number(match[2]) - 1,
            Number(match[3])
        );
    }

    function monthRange(date) {
        const start = startOfMonth(date);
        const end = new Date(
            start.getFullYear(),
            start.getMonth() + 1,
            0
        );

        return {
            start: isoDate(start),
            end: isoDate(end)
        };
    }

    function gridDates(date) {
        const first = startOfMonth(date);
        const gridStart = new Date(first);
        gridStart.setDate(
            first.getDate() - first.getDay()
        );

        const dates = [];

        for (let index = 0; index < 42; index += 1) {
            const next = new Date(gridStart);
            next.setDate(
                gridStart.getDate() + index
            );
            dates.push(next);
        }

        return dates;
    }

    function formatMonth(date) {
        return new Intl.DateTimeFormat(
            "en-GB",
            {
                month: "long",
                year: "numeric"
            }
        ).format(date);
    }

    function formatAgendaDate(value) {
        const date = parseIsoDate(value);

        if (!date) {
            return value;
        }

        return new Intl.DateTimeFormat(
            "en-GB",
            {
                weekday: "long",
                day: "numeric",
                month: "long"
            }
        ).format(date);
    }

    function displayTime(event) {
        const freeText =
            String(event?.time_text || "").trim();

        if (freeText) {
            return freeText;
        }

        const start =
            String(event?.start_time || "")
                .slice(0, 5);

        const end =
            String(event?.end_time || "")
                .slice(0, 5);

        if (start && end) {
            return `${start}–${end}`;
        }

        return start || "";
    }

    function eventMeta(event) {
        const parts = [
            SECTION_LABELS[event.section] || event.section,
            TYPE_LABELS[event.event_type] || event.event_type,
            event.location_type === "home"
                ? "Home"
                : event.location_type === "away"
                    ? "Away"
                    : "",
            event.venue || ""
        ].filter(Boolean);

        return parts.join(" · ");
    }

    function showError(error) {
        console.error(
            "Paryx calendar error:",
            error
        );

        if (!elements.error) {
            return;
        }

        elements.error.textContent =
            getReadableError(error);
        elements.error.hidden = false;
    }

    function clearError() {
        if (elements.error) {
            elements.error.hidden = true;
            elements.error.textContent = "";
        }
    }

    function showSuccess(message) {
        if (!elements.success) {
            return;
        }

        elements.success.textContent = message;
        elements.success.hidden = false;

        window.setTimeout(function () {
            if (elements.success) {
                elements.success.hidden = true;
            }
        }, 5000);
    }

    function setImportError(message) {
        if (!elements.importError) {
            return;
        }

        elements.importError.textContent =
            String(message || "");
        elements.importError.hidden = !message;
    }

    function setEventFormError(message) {
        if (!elements.eventFormError) {
            return;
        }

        elements.eventFormError.textContent =
            String(message || "");
        elements.eventFormError.hidden = !message;
    }

    function filteredEvents() {
        if (state.sectionFilter === "all") {
            return state.events.slice();
        }

        return state.events.filter(function (event) {
            return event.section === state.sectionFilter;
        });
    }

    function eventsForDate(dateValue) {
        return filteredEvents()
            .filter(function (event) {
                return event.event_date === dateValue;
            })
            .sort(function (a, b) {
                return (
                    String(a.start_time || "99:99")
                        .localeCompare(
                            String(b.start_time || "99:99")
                        ) ||
                    Number(a.display_order || 1) -
                        Number(b.display_order || 1) ||
                    String(a.title || "")
                        .localeCompare(
                            String(b.title || "")
                        )
                );
            });
    }

    function eventButtonMarkup(event) {
        const time = displayTime(event);
        const cancelled =
            event.status === "cancelled";

        return `
            <button
                class="calendar-event-pill${cancelled ? " calendar-event-pill--cancelled" : ""}"
                type="button"
                data-event-id="${escapeHtml(event.event_id)}"
                data-section="${escapeHtml(event.section)}"
            >
                ${time ? `<span class="calendar-event-pill__time">${escapeHtml(time)}</span>` : ""}
                <span class="calendar-event-pill__title">${escapeHtml(event.title)}</span>
            </button>
        `;
    }

    function renderGrid() {
        if (!elements.grid) {
            return;
        }

        const today = isoDate(new Date());
        const dates = gridDates(state.currentMonth);
        const currentMonthNumber =
            state.currentMonth.getMonth();

        elements.grid.innerHTML =
            dates.map(function (date) {
                const value = isoDate(date);
                const dayEvents = eventsForDate(value);
                const shown = dayEvents.slice(0, 4);
                const remaining =
                    Math.max(dayEvents.length - shown.length, 0);

                return `
                    <div
                        class="calendar-day${date.getMonth() !== currentMonthNumber ? " calendar-day--outside" : ""}${value === today ? " calendar-day--today" : ""}"
                        data-calendar-date="${value}"
                    >
                        <button
                            type="button"
                            class="calendar-day__number"
                            data-add-date="${value}"
                            aria-label="Add event on ${value}"
                        >
                            ${date.getDate()}
                        </button>

                        <div class="calendar-day__events">
                            ${shown.map(eventButtonMarkup).join("")}
                            ${remaining > 0 ? `<span class="calendar-day__more">+${remaining} more</span>` : ""}
                        </div>
                    </div>
                `;
            }).join("");
    }

    function renderAgenda() {
        if (!elements.agenda) {
            return;
        }

        const month = monthRange(state.currentMonth);
        const events = filteredEvents()
            .filter(function (event) {
                return (
                    event.event_date >= month.start &&
                    event.event_date <= month.end
                );
            });

        if (!events.length) {
            elements.agenda.innerHTML = `
                <div class="card calendar-empty">
                    No events match this month and filter.
                </div>
            `;
            return;
        }

        const grouped = new Map();

        for (const event of events) {
            if (!grouped.has(event.event_date)) {
                grouped.set(event.event_date, []);
            }

            grouped.get(event.event_date).push(event);
        }

        elements.agenda.innerHTML =
            Array.from(grouped.entries())
                .sort(function (a, b) {
                    return a[0].localeCompare(b[0]);
                })
                .map(function ([date, dayEvents]) {
                    dayEvents.sort(function (a, b) {
                        return String(a.start_time || "99:99")
                            .localeCompare(
                                String(b.start_time || "99:99")
                            );
                    });

                    return `
                        <section class="calendar-agenda-day">
                            <h2 class="calendar-agenda-day__heading">
                                ${escapeHtml(formatAgendaDate(date))}
                            </h2>
                            ${dayEvents.map(function (event) {
                                return `
                                    <button
                                        class="calendar-agenda-event"
                                        type="button"
                                        data-event-id="${escapeHtml(event.event_id)}"
                                    >
                                        <span class="calendar-agenda-event__time">
                                            ${escapeHtml(displayTime(event) || "All day")}
                                        </span>
                                        <span>
                                            <strong>${escapeHtml(event.title)}</strong>
                                            <small>${escapeHtml(eventMeta(event))}</small>
                                        </span>
                                    </button>
                                `;
                            }).join("")}
                        </section>
                    `;
                })
                .join("");
    }

    function renderSummary() {
        const month = monthRange(state.currentMonth);
        const count = filteredEvents()
            .filter(function (event) {
                return (
                    event.event_date >= month.start &&
                    event.event_date <= month.end
                );
            }).length;

        if (elements.monthTitle) {
            elements.monthTitle.textContent =
                formatMonth(state.currentMonth);
        }

        if (elements.eventCount) {
            elements.eventCount.textContent =
                new Intl.NumberFormat("en-GB")
                    .format(count);
        }

        if (elements.loadStatus) {
            elements.loadStatus.textContent =
                state.sectionFilter === "all"
                    ? "All club sections"
                    : `${SECTION_LABELS[state.sectionFilter] || state.sectionFilter} events`;
        }
    }

    function renderCalendar() {
        renderSummary();
        renderGrid();
        renderAgenda();
    }

    async function loadCourses() {
        const client = getClient();

        const {
            data,
            error
        } = await client.rpc(
            "admin_get_courses",
            {
                p_club_id: state.clubId
            }
        );

        if (error) {
            throw error;
        }

        state.courses =
            Array.isArray(data)
                ? data
                : [];

        populateCourseSelect();
    }

    function populateCourseSelect() {
        if (!elements.eventCourseId) {
            return;
        }

        elements.eventCourseId.innerHTML = [
            '<option value="">All / not specified</option>',
            ...state.courses.map(function (course) {
                return `
                    <option value="${escapeHtml(course.course_id)}">
                        ${escapeHtml(course.course_name)}${course.is_default ? " (default)" : ""}
                    </option>
                `;
            })
        ].join("");
    }

    function defaultCourseId() {
        return (
            state.courses.find(function (course) {
                return course.is_default === true;
            })?.course_id ||
            state.courses[0]?.course_id ||
            null
        );
    }

    async function loadEvents() {
        clearError();

        const client = getClient();
        const range = monthRange(state.currentMonth);

        if (elements.loadStatus) {
            elements.loadStatus.textContent =
                "Loading calendar...";
        }

        const {
            data,
            error
        } = await client.rpc(
            "admin_get_calendar_events",
            {
                p_club_id: state.clubId,
                p_from_date: range.start,
                p_to_date: range.end
            }
        );

        if (error) {
            throw error;
        }

        state.events =
            Array.isArray(data)
                ? data
                : [];

        renderCalendar();
    }

    function resetEventForm() {
        elements.eventForm?.reset();
        setEventFormError("");

        if (elements.eventId) {
            elements.eventId.value = "";
        }
        if (elements.eventSourceKey) {
            elements.eventSourceKey.value = "";
        }
        if (elements.eventSourceText) {
            elements.eventSourceText.value = "";
        }
        if (elements.eventSourcePage) {
            elements.eventSourcePage.value = "";
        }
        if (elements.eventSection) {
            elements.eventSection.value = "club";
        }
        if (elements.eventType) {
            elements.eventType.value = "competition";
        }
        if (elements.eventStatus) {
            elements.eventStatus.value = "scheduled";
        }
        if (elements.eventPublished) {
            elements.eventPublished.checked = true;
        }
        if (elements.eventCourseClosed) {
            elements.eventCourseClosed.checked = false;
        }
        if (elements.closureFields) {
            elements.closureFields.hidden = true;
        }
        if (elements.deleteEvent) {
            elements.deleteEvent.hidden = true;
        }
        if (elements.eventCourseId) {
            elements.eventCourseId.value = "";
        }
    }

    function openNewEvent(dateValue) {
        resetEventForm();

        if (elements.eventDialogTitle) {
            elements.eventDialogTitle.textContent =
                "Add event";
        }

        if (elements.eventDate) {
            elements.eventDate.value =
                dateValue || isoDate(new Date());
        }

        elements.eventDialog?.showModal();
        elements.eventTitle?.focus();
    }

    function findEvent(eventId) {
        return state.events.find(function (event) {
            return event.event_id === eventId;
        }) || null;
    }

    function openExistingEvent(eventId) {
        const event = findEvent(eventId);

        if (!event) {
            return;
        }

        resetEventForm();

        if (elements.eventDialogTitle) {
            elements.eventDialogTitle.textContent =
                "Edit event";
        }

        elements.eventId.value = event.event_id || "";
        elements.eventSourceKey.value = event.source_key || "";
        elements.eventSourceText.value = event.source_text || "";
        elements.eventSourcePage.value = event.source_page || "";
        elements.eventTitle.value = event.title || "";
        elements.eventDate.value = event.event_date || "";
        elements.eventSection.value = event.section || "club";
        elements.eventStartTime.value = String(event.start_time || "").slice(0, 5);
        elements.eventEndTime.value = String(event.end_time || "").slice(0, 5);
        elements.eventTimeText.value = event.time_text || "";
        elements.eventType.value = event.event_type || "other";
        elements.eventLocationType.value = event.location_type || "";
        elements.eventStatus.value = event.status || "scheduled";
        elements.eventVenue.value = event.venue || "";
        elements.eventCourseId.value = event.course_id || "";
        elements.eventNotes.value = event.notes || "";
        elements.eventQualifier.checked = event.is_qualifier === true;
        elements.eventPublished.checked = event.is_published === true;
        elements.eventCourseClosed.checked = event.course_closed === true;
        elements.eventCourseClosedStart.value = String(event.course_closed_start_time || "").slice(0, 5);
        elements.eventCourseClosedEnd.value = String(event.course_closed_end_time || "").slice(0, 5);
        elements.closureFields.hidden = event.course_closed !== true;
        elements.deleteEvent.hidden = false;

        elements.eventDialog?.showModal();
    }

    function eventPayloadFromForm() {
        return {
            id: elements.eventId?.value || null,
            event_date: elements.eventDate?.value || null,
            display_order: 1,
            start_time: elements.eventStartTime?.value || null,
            end_time: elements.eventEndTime?.value || null,
            time_text: elements.eventTimeText?.value?.trim() || null,
            title: elements.eventTitle?.value?.trim() || null,
            section: elements.eventSection?.value || "club",
            event_type: elements.eventType?.value || "other",
            location_type: elements.eventLocationType?.value || null,
            venue: elements.eventVenue?.value?.trim() || null,
            notes: elements.eventNotes?.value?.trim() || null,
            is_qualifier: elements.eventQualifier?.checked === true,
            course_closed: elements.eventCourseClosed?.checked === true,
            course_closed_start_time:
                elements.eventCourseClosed?.checked === true
                    ? elements.eventCourseClosedStart?.value || null
                    : null,
            course_closed_end_time:
                elements.eventCourseClosed?.checked === true
                    ? elements.eventCourseClosedEnd?.value || null
                    : null,
            status: elements.eventStatus?.value || "scheduled",
            is_published: elements.eventPublished?.checked === true,
            course_id: elements.eventCourseId?.value || null,
            source_key: elements.eventSourceKey?.value || null,
            source_text: elements.eventSourceText?.value || null,
            source_page: elements.eventSourcePage?.value || null
        };
    }

    async function saveEvent(event) {
        event.preventDefault();
        setEventFormError("");

        const payload = eventPayloadFromForm();

        if (!payload.title || !payload.event_date) {
            setEventFormError(
                "Event title and date are required."
            );
            return;
        }

        elements.saveEvent.disabled = true;
        elements.saveEvent.textContent = "Saving...";

        try {
            const {
                error
            } = await getClient().rpc(
                "admin_save_calendar_event",
                {
                    p_club_id: state.clubId,
                    p_event: payload
                }
            );

            if (error) {
                throw error;
            }

            elements.eventDialog?.close();
            showSuccess(
                payload.id
                    ? "Event updated."
                    : "Event added."
            );
            await loadEvents();
        } catch (error) {
            setEventFormError(
                getReadableError(error)
            );
        } finally {
            elements.saveEvent.disabled = false;
            elements.saveEvent.textContent = "Save event";
        }
    }

    async function deleteEvent() {
        const eventId =
            elements.eventId?.value || "";

        if (!eventId) {
            return;
        }

        const current = findEvent(eventId);

        if (!window.confirm(
            `Delete ${current?.title || "this calendar event"}?`
        )) {
            return;
        }

        elements.deleteEvent.disabled = true;

        try {
            const {
                data,
                error
            } = await getClient().rpc(
                "admin_delete_calendar_event",
                {
                    p_club_id: state.clubId,
                    p_event_id: eventId
                }
            );

            if (error) {
                throw error;
            }

            if (data !== true) {
                throw new Error(
                    "The calendar event could not be deleted."
                );
            }

            elements.eventDialog?.close();
            showSuccess("Event deleted.");
            await loadEvents();
        } catch (error) {
            setEventFormError(
                getReadableError(error)
            );
        } finally {
            elements.deleteEvent.disabled = false;
        }
    }

    function formatBytes(bytes) {
        const value = Number(bytes || 0);

        if (value < 1024) {
            return `${value} B`;
        }

        if (value < 1024 * 1024) {
            return `${(value / 1024).toFixed(1)} KB`;
        }

        return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    }

    function resetImport() {
        state.importFile = null;
        state.importExtraction = null;
        setImportError("");

        if (elements.pdfInput) {
            elements.pdfInput.value = "";
        }
        if (elements.fileSummary) {
            elements.fileSummary.hidden = true;
        }
        if (elements.scanFixture) {
            elements.scanFixture.disabled = true;
            elements.scanFixture.textContent =
                "Scan fixture calendar";
        }
        if (elements.importPicker) {
            elements.importPicker.hidden = false;
        }
        if (elements.importProgress) {
            elements.importProgress.hidden = true;
        }
        if (elements.importReview) {
            elements.importReview.hidden = true;
        }
        if (elements.importReviewBody) {
            elements.importReviewBody.innerHTML = "";
        }
        if (elements.importWarnings) {
            elements.importWarnings.hidden = true;
            elements.importWarnings.innerHTML = "";
        }
        if (elements.yearHint) {
            elements.yearHint.value =
                String(
                    state.currentMonth.getFullYear()
                );
        }
    }

    function setImportProgress(title, text) {
        if (elements.importProgressTitle) {
            elements.importProgressTitle.textContent = title || "Scanning fixture calendar…";
        }

        if (elements.importProgressText) {
            elements.importProgressText.textContent = text || "";
        }
    }

    function openImportDialog() {
        resetImport();
        elements.importDialog?.showModal();
    }

    function handlePdfSelection() {
        setImportError("");

        const file =
            elements.pdfInput?.files?.[0] ||
            null;

        if (!file) {
            state.importFile = null;
            elements.fileSummary.hidden = true;
            elements.scanFixture.disabled = true;
            return;
        }

        if (
            file.type !== "application/pdf" &&
            !file.name.toLowerCase().endsWith(".pdf")
        ) {
            state.importFile = null;
            elements.pdfInput.value = "";
            setImportError(
                "Choose a PDF fixture calendar."
            );
            return;
        }

        if (file.size > 12 * 1024 * 1024) {
            state.importFile = null;
            elements.pdfInput.value = "";
            setImportError(
                "This PDF is too large. Use a file under 12 MB."
            );
            return;
        }

        state.importFile = file;
        elements.fileName.textContent = file.name;
        elements.fileSize.textContent = formatBytes(file.size);
        elements.fileSummary.hidden = false;
        elements.scanFixture.disabled = false;
    }

    function readFileAsDataUrl(file) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();

            reader.onload = function () {
                resolve(String(reader.result || ""));
            };

            reader.onerror = function () {
                reject(
                    new Error(
                        "Paryx could not read this PDF."
                    )
                );
            };

            reader.readAsDataURL(file);
        });
    }

    async function functionErrorMessage(error) {
        let message =
            error?.message ||
            "Fixture calendar scanning failed.";

        try {
            if (
                error?.context &&
                typeof error.context.json === "function"
            ) {
                const body =
                    await error.context.json();

                message =
                    body?.error ||
                    body?.message ||
                    message;
            }
        } catch (parseError) {
            console.warn(
                "Could not read Edge Function error response:",
                parseError
            );
        }

        return message;
    }

    function eventTimeDisplay(event) {
        if (event.time_text) {
            return event.time_text;
        }

        if (event.start_time && event.end_time) {
            return `${event.start_time} - ${event.end_time}`;
        }

        return event.start_time || "";
    }

    function normaliseImportEvents(extraction) {
        return (extraction?.events || [])
            .filter(function (event) {
                return event?.event_date && event?.title;
            })
            .map(function (event, index) {
                const isHomeGolfEvent =
                    event.location_type !== "away" &&
                    event.event_type !== "social" &&
                    event.event_type !== "other";

                return {
                    ...event,
                    selected: true,
                    time_display: eventTimeDisplay(event),
                    course_id:
                        isHomeGolfEvent || event.course_closed === true
                            ? defaultCourseId()
                            : null,
                    status: "scheduled",
                    is_published: true,
                    display_order: index + 1
                };
            });
    }

    function importSelectOptions(options, selected) {
        return options.map(function (option) {
            return `
                <option
                    value="${escapeHtml(option.value)}"
                    ${option.value === selected ? "selected" : ""}
                >
                    ${escapeHtml(option.label)}
                </option>
            `;
        }).join("");
    }

    function renderImportWarnings() {
        const warnings =
            Array.isArray(
                state.importExtraction?.warnings
            )
                ? state.importExtraction.warnings
                    .filter(Boolean)
                : [];

        if (!warnings.length) {
            elements.importWarnings.hidden = true;
            elements.importWarnings.innerHTML = "";
            return;
        }

        elements.importWarnings.hidden = false;
        elements.importWarnings.innerHTML = `
            <strong>Check these items</strong>
            <ul>
                ${warnings.map(function (warning) {
                    return `<li>${escapeHtml(warning)}</li>`;
                }).join("")}
            </ul>
        `;
    }

    function renderImportReview() {
        const extraction = state.importExtraction;
        const events = extraction?.events || [];

        if (elements.importReviewTitle) {
            elements.importReviewTitle.textContent =
                extraction?.calendar_title
                    ? `Calendar recognised: ${extraction.calendar_title}`
                    : "Fixture calendar recognised";
        }

        if (elements.importReviewMeta) {
            const year =
                extraction?.calendar_year
                    ? ` · ${extraction.calendar_year}`
                    : "";

            elements.importReviewMeta.textContent =
                `${events.length} event${events.length === 1 ? "" : "s"} found${year}. Edit anything that needs correcting before import.`;
        }

        const sectionOptions = Object.entries(SECTION_LABELS)
            .map(function ([value, label]) {
                return { value, label };
            });

        const typeOptions = Object.entries(TYPE_LABELS)
            .map(function ([value, label]) {
                return { value, label };
            });

        const locationOptions = [
            { value: "", label: "—" },
            { value: "home", label: "Home" },
            { value: "away", label: "Away" }
        ];

        elements.importReviewBody.innerHTML =
            events.map(function (event, index) {
                return `
                    <tr class="${event.warning ? "calendar-import-row--warning" : ""}" data-import-index="${index}">
                        <td>
                            <input
                                class="calendar-import-use"
                                type="checkbox"
                                data-import-field="selected"
                                ${event.selected ? "checked" : ""}
                                aria-label="Include ${escapeHtml(event.title)}"
                            />
                        </td>
                        <td>
                            <input
                                type="date"
                                data-import-field="event_date"
                                value="${escapeHtml(event.event_date)}"
                            />
                        </td>
                        <td>
                            <input
                                type="text"
                                data-import-field="time_display"
                                value="${escapeHtml(event.time_display || "")}"
                                placeholder="07:28 or Time TBC"
                            />
                        </td>
                        <td>
                            <select data-import-field="section">
                                ${importSelectOptions(sectionOptions, event.section)}
                            </select>
                        </td>
                        <td>
                            <select data-import-field="event_type">
                                ${importSelectOptions(typeOptions, event.event_type)}
                            </select>
                        </td>
                        <td>
                            <input
                                type="text"
                                data-import-field="title"
                                value="${escapeHtml(event.title)}"
                            />
                            ${event.warning ? `<span class="calendar-import-warning-text">⚠ ${escapeHtml(event.warning)}</span>` : ""}
                            ${event.course_closed ? `<span class="calendar-import-warning-text">Course closure detected${event.course_closed_start_time ? ` · ${escapeHtml(event.course_closed_start_time)}${event.course_closed_end_time ? `–${escapeHtml(event.course_closed_end_time)}` : ""}` : ""}</span>` : ""}
                        </td>
                        <td>
                            <select data-import-field="location_type">
                                ${importSelectOptions(locationOptions, event.location_type || "")}
                            </select>
                            <input
                                type="text"
                                data-import-field="venue"
                                value="${escapeHtml(event.venue || "")}"
                                placeholder="Venue"
                            />
                        </td>
                        <td>
                            ${escapeHtml(event.source_page || "—")}
                        </td>
                    </tr>
                `;
            }).join("");

        renderImportWarnings();
        updateImportSelectedCount();
    }

    function updateImportSelectedCount() {
        const events =
            state.importExtraction?.events || [];
        const count = events.filter(function (event) {
            return event.selected === true;
        }).length;

        if (elements.importSelectedCount) {
            elements.importSelectedCount.textContent =
                `${count} selected`;
        }

        if (elements.importReviewed) {
            elements.importReviewed.disabled =
                count === 0;
        }
    }

    async function invokeFixtureScanner(payload) {
        const {
            data,
            error
        } = await getClient().functions.invoke(
            "scan-fixture-calendar",
            {
                body: payload
            }
        );

        if (error) {
            throw new Error(
                await functionErrorMessage(error)
            );
        }

        return data;
    }

    async function scanFixturePage(basePayload, pageNumber) {
        let lastError = null;

        for (let attempt = 1; attempt <= 2; attempt += 1) {
            try {
                const data = await invokeFixtureScanner({
                    ...basePayload,
                    mode: "page",
                    pageNumber
                });

                if (!data?.extraction) {
                    throw new Error(
                        "Paryx did not receive fixture data from the scanner."
                    );
                }

                return data;
            } catch (error) {
                lastError = error;

                const message = getReadableError(error).toLowerCase();
                const retryable =
                    message.includes("idle timeout") ||
                    message.includes("timeout") ||
                    message.includes("timed out");

                if (!retryable || attempt >= 2) {
                    break;
                }
            }
        }

        throw new Error(
            `Page ${pageNumber}: ${getReadableError(lastError)}`
        );
    }

    async function scanFixtureCalendar() {
        const file = state.importFile;

        if (!file) {
            setImportError(
                "Choose a fixture calendar PDF first."
            );
            return;
        }

        setImportError("");
        elements.importPicker.hidden = true;
        elements.importReview.hidden = true;
        elements.importProgress.hidden = false;
        setImportProgress(
            "Preparing fixture scan…",
            "Checking the PDF before scanning each page."
        );

        try {
            const pdfDataUrl =
                await readFileAsDataUrl(file);

            const yearHint =
                Number(elements.yearHint?.value || 0);

            const basePayload = {
                clubId: state.clubId,
                fileName: file.name,
                pdfDataUrl,
                yearHint:
                    Number.isInteger(yearHint)
                        ? yearHint
                        : null
            };

            const inspection = await invokeFixtureScanner({
                ...basePayload,
                mode: "inspect"
            });

            const pageCount = Number(
                inspection?.meta?.pageCount || 0
            );

            if (
                !Number.isInteger(pageCount) ||
                pageCount < 1 ||
                pageCount > 60
            ) {
                throw new Error(
                    "Paryx could not determine a valid page count for this PDF."
                );
            }

            const pageResults = new Array(pageCount);
            let nextPage = 1;
            let completedPages = 0;
            let recognisedEvents = 0;

            setImportProgress(
                "Scanning fixture pages…",
                `0 of ${pageCount} pages scanned.`
            );

            async function worker() {
                while (true) {
                    const pageNumber = nextPage;
                    nextPage += 1;

                    if (pageNumber > pageCount) {
                        return;
                    }

                    const result =
                        await scanFixturePage(
                            basePayload,
                            pageNumber
                        );

                    pageResults[pageNumber - 1] = result;
                    completedPages += 1;
                    recognisedEvents += Array.isArray(
                        result?.extraction?.events
                    )
                        ? result.extraction.events.length
                        : 0;

                    setImportProgress(
                        "Scanning fixture pages…",
                        `${completedPages} of ${pageCount} pages scanned · ${recognisedEvents} events recognised so far.`
                    );
                }
            }

            const workerCount = Math.min(3, pageCount);

            await Promise.all(
                Array.from(
                    { length: workerCount },
                    function () {
                        return worker();
                    }
                )
            );

            setImportProgress(
                "Preparing review…",
                "Combining the recognised fixtures into one editable calendar."
            );

            const combined = {
                calendar_title: null,
                calendar_year: null,
                events: [],
                warnings: []
            };

            pageResults.forEach(function (result, pageIndex) {
                const extraction = result?.extraction || {};

                if (
                    !combined.calendar_title &&
                    extraction.calendar_title
                ) {
                    combined.calendar_title =
                        extraction.calendar_title;
                }

                if (
                    !combined.calendar_year &&
                    Number.isInteger(extraction.calendar_year)
                ) {
                    combined.calendar_year =
                        extraction.calendar_year;
                }

                if (Array.isArray(extraction.events)) {
                    combined.events.push(
                        ...extraction.events
                    );
                }

                if (Array.isArray(extraction.warnings)) {
                    extraction.warnings
                        .filter(Boolean)
                        .forEach(function (warning) {
                            combined.warnings.push(
                                `Page ${pageIndex + 1}: ${warning}`
                            );
                        });
                }
            });

            combined.events.sort(function (left, right) {
                const dateCompare = String(
                    left?.event_date || ""
                ).localeCompare(
                    String(right?.event_date || "")
                );

                if (dateCompare !== 0) {
                    return dateCompare;
                }

                const leftTime =
                    left?.start_time ||
                    left?.time_text ||
                    "99:99";
                const rightTime =
                    right?.start_time ||
                    right?.time_text ||
                    "99:99";

                const timeCompare = String(leftTime)
                    .localeCompare(String(rightTime));

                if (timeCompare !== 0) {
                    return timeCompare;
                }

                return Number(left?.source_page || 0) -
                    Number(right?.source_page || 0);
            });

            const extraction = {
                ...combined,
                events:
                    normaliseImportEvents(
                        combined
                    )
            };

            if (!extraction.events.length) {
                throw new Error(
                    "No dated fixture events were recognised in this PDF."
                );
            }

            state.importExtraction = extraction;
            elements.importProgress.hidden = true;
            elements.importReview.hidden = false;
            renderImportReview();
        } catch (error) {
            console.error(
                "Fixture calendar scan failed:",
                error
            );

            elements.importProgress.hidden = true;
            elements.importPicker.hidden = false;
            setImportError(
                getReadableError(error)
            );
        }
    }

    function applyReviewTime(event) {
        const value =
            String(event.time_display || "").trim();

        event.start_time = null;
        event.end_time = null;
        event.time_text = null;

        if (!value) {
            return;
        }

        const range = value.match(
            /^(\d{1,2}:\d{2})\s*(?:-|–|—|to)\s*(\d{1,2}:\d{2})$/i
        );

        if (range) {
            event.start_time = range[1];
            event.end_time = range[2];
            return;
        }

        if (/^\d{1,2}:\d{2}$/.test(value)) {
            event.start_time = value;
            return;
        }

        event.time_text = value;
    }

    function handleImportReviewChange(event) {
        const control =
            event.target.closest(
                "[data-import-field]"
            );

        if (!control) {
            return;
        }

        const row =
            control.closest(
                "[data-import-index]"
            );

        if (!row) {
            return;
        }

        const index = Number(
            row.dataset.importIndex
        );

        const item =
            state.importExtraction?.events?.[index];

        if (!item) {
            return;
        }

        const field =
            control.dataset.importField;

        if (field === "selected") {
            item.selected = control.checked === true;
        } else {
            item[field] = control.value;
        }

        updateImportSelectedCount();
    }

    async function importReviewedEvents() {
        const selected =
            (state.importExtraction?.events || [])
                .filter(function (event) {
                    return event.selected === true;
                });

        if (!selected.length) {
            setImportError(
                "Select at least one event to import."
            );
            return;
        }

        const payload = selected.map(function (event, index) {
            const copy = { ...event };
            applyReviewTime(copy);

            return {
                event_date: copy.event_date,
                display_order: index + 1,
                start_time: copy.start_time,
                end_time: copy.end_time,
                time_text: copy.time_text,
                title: String(copy.title || "").trim(),
                section: copy.section,
                event_type: copy.event_type,
                location_type: copy.location_type || null,
                venue: String(copy.venue || "").trim() || null,
                notes: copy.notes || null,
                is_qualifier: copy.is_qualifier === true,
                course_closed: copy.course_closed === true,
                course_closed_start_time:
                    copy.course_closed_start_time || null,
                course_closed_end_time:
                    copy.course_closed_end_time || null,
                status: "scheduled",
                is_published: true,
                course_id: copy.course_id || null,
                source_key: copy.source_key,
                source_text: copy.source_text || null,
                source_page: copy.source_page || null
            };
        });

        const invalid = payload.find(function (event) {
            return !event.event_date || !event.title;
        });

        if (invalid) {
            setImportError(
                "Every selected event needs a date and title."
            );
            return;
        }

        setImportError("");
        elements.importReviewed.disabled = true;
        elements.importReviewed.textContent = "Importing...";

        try {
            const {
                data,
                error
            } = await getClient().rpc(
                "admin_import_calendar_events",
                {
                    p_club_id: state.clubId,
                    p_events: payload
                }
            );

            if (error) {
                throw error;
            }

            const total = Number(data?.total || payload.length);
            const inserted = Number(data?.inserted || 0);
            const updated = Number(data?.updated || 0);

            elements.importDialog?.close();
            showSuccess(
                `Fixture import complete: ${total} events (${inserted} new, ${updated} updated).`
            );
            await loadEvents();
        } catch (error) {
            setImportError(
                getReadableError(error)
            );
        } finally {
            elements.importReviewed.disabled = false;
            elements.importReviewed.textContent =
                "Import selected events";
        }
    }

    function handleCalendarClick(event) {
        const edit =
            event.target.closest(
                "[data-event-id]"
            );

        if (edit) {
            openExistingEvent(
                edit.dataset.eventId
            );
            return;
        }

        const add =
            event.target.closest(
                "[data-add-date]"
            );

        if (add) {
            openNewEvent(
                add.dataset.addDate
            );
        }
    }

    function bindEvents() {
        elements.previousMonth?.addEventListener(
            "click",
            async function () {
                state.currentMonth =
                    addMonths(state.currentMonth, -1);
                try {
                    await loadEvents();
                } catch (error) {
                    showError(error);
                }
            }
        );

        elements.nextMonth?.addEventListener(
            "click",
            async function () {
                state.currentMonth =
                    addMonths(state.currentMonth, 1);
                try {
                    await loadEvents();
                } catch (error) {
                    showError(error);
                }
            }
        );

        elements.today?.addEventListener(
            "click",
            async function () {
                state.currentMonth =
                    startOfMonth(new Date());
                try {
                    await loadEvents();
                } catch (error) {
                    showError(error);
                }
            }
        );

        elements.filters?.addEventListener(
            "click",
            function (event) {
                const button =
                    event.target.closest(
                        "[data-section-filter]"
                    );

                if (!button) {
                    return;
                }

                state.sectionFilter =
                    button.dataset.sectionFilter ||
                    "all";

                elements.filters
                    .querySelectorAll(
                        "[data-section-filter]"
                    )
                    .forEach(function (item) {
                        item.classList.toggle(
                            "is-active",
                            item === button
                        );
                    });

                renderCalendar();
            }
        );

        elements.grid?.addEventListener(
            "click",
            handleCalendarClick
        );

        elements.agenda?.addEventListener(
            "click",
            handleCalendarClick
        );

        elements.addEvent?.addEventListener(
            "click",
            function () {
                const today = new Date();
                const defaultDate =
                    today.getFullYear() === state.currentMonth.getFullYear() &&
                    today.getMonth() === state.currentMonth.getMonth()
                        ? isoDate(today)
                        : isoDate(state.currentMonth);

                openNewEvent(defaultDate);
            }
        );

        elements.eventDialogClose?.addEventListener(
            "click",
            function () {
                elements.eventDialog?.close();
            }
        );

        elements.cancelEvent?.addEventListener(
            "click",
            function () {
                elements.eventDialog?.close();
            }
        );

        elements.eventCourseClosed?.addEventListener(
            "change",
            function () {
                elements.closureFields.hidden =
                    elements.eventCourseClosed.checked !== true;
            }
        );

        elements.eventForm?.addEventListener(
            "submit",
            saveEvent
        );

        elements.deleteEvent?.addEventListener(
            "click",
            deleteEvent
        );

        elements.importFixture?.addEventListener(
            "click",
            openImportDialog
        );

        elements.importDialogClose?.addEventListener(
            "click",
            function () {
                elements.importDialog?.close();
            }
        );

        elements.pdfInput?.addEventListener(
            "change",
            handlePdfSelection
        );

        elements.scanFixture?.addEventListener(
            "click",
            scanFixtureCalendar
        );

        elements.useAnotherPdf?.addEventListener(
            "click",
            resetImport
        );

        elements.importReviewBody?.addEventListener(
            "change",
            handleImportReviewChange
        );

        elements.importReviewBody?.addEventListener(
            "input",
            handleImportReviewChange
        );

        elements.importReviewed?.addEventListener(
            "click",
            importReviewedEvents
        );
    }

    async function initialiseCalendarPage() {
        if (state.initialised) {
            return;
        }

        state.initialised = true;
        bindEvents();

        try {
            if (!window.Paryx.ready) {
                throw new Error(
                    "Paryx has not finished initialising."
                );
            }

            await window.Paryx.ready;

            if (!window.Paryx.clubContext) {
                throw new Error(
                    "Paryx club context is unavailable."
                );
            }

            const context =
                await window.Paryx.clubContext.ready;

            const activeClub =
                context?.activeClub ||
                window.Paryx.clubContext.getActiveClub();

            if (
                !activeClub?.id ||
                !ADMIN_ROLES.has(activeClub.role)
            ) {
                window.location.replace(
                    "login.html?reason=access"
                );
                return;
            }

            state.clubId = activeClub.id;
            state.clubName = activeClub.name || "Your club";
            state.role = activeClub.role;

            if (elements.clubName) {
                elements.clubName.textContent =
                    state.clubName;
            }

            await loadCourses();
            await loadEvents();
        } catch (error) {
            showError(error);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initialiseCalendarPage,
            { once: true }
        );
    } else {
        initialiseCalendarPage();
    }
})();
