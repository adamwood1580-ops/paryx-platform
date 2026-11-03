(function () {
    "use strict";

    window.Paryx = window.Paryx || {};

    const OPERATOR_ROLES = new Set([
        "starter",
        "reception",
        "professional",
        "greenkeeper",
        "manager",
        "club_admin"
    ]);

    const BOOKING_ROLES = new Set([
        "starter",
        "reception",
        "professional",
        "manager",
        "club_admin"
    ]);

    const ADMIN_ROLES = new Set([
        "manager",
        "club_admin"
    ]);

    const STATUS_LABELS = {
        open: "Open",
        reserved: "Reserved",
        blocked: "Blocked",
        maintenance: "Maintenance",
        competition: "Competition",
        closed: "Closed"
    };

    const SECTION_LABELS = {
        club: "Club",
        mens: "Men",
        seniors: "Seniors",
        ladies: "Ladies"
    };

    const state = {
        clubId: null,
        clubName: "",
        role: "",
        courses: [],
        courseId: null,
        playDate: todayIso(),
        schedules: [],
        teeTimes: [],
        weekRows: {},
        weekDates: [],
        weekRequest: 0,
        hotelModeEnabled: false,
        hotelByDate: {},
        resortHoldsByDate: {},
        resortCaps: null,
        hotelOverlayWarning: "",
        events: [],
        teeSheetSearch: "",
        teeSheetFilter: "all",
        booking: {
            mode: "create",
            maxPlayers: 4,
            members: [],
            guests: [],
            searchResults: [],
            searchTimer: null,
            playDate: null,
            checkedInAt: null,
            bookingSource: null
        },
        initialised: false
    };

    const elements = {
        clubName: document.getElementById("teeSheetClubName"),
        error: document.getElementById("teeSheetError"),
        success: document.getElementById("teeSheetSuccess"),
        courseSelect: document.getElementById("teeSheetCourseSelect"),
        courseField: document.getElementById("teeSheetCourseField"),
        date: document.getElementById("teeSheetDate"),
        previousDay: document.getElementById("previousDayButton"),
        nextDay: document.getElementById("nextDayButton"),
        today: document.getElementById("todayTeeSheetButton"),
        generate: document.getElementById("generateTeeSheetButton"),
        manageSchedules: document.getElementById("manageSchedulesButton"),
        teeSheetSearch: document.getElementById("teeSheetSearch"),
        teeSheetFilter: document.getElementById("teeSheetFilter"),
        totalCount: document.getElementById("teeSheetTotalCount"),
        openCount: document.getElementById("teeSheetOpenCount"),
        bookedCount: document.getElementById("teeSheetBookedCount"),
        playerCount: document.getElementById("teeSheetPlayerCount"),
        unavailableCount: document.getElementById("teeSheetUnavailableCount"),
        dayTitle: document.getElementById("teeSheetDayTitle"),
        loadStatus: document.getElementById("teeSheetLoadStatus"),
        empty: document.getElementById("teeSheetEmpty"),
        rows: document.getElementById("teeSheetRows"),
        hotelBanner: document.getElementById("hotelModeTeeSheetBanner"),
        hotelCount: document.getElementById("hotelModeTeeSheetCount"),
        hotelWarning: document.getElementById("hotelModeOverlayWarning"),
        resortBookingLink: document.getElementById("resortBookingLink"),
        earlierTimes: document.getElementById("earlierTeeTimesButton"),
        eventsEmpty: document.getElementById("teeSheetEventsEmpty"),
        events: document.getElementById("teeSheetEvents"),

        scheduleDialog: document.getElementById("scheduleDialog"),
        scheduleForm: document.getElementById("scheduleForm"),
        scheduleDialogTitle: document.getElementById("scheduleDialogTitle"),
        scheduleDialogError: document.getElementById("scheduleDialogError"),
        closeScheduleDialog: document.getElementById("closeScheduleDialogButton"),
        newSchedule: document.getElementById("newScheduleButton"),
        scheduleList: document.getElementById("scheduleList"),
        scheduleId: document.getElementById("scheduleId"),
        scheduleName: document.getElementById("scheduleName"),
        scheduleFirstTime: document.getElementById("scheduleFirstTime"),
        scheduleLastTime: document.getElementById("scheduleLastTime"),
        scheduleInterval: document.getElementById("scheduleInterval"),
        scheduleMaxPlayers: document.getElementById("scheduleMaxPlayers"),
        scheduleFrom: document.getElementById("scheduleFrom"),
        scheduleTo: document.getElementById("scheduleTo"),
        scheduleMonday: document.getElementById("scheduleMonday"),
        scheduleTuesday: document.getElementById("scheduleTuesday"),
        scheduleWednesday: document.getElementById("scheduleWednesday"),
        scheduleThursday: document.getElementById("scheduleThursday"),
        scheduleFriday: document.getElementById("scheduleFriday"),
        scheduleSaturday: document.getElementById("scheduleSaturday"),
        scheduleSunday: document.getElementById("scheduleSunday"),
        scheduleActive: document.getElementById("scheduleActive"),
        deleteSchedule: document.getElementById("deleteScheduleButton"),
        saveSchedule: document.getElementById("saveScheduleButton"),

        bookingDialog: document.getElementById("bookingDialog"),
        bookingForm: document.getElementById("bookingForm"),
        bookingDialogEyebrow: document.getElementById("bookingDialogEyebrow"),
        bookingDialogTitle: document.getElementById("bookingDialogTitle"),
        bookingDialogSubtitle: document.getElementById("bookingDialogSubtitle"),
        bookingDialogError: document.getElementById("bookingDialogError"),
        bookingId: document.getElementById("bookingId"),
        bookingTeeTimeId: document.getElementById("bookingTeeTimeId"),
        bookingCapacity: document.getElementById("bookingCapacity"),
        bookingSelectedPlayers: document.getElementById("bookingSelectedPlayers"),
        bookingMemberSearch: document.getElementById("bookingMemberSearch"),
        bookingMemberResults: document.getElementById("bookingMemberResults"),
        bookingGuestName: document.getElementById("bookingGuestName"),
        addBookingGuest: document.getElementById("addBookingGuestButton"),
        bookingType: document.getElementById("bookingType"),
        bookingBuggies: document.getElementById("bookingBuggies"),
        bookingContactNumber: document.getElementById("bookingContactNumber"),
        bookingNotes: document.getElementById("bookingNotes"),
        bookingOperationalStatus: document.getElementById("bookingOperationalStatus"),
        checkInBooking: document.getElementById("checkInBookingButton"),
        closeBookingDialog: document.getElementById("closeBookingDialogButton"),
        saveBooking: document.getElementById("saveBookingButton"),
        cancelBooking: document.getElementById("cancelBookingButton"),
        moveBooking: document.getElementById("moveBookingButton"),
        moveBookingPanel: document.getElementById("moveBookingPanel"),
        moveBookingDate: document.getElementById("moveBookingDate"),
        moveBookingTeeTime: document.getElementById("moveBookingTeeTime"),
        confirmMoveBooking: document.getElementById("confirmMoveBookingButton"),
        cancelMoveBooking: document.getElementById("cancelMoveBookingButton"),

        statusDialog: document.getElementById("statusDialog"),
        statusForm: document.getElementById("statusForm"),
        statusDialogTitle: document.getElementById("statusDialogTitle"),
        statusDialogError: document.getElementById("statusDialogError"),
        statusTeeTimeId: document.getElementById("statusTeeTimeId"),
        statusValue: document.getElementById("statusValue"),
        statusNotes: document.getElementById("statusNotes"),
        closeStatusDialog: document.getElementById("closeStatusDialogButton")
    };

    function getClient() {
        if (
            window.supabaseClient &&
            typeof window.supabaseClient.rpc === "function"
        ) {
            return window.supabaseClient;
        }

        throw new Error("The Paryx data service is unavailable.");
    }

    function readableError(error) {
        if (!error) {
            return "An unknown error occurred.";
        }

        return String(
            error.message ||
            error.details ||
            error.hint ||
            error
        ).trim();
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }



    function parseBookingNotes(value) {
        const raw = String(value || "");
        const match = raw.match(/\[\[BUGGIES:(\d+)\]\]/i);
        const buggyCount = match ? Math.max(0, Number(match[1] || 0)) : 0;
        const cleanNotes = raw.replace(/\[\[BUGGIES:\d+\]\]\s*/ig, "").trim();
        return { buggyCount, cleanNotes };
    }

    function buildBookingNotes(notes, buggyCount) {
        const parts = [];
        const count = Math.max(0, Number(buggyCount || 0));
        if (count > 0) {
            parts.push(`[[BUGGIES:${count}]]`);
        }
        const text = String(notes || "").trim();
        if (text) {
            parts.push(text);
        }
        return parts.join("\n");
    }

    function bookingMetaFromRow(row) {
        return parseBookingNotes(row.booking_notes || row.notes || "");
    }

    function clearMessages() {
        hide(elements.error);
        hide(elements.success);
    }

    function showError(error, target) {
        const element = target || elements.error;
        if (!element) {
            return;
        }
        element.textContent = readableError(error);
        element.hidden = false;
    }

    function showSuccess(message) {
        if (!elements.success) {
            return;
        }
        elements.success.textContent = message;
        elements.success.hidden = false;
        window.setTimeout(function () {
            elements.success.hidden = true;
        }, 4200);
    }

    function hide(element) {
        if (element) {
            element.hidden = true;
        }
    }

    function todayIso() {
        const now = new Date();
        return isoDate(now);
    }

    function isoDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    function parseIsoDate(value) {
        const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) {
            return null;
        }
        return new Date(
            Number(match[1]),
            Number(match[2]) - 1,
            Number(match[3])
        );
    }

    function shiftDate(value, days) {
        const date = parseIsoDate(value) || new Date();
        date.setDate(date.getDate() + days);
        return isoDate(date);
    }

    function formatDayTitle(value) {
        const date = parseIsoDate(value);
        if (!date) {
            return value;
        }
        return new Intl.DateTimeFormat("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric"
        }).format(date);
    }

    function shortTime(value) {
        return String(value || "").slice(0, 5);
    }

    function minutesFromTime(value) {
        const parts =
            String(
                value || ""
            )
                .slice(0, 5)
                .split(":")
                .map(Number);

        if (
            parts.length < 2 ||
            !Number.isFinite(parts[0]) ||
            !Number.isFinite(parts[1])
        ) {
            return null;
        }

        return (
            parts[0] * 60 +
            parts[1]
        );
    }

    function isPastTeeTime(
        row,
        playDate = state.playDate
    ) {
        if (!row || !playDate) {
            return false;
        }

        const today =
            todayIso();

        if (playDate < today) {
            return true;
        }

        if (playDate > today) {
            return false;
        }

        const teeMinutes =
            minutesFromTime(
                row.start_time
            );

        if (teeMinutes === null) {
            return false;
        }

        const now =
            new Date();

        const currentMinutes =
            now.getHours() * 60 +
            now.getMinutes();

        return teeMinutes <
            currentMinutes;
    }

    function formatCheckInTime(value) {
        if (!value) {
            return "";
        }

        const date =
            new Date(value);

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {
            return "";
        }

        return new Intl.DateTimeFormat(
            "en-GB",
            {
                hour: "2-digit",
                minute: "2-digit"
            }
        ).format(date);
    }

    function normaliseRows(data) {
        return Array.isArray(data) ? data : [];
    }

    async function rpc(name, args) {
        const result = await getClient().rpc(name, args || {});
        if (result.error) {
            throw result.error;
        }
        return result.data;
    }

    async function loadCourses() {
        const rows = normaliseRows(
            await rpc("staff_get_booking_courses", {
                p_club_id: state.clubId
            })
        );

        state.courses = rows;

        let courseMode = null;
        try {
            const modeRows = normaliseRows(await rpc("get_club_course_mode", { p_club_id: state.clubId }));
            courseMode = modeRows[0] || null;
        } catch (error) {
            console.warn("Course mode unavailable; using normal selector.", error);
        }

        elements.courseSelect.innerHTML = rows
            .map(function (course) {
                return `
                    <option value="${escapeHtml(course.course_id)}">
                        ${escapeHtml(course.course_name)}
                    </option>
                `;
            })
            .join("");

        const preferred =
            rows.find(function (course) {
                return course.course_id === courseMode?.default_course_id;
            }) || rows.find(function (course) {
                return course.is_default === true;
            }) || rows[0] || null;

        state.courseId = preferred?.course_id || null;
        elements.courseSelect.value = state.courseId || "";
        if (elements.courseField) {
            elements.courseField.hidden = courseMode?.single_course_mode === true && rows.length === 1;
        }
    }

    async function loadSchedules() {
        if (!state.courseId) {
            state.schedules = [];
            renderScheduleList();
            return;
        }

        state.schedules = normaliseRows(
            await rpc("staff_get_booking_schedules", {
                p_club_id: state.clubId,
                p_course_id: state.courseId
            })
        );

        renderScheduleList();
    }

    // Load hotel priority and provisional holds from the SAME functions the
    // earlier daily Tee Sheet used. Booking rules remain enforced by Supabase.
    // Every weekday is fetched independently so its labels cannot leak into
    // another date while navigating the weekly timetable.
    async function loadTeeSheet() {
        if (!state.courseId || !state.playDate) {
            ++state.weekRequest;
            state.teeTimes = [];
            state.weekRows = {};
            state.weekDates = [];
            state.hotelModeEnabled = false;
            state.hotelByDate = {};
            state.resortHoldsByDate = {};
            state.resortCaps = null;
            state.hotelOverlayWarning = "";
            renderTeeSheet();
            return;
        }

        const requestId = ++state.weekRequest;
        const courseId = state.courseId;
        const dates = weekDatesFor(state.playDate);
        const baseArgs = {p_club_id: state.clubId, p_course_id: courseId};

        // Always load the actual tee times first. Optional overlay failures
        // should not render stale hotel labels or break the entire page.
        const [results, capsResult] = await Promise.all([
            Promise.all(dates.map(function (date) {
                return rpc("staff_get_tee_sheet", {...baseArgs, p_play_date: date});
            })),
            rpc("resort_staff_context", {p_club_id: state.clubId})
                .then(function (caps) { return {caps}; })
                .catch(function (error) {
                    console.warn("Hotel Mode context unavailable", error);
                    return {error};
                })
        ]);

        const caps = capsResult.caps && typeof capsResult.caps === "object"
            ? capsResult.caps : null;
        const enabled = caps?.enabled === true;
        let overlayWarning = capsResult.error
            ? "Hotel allocation information could not be verified. Booking eligibility is still checked by the server."
            : "";
        const hotelByDate = {};
        const resortHoldsByDate = {};

        if (enabled) {
            // Each day has its own independent result. Do not display an old
            // release status or hold as if it applied to a new week.
            await Promise.all(dates.map(async function (date) {
                const args = {...baseArgs, p_play_date: date};
                const [hotelResult, holdsResult] = await Promise.allSettled([
                    rpc("staff_get_hotel_mode_tee_sheet", args),
                    rpc("resort_staff_overlay", args)
                ]);
                if (hotelResult.status === "fulfilled") {
                    const hotel = hotelResult.value;
                    const slots = new Map();
                    (Array.isArray(hotel?.slots) ? hotel.slots : []).forEach(function (slot) {
                        if (slot?.tee_time_id) slots.set(String(slot.tee_time_id), slot);
                    });
                    hotelByDate[date] = {
                        enabled: hotel?.enabled === true,
                        canManageHotel: hotel?.can_manage_hotel === true,
                        slots,
                        failed: hotel?.enabled !== true
                    };
                    if (hotel?.enabled !== true) {
                        overlayWarning = "Some hotel allocations could not be verified. Booking eligibility is still checked by the server.";
                    }
                } else {
                    hotelByDate[date] = {enabled: false, canManageHotel: false, slots: new Map(), failed: true};
                    overlayWarning = "Some hotel allocations could not be displayed. Booking eligibility is still checked by the server.";
                    console.warn("Hotel allocation loading failed for", date, hotelResult.reason);
                }

                if (holdsResult.status === "fulfilled") {
                    const holds = new Map();
                    (Array.isArray(holdsResult.value) ? holdsResult.value : []).forEach(function (hold) {
                        if (hold?.tee_time_id) holds.set(String(hold.tee_time_id), hold);
                    });
                    resortHoldsByDate[date] = holds;
                } else {
                    // Null marks an unverified day. Do not enable ordinary
                    // booking actions where society holds might be missing.
                    resortHoldsByDate[date] = null;
                    overlayWarning = "Some provisional society holds could not be displayed. Booking eligibility is still checked by the server.";
                    console.warn("Society hold loading failed for", date, holdsResult.reason);
                }
            }));
        }

        // Prevent older RPC responses replacing newer week/course navigation.
        if (requestId !== state.weekRequest || state.courseId !== courseId) return;

        state.weekDates = dates;
        state.weekRows = Object.fromEntries(dates.map(function (date, index) {
            return [date, normaliseRows(results[index])];
        }));
        state.teeTimes = state.weekRows[state.playDate] || [];
        state.hotelModeEnabled = enabled;
        state.hotelByDate = hotelByDate;
        state.resortHoldsByDate = resortHoldsByDate;
        state.resortCaps = caps;
        state.hotelOverlayWarning = overlayWarning;
        renderTeeSheet();
    }

    async function loadEvents() {
        if (!state.playDate) {
            state.events = [];
            renderEvents();
            return;
        }

        state.events = normaliseRows(
            await rpc("staff_get_booking_events", {
                p_club_id: state.clubId,
                p_play_date: state.playDate
            })
        );

        renderEvents();
    }

    async function loadDay() {
        clearMessages();
        elements.loadStatus.textContent = "Loading…";
        elements.dayTitle.textContent = "Tee Sheet";
        elements.date.value = state.playDate;

        try {
            await Promise.all([
                loadSchedules(),
                loadTeeSheet(),
                loadEvents()
            ]);
            elements.loadStatus.textContent = "Ready";
        } catch (error) {
            elements.loadStatus.textContent = "Could not load";
            showError(error);
        }
    }

    function currentWeekStart() {
        const base = new Date(`${state.playDate}T12:00:00`);
        const mondayOffset = (base.getDay() + 6) % 7;
        return shiftDate(state.playDate, -mondayOffset);
    }

    function weekDatesFor(date) {
        const base = new Date(`${date}T12:00:00`);
        const mondayOffset = (base.getDay() + 6) % 7;
        const start = shiftDate(date, -mondayOffset);
        return Array.from({ length: 7 }, function (_, index) {
            return shiftDate(start, index);
        });
    }

    function formatWeekDate(date) {
        return new Intl.DateTimeFormat("en-GB", {
            day: "numeric", month: "short", year: "numeric"
        }).format(new Date(`${date}T12:00:00`));
    }

    function formatWeekday(date) {
        return new Intl.DateTimeFormat("en-GB", {
            weekday: "short"
        }).format(new Date(`${date}T12:00:00`));
    }

    function formatWeekHeading() {
        if (!state.weekDates.length) {
            return "Tee Sheet";
        }
        return `Tee Sheet · ${formatWeekDate(state.weekDates[0])} – ${formatWeekDate(state.weekDates[6])}`;
    }

    function selectWeekDate(date) {
        if (!state.weekDates.includes(date)) {
            return;
        }
        state.playDate = date;
        state.teeTimes = state.weekRows[date] || [];
        elements.date.value = date;
        renderSummary();
        renderTeeSheet();
        loadEvents().catch(showError);
    }

    function renderSummary() {
        const total = state.teeTimes.length;
        const booked = state.teeTimes.filter(function (row) {
            return Boolean(row.booking_id);
        }).length;
        const open = state.teeTimes.filter(function (row) {
            return row.operational_status === "open" && !row.booking_id;
        }).length;
        const buggyCount = state.teeTimes.reduce(function (totalBuggies, row) {
            if (!row.booking_id) {
                return totalBuggies;
            }
            return totalBuggies + bookingMetaFromRow(row).buggyCount;
        }, 0);

        const players = state.teeTimes.reduce(function (totalPlayers, row) {
            if (!row.booking_id) {
                return totalPlayers;
            }

            return totalPlayers + Number(row.player_count || 0);
        }, 0);

        elements.totalCount.textContent = String(total);
        elements.openCount.textContent = String(open);
        elements.bookedCount.textContent = String(booked);
        elements.playerCount.textContent = String(players);
        elements.unavailableCount.textContent = String(buggyCount);
        const selectedDateLabel = document.getElementById("teeSheetSelectedDateLabel");
        if (selectedDateLabel) {
            selectedDateLabel.textContent = formatWeekday(state.playDate) + " " + state.playDate.slice(8);
        }

    }

    function rowStatus(row) {
        if (row.booking_id) {
            return "booked";
        }
        return row.operational_status || "open";
    }

    function bookingNames(row) {
        const names = Array.isArray(row.player_names)
            ? row.player_names.filter(Boolean)
            : [];

        if (names.length) {
            return names.join(", ");
        }

        return row.lead_name || "Booked";
    }

    function findCurrentOrNextTeeTime() {
        if (state.playDate !== todayIso()) {
            return null;
        }

        return (
            state.teeTimes.find(function (row) {
                return !isPastTeeTime(row);
            }) ||
            state.teeTimes[state.teeTimes.length - 1] ||
            null
        );
    }

    function updateEarlierTimesButton() {
        const hasEarlier =
            state.playDate === todayIso() &&
            state.teeTimes.some(function (row) {
                return isPastTeeTime(row);
            });

        elements.earlierTimes.hidden =
            !hasEarlier;
    }

    function focusCurrentTeeTime() {
        updateEarlierTimesButton();

        if (
            !state.teeTimes.length ||
            state.playDate !== todayIso()
        ) {
            elements.rows.scrollTop = 0;
            return;
        }

        const anchorRow =
            findCurrentOrNextTeeTime();

        if (!anchorRow) {
            return;
        }

        window.requestAnimationFrame(function () {
            const element =
                elements.rows.querySelector(
                    `[data-tee-time-id="${CSS.escape(
                        String(anchorRow.tee_time_id)
                    )}"]`
                );

            if (!element) {
                return;
            }

            elements.rows.scrollTop =
                Math.max(
                    0,
                    element.offsetTop - 8
                );
        });
    }

    function showEarlierTeeTimes() {
        elements.rows.scrollTo({
            top: 0,
            behavior: "smooth"
        });
    }


    function teeSheetMatchesFilter(row, date = state.playDate) {
        const filter = state.teeSheetFilter || "all";
        const meta = bookingMetaFromRow(row);
        const hold = societyHoldFor(row, date);
        const priority = hotelPriorityFor(row, date);
        const protectedHotel = priority?.allocation === "hotel" && !priority.released &&
            !state.hotelByDate[date]?.canManageHotel;
        const unverified = state.hotelModeEnabled &&
            (state.hotelByDate[date]?.failed || !state.resortHoldsByDate[date]);

        if (filter === "booked") return Boolean(row.booking_id);
        if (filter === "open") {
            return row.operational_status === "open" && !row.booking_id &&
                !hold && !protectedHotel && !unverified;
        }
        if (filter === "buggy") return Boolean(row.booking_id) && meta.buggyCount > 0;
        if (filter === "unavailable") {
            return !row.booking_id && (row.operational_status !== "open" ||
                Boolean(hold) || protectedHotel || unverified);
        }
        return true;
    }

    function teeSheetMatchesSearch(row) {
        const query = String(state.teeSheetSearch || "").trim().toLowerCase();
        if (!query) {
            return true;
        }

        const meta = bookingMetaFromRow(row);
        const haystack = [
            shortTime(row.start_time),
            bookingNames(row),
            row.contact_number,
            row.lead_name,
            row.event_title,
            row.booking_type,
            meta.cleanNotes,
            String(row.player_count || "")
        ].join(" ").toLowerCase();

        return haystack.includes(query);
    }

    function visibleTeeTimes() {
        return state.teeTimes.filter(function (row) {
            return teeSheetMatchesFilter(row) && teeSheetMatchesSearch(row);
        });
    }

    function hotelPriorityFor(row, date) {
        const day = state.hotelByDate[date];
        return day?.enabled ? day.slots.get(String(row.tee_time_id)) || null : null;
    }

    function societyHoldFor(row, date) {
        return state.resortHoldsByDate[date]?.get(String(row.tee_time_id)) || null;
    }

    function formatHotelRelease(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "";
        const parts = value.split("-");
        return new Intl.DateTimeFormat("en-GB", {day: "numeric", month: "short"})
            .format(new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
    }

    function hotelPriorityChip(priority) {
        if (!priority || !["hotel", "member"].includes(priority.allocation)) return "";
        const kind = priority.allocation;
        const label = kind === "hotel" ? "Hotel" : "Members";
        const release = priority.released ? " · Released" :
            priority.release_on ? " · Releases " + formatHotelRelease(priority.release_on) : "";
        return `<span class="tee-week-priority tee-week-priority--${kind}${priority.released ? " tee-week-priority--released" : ""}" title="${escapeHtml(label + " priority" + release)}">${escapeHtml(label + (priority.released ? " · Released" : ""))}</span>`;
    }

    function renderHotelSummary() {
        if (elements.hotelBanner) {
            elements.hotelBanner.hidden = !state.hotelModeEnabled;
        }
        if (elements.resortBookingLink) {
            elements.resortBookingLink.hidden = !(
                state.hotelModeEnabled && (state.resortCaps?.can_hotel || state.resortCaps?.can_society)
            );
        }
        if (elements.hotelWarning) {
            elements.hotelWarning.hidden = !state.hotelOverlayWarning;
            elements.hotelWarning.textContent = state.hotelOverlayWarning;
        }
        if (!state.hotelModeEnabled || !elements.hotelCount) return;
        let hotel = 0, member = 0, general = 0, held = 0;
        state.weekDates.forEach(function (date) {
            const day = state.hotelByDate[date];
            if (day?.enabled) {
                for (const slot of day.slots.values()) {
                    if (slot.allocation === "hotel") hotel++;
                    else if (slot.allocation === "member") member++;
                    else general++;
                }
            }
            held += state.resortHoldsByDate[date]?.size || 0;
        });
        elements.hotelCount.textContent = `${hotel} hotel priority · ${member} member priority · ${general} general${held ? ` · ${held} society hold${held === 1 ? "" : "s"}` : ""} (this week)`;
    }

    function renderTeeSheet() {
        renderSummary();
        renderHotelSummary();
        elements.dayTitle.textContent = formatWeekHeading();
        const dates = state.weekDates;
        if (!dates.length) {
            elements.rows.innerHTML = "";
            elements.empty.hidden = false;
            elements.earlierTimes.hidden = true;
            return;
        }

        // All unique start times within the week. The underlying RPC remains the source
        // of truth for each individual slot, including course closures and Hotel Mode.
        const times = Array.from(new Set(dates.flatMap(function (date) {
            return (state.weekRows[date] || []).map(function (r) {
                return shortTime(r.start_time);
            });
        }))).sort();
        if (!times.length) {
            elements.rows.innerHTML = "";
            elements.empty.hidden = false;
            elements.earlierTimes.hidden = true;
            return;
        }

        const rowMaps = Object.fromEntries(dates.map(function (date) {
            return [date, new Map((state.weekRows[date] || []).map(function (r) {
                return [shortTime(r.start_time), r];
            }))];
        }));

        const cols = dates.map(function (date) {
            const isToday = date === todayIso();
            const selected = date === state.playDate;
            return `<th scope="col" class="tee-week-day${isToday ? " tee-week-day--today" : ""}${selected ? " tee-week-day--selected" : ""}">
                <button type="button" data-select-week-date="${escapeHtml(date)}" aria-pressed="${selected ? "true" : "false"}">
                    <span>${escapeHtml(formatWeekday(date))}</span><strong>${escapeHtml(date.slice(8))}</strong>
                </button>
            </th>`;
        }).join("");

        let visibleCount = 0;
        const body = times.map(function (time) {
            const cells = dates.map(function (date) {
                const row = rowMaps[date].get(time);
                if (!row) {
                    return `<td class="tee-week-blank"><span aria-label="No tee time">—</span></td>`;
                }

                const status = rowStatus(row);
                const past = isPastTeeTime(row, date);
                const notesMeta = bookingMetaFromRow(row);
                const priority = hotelPriorityFor(row, date);
                const hold = societyHoldFor(row, date);
                const dayHotel = state.hotelByDate[date];
                const hotelLocked = Boolean(priority?.allocation === "hotel" &&
                    !priority.released && !dayHotel?.canManageHotel);
                const unverified = Boolean(state.hotelModeEnabled && (dayHotel?.failed ||
                    !state.resortHoldsByDate[date]));
                const matches = teeSheetMatchesFilter(row, date) && teeSheetMatchesSearch(row);
                if (!matches) {
                    return `<td class="tee-week-blank"><span aria-label="Filtered out">·</span></td>`;
                }
                visibleCount += 1;
                const name = hold ? "Society hold" : row.booking_id ? bookingNames(row) :
                    (row.operational_status === "open" ? "Available" :
                    (row.tee_time_notes || STATUS_LABELS[row.operational_status] || "Unavailable"));
                const action = hold ? ""
                    : row.booking_id ? (BOOKING_ROLES.has(state.role) ? "manage-booking" : "availability")
                    : past ? ""
                    : (hotelLocked || unverified) ? "availability"
                    : (row.operational_status === "open" && BOOKING_ROLES.has(state.role) ? "book" : "availability");
                const bookedDetail = `${escapeHtml(String(row.player_count || 0))}/${escapeHtml(String(row.max_players || 4))} players${notesMeta.buggyCount > 0 ? ` · Buggy ×${escapeHtml(String(notesMeta.buggyCount))}` : ""}${row.staff_checked_in_at ? " · Checked in" : ""}`;
                const holdExpiry = hold?.hold_expires_at && !Number.isNaN(Date.parse(hold.hold_expires_at))
                    ? new Date(hold.hold_expires_at).toLocaleString("en-GB") : "";
                const detail = hold
                    ? `<span class="tee-week-slot__meta">Provisional${holdExpiry ? " · Until " + escapeHtml(holdExpiry) : ""}</span>`
                    : row.booking_id ? `<span class="tee-week-slot__meta">${bookedDetail}</span>`
                    : hotelLocked ? `<span class="tee-week-slot__meta">Hotel access required</span>`
                    : unverified ? `<span class="tee-week-slot__meta">Allocation unverified</span>`
                    : (past ? `<span class="tee-week-slot__meta">Past</span>` : "");
                const priorityLabel = priority?.allocation === "hotel" ? "Hotel priority" :
                    priority?.allocation === "member" ? "Member priority" : "";
                const label = `${date} ${time} ${name}${priorityLabel ? ", " + priorityLabel : ""}${notesMeta.buggyCount ? `, ${notesMeta.buggyCount} buggies` : ""}`;
                const classes = `tee-week-slot tee-week-slot--${escapeHtml(hold ? "society-hold" : status)}${past ? " tee-week-slot--past" : ""}`;
                const content = `<span class="tee-week-slot__name">${escapeHtml(name)}</span>${detail}${hotelPriorityChip(priority)}`;
                if (!action) {
                    return `<td><span class="${classes} tee-week-slot--disabled" title="${escapeHtml(label)}">${content}</span></td>`;
                }
                return `<td><button type="button" class="${classes}" data-action="${action}" data-tee-time-id="${escapeHtml(row.tee_time_id)}" data-play-date="${escapeHtml(date)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${content}</button></td>`;
            }).join("");
            return `<tr><th scope="row" class="tee-week-time">${escapeHtml(time)}</th>${cells}</tr>`;
        }).join("");

        elements.empty.hidden = visibleCount > 0;
        if (!visibleCount) {
            elements.empty.innerHTML = "<strong>No matching tee times.</strong><p>Clear the search or choose another filter.</p>";
        }
        elements.rows.innerHTML = `<table class="tee-week-grid">
            <thead><tr><th class="tee-week-time tee-week-time--heading" scope="col">Time</th>${cols}</tr></thead>
            <tbody>${body}</tbody>
        </table>`;

        // Keep the same earlier-times affordance, but don't auto-scroll away
        // from the week heading or the user's chosen date when filtering.
        elements.earlierTimes.hidden = true;
        elements.rows.scrollTop = 0;
    }

    function defaultAction(event) {
        if (event.tee_sheet_action && event.tee_sheet_action !== "none") {
            return event.tee_sheet_action;
        }
        if (event.course_closed) {
            return "closed";
        }
        if (event.event_type === "competition") {
            return "competition";
        }
        if (event.event_type === "roll_up") {
            return "reserve";
        }
        return "none";
    }

    function defaultCount(event) {
        const existing = Number(event.tee_times_required || 0);
        if (existing > 0) {
            return existing;
        }
        if (event.event_type === "roll_up") {
            return 4;
        }
        return 4;
    }

    function eventTime(event) {
        return (
            String(event.time_text || "").trim() ||
            shortTime(event.start_time) ||
            "Time not set"
        );
    }

    function renderEvents() {
        elements.eventsEmpty.hidden = state.events.length > 0;

        if (!state.events.length) {
            elements.events.innerHTML = "";
            return;
        }

        elements.events.innerHTML = state.events
            .map(function (event) {
                const action = defaultAction(event);
                const count = defaultCount(event);
                const applied = event.tee_sheet_action && event.tee_sheet_action !== "none";
                const countHidden = action === "closed" || action === "none";

                return `
                    <article class="tee-sheet-event" data-event-id="${escapeHtml(event.event_id)}">
                        <div class="tee-sheet-event__heading">
                            <div>
                                <span class="tee-sheet-event__time">${escapeHtml(eventTime(event))}</span>
                                <strong>${escapeHtml(event.title)}</strong>
                            </div>
                            <span class="tee-sheet-event__section tee-sheet-event__section--${escapeHtml(event.section)}">
                                ${escapeHtml(SECTION_LABELS[event.section] || event.section)}
                            </span>
                        </div>

                        ${applied ? `
                            <div class="tee-sheet-event__applied">
                                Applied: ${escapeHtml(event.tee_sheet_action)}${event.tee_times_required ? ` · ${escapeHtml(String(event.tee_times_required))} tee times` : ""}
                            </div>
                        ` : ""}

                        <label class="tee-sheet-field tee-sheet-field--compact">
                            <span>Booking impact</span>
                            <select data-event-field="action">
                                <option value="none" ${action === "none" ? "selected" : ""}>Calendar only</option>
                                <option value="reserve" ${action === "reserve" ? "selected" : ""}>Reserve tee times</option>
                                <option value="competition" ${action === "competition" ? "selected" : ""}>Competition</option>
                                <option value="blocked" ${action === "blocked" ? "selected" : ""}>Blocked</option>
                                <option value="closed" ${action === "closed" ? "selected" : ""}>Course closed</option>
                            </select>
                        </label>

                        <label class="tee-sheet-field tee-sheet-field--compact" data-event-count-wrap ${countHidden ? "hidden" : ""}>
                            <span>Tee times required</span>
                            <input data-event-field="count" type="number" min="1" max="48" value="${escapeHtml(String(count))}" />
                        </label>

                        <p class="tee-sheet-event__course">
                            Applies to <strong>${escapeHtml(currentCourseName())}</strong>
                        </p>

                        <button class="tee-sheet-button tee-sheet-button--small" type="button" data-action="apply-event">
                            ${action === "none" ? "Keep calendar only" : (applied ? "Update allocation" : "Apply to tee sheet")}
                        </button>
                    </article>
                `;
            })
            .join("");
    }

    function currentCourseName() {
        return state.courses.find(function (course) {
            return course.course_id === state.courseId;
        })?.course_name || "selected course";
    }

    async function generateDay() {
        clearMessages();
        elements.generate.disabled = true;
        elements.generate.textContent = "Generating…";

        try {
            const created = Number(
                await rpc("staff_generate_course_tee_sheet", {
                    p_club_id: state.clubId,
                    p_course_id: state.courseId,
                    p_play_date: state.playDate
                }) || 0
            );

            await loadTeeSheet();
            showSuccess(
                created > 0
                    ? `${created} tee times created.`
                    : "Tee sheet refreshed. No new tee times were needed."
            );
        } catch (error) {
            showError(error);
        } finally {
            elements.generate.disabled = false;
            elements.generate.textContent = "Generate / refresh";
        }
    }

    function openStatusDialog(row) {
        if (!row || row.booking_id) {
            return;
        }

        hide(elements.statusDialogError);
        elements.statusTeeTimeId.value = row.tee_time_id;
        elements.statusValue.value = row.operational_status || "open";
        elements.statusNotes.value = row.tee_time_notes || "";
        elements.statusDialogTitle.textContent = `${shortTime(row.start_time)} availability`;
        elements.statusDialog.showModal();
    }

    async function saveStatus(event) {
        event.preventDefault();
        hide(elements.statusDialogError);

        try {
            await rpc("staff_set_tee_time_status", {
                p_club_id: state.clubId,
                p_tee_time_id: elements.statusTeeTimeId.value,
                p_status: elements.statusValue.value,
                p_notes: elements.statusNotes.value || null
            });

            elements.statusDialog.close();
            await loadTeeSheet();
            showSuccess("Tee-time availability updated.");
        } catch (error) {
            showError(error, elements.statusDialogError);
        }
    }


    function selectedPlayerCount() {
        const memberPlaces = state.booking.members.reduce(function (total, member) {
            return total + Math.max(1, Number(member.party_size || 1));
        }, 0);
        return memberPlaces + state.booking.guests.length;
    }

    function memberDisplay(member) {
        return (
            String(member?.display_name || "").trim() ||
            String(member?.email || "").trim() ||
            "Member"
        );
    }

    function bookingLeadName() {
        if (state.booking.members.length) {
            return memberDisplay(state.booking.members[0]);
        }
        if (state.booking.guests.length) {
            return String(state.booking.guests[0]?.guest_name || "").trim() || null;
        }
        return null;
    }

    function isActiveClubMember(member) {
        if (
            typeof member?.is_active_member ===
            "boolean"
        ) {
            return member.is_active_member;
        }

        const membershipType =
            String(
                member?.membership_type ||
                ""
            )
                .trim()
                .toLowerCase();

        const membershipStatus =
            String(
                member?.membership_status ||
                ""
            )
                .trim()
                .toLowerCase();

        return (
            membershipStatus === "active" &&
            ![
                "visitor",
                "guest",
                "staff"
            ].includes(
                membershipType
            )
        );
    }

    function bookingRelationshipLabel(member) {
        const membershipType =
            String(
                member?.membership_type ||
                ""
            )
                .trim()
                .toLowerCase();

        const membershipStatus =
            String(
                member?.membership_status ||
                ""
            )
                .trim()
                .toLowerCase();

        if (isActiveClubMember(member)) {
            return member.membership_number
                ? `Member ${member.membership_number}`
                : "Club member";
        }

        if (
            membershipType === "visitor" ||
            membershipType === "guest"
        ) {
            return "Visitor";
        }

        if (membershipType === "staff") {
            return "Staff";
        }

        const inactiveLabels = {
            invited:
                "Membership invited",
            pending:
                "Membership pending",
            suspended:
                "Membership suspended",
            expired:
                "Membership expired",
            cancelled:
                "Membership cancelled"
        };

        return (
            inactiveLabels[
                membershipStatus
            ] ||
            "Paryx player"
        );
    }

    function renderBookingPlayers() {
        const total = selectedPlayerCount();
        elements.bookingCapacity.textContent = `${total} / ${state.booking.maxPlayers}`;

        const entries = [
            ...state.booking.members.map(function (member) {
                return {
                    type: "member",
                    key: member.membership_id,
                    name: memberDisplay(member),
                    meta: [
                        Number(member.party_size || 1) > 1
                            ? `${Number(member.party_size)} places`
                            : "1 place",
                        bookingRelationshipLabel(
                            member
                        ),
                        member.email || ""
                    ].filter(Boolean).join(" · ")
                };
            }),
            ...state.booking.guests.map(function (guest, index) {
                const websiteMeta = guest.is_party_lead
                    ? [
                        "Website visitor",
                        guest.contact_email || "",
                        guest.contact_number || "",
                        guest.booking_reference
                            ? `Ref ${guest.booking_reference}`
                            : ""
                    ].filter(Boolean).join(" · ")
                    : "Guest · 1 place";

                return {
                    type: "guest",
                    key: String(index),
                    name: String(guest.guest_name || "Guest"),
                    meta: websiteMeta
                };
            })
        ];

        if (!entries.length) {
            elements.bookingSelectedPlayers.innerHTML = `
                <div class="tee-sheet-selected-players__empty">
                    No players added yet.
                </div>
            `;
        } else {
            elements.bookingSelectedPlayers.innerHTML = entries.map(function (entry) {
                return `
                    <div class="tee-sheet-selected-player">
                        <div>
                            <strong>${escapeHtml(entry.name)}</strong>
                            <span>${escapeHtml(entry.meta)}</span>
                        </div>
                        <button
                            type="button"
                            data-remove-player-type="${escapeHtml(entry.type)}"
                            data-remove-player-key="${escapeHtml(entry.key)}"
                        >
                            Remove
                        </button>
                    </div>
                `;
            }).join("");
        }

        const full = total >= state.booking.maxPlayers;
        elements.bookingMemberSearch.disabled = full;
        elements.bookingGuestName.disabled = full;
        elements.addBookingGuest.disabled = full;
    }

    function renderMemberResults() {
        const selected = new Set(
            state.booking.members.map(function (member) {
                return member.membership_id;
            })
        );

        const rows = state.booking.searchResults.filter(function (member) {
            return !selected.has(member.membership_id);
        });

        if (elements.bookingMemberSearch.disabled) {
            elements.bookingMemberResults.hidden = true;
            return;
        }

        elements.bookingMemberResults.hidden = false;

        if (!rows.length) {
            elements.bookingMemberResults.innerHTML = `
                <div class="tee-sheet-member-results__empty">
                    No matching active members.
                </div>
            `;
            return;
        }

        elements.bookingMemberResults.innerHTML = rows.map(function (member) {
            const meta = [
                member.membership_number ? `#${member.membership_number}` : "",
                member.email || ""
            ].filter(Boolean).join(" · ");

            return `
                <div class="tee-sheet-member-result">
                    <div>
                        <strong>${escapeHtml(memberDisplay(member))}</strong>
                        <span>${escapeHtml(meta || "Active member")}</span>
                    </div>
                    <button
                        type="button"
                        data-add-member-id="${escapeHtml(member.membership_id)}"
                    >
                        Add
                    </button>
                </div>
            `;
        }).join("");
    }

    async function searchBookingMembers(term) {
        const searchTerm =
            String(term || "").trim();

        if (!searchTerm) {
            state.booking.searchResults = [];
            elements.bookingMemberResults.innerHTML = "";
            elements.bookingMemberResults.hidden = true;
            return;
        }

        try {
            state.booking.searchResults = normaliseRows(
                await rpc("staff_search_booking_members", {
                    p_club_id: state.clubId,
                    p_search: searchTerm,
                    p_limit: 20
                })
            );
            renderMemberResults();
        } catch (error) {
            showError(error, elements.bookingDialogError);
        }
    }

    function queueMemberSearch() {
        if (state.booking.searchTimer) {
            window.clearTimeout(state.booking.searchTimer);
        }

        const searchTerm =
            String(elements.bookingMemberSearch.value || "").trim();

        if (!searchTerm) {
            state.booking.searchResults = [];
            elements.bookingMemberResults.innerHTML = "";
            elements.bookingMemberResults.hidden = true;
            return;
        }

        state.booking.searchTimer = window.setTimeout(function () {
            searchBookingMembers(searchTerm);
        }, 220);
    }

    function addSelectedMember(membershipId) {
        if (selectedPlayerCount() >= state.booking.maxPlayers) {
            showError(
                "This tee time is already at capacity.",
                elements.bookingDialogError
            );
            return;
        }

        const member = state.booking.searchResults.find(function (item) {
            return item.membership_id === membershipId;
        });

        if (!member) {
            return;
        }

        if (state.booking.members.some(function (item) {
            return item.membership_id === membershipId;
        })) {
            return;
        }

        state.booking.members.push({
            ...member,
            party_size: Number(member.party_size || 1)
        });

        elements.bookingMemberSearch.value = "";
        state.booking.searchResults = [];
        elements.bookingMemberResults.innerHTML = "";
        elements.bookingMemberResults.hidden = true;

        hide(elements.bookingDialogError);
        renderBookingPlayers();
    }

    function addGuest() {
        const name = String(elements.bookingGuestName.value || "").trim();

        if (!name) {
            showError("Enter the guest name first.", elements.bookingDialogError);
            return;
        }

        if (selectedPlayerCount() >= state.booking.maxPlayers) {
            showError(
                "This tee time is already at capacity.",
                elements.bookingDialogError
            );
            return;
        }

        state.booking.guests.push({
            guest_name: name
        });

        elements.bookingGuestName.value = "";
        hide(elements.bookingDialogError);
        renderBookingPlayers();
    }

    function removeSelectedPlayer(type, key) {
        if (type === "member") {
            state.booking.members = state.booking.members.filter(function (member) {
                return member.membership_id !== key;
            });
        } else if (type === "guest") {
            const index = Number(key);

            if (Number.isInteger(index) && index >= 0) {
                state.booking.guests.splice(index, 1);
            }
        }

        hide(elements.bookingDialogError);
        renderBookingPlayers();
        renderMemberResults();
    }

    function renderBookingOperationalStatus() {
        if (
            state.booking.mode !==
            "edit"
        ) {
            elements.bookingOperationalStatus
                .textContent =
                "New booking";

            if (elements.bookingDialogEyebrow) {
                elements.bookingDialogEyebrow
                    .textContent =
                    "Staff booking";
            }

            elements.checkInBooking.hidden =
                true;

            return;
        }

        const checkedIn =
            Boolean(
                state.booking.checkedInAt
            );

        const source =
            state.booking.bookingSource === "staff"
                ? "Staff booking"
                : state.booking.bookingSource === "website"
                    ? "Website visitor booking"
                    : "Player booking";

        if (elements.bookingDialogEyebrow) {
            elements.bookingDialogEyebrow
                .textContent =
                source;
        }

        elements.bookingOperationalStatus
            .textContent =
            checkedIn
                ? `${source} · Checked in ${
                    formatCheckInTime(
                        state.booking.checkedInAt
                    ) || ""
                }`
                : source;

        const todayBooking =
            state.booking.playDate ===
            todayIso();

        elements.checkInBooking.hidden =
            !todayBooking;

        elements.checkInBooking
            .classList
            .toggle(
                "is-checked-in",
                checkedIn
            );

        elements.checkInBooking
            .textContent =
            checkedIn
                ? "Undo check-in"
                : "Check in";
    }

    function resetBookingDialog(row) {
        state.booking.mode = "create";
        state.booking.maxPlayers = Number(row?.max_players || 4);
        state.booking.members = [];
        state.booking.guests = [];
        state.booking.searchResults = [];
        state.booking.playDate =
            state.playDate;
        state.booking.checkedInAt =
            null;
        state.booking.bookingSource =
            "staff";

        hide(elements.bookingDialogError);

        elements.bookingId.value = "";
        elements.bookingTeeTimeId.value = row?.tee_time_id || "";
        elements.bookingType.value = "joinable";
        elements.bookingBuggies.value = "0";
        elements.bookingContactNumber.value = "";
        elements.bookingNotes.value = "";
        elements.bookingMemberSearch.value = "";
        elements.bookingGuestName.value = "";
        elements.moveBookingPanel.hidden = true;
        elements.cancelBooking.hidden = true;
        elements.moveBooking.hidden = true;
        elements.saveBooking.textContent = "Create booking";
        elements.bookingDialogTitle.textContent = "Create booking";
        elements.bookingDialogSubtitle.textContent =
            `${formatDayTitle(state.playDate)} · ${shortTime(row?.start_time)} · ${currentCourseName()}`;
        elements.moveBookingDate.value = state.playDate;

        renderBookingPlayers();
        renderBookingOperationalStatus();
        elements.bookingMemberResults.hidden = true;
    }

    async function openCreateBooking(row) {
        if (
            !row ||
            row.booking_id ||
            row.operational_status !== "open"
        ) {
            return;
        }

        if (
            isPastTeeTime(
                row
            )
        ) {
            showError(
                "Past tee times cannot be booked."
            );

            return;
        }

        resetBookingDialog(row);
        elements.bookingDialog.showModal();
        elements.bookingMemberSearch.focus();
    }

    async function openEditBooking(row) {
        if (!row?.booking_id) {
            return;
        }

        hide(elements.bookingDialogError);

        try {
            const rows = normaliseRows(
                await rpc("staff_get_booking_detail", {
                    p_club_id: state.clubId,
                    p_booking_id: row.booking_id
                })
            );

            const detail = rows[0];

            if (!detail) {
                throw new Error("The selected booking could not be loaded.");
            }

            state.booking.mode = "edit";
            state.booking.maxPlayers =
                Number(detail.max_players || row.max_players || 4);
            state.booking.members = Array.isArray(detail.members)
                ? detail.members
                : [];
            state.booking.guests = Array.isArray(detail.guests)
                ? detail.guests
                : [];
            state.booking.searchResults = [];
            state.booking.playDate =
                detail.play_date ||
                state.playDate;
            state.booking.checkedInAt =
                row.staff_checked_in_at ||
                null;
            state.booking.bookingSource =
                row.booking_source ||
                "player";

            const bookingNotesMeta = parseBookingNotes(detail.notes || "");
            elements.bookingId.value = detail.booking_id;
            elements.bookingTeeTimeId.value = detail.tee_time_id;
            elements.bookingType.value = detail.booking_type || "joinable";
            elements.bookingBuggies.value = String(bookingNotesMeta.buggyCount || 0);
            elements.bookingContactNumber.value = detail.contact_number || "";
            elements.bookingNotes.value = bookingNotesMeta.cleanNotes || "";
            elements.bookingMemberSearch.value = "";
            elements.bookingGuestName.value = "";
            elements.bookingDialogTitle.textContent = "Manage booking";
            elements.bookingDialogSubtitle.textContent =
                `${formatDayTitle(detail.play_date)} · ${shortTime(detail.start_time)} · ${detail.course_name || currentCourseName()}`;
            elements.saveBooking.textContent = "Save changes";
            elements.cancelBooking.hidden = false;
            elements.moveBooking.hidden = false;
            elements.moveBookingPanel.hidden = true;
            elements.moveBookingDate.value =
                detail.play_date || state.playDate;

            renderBookingPlayers();
            renderBookingOperationalStatus();
            elements.bookingMemberResults.hidden = true;
            elements.bookingDialog.showModal();
            elements.bookingMemberSearch.focus();
        } catch (error) {
            showError(error);
        }
    }

    function bookingPayload() {
        return {
            memberIds: state.booking.members.map(function (member) {
                return member.membership_id;
            }),
            memberPartySizes: state.booking.members.map(function (member) {
                return Math.max(1, Number(member.party_size || 1));
            }),
            guestNames: state.booking.guests.map(function (guest) {
                return String(guest.guest_name || "").trim();
            }).filter(Boolean),
            bookingType: elements.bookingType.value || "joinable",
            leadName: bookingLeadName(),
            contactNumber: elements.bookingContactNumber.value || null,
            notes: buildBookingNotes(elements.bookingNotes.value, elements.bookingBuggies.value) || null
        };
    }

    async function saveBooking(event) {
        event.preventDefault();
        hide(elements.bookingDialogError);

        if (selectedPlayerCount() < 1) {
            showError(
                "Add at least one member or guest to the booking.",
                elements.bookingDialogError
            );
            return;
        }

        const payload = bookingPayload();

        elements.saveBooking.disabled = true;
        elements.saveBooking.textContent =
            state.booking.mode === "edit"
                ? "Saving…"
                : "Booking…";

        try {
            if (state.booking.mode === "edit") {
                await rpc("staff_update_booking", {
                    p_club_id: state.clubId,
                    p_booking_id: elements.bookingId.value,
                    p_member_ids: payload.memberIds,
                    p_member_party_sizes: payload.memberPartySizes,
                    p_guest_names: payload.guestNames,
                    p_booking_type: payload.bookingType,
                    p_lead_name: payload.leadName,
                    p_contact_number: payload.contactNumber,
                    p_notes: payload.notes
                });
            } else {
                await rpc("staff_create_booking", {
                    p_club_id: state.clubId,
                    p_tee_time_id: elements.bookingTeeTimeId.value,
                    p_member_ids: payload.memberIds,
                    p_member_party_sizes: payload.memberPartySizes,
                    p_guest_names: payload.guestNames,
                    p_booking_type: payload.bookingType,
                    p_lead_name: payload.leadName,
                    p_contact_number: payload.contactNumber,
                    p_notes: payload.notes
                });
            }

            const wasEdit = state.booking.mode === "edit";
            elements.bookingDialog.close();
            await loadTeeSheet();
            showSuccess(wasEdit ? "Booking updated." : "Booking created.");
        } catch (error) {
            showError(error, elements.bookingDialogError);
        } finally {
            elements.saveBooking.disabled = false;
            elements.saveBooking.textContent =
                state.booking.mode === "edit"
                    ? "Save changes"
                    : "Create booking";
        }
    }

    async function cancelCurrentBooking() {
        const bookingId = elements.bookingId.value;

        if (!bookingId) {
            return;
        }

        if (!window.confirm(
            "Cancel this booking? The tee time will become available again."
        )) {
            return;
        }

        hide(elements.bookingDialogError);

        try {
            await rpc("staff_cancel_booking", {
                p_club_id: state.clubId,
                p_booking_id: bookingId
            });

            elements.bookingDialog.close();
            await loadTeeSheet();
            showSuccess("Booking cancelled.");
        } catch (error) {
            showError(error, elements.bookingDialogError);
        }
    }

    async function loadMoveOptions() {
        const date =
            elements.moveBookingDate.value ||
            state.playDate;

        elements.moveBookingTeeTime.innerHTML =
            `<option value="">Loading…</option>`;
        elements.confirmMoveBooking.disabled = true;

        try {
            const rows = normaliseRows(
                await rpc("staff_get_tee_sheet", {
                    p_club_id: state.clubId,
                    p_course_id: state.courseId,
                    p_play_date: date
                })
            );

            const total = selectedPlayerCount();

            const available = rows.filter(function (row) {
                return (
                    row.operational_status === "open" &&
                    !row.booking_id &&
                    !isPastTeeTime(
                        row,
                        date
                    ) &&
                    Number(row.max_players || 0) >= total
                );
            });

            elements.moveBookingTeeTime.innerHTML = available.length
                ? available.map(function (row) {
                    return `
                        <option value="${escapeHtml(row.tee_time_id)}">
                            ${escapeHtml(shortTime(row.start_time))}
                            · ${escapeHtml(String(row.max_players || 4))} players
                        </option>
                    `;
                }).join("")
                : `<option value="">No open generated tee times</option>`;

            elements.confirmMoveBooking.disabled =
                available.length === 0;
        } catch (error) {
            elements.moveBookingTeeTime.innerHTML =
                `<option value="">Could not load tee times</option>`;
            showError(error, elements.bookingDialogError);
        }
    }

    async function openMoveBooking() {
        elements.moveBookingDate.min =
            todayIso();

        if (
            elements.moveBookingDate.value <
            todayIso()
        ) {
            elements.moveBookingDate.value =
                todayIso();
        }

        elements.moveBookingPanel.hidden = false;
        await loadMoveOptions();
    }

    async function confirmMoveBooking() {
        const bookingId = elements.bookingId.value;
        const teeTimeId = elements.moveBookingTeeTime.value;

        if (!bookingId || !teeTimeId) {
            showError(
                "Choose an available destination tee time.",
                elements.bookingDialogError
            );
            return;
        }

        elements.confirmMoveBooking.disabled = true;

        try {
            await rpc("staff_move_booking", {
                p_club_id: state.clubId,
                p_booking_id: bookingId,
                p_new_tee_time_id: teeTimeId
            });

            const targetDate =
                elements.moveBookingDate.value ||
                state.playDate;

            elements.bookingDialog.close();
            state.playDate = targetDate;
            elements.date.value = targetDate;

            await loadDay();
            showSuccess("Booking moved.");
        } catch (error) {
            showError(error, elements.bookingDialogError);
        } finally {
            elements.confirmMoveBooking.disabled = false;
        }
    }

    async function toggleBookingCheckIn() {
        const bookingId =
            elements.bookingId.value;

        if (
            !bookingId ||
            state.booking.mode !==
            "edit"
        ) {
            return;
        }

        const nextCheckedIn =
            !state.booking.checkedInAt;

        elements.checkInBooking.disabled =
            true;

        try {
            const result =
                await rpc(
                    "staff_set_booking_check_in",
                    {
                        p_club_id:
                            state.clubId,
                        p_booking_id:
                            bookingId,
                        p_checked_in:
                            nextCheckedIn
                    }
                );

            state.booking.checkedInAt =
                result ||
                null;

            renderBookingOperationalStatus();

            await loadTeeSheet();

            showSuccess(
                nextCheckedIn
                    ? "Booking checked in."
                    : "Booking check-in removed."
            );
        } catch (error) {
            showError(
                error,
                elements.bookingDialogError
            );
        } finally {
            elements.checkInBooking.disabled =
                false;
        }
    }

    async function applyEvent(card) {
        const eventId = card?.dataset?.eventId;
        if (!eventId) {
            return;
        }

        const action = card.querySelector('[data-event-field="action"]')?.value || "none";
        const countInput = card.querySelector('[data-event-field="count"]');
        const count = action === "closed" || action === "none"
            ? null
            : Number(countInput?.value || 0);
        const button = card.querySelector('[data-action="apply-event"]');

        if (button) {
            button.disabled = true;
            button.textContent = "Applying…";
        }

        clearMessages();

        try {
            const result = await rpc("staff_apply_event_tee_times", {
                p_club_id: state.clubId,
                p_event_id: eventId,
                p_course_id: state.courseId,
                p_action: action,
                p_tee_times_required: count
            });

            await Promise.all([
                loadTeeSheet(),
                loadEvents()
            ]);

            const allocated = Number(result?.allocated || 0);
            showSuccess(
                action === "none"
                    ? "Event removed from the tee sheet."
                    : `${allocated} tee time${allocated === 1 ? "" : "s"} allocated to the event.`
            );
        } catch (error) {
            showError(error);
            renderEvents();
        }
    }

    function clearScheduleForm() {
        hide(elements.scheduleDialogError);
        elements.scheduleId.value = "";
        elements.scheduleName.value = "Standard tee times";
        elements.scheduleFirstTime.value = "07:30";
        elements.scheduleLastTime.value = "18:00";
        elements.scheduleInterval.value = "7";
        elements.scheduleMaxPlayers.value = "4";
        elements.scheduleFrom.value = state.playDate || todayIso();
        elements.scheduleTo.value = "";
        [
            elements.scheduleMonday,
            elements.scheduleTuesday,
            elements.scheduleWednesday,
            elements.scheduleThursday,
            elements.scheduleFriday,
            elements.scheduleSaturday,
            elements.scheduleSunday
        ].forEach(function (input) {
            input.checked = true;
        });
        elements.scheduleActive.checked = true;
        elements.deleteSchedule.hidden = true;
        elements.scheduleDialogTitle.textContent = "New booking schedule";
    }

    function scheduleDays(schedule) {
        return [
            ["Mon", schedule.monday],
            ["Tue", schedule.tuesday],
            ["Wed", schedule.wednesday],
            ["Thu", schedule.thursday],
            ["Fri", schedule.friday],
            ["Sat", schedule.saturday],
            ["Sun", schedule.sunday]
        ]
            .filter(function (item) {
                return item[1];
            })
            .map(function (item) {
                return item[0];
            })
            .join(" · ");
    }

    function renderScheduleList() {
        if (!elements.scheduleList) {
            return;
        }

        if (!state.schedules.length) {
            elements.scheduleList.innerHTML = `
                <p class="tee-sheet-schedule-list__empty">
                    No schedules yet. Create one to generate tee times.
                </p>
            `;
            return;
        }

        elements.scheduleList.innerHTML = state.schedules
            .map(function (schedule) {
                return `
                    <button type="button" data-schedule-id="${escapeHtml(schedule.schedule_id)}">
                        <strong>${escapeHtml(schedule.name)}</strong>
                        <span>${escapeHtml(shortTime(schedule.first_tee_time))}–${escapeHtml(shortTime(schedule.last_tee_time))} · every ${escapeHtml(String(schedule.interval_minutes))} min</span>
                        <small>${escapeHtml(scheduleDays(schedule))}${schedule.is_active ? "" : " · Inactive"}</small>
                    </button>
                `;
            })
            .join("");
    }

    function editSchedule(schedule) {
        if (!schedule) {
            return;
        }

        hide(elements.scheduleDialogError);
        elements.scheduleId.value = schedule.schedule_id;
        elements.scheduleName.value = schedule.name || "";
        elements.scheduleFirstTime.value = shortTime(schedule.first_tee_time);
        elements.scheduleLastTime.value = shortTime(schedule.last_tee_time);
        elements.scheduleInterval.value = String(schedule.interval_minutes || 7);
        elements.scheduleMaxPlayers.value = String(schedule.max_players || 4);
        elements.scheduleFrom.value = schedule.effective_from || "";
        elements.scheduleTo.value = schedule.effective_to || "";
        elements.scheduleMonday.checked = schedule.monday === true;
        elements.scheduleTuesday.checked = schedule.tuesday === true;
        elements.scheduleWednesday.checked = schedule.wednesday === true;
        elements.scheduleThursday.checked = schedule.thursday === true;
        elements.scheduleFriday.checked = schedule.friday === true;
        elements.scheduleSaturday.checked = schedule.saturday === true;
        elements.scheduleSunday.checked = schedule.sunday === true;
        elements.scheduleActive.checked = schedule.is_active === true;
        elements.deleteSchedule.hidden = false;
        elements.scheduleDialogTitle.textContent = "Edit booking schedule";
    }

    async function openSchedules() {
        if (!ADMIN_ROLES.has(state.role)) {
            showError("Only a manager or club administrator can edit booking schedules.");
            return;
        }

        hide(elements.scheduleDialogError);
        await loadSchedules();
        if (state.schedules.length) {
            editSchedule(state.schedules[0]);
        } else {
            clearScheduleForm();
        }
        elements.scheduleDialog.showModal();
    }

    function schedulePayload() {
        return {
            id: elements.scheduleId.value || null,
            course_id: state.courseId,
            name: elements.scheduleName.value,
            first_tee_time: elements.scheduleFirstTime.value,
            last_tee_time: elements.scheduleLastTime.value,
            interval_minutes: Number(elements.scheduleInterval.value),
            max_players: Number(elements.scheduleMaxPlayers.value),
            monday: elements.scheduleMonday.checked,
            tuesday: elements.scheduleTuesday.checked,
            wednesday: elements.scheduleWednesday.checked,
            thursday: elements.scheduleThursday.checked,
            friday: elements.scheduleFriday.checked,
            saturday: elements.scheduleSaturday.checked,
            sunday: elements.scheduleSunday.checked,
            effective_from: elements.scheduleFrom.value,
            effective_to: elements.scheduleTo.value || null,
            is_active: elements.scheduleActive.checked
        };
    }

    async function saveSchedule(event) {
        event.preventDefault();
        hide(elements.scheduleDialogError);
        elements.saveSchedule.disabled = true;
        elements.saveSchedule.textContent = "Saving…";

        try {
            const scheduleId = await rpc("admin_save_booking_schedule", {
                p_club_id: state.clubId,
                p_schedule: schedulePayload()
            });

            await loadSchedules();
            const saved = state.schedules.find(function (schedule) {
                return schedule.schedule_id === scheduleId;
            });
            if (saved) {
                editSchedule(saved);
            }
            showSuccess("Booking schedule saved.");
        } catch (error) {
            showError(error, elements.scheduleDialogError);
        } finally {
            elements.saveSchedule.disabled = false;
            elements.saveSchedule.textContent = "Save schedule";
        }
    }

    async function deleteSchedule() {
        const id = elements.scheduleId.value;
        if (!id) {
            return;
        }

        if (!window.confirm("Delete this booking schedule? Existing tee times will remain on the tee sheet.")) {
            return;
        }

        hide(elements.scheduleDialogError);

        try {
            await rpc("admin_delete_booking_schedule", {
                p_club_id: state.clubId,
                p_schedule_id: id
            });
            await loadSchedules();
            if (state.schedules.length) {
                editSchedule(state.schedules[0]);
            } else {
                clearScheduleForm();
            }
            showSuccess("Booking schedule deleted.");
        } catch (error) {
            showError(error, elements.scheduleDialogError);
        }
    }

    function bindEvents() {
        elements.courseSelect.addEventListener("change", async function () {
            state.courseId = elements.courseSelect.value || null;
            await loadDay();
        });

        elements.date.addEventListener("change", async function () {
            state.playDate = elements.date.value || todayIso();
            await loadDay();
        });

        elements.previousDay.addEventListener("click", async function () {
            state.playDate = shiftDate(state.playDate, -7);
            await loadDay();
        });

        elements.nextDay.addEventListener("click", async function () {
            state.playDate = shiftDate(state.playDate, 7);
            await loadDay();
        });

        elements.today.addEventListener("click", async function () {
            state.playDate = todayIso();
            await loadDay();
        });

        elements.earlierTimes.addEventListener(
            "click",
            showEarlierTeeTimes
        );

        elements.generate.addEventListener("click", generateDay);
        elements.manageSchedules.addEventListener("click", openSchedules);

        // The v0.31.8 layout uses these new IDs. Keep the controls optional
        // so an older, cached HTML page cannot break every booking action.
        if (elements.teeSheetSearch) {
            elements.teeSheetSearch.addEventListener("input", function () {
                state.teeSheetSearch = elements.teeSheetSearch.value || "";
                renderTeeSheet();
            });
        }
        if (elements.teeSheetFilter) {
            elements.teeSheetFilter.addEventListener("change", function () {
                state.teeSheetFilter = elements.teeSheetFilter.value || "all";
                renderTeeSheet();
            });
        }

        elements.rows.addEventListener("click", function (event) {
            const dateButton = event.target.closest("[data-select-week-date]");
            if (dateButton) {
                selectWeekDate(dateButton.dataset.selectWeekDate);
                return;
            }
            const button = event.target.closest("[data-action][data-tee-time-id][data-play-date]");
            if (!button) {
                return;
            }
            const playDate = button.dataset.playDate;
            const row = (state.weekRows[playDate] || []).find(function (item) {
                return String(item.tee_time_id) === button.dataset.teeTimeId;
            });
            if (!row) {
                return;
            }

            if (playDate !== state.playDate) {
                selectWeekDate(playDate);
            }
            if (button.dataset.action === "book") {
                if (BOOKING_ROLES.has(state.role)) {
                    openCreateBooking(row);
                }
                return;
            }
            if (button.dataset.action === "manage-booking") {
                if (BOOKING_ROLES.has(state.role)) {
                    openEditBooking(row);
                }
                return;
            }
            if (button.dataset.action === "availability") {
                openStatusDialog(row);
            }
        });

        elements.events.addEventListener("change", function (event) {
            const select = event.target.closest('[data-event-field="action"]');
            if (!select) {
                return;
            }
            const card = select.closest("[data-event-id]");
            const wrap = card?.querySelector("[data-event-count-wrap]");
            if (wrap) {
                wrap.hidden = select.value === "closed" || select.value === "none";
            }
            const button = card?.querySelector('[data-action="apply-event"]');
            if (button) {
                button.textContent = select.value === "none"
                    ? "Keep calendar only"
                    : "Apply to tee sheet";
            }
        });

        elements.events.addEventListener("click", function (event) {
            const button = event.target.closest('[data-action="apply-event"]');
            if (!button) {
                return;
            }
            applyEvent(button.closest("[data-event-id]"));
        });

        elements.closeScheduleDialog.addEventListener("click", function () {
            elements.scheduleDialog.close();
        });
        elements.newSchedule.addEventListener("click", clearScheduleForm);
        elements.scheduleForm.addEventListener("submit", saveSchedule);
        elements.deleteSchedule.addEventListener("click", deleteSchedule);
        elements.scheduleList.addEventListener("click", function (event) {
            const button = event.target.closest("[data-schedule-id]");
            if (!button) {
                return;
            }
            const schedule = state.schedules.find(function (item) {
                return item.schedule_id === button.dataset.scheduleId;
            });
            editSchedule(schedule);
        });


        elements.closeBookingDialog.addEventListener("click", function () {
            elements.bookingDialog.close();
        });

        elements.bookingForm.addEventListener("submit", saveBooking);

        elements.bookingMemberSearch.addEventListener(
            "input",
            queueMemberSearch
        );

        elements.bookingMemberSearch.addEventListener(
            "keydown",
            function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                }
            }
        );

        elements.bookingMemberSearch.addEventListener(
            "focus",
            function () {
                const searchTerm =
                    String(
                        elements.bookingMemberSearch.value || ""
                    ).trim();

                if (searchTerm) {
                    if (!state.booking.searchResults.length) {
                        searchBookingMembers(searchTerm);
                    } else {
                        renderMemberResults();
                    }
                }
            }
        );

        elements.bookingMemberSearch.addEventListener(
            "blur",
            function () {
                window.setTimeout(function () {
                    elements.bookingMemberResults.hidden = true;
                }, 160);
            }
        );

        elements.bookingMemberResults.addEventListener(
            "click",
            function (event) {
                const button = event.target.closest(
                    "[data-add-member-id]"
                );

                if (button) {
                    addSelectedMember(
                        button.dataset.addMemberId
                    );
                }
            }
        );

        elements.bookingSelectedPlayers.addEventListener(
            "click",
            function (event) {
                const button = event.target.closest(
                    "[data-remove-player-type]"
                );

                if (button) {
                    removeSelectedPlayer(
                        button.dataset.removePlayerType,
                        button.dataset.removePlayerKey
                    );
                }
            }
        );

        elements.addBookingGuest.addEventListener(
            "click",
            addGuest
        );

        elements.bookingGuestName.addEventListener(
            "keydown",
            function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    addGuest();
                }
            }
        );

        elements.cancelBooking.addEventListener(
            "click",
            cancelCurrentBooking
        );

        elements.checkInBooking.addEventListener(
            "click",
            toggleBookingCheckIn
        );

        elements.moveBooking.addEventListener(
            "click",
            openMoveBooking
        );

        elements.cancelMoveBooking.addEventListener(
            "click",
            function () {
                elements.moveBookingPanel.hidden = true;
            }
        );

        elements.moveBookingDate.addEventListener(
            "change",
            loadMoveOptions
        );

        elements.confirmMoveBooking.addEventListener(
            "click",
            confirmMoveBooking
        );

        elements.closeStatusDialog.addEventListener("click", function () {
            elements.statusDialog.close();
        });
        elements.statusForm.addEventListener("submit", saveStatus);

        [
            elements.scheduleDialog,
            elements.bookingDialog,
            elements.statusDialog
        ].forEach(function (dialog) {
            dialog.addEventListener("click", function (event) {
                if (event.target === dialog) {
                    dialog.close();
                }
            });
        });
    }

    async function initialise() {
        try {
            clearMessages();
            await window.Paryx.ready;
            const clubContext = await window.Paryx.clubContext.ready;
            const activeClub =
                clubContext?.activeClub ||
                window.Paryx.clubContext.getActiveClub();

            if (!activeClub?.id) {
                throw new Error("Staff club access required.");
            }

            const role = String(activeClub.role || "").trim().toLowerCase();
            if (!OPERATOR_ROLES.has(role)) {
                throw new Error("Tee sheet access required.");
            }

            state.clubId = activeClub.id;
            state.clubName = activeClub.name || "Your club";
            state.role = role;
            elements.clubName.textContent = state.clubName;
            elements.date.value = state.playDate;
            if (elements.teeSheetSearch) {
                elements.teeSheetSearch.value = state.teeSheetSearch;
            }
            if (elements.teeSheetFilter) {
                elements.teeSheetFilter.value = state.teeSheetFilter;
            }

            if (!ADMIN_ROLES.has(role)) {
                elements.manageSchedules.hidden = true;
            }

            bindEvents();
            await loadCourses();

            if (!state.courseId) {
                throw new Error("Create an active course before using the tee sheet.");
            }

            await loadDay();
            state.initialised = true;
        } catch (error) {
            showError(error);
            elements.loadStatus.textContent = "Unavailable";
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialise, { once: true });
    } else {
        initialise();
    }
})();
