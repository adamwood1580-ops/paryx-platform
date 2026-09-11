(function () {
    "use strict";

    const params = new URLSearchParams(window.location.search);
    const clubSlug = String(params.get("club") || "").trim().toLowerCase();

    const elements = {
        shell: document.getElementById("widgetShell"),
        clubName: document.getElementById("clubName"),
        clubLocation: document.getElementById("clubLocation"),
        clubLogoWrap: document.getElementById("clubLogoWrap"),
        clubLogo: document.getElementById("clubLogo"),
        error: document.getElementById("widgetError"),
        disabled: document.getElementById("widgetDisabled"),
        content: document.getElementById("widgetContent"),
        course: document.getElementById("courseSelect"),
        dates: document.getElementById("dateStrip"),
        heading: document.getElementById("availabilityHeading"),
        summary: document.getElementById("availabilitySummary"),
        periodTabs: document.getElementById("periodTabs"),
        showUnavailable: document.getElementById("showUnavailable"),
        tees: document.getElementById("teeTimes"),
        refresh: document.getElementById("refreshButton"),
        contact: document.getElementById("clubContact"),

        guestDialog: document.getElementById("guestBookingDialog"),
        guestForm: document.getElementById("guestBookingForm"),
        guestMeta: document.getElementById("guestBookingMeta"),
        guestError: document.getElementById("guestBookingError"),
        guestName: document.getElementById("guestName"),
        guestEmail: document.getElementById("guestEmail"),
        guestPhone: document.getElementById("guestPhone"),
        guestParty: document.getElementById("guestPartySize"),
        guestConsent: document.getElementById("guestConsent"),
        guestSubmit: document.getElementById("confirmGuestBooking"),
        paryxLink: document.getElementById("continueWithParyx"),
        guestClose: document.getElementById("closeGuestBooking"),

        successDialog: document.getElementById("bookingSuccessDialog"),
        successMeta: document.getElementById("bookingSuccessMeta"),
        successReference: document.getElementById("bookingReference"),
        successClose: document.getElementById("closeBookingSuccess")
    };

    const state = {
        config: null,
        courseId: null,
        date: null,
        rows: [],
        period: "morning",
        showUnavailable: false,
        selectedTee: null,
        bookingKey: null,
        visibleLimit: 15,
        loading: false,
        booking: false
    };

    function client() {
        if (!window.supabase || !CONFIG?.SUPABASE_URL || !CONFIG?.SUPABASE_ANON_KEY) {
            throw new Error("Paryx booking is temporarily unavailable.");
        }

        return window.supabase.createClient(
            CONFIG.SUPABASE_URL,
            CONFIG.SUPABASE_ANON_KEY,
            {
                auth: {
                    persistSession: false,
                    autoRefreshToken: false,
                    detectSessionInUrl: false
                }
            }
        );
    }

    const supabaseClient = client();

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function isoDate(date) {
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0")
        ].join("-");
    }

    function parseDate(value) {
        const parts = String(value || "").split("-").map(Number);
        return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
    }

    function shortTime(value) {
        return String(value || "").slice(0, 5);
    }

    function longDate(value) {
        return new Intl.DateTimeFormat("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long"
        }).format(parseDate(value));
    }

    function readableError(error) {
        return error?.message || error?.details || String(error || "Something went wrong.");
    }

    function showError(error) {
        console.error("Paryx website booking widget:", error);
        elements.error.textContent = readableError(error) || "Could not load tee-time availability.";
        elements.error.hidden = false;
        elements.content.hidden = true;
        notifyHeight();
    }

    function clearPageError() {
        elements.error.hidden = true;
        elements.error.textContent = "";
    }

    function showGuestError(error) {
        elements.guestError.textContent = readableError(error);
        elements.guestError.hidden = false;
    }

    function clearGuestError() {
        elements.guestError.hidden = true;
        elements.guestError.textContent = "";
    }

    function logoUrl(path) {
        if (!path) return null;
        const clean = String(path).replace(/^\/+/, "");
        return `${CONFIG.SUPABASE_URL}/storage/v1/object/public/club-branding/${encodeURI(clean)}`;
    }

    function applyBranding(config) {
        document.documentElement.style.setProperty("--club-primary", config.primary_color || "#064831");
        document.documentElement.style.setProperty("--club-secondary", config.secondary_color || "#022D1D");
        document.documentElement.style.setProperty("--club-accent", config.accent_color || "#E5C45F");

        elements.clubName.textContent = config.club_name || "Golf club";
        elements.clubLocation.textContent = [config.town_city, config.county_region].filter(Boolean).join(", ");

        const logo = logoUrl(config.logo_path);
        if (logo) {
            elements.clubLogo.src = logo;
            elements.clubLogo.alt = `${config.club_name || "Club"} logo`;
            elements.clubLogoWrap.hidden = false;
        } else {
            elements.clubLogoWrap.hidden = true;
        }

        const contact = config.contact_email || config.phone || "";
        elements.contact.textContent = contact ? `Club contact: ${contact}` : "";
    }

    async function rpc(name, args) {
        const { data, error } = await supabaseClient.rpc(name, args || {});
        if (error) throw error;
        return data;
    }

    async function loadBootstrap() {
        if (!clubSlug) {
            throw new Error("This Paryx booking widget has no club configured.");
        }

        const data = await rpc("public_booking_widget_bootstrap", {
            p_club_slug: clubSlug
        });

        const row = Array.isArray(data) ? data[0] : data;
        if (!row) {
            throw new Error("This club is not available for Paryx website booking.");
        }

        state.config = row;
        applyBranding(row);

        if (!row.public_booking_enabled) {
            elements.disabled.hidden = false;
            elements.content.hidden = true;
            notifyHeight();
            return;
        }

        const courses = Array.isArray(row.courses) ? row.courses : [];
        if (!courses.length) {
            throw new Error("No active courses are available for online booking.");
        }

        elements.course.innerHTML = courses.map(function (course) {
            const suffix = Number(course.holes) === 9 ? " · 9 holes" : "";
            return `<option value="${escapeHtml(course.course_id)}">${escapeHtml(course.course_name)}${suffix}</option>`;
        }).join("");

        const requestedCourse = String(params.get("course") || "");
        const defaultCourse = courses.find(function (course) {
            return course.course_id === requestedCourse;
        }) || courses.find(function (course) {
            return course.course_id === row.default_course_id;
        }) || courses[0];

        state.courseId = defaultCourse.course_id;
        elements.course.value = state.courseId;
        state.date = /^\d{4}-\d{2}-\d{2}$/.test(String(params.get("date") || ""))
            ? params.get("date")
            : isoDate(new Date());

        elements.content.hidden = false;
        renderDates();
        await loadTees();
    }

    function renderDates() {
        const total = Math.max(1, Math.min(14, Number(state.config?.public_booking_advance_days || 14)));
        const today = new Date();
        const dates = [];

        for (let index = 0; index < total; index += 1) {
            const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + index);
            dates.push({ date, iso: isoDate(date), index });
        }

        if (!dates.some(function (item) { return item.iso === state.date; })) {
            state.date = dates[0].iso;
        }

        elements.dates.innerHTML = dates.map(function (item) {
            const label = item.index === 0
                ? "Today"
                : new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(item.date);
            const detail = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(item.date);
            return `
                <button type="button" class="widget-date ${item.iso === state.date ? "active" : ""}" data-date="${item.iso}">
                    <strong>${escapeHtml(label)}</strong>
                    <span>${escapeHtml(detail)}</span>
                </button>
            `;
        }).join("");
    }

    function periodFor(row) {
        const hour = Number(shortTime(row.start_time).split(":")[0] || 0);
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
        return state.rows.filter(function (row) {
            return periodFor(row) === period;
        });
    }

    function availableRows(period) {
        return rowsInPeriod(period).filter(function (row) {
            return row.bookable;
        });
    }

    function ensurePeriod() {
        const periods = ["morning", "afternoon", "evening"];
        const currentRows = state.showUnavailable
            ? rowsInPeriod(state.period)
            : availableRows(state.period);

        if (currentRows.length) return;

        const next = periods.find(function (period) {
            return (state.showUnavailable ? rowsInPeriod(period) : availableRows(period)).length > 0;
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
            const count = availableRows(period).length;
            return `
                <button type="button" class="widget-period-tab ${period === state.period ? "active" : ""}" data-period="${period}">
                    ${periodLabel(period)} <span>${count}</span>
                </button>
            `;
        }).join("");
    }

    function slotCopy(row) {
        if (!row.bookable) {
            if (row.availability === "full") return "Full";
            return "Closed";
        }

        const spaces = Number(row.spaces_remaining || 0);
        if (row.availability === "joinable") {
            return `${spaces} ${spaces === 1 ? "space" : "spaces"} · join`;
        }
        return `${spaces} ${spaces === 1 ? "space" : "spaces"}`;
    }

    function renderTees() {
        elements.heading.textContent = `${longDate(state.date)} tee times`;
        elements.showUnavailable.checked = state.showUnavailable;
        renderPeriods();

        let rows = rowsInPeriod(state.period);
        if (!state.showUnavailable) {
            rows = rows.filter(function (row) { return row.bookable; });
        }

        const bookableCount = state.rows.filter(function (row) { return row.bookable; }).length;
        const visibleCount = Math.min(rows.length, state.visibleLimit);
        const periodName = periodLabel(state.period).toLowerCase();
        elements.summary.textContent = bookableCount
            ? `${bookableCount} tee ${bookableCount === 1 ? "time" : "times"} available · showing ${visibleCount} ${periodName} slot${visibleCount === 1 ? "" : "s"}`
            : "No online spaces remain for this date";

        if (!state.rows.length) {
            elements.tees.innerHTML = '<div class="widget-empty">No generated tee times are available for this date.</div>';
            notifyHeight();
            return;
        }

        if (!rows.length) {
            elements.tees.innerHTML = state.showUnavailable
                ? '<div class="widget-empty">No tee times fall within this part of the day.</div>'
                : '<div class="widget-empty">No spaces are available in this part of the day. Choose another tab or show full / closed times.</div>';
            notifyHeight();
            return;
        }

        const visibleRows = rows.slice(0, state.visibleLimit);
        const remaining = Math.max(0, rows.length - visibleRows.length);

        elements.tees.innerHTML = visibleRows.map(function (row) {
            const disabled = !row.bookable;
            const css = row.availability === "joinable" ? " widget-time-slot--joinable" : "";
            const title = disabled
                ? `${shortTime(row.start_time)} · ${slotCopy(row)}`
                : `${shortTime(row.start_time)} · ${row.spaces_remaining} place(s) available`;

            return `
                <button
                    type="button"
                    class="widget-time-slot${css}"
                    data-tee="${escapeHtml(row.tee_time_id)}"
                    title="${escapeHtml(title)}"
                    ${disabled ? "disabled" : ""}
                >
                    <strong>${escapeHtml(shortTime(row.start_time))}</strong>
                    <span>${escapeHtml(slotCopy(row))}</span>
                </button>
            `;
        }).join("") + (remaining > 0
            ? `
                <button type="button" class="widget-more-times" data-show-more>
                    Show ${Math.min(15, remaining)} more ${escapeHtml(periodName)} tee times
                    <span>${remaining} remaining</span>
                </button>
            `
            : "");

        notifyHeight();
    }

    async function loadTees() {
        if (state.loading || !state.courseId || !state.date) return;
        state.loading = true;
        elements.refresh.disabled = true;
        elements.tees.innerHTML = '<div class="widget-empty">Loading tee times…</div>';
        clearPageError();
        notifyHeight();

        try {
            const data = await rpc("public_booking_widget_tee_times", {
                p_club_slug: clubSlug,
                p_course_id: state.courseId,
                p_play_date: state.date
            });
            state.rows = Array.isArray(data) ? data : [];
            ensurePeriod();
            renderTees();
        } catch (error) {
            showError(error);
        } finally {
            state.loading = false;
            elements.refresh.disabled = false;
        }
    }

    function playerBookingUrl(row) {
        const url = new URL("../member/html/booking.html", window.location.href);
        url.searchParams.set("club", state.config.club_id);
        url.searchParams.set("course", state.courseId);
        url.searchParams.set("date", state.date);
        url.searchParams.set("tee", row.tee_time_id);
        url.searchParams.set("source", "website-widget");
        return url.href;
    }

    function newBookingKey() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return window.crypto.randomUUID();
        }
        return `widget-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
    }

    function openGuestBooking(row) {
        state.selectedTee = row;
        state.bookingKey = newBookingKey();
        clearGuestError();
        elements.guestForm.reset();
        elements.guestConsent.checked = false;

        const spaces = Math.max(1, Number(row.spaces_remaining || 1));
        elements.guestParty.innerHTML = Array.from({ length: spaces }, function (_, index) {
            const value = index + 1;
            return `<option value="${value}">${value} ${value === 1 ? "player" : "players"}</option>`;
        }).join("");

        elements.guestMeta.textContent = `${longDate(state.date)} at ${shortTime(row.start_time)} · ${spaces} ${spaces === 1 ? "space" : "spaces"} available`;
        if (row.availability === "joinable") {
            elements.guestMeta.textContent += " · your party will join an existing tee time";
        }

        elements.paryxLink.href = playerBookingUrl(row);
        elements.guestDialog.showModal();
        window.setTimeout(function () {
            elements.guestName.focus();
        }, 30);
    }

    async function submitGuestBooking(event) {
        event.preventDefault();
        if (state.booking || !state.selectedTee) return;

        clearGuestError();
        if (!elements.guestForm.reportValidity()) return;

        state.booking = true;
        elements.guestSubmit.disabled = true;
        elements.guestSubmit.textContent = "Booking…";

        try {
            const result = await rpc("public_booking_widget_create_guest", {
                p_club_slug: clubSlug,
                p_tee_time_id: state.selectedTee.tee_time_id,
                p_lead_name: elements.guestName.value.trim(),
                p_contact_email: elements.guestEmail.value.trim(),
                p_contact_number: elements.guestPhone.value.trim() || null,
                p_party_size: Number(elements.guestParty.value || 1),
                p_idempotency_key: state.bookingKey
            });

            elements.guestDialog.close();
            elements.successReference.textContent = result?.booking_reference || "Confirmed";
            elements.successMeta.textContent = `${result?.club_name || state.config.club_name} · ${longDate(result?.play_date || state.date)} at ${result?.start_time || shortTime(state.selectedTee.start_time)} · ${result?.party_size || elements.guestParty.value} player${Number(result?.party_size || elements.guestParty.value) === 1 ? "" : "s"}`;
            elements.successDialog.showModal();

            await loadTees();
        } catch (error) {
            showGuestError(error);
        } finally {
            state.booking = false;
            elements.guestSubmit.disabled = false;
            elements.guestSubmit.textContent = "Confirm visitor booking";
        }
    }

    function notifyHeight() {
        window.setTimeout(function () {
            const height = Math.ceil(document.documentElement.scrollHeight);
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({
                    type: "paryx-widget-resize",
                    club: clubSlug,
                    height
                }, "*");
            }
        }, 0);
    }

    elements.course.addEventListener("change", function () {
        state.courseId = elements.course.value || null;
        state.period = "morning";
        state.visibleLimit = 15;
        loadTees();
    });

    elements.dates.addEventListener("click", function (event) {
        const button = event.target.closest("[data-date]");
        if (!button) return;
        state.date = button.dataset.date;
        state.period = "morning";
        state.visibleLimit = 15;
        renderDates();
        loadTees();
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
        const more = event.target.closest("[data-show-more]");
        if (more) {
            state.visibleLimit += 15;
            renderTees();
            return;
        }

        const button = event.target.closest("[data-tee]");
        if (!button || button.disabled) return;
        const row = state.rows.find(function (item) {
            return item.tee_time_id === button.dataset.tee;
        });
        if (row?.bookable) openGuestBooking(row);
    });

    elements.refresh.addEventListener("click", loadTees);
    elements.guestForm.addEventListener("submit", submitGuestBooking);
    elements.guestClose.addEventListener("click", function () {
        if (!state.booking) elements.guestDialog.close();
    });
    elements.successClose.addEventListener("click", function () {
        elements.successDialog.close();
    });

    if ("ResizeObserver" in window) {
        new ResizeObserver(notifyHeight).observe(elements.shell);
    }
    window.addEventListener("load", notifyHeight, { once: true });

    loadBootstrap().catch(showError);
})();
