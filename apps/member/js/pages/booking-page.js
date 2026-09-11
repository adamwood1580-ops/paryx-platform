(function () {
    "use strict";

    const P = window.ParyxMember;

    const state = {
        clubs: [],
        courses: [],
        tees: [],
        bookings: [],
        clubId: null,
        courseId: null,
        date: P.isoDate(new Date()),
        timer: null
    };

    const elements = {
        clubName: document.getElementById("clubName"),
        clubMeta: document.getElementById("clubMeta"),
        accessBanner: document.getElementById("accessBanner"),
        course: document.getElementById("courseSelect"),
        dateStrip: document.getElementById("dateStrip"),
        teeHeading: document.getElementById("teeHeading"),
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
        confirmBooking: document.getElementById("confirmBooking")
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

        state.courseId = state.courses[0]?.course_id || null;
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

    function renderTees() {
        renderDates();
        elements.teeHeading.textContent = `Tee times · ${P.formatDay(state.date)}`;

        if (!state.courseId) {
            elements.tees.innerHTML = '<div class="empty">Choose a club and course.</div>';
            return;
        }

        if (!state.tees.length) {
            elements.tees.innerHTML = '<div class="empty">No generated tee times for this date.</div>';
            return;
        }

        elements.tees.innerHTML = state.tees.map(function (row) {
            let title = "";
            let meta = "";
            let action = "";

            if (row.current_user_role) {
                title = row.current_user_role === "lead" ? "Your booking" : "Booking joined";
                meta = (row.player_names || []).join(", ");
                action = '<button class="secondary" type="button" data-view>View</button>';
            } else if (row.operational_status !== "open") {
                title = closedStatus(row);
                meta = row.event_title || "";
                action = '<button disabled>Closed</button>';
            } else if (!row.booking_id) {
                title = `${row.spaces_remaining} places available`;
                meta = "Open tee time";
                action = `<button type="button" data-book="${P.escapeHtml(row.tee_time_id)}">Book</button>`;
            } else if (row.booking_type === "joinable" && row.spaces_remaining > 0) {
                title = (row.player_names || []).join(", ") || "Joinable booking";
                meta = `${row.spaces_remaining} places available`;
                action = `<button type="button" data-join="${P.escapeHtml(row.booking_id)}">Join</button>`;
            } else if (row.booking_type === "private") {
                title = "Private booking";
                meta = "Unavailable";
                action = '<button disabled>Private</button>';
            } else {
                title = "Fully booked";
                meta = (row.player_names || []).join(", ");
                action = '<button disabled>Full</button>';
            }

            return `
                <article class="tee">
                    <div class="tee-time">${P.escapeHtml(P.shortTime(row.start_time))}</div>
                    <div><strong>${P.escapeHtml(title)}</strong><span>${P.escapeHtml(meta)}</span></div>
                    ${action}
                </article>
            `;
        }).join("");
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
            await Promise.all([loadTees(), loadBookings()]);
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
            await Promise.all([loadTees(), loadBookings()]);
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
            loadTees();
        });
        elements.dateStrip.addEventListener("click", function (event) {
            const button = event.target.closest("[data-date]");
            if (button) {
                state.date = button.dataset.date;
                loadTees();
            }
        });
        elements.tees.addEventListener("click", function (event) {
            const book = event.target.closest("[data-book]");
            const join = event.target.closest("[data-join]");
            const view = event.target.closest("[data-view]");
            if (book) openBooking("create", book.dataset.book);
            else if (join) openBooking("join", join.dataset.join);
            else if (view) document.getElementById("my-bookings").scrollIntoView({ behavior: "smooth" });
        });
        elements.bookingForm.addEventListener("submit", submitBooking);
        [elements.closeBooking, elements.backBooking].forEach(function (button) {
            button.addEventListener("click", function () { elements.bookingDialog.close(); });
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

        const queryClubId = new URLSearchParams(window.location.search).get("club");
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

        await loadBookings();
    }).catch(function (error) {
        showMessage(P.readableError(error), "error");
    });
})();
