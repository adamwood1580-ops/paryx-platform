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
        tees: document.getElementById("teeTimes"),
        refresh: document.getElementById("refreshButton"),
        contact: document.getElementById("clubContact")
    };

    const state = {
        config: null,
        courseId: null,
        date: null,
        loading: false
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

    function showError(error) {
        console.error("Paryx website booking widget:", error);
        elements.error.textContent = error?.message || String(error || "Could not load tee-time availability.");
        elements.error.hidden = false;
        elements.content.hidden = true;
        notifyHeight();
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
        state.date = isoDate(new Date());
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

    function availabilityCopy(row) {
        switch (row.availability) {
            case "open":
                return {
                    title: `${row.spaces_remaining} ${Number(row.spaces_remaining) === 1 ? "place" : "places"} available`,
                    meta: "Open tee time"
                };
            case "joinable":
                return {
                    title: `${row.spaces_remaining} ${Number(row.spaces_remaining) === 1 ? "place" : "places"} available`,
                    meta: "Join an existing booking"
                };
            case "full":
                return { title: "Fully booked", meta: "No places available" };
            case "closed":
                return { title: "Unavailable", meta: "Tee time closed by the club" };
            default:
                return { title: "Unavailable", meta: "Not available for online booking" };
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

    function renderTees(rows) {
        elements.heading.textContent = `${longDate(state.date)} tee times`;

        if (!rows.length) {
            elements.tees.innerHTML = '<div class="widget-empty">No generated tee times are available for this date.</div>';
            notifyHeight();
            return;
        }

        elements.tees.innerHTML = rows.map(function (row) {
            const copy = availabilityCopy(row);
            const action = row.bookable
                ? `<button type="button" class="widget-book-button" data-book="${escapeHtml(row.tee_time_id)}">Book</button>`
                : `<span class="widget-status">${escapeHtml(copy.title === "Fully booked" ? "Full" : "Closed")}</span>`;

            return `
                <article class="widget-tee">
                    <div class="widget-time">${escapeHtml(shortTime(row.start_time))}</div>
                    <div>
                        <strong>${escapeHtml(copy.title)}</strong>
                        <span>${escapeHtml(copy.meta)}</span>
                    </div>
                    ${action}
                </article>
            `;
        }).join("");

        notifyHeight();
    }

    async function loadTees() {
        if (state.loading || !state.courseId || !state.date) return;
        state.loading = true;
        elements.refresh.disabled = true;
        elements.tees.innerHTML = '<div class="widget-empty">Loading tee times…</div>';
        notifyHeight();

        try {
            const data = await rpc("public_booking_widget_tee_times", {
                p_club_slug: clubSlug,
                p_course_id: state.courseId,
                p_play_date: state.date
            });
            renderTees(Array.isArray(data) ? data : []);
        } catch (error) {
            showError(error);
        } finally {
            state.loading = false;
            elements.refresh.disabled = false;
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
        loadTees();
    });

    elements.dates.addEventListener("click", function (event) {
        const button = event.target.closest("[data-date]");
        if (!button) return;
        state.date = button.dataset.date;
        renderDates();
        loadTees();
    });

    elements.tees.addEventListener("click", function (event) {
        const button = event.target.closest("[data-book]");
        if (!button) return;
        const row = { tee_time_id: button.dataset.book };
        window.open(playerBookingUrl(row), "_blank", "noopener");
    });

    elements.refresh.addEventListener("click", loadTees);

    if ("ResizeObserver" in window) {
        new ResizeObserver(notifyHeight).observe(elements.shell);
    }
    window.addEventListener("load", notifyHeight, { once: true });

    loadBootstrap().catch(showError);
})();
