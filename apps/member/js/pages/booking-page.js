(function () {
    "use strict";

    const P = window.ParyxMember;
    const pageParameters = new URLSearchParams(window.location.search);
    const requestedCourseId = pageParameters.get("course");
    const requestedTeeId = pageParameters.get("tee");
    const requestedDate = pageParameters.get("date");

    const state = {
        clubs: [],
        courses: [],
        tees: [],
        bookings: [],
        alerts: [],
        clubId: null,
        courseId: null,
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(requestedDate || ""))
            ? requestedDate
            : P.isoDate(new Date()),
        timer: null,
        deepLinkHandled: false,
        period: "morning",
        showUnavailable: false,
        visibleLimit: 15
    };

    const elements = {
        clubName: document.getElementById("clubName"),
        clubMeta: document.getElementById("clubMeta"),
        accessBanner: document.getElementById("accessBanner"),
        course: document.getElementById("courseSelect"),
        dateStrip: document.getElementById("dateStrip"),
        teeHeading: document.getElementById("teeHeading"),
        teeSummary: document.getElementById("teeSummary"),
        periodTabs: document.getElementById("periodTabs"),
        showUnavailable: document.getElementById("showUnavailable"),
        message: document.getElementById("message"),
        tees: document.getElementById("teeTimes"),
        bookings: document.getElementById("bookings"),
        openClub: document.getElementById("openClubPicker"),
        clubDialog: document.getElementById("clubDialog"),
        closeClub: document.getElementById("closeClubDialog"),
        clubSearch: document.getElementById("clubSearch"),
        clubResults: document.getElementById("clubResults"),
        bookingDialog: document.getElementById("bookingDialog"),
        bookingForm: document.getElementById("bookingForm"),
        bookingTitle: document.getElementById("bookingTitle"),
        bookingMeta: document.getElementById("bookingMeta"),
        actionId: document.getElementById("actionId"),
        actionType: document.getElementById("actionType"),
        party: document.getElementById("partySize"),
        bookingTypeField: document.getElementById("bookingTypeField"),
        bookingType: document.getElementById("bookingType"),
        closeBooking: document.getElementById("closeBookingDialog"),
        backBooking: document.getElementById("backBooking"),
        confirmBooking: document.getElementById("confirmBooking"),
        alertList: document.getElementById("teeAlerts"),
        alertDialog: document.getElementById("alertDialog"),
        alertForm: document.getElementById("alertForm"),
        alertMeta: document.getElementById("alertMeta"),
        alertTeeId: document.getElementById("alertTeeId"),
        alertParty: document.getElementById("alertPartySize"),
        closeAlert: document.getElementById("closeAlertDialog"),
        backAlert: document.getElementById("backAlert"),
        confirmAlert: document.getElementById("confirmAlert")
    };

    function showMessage(text, type) {
        elements.message.textContent = text;
        elements.message.className = `notice ${type || ""}`;
        elements.message.hidden = false;
    }

    function clearMessage() {
        elements.message.hidden = true;
    }

    function currentClub() {
        return state.clubs.find(function (club) {
            return club.club_id === state.clubId;
        }) || null;
    }

    async function loadClubs(query) {
        state.clubs = P.rows(await P.rpc("player_list_clubs_v2", {
            p_search: String(query || "").trim() || null
        }));
        renderClubResults();
    }

    function renderClubResults() {
        elements.clubResults.innerHTML = state.clubs.length
            ? state.clubs.map(function (club) {
                return `
                    <button type="button" class="club" data-club="${P.escapeHtml(club.club_id)}" style="cursor:pointer">
                        <div class="club-logo">${P.escapeHtml(String(club.club_name).charAt(0).toUpperCase())}</div>
                        <div>
                            <strong>${P.escapeHtml(club.club_name)}</strong>
                            <span>${P.escapeHtml([club.town_city, club.county_region].filter(Boolean).join(", ") || `${club.active_course_count || 0} course(s)`)}</span>
                        </div>
                        <span class="badge">${club.is_member ? "Member" : "Book"}</span>
                    </button>
                `;
            }).join("")
            : '<div class="empty">No clubs found.</div>';
    }

    function renderClubHeader() {
        const club = currentClub();
        if (!club) {
            elements.clubName.textContent = "Choose a club";
            elements.clubMeta.textContent = "Book at any club using Paryx.";
            elements.accessBanner.hidden = true;
            return;
        }

        elements.clubName.textContent = club.club_name;
        elements.clubMeta.textContent = club.is_member ? "Member access active" : "Visitor booking";

        if (club.is_member) {
            elements.accessBanner.hidden = true;
            elements.accessBanner.innerHTML = "";
        } else {
            elements.accessBanner.hidden = false;
            elements.accessBanner.innerHTML = `
                <strong>Are you already a member here?</strong>
                <div>Verify your existing membership privately using your club membership number.</div>
                <a class="link-btn" href="clubs.html?club=${encodeURIComponent(club.club_id)}&claim=1">Link membership</a>
            `;
        }
    }

    async function chooseClub(id) {
        state.clubId = id;
        P.setSelectedClubId(id);
        if (elements.clubDialog.open) elements.clubDialog.close();
        renderClubHeader();
        await loadCourses();
    }

    async function loadCourses() {
        if (!state.clubId) {
            state.courses = [];
            state.courseId = null;
            elements.course.innerHTML = '<option>Choose a club first</option>';
            renderTees();
            return;
        }

        state.courses = P.rows(await P.rpc("member_get_courses", {
            p_club_id: state.clubId
        }));

        elements.course.innerHTML = state.courses.length
            ? state.courses.map(function (course) {
                return `<option value="${P.escapeHtml(course.course_id)}">${P.escapeHtml(course.course_name)}</option>`;
            }).join("")
            : '<option value="">No active courses</option>';

        const requestedCourse = state.courses.find(function (course) {
            return course.course_id === requestedCourseId;
        });

        state.courseId = requestedCourse?.course_id || state.courses[0]?.course_id || null;
        elements.course.value = state.courseId || "";
        await loadTees();
    }

    function renderDates() {
        const today = new Date();
        const dates = [];
        for (let index = 0; index < 14; index += 1) {
            const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + index);
            dates.push({ iso: P.isoDate(date), date, index });
        }

        elements.dateStrip.innerHTML = dates.map(function (item) {
            return `
                <button class="date ${item.iso === state.date ? "active" : ""}" type="button" data-date="${item.iso}">
                    <strong>${item.index === 0 ? "Today" : new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(item.date)}</strong>
                    <span>${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(item.date)}</span>
                </button>
            `;
        }).join("");
    }

    function closedStatus(row) {
        if (row.operational_status === "reserved") return row.event_title || "Reserved";
        if (row.operational_status === "competition") return row.event_title || "Competition";
        if (row.operational_status === "maintenance") return "Course maintenance";
        return "Unavailable";
    }

    function activeAlertForTee(teeTimeId) {
        return state.alerts.find(function (alert) {
            return alert.tee_time_id === teeTimeId && alert.alert_status === "active";
        }) || null;
    }

    function renderAlerts() {
        const active = state.alerts.filter(function (alert) {
            return alert.alert_status === "active";
        });

        if (!active.length) {
            elements.alertList.innerHTML = '<div class="empty">No active tee-time alerts.</div>';
            return;
        }

        elements.alertList.innerHTML = active.map(function (alert) {
            const places = Number(alert.requested_places || 1);
            return `
                <article class="card tee-alert-card">
                    <div>
                        <p class="kicker">${P.escapeHtml(alert.club_name)}</p>
                        <h3>${P.escapeHtml(P.longDay(alert.play_date))} · ${P.escapeHtml(P.shortTime(alert.start_time))}</h3>
                        <p class="meta">${P.escapeHtml(alert.course_name)} · watching for ${places} ${places === 1 ? "place" : "places"}</p>
                    </div>
                    <div class="tee-alert-card__actions">
                        <a class="button secondary" href="${P.escapeHtml(alert.action_url)}">View</a>
                        <button class="button secondary" type="button" data-cancel-alert="${P.escapeHtml(alert.alert_id)}">Cancel</button>
                    </div>
                </article>
            `;
        }).join("");
    }

    async function loadAlerts() {
        state.alerts = P.rows(await P.rpc("player_list_tee_time_alerts"));
        renderAlerts();
    }

    function periodFor(row) {
        const hour = Number(P.shortTime(row.start_time).split(":")[0] || 0);
        if (hour < 12) return "morning";
        if (hour < 17) return "afternoon";
        return "evening";
    }

    function periodLabel(period) {
        if (period === "morning") return "Morning";
        if (period === "afternoon") return "Afternoon";
        return "Evening";
    }

    function rowsInPeriod(period) {
        return state.tees.filter(function (row) {
            return periodFor(row) === period;
        });
    }

    function isPrimaryVisible(row) {
        if (row.current_user_role) return true;
        if (row.operational_status !== "open") return false;
        if (!row.booking_id) return Number(row.spaces_remaining || 0) > 0;
        return row.booking_type === "joinable" && Number(row.spaces_remaining || 0) > 0;
    }

    function primaryRows(period) {
        return rowsInPeriod(period).filter(isPrimaryVisible);
    }

    function ensurePeriod() {
        const periods = ["morning", "afternoon", "evening"];
        const currentRows = state.showUnavailable
            ? rowsInPeriod(state.period)
            : primaryRows(state.period);

        if (currentRows.length) return;

        const next = periods.find(function (period) {
            return (state.showUnavailable ? rowsInPeriod(period) : primaryRows(period)).length > 0;
        });

        state.period = next || periods.find(function (period) {
            return rowsInPeriod(period).length > 0;
        }) || "morning";
    }

    function renderPeriods() {
        ensurePeriod();
        const periods = ["morning", "afternoon", "evening"];
        const visible = periods.filter(function (period) {
            return rowsInPeriod(period).length > 0;
        });

        elements.periodTabs.innerHTML = visible.map(function (period) {
            const count = primaryRows(period).length;
            return `
                <button type="button" class="player-period-tab ${period === state.period ? "active" : ""}" data-period="${period}">
                    ${periodLabel(period)} <span>${count}</span>
                </button>
            `;
        }).join("");
    }

    function slotDetails(row) {
        if (row.current_user_role) {
            return {
                label: row.current_user_role === "lead" ? "Your booking" : "Joined",
                className: " player-time-slot--mine",
                attributes: "data-view"
            };
        }

        if (row.operational_status !== "open") {
            return {
                label: closedStatus(row),
                className: " player-time-slot--unavailable",
                attributes: "disabled"
            };
        }

        if (!row.booking_id) {
            const spaces = Number(row.spaces_remaining || row.max_players || 0);
            return {
                label: `${spaces} ${spaces === 1 ? "space" : "spaces"}`,
                className: "",
                attributes: `data-book="${P.escapeHtml(row.tee_time_id)}"`
            };
        }

        if (row.booking_type === "joinable" && Number(row.spaces_remaining || 0) > 0) {
            const spaces = Number(row.spaces_remaining || 0);
            return {
                label: `${spaces} ${spaces === 1 ? "space" : "spaces"} · join`,
                className: " player-time-slot--joinable",
                attributes: `data-join="${P.escapeHtml(row.booking_id)}"`
            };
        }

        const alert = activeAlertForTee(row.tee_time_id);
        return {
            label: alert ? "Watching" : (row.booking_type === "private" ? "Private · alert" : "Full · alert"),
            className: alert ? " player-time-slot--watching" : " player-time-slot--unavailable player-time-slot--alertable",
            attributes: alert ? "disabled" : `data-alert="${P.escapeHtml(row.tee_time_id)}"`
        };
    }

    function renderTees() {
        renderDates();
        elements.teeHeading.textContent = `${P.formatDay(state.date)} tee times`;
        elements.showUnavailable.checked = state.showUnavailable;

        if (!state.courseId) {
            elements.teeSummary.textContent = "";
            elements.periodTabs.innerHTML = "";
            elements.tees.innerHTML = '<div class="empty">Choose a club and course.</div>';
            return;
        }

        if (!state.tees.length) {
            elements.teeSummary.textContent = "";
            elements.periodTabs.innerHTML = "";
            elements.tees.innerHTML = '<div class="empty">No generated tee times for this date.</div>';
            return;
        }

        renderPeriods();

        let rows = rowsInPeriod(state.period);
        if (!state.showUnavailable) {
            rows = rows.filter(isPrimaryVisible);
        }

        const bookableCount = state.tees.filter(function (row) {
            return !row.current_user_role && isPrimaryVisible(row);
        }).length;
        const ownCount = state.tees.filter(function (row) {
            return Boolean(row.current_user_role);
        }).length;
        const visibleCount = Math.min(rows.length, state.visibleLimit);
        const periodName = periodLabel(state.period).toLowerCase();
        const summaryBits = [];
        summaryBits.push(`${bookableCount} bookable`);
        if (ownCount) summaryBits.push(`${ownCount} yours`);
        summaryBits.push(`showing ${visibleCount} ${periodName}`);
        elements.teeSummary.textContent = summaryBits.join(" · ");

        if (!rows.length) {
            elements.tees.innerHTML = state.showUnavailable
                ? '<div class="empty player-time-grid__empty">No tee times fall within this part of the day.</div>'
                : '<div class="empty player-time-grid__empty">No available tee times in this part of the day. Choose another tab or show full / closed times to create an alert.</div>';
            return;
        }

        const visibleRows = rows.slice(0, state.visibleLimit);
        const remaining = Math.max(0, rows.length - visibleRows.length);

        elements.tees.innerHTML = visibleRows.map(function (row) {
            const slot = slotDetails(row);
            return `
                <button type="button" class="player-time-slot${slot.className}" ${slot.attributes}>
                    <strong>${P.escapeHtml(P.shortTime(row.start_time))}</strong>
                    <span>${P.escapeHtml(slot.label)}</span>
                </button>
            `;
        }).join("") + (remaining > 0
            ? `
                <button type="button" class="player-more-times" data-show-more>
                    Show ${Math.min(15, remaining)} more ${P.escapeHtml(periodName)} times
                    <span>${remaining} remaining</span>
                </button>
            `
            : "");
    }

    async function loadTees() {
        clearMessage();
        if (!state.courseId) {
            state.tees = [];
            renderTees();
            return;
        }
        state.tees = P.rows(await P.rpc("member_get_tee_sheet", {
            p_course_id: state.courseId,
            p_play_date: state.date
        }));
        renderTees();
        handleRequestedTee();
    }

    function handleRequestedTee() {
        if (state.deepLinkHandled || !requestedTeeId) {
            return;
        }

        state.deepLinkHandled = true;

        const row = state.tees.find(function (item) {
            return item.tee_time_id === requestedTeeId;
        });

        if (!row) {
            showMessage(
                "That tee time is no longer available. Choose another time below.",
                "error"
            );
            return;
        }

        if (row.current_user_role) {
            showMessage(
                "This tee time is already in your bookings.",
                "success"
            );
            return;
        }

        if (row.operational_status !== "open") {
            showMessage(
                "That tee time is no longer available. Choose another time below.",
                "error"
            );
            return;
        }

        if (!row.booking_id) {
            openBooking("create", row.tee_time_id);
            return;
        }

        if (row.booking_type === "joinable" && Number(row.spaces_remaining || 0) > 0) {
            openBooking("join", row.booking_id);
            return;
        }

        showMessage(
            "That tee time has filled since you viewed the club website. Choose another time below.",
            "error"
        );
    }

    function openBooking(type, id) {
        const row = type === "create"
            ? state.tees.find(function (item) { return item.tee_time_id === id; })
            : state.tees.find(function (item) { return item.booking_id === id; });
        if (!row) return;

        const max = type === "create" ? row.max_players : row.spaces_remaining;
        elements.actionId.value = id;
        elements.actionType.value = type;
        elements.bookingTitle.textContent = type === "create" ? "Book tee time" : "Join booking";
        elements.bookingMeta.textContent = `${P.longDay(row.play_date)} · ${P.shortTime(row.start_time)}`;
        elements.party.innerHTML = Array.from({ length: Math.max(1, Math.min(8, Number(max || 1))) }, function (_, index) {
            return `<option value="${index + 1}">${index + 1}</option>`;
        }).join("");
        elements.bookingTypeField.hidden = type !== "create";
        elements.bookingDialog.showModal();
    }

    function openAlert(teeTimeId) {
        const row = state.tees.find(function (item) {
            return item.tee_time_id === teeTimeId;
        });
        if (!row) return;

        const max = Math.max(1, Math.min(8, Number(row.max_players || 1)));
        elements.alertTeeId.value = teeTimeId;
        elements.alertMeta.textContent = `${P.longDay(row.play_date)} · ${P.shortTime(row.start_time)} · ${row.course_name || "Tee time"}`;
        elements.alertParty.innerHTML = Array.from({ length: max }, function (_, index) {
            const value = index + 1;
            return `<option value="${value}">${value} ${value === 1 ? "place" : "places"}</option>`;
        }).join("");
        elements.alertDialog.showModal();
    }

    async function submitAlert(event) {
        event.preventDefault();
        elements.confirmAlert.disabled = true;
        try {
            await P.rpc("player_create_tee_time_alert", {
                p_tee_time_id: elements.alertTeeId.value,
                p_requested_places: Number(elements.alertParty.value)
            });
            elements.alertDialog.close();
            showMessage("Tee-time alert created. We’ll notify you when enough space opens.", "success");
            await loadAlerts();
            renderTees();
            window.dispatchEvent(new CustomEvent("paryx:notifications-changed"));
        } catch (error) {
            showMessage(P.readableError(error), "error");
            await loadTees();
        } finally {
            elements.confirmAlert.disabled = false;
        }
    }

    async function cancelAlert(id) {
        try {
            await P.rpc("player_cancel_tee_time_alert", {
                p_alert_id: id
            });
            showMessage("Tee-time alert cancelled.", "success");
            await loadAlerts();
            renderTees();
            window.dispatchEvent(new CustomEvent("paryx:notifications-changed"));
        } catch (error) {
            showMessage(P.readableError(error), "error");
        }
    }

    async function submitBooking(event) {
        event.preventDefault();
        elements.confirmBooking.disabled = true;
        try {
            if (elements.actionType.value === "create") {
                await P.rpc("member_create_booking", {
                    p_tee_time_id: elements.actionId.value,
                    p_player_count: Number(elements.party.value),
                    p_booking_type: elements.bookingType.value
                });
                showMessage("Booking confirmed.", "success");
            } else {
                await P.rpc("member_join_booking", {
                    p_booking_id: elements.actionId.value,
                    p_player_count: Number(elements.party.value)
                });
                showMessage("You joined the booking.", "success");
            }
            elements.bookingDialog.close();
            await Promise.all([loadTees(), loadBookings(), loadAlerts()]);
            window.dispatchEvent(new CustomEvent("paryx:notifications-changed"));
        } catch (error) {
            showMessage(P.readableError(error), "error");
        } finally {
            elements.confirmBooking.disabled = false;
        }
    }

    async function loadBookings() {
        state.bookings = P.rows(await P.rpc("member_get_upcoming_bookings_v2", { p_limit: 20 }));
        elements.bookings.innerHTML = state.bookings.length
            ? state.bookings.map(function (booking) {
                return `
                    <article class="card">
                        <div class="booking-top">
                            <div>
                                <p class="kicker">${P.escapeHtml(booking.club_name)}</p>
                                <h3>${P.escapeHtml(P.longDay(booking.play_date))}</h3>
                                <p class="meta">${P.escapeHtml(booking.course_name)} · ${P.escapeHtml((booking.player_names || []).join(", "))}</p>
                                ${booking.checked_in_at ? '<span class="badge">Checked in</span>' : ''}
                            </div>
                            <div class="booking-time">${P.escapeHtml(P.shortTime(booking.start_time))}</div>
                        </div>
                        <div class="booking-actions">
                            <button class="button danger" type="button" data-${booking.member_role === "lead" ? "cancel" : "leave"}="${P.escapeHtml(booking.booking_id)}">${booking.member_role === "lead" ? "Cancel booking" : "Leave booking"}</button>
                        </div>
                    </article>
                `;
            }).join("")
            : '<div class="empty">No upcoming bookings.</div>';
    }

    async function removeBooking(action, id) {
        if (!window.confirm(action === "cancel" ? "Cancel this booking?" : "Leave this booking?")) return;
        try {
            await P.rpc(action === "cancel" ? "cancel_booking" : "leave_booking", { p_booking_id: id });
            showMessage(action === "cancel" ? "Booking cancelled." : "You left the booking.", "success");
            await Promise.all([loadTees(), loadBookings(), loadAlerts()]);
            window.dispatchEvent(new CustomEvent("paryx:notifications-changed"));
        } catch (error) {
            showMessage(P.readableError(error), "error");
        }
    }

    function bind() {
        elements.openClub.addEventListener("click", function () {
            elements.clubDialog.showModal();
            elements.clubSearch.focus();
        });
        elements.closeClub.addEventListener("click", function () { elements.clubDialog.close(); });
        elements.clubResults.addEventListener("click", function (event) {
            const button = event.target.closest("[data-club]");
            if (button) chooseClub(button.dataset.club);
        });
        elements.clubSearch.addEventListener("input", function () {
            window.clearTimeout(state.timer);
            state.timer = window.setTimeout(function () {
                loadClubs(elements.clubSearch.value).catch(function (error) {
                    showMessage(P.readableError(error), "error");
                });
            }, 200);
        });
        elements.course.addEventListener("change", function () {
            state.courseId = elements.course.value || null;
            state.period = "morning";
            state.visibleLimit = 15;
            loadTees();
        });
        elements.dateStrip.addEventListener("click", function (event) {
            const button = event.target.closest("[data-date]");
            if (button) {
                state.date = button.dataset.date;
                state.period = "morning";
                state.visibleLimit = 15;
                loadTees();
            }
        });
        elements.periodTabs.addEventListener("click", function (event) {
            const button = event.target.closest("[data-period]");
            if (!button) return;
            state.period = button.dataset.period;
            state.visibleLimit = 15;
            renderTees();
        });
        elements.showUnavailable.addEventListener("change", function () {
            state.showUnavailable = elements.showUnavailable.checked;
            state.visibleLimit = 15;
            renderTees();
        });
        elements.tees.addEventListener("click", function (event) {
            const book = event.target.closest("[data-book]");
            const join = event.target.closest("[data-join]");
            const view = event.target.closest("[data-view]");
            const alert = event.target.closest("[data-alert]");
            const more = event.target.closest("[data-show-more]");
            if (book) openBooking("create", book.dataset.book);
            else if (join) openBooking("join", join.dataset.join);
            else if (alert) openAlert(alert.dataset.alert);
            else if (view) document.getElementById("my-bookings").scrollIntoView({ behavior: "smooth" });
            else if (more) {
                state.visibleLimit += 15;
                renderTees();
            }
        });
        elements.bookingForm.addEventListener("submit", submitBooking);
        [elements.closeBooking, elements.backBooking].forEach(function (button) {
            button.addEventListener("click", function () { elements.bookingDialog.close(); });
        });
        elements.alertForm.addEventListener("submit", submitAlert);
        [elements.closeAlert, elements.backAlert].forEach(function (button) {
            button.addEventListener("click", function () { elements.alertDialog.close(); });
        });
        elements.alertList.addEventListener("click", function (event) {
            const cancel = event.target.closest("[data-cancel-alert]");
            if (cancel) cancelAlert(cancel.dataset.cancelAlert);
        });
        elements.bookings.addEventListener("click", function (event) {
            const cancel = event.target.closest("[data-cancel]");
            const leave = event.target.closest("[data-leave]");
            if (cancel) removeBooking("cancel", cancel.dataset.cancel);
            else if (leave) removeBooking("leave", leave.dataset.leave);
        });
    }

    P.ready.then(async function () {
        bind();
        renderDates();
        await loadClubs("");

        const queryClubId = pageParameters.get("club");
        const stored = P.selectedClubId();
        const initial = state.clubs.find(function (club) { return club.club_id === queryClubId; })
            || state.clubs.find(function (club) { return club.club_id === stored; })
            || state.clubs.find(function (club) { return club.is_member; })
            || state.clubs[0];

        if (initial) {
            state.clubId = initial.club_id;
            P.setSelectedClubId(state.clubId);
            renderClubHeader();
            await loadCourses();
        } else {
            renderClubHeader();
            renderTees();
        }

        await Promise.all([loadBookings(), loadAlerts()]);
        renderTees();
    }).catch(function (error) {
        showMessage(P.readableError(error), "error");
    });
})();
