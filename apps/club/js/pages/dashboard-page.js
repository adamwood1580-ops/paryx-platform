(function () {
    "use strict";

    // Paryx staff application namespace.
    window.Paryx = window.Paryx || {};

    const ADMIN_ROLES = new Set([
        "manager",
        "club_admin"
    ]);

    const ROLE_LABELS = {
        manager: "Manager",
        club_admin: "Club Admin"
    };

    const elements = {
        clubName: document.getElementById("adminClubName"),
        roleBadge: document.getElementById("adminRoleBadge"),
        error: document.getElementById("adminError"),
        activeMembers: document.getElementById("adminActiveMembers"),
        pendingInvites: document.getElementById("adminPendingInvites"),
        todayBookings: document.getElementById("adminTodayBookings"),
        upcomingEvents: document.getElementById("adminUpcomingEvents"),
        nextEvent: document.getElementById("adminNextEvent"),
        nextEventTitle: document.getElementById("adminNextEventTitle"),
        nextEventMeta: document.getElementById("adminNextEventMeta"),
        updated: document.getElementById("adminUpdated")
    };

    let initialised = false;

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

    function isAccessDenied(error) {
        const message = getReadableError(error).toLowerCase();

        return (
            message.includes("admin access required") ||
            message.includes("not authorised for admin") ||
            message.includes("not authorized for admin") ||
            message.includes("staff club access required")
        );
    }

    function redirectUnauthorised() {
        window.location.replace(
            "login.html?reason=access"
        );
    }

    function getDashboardRow(data) {
        if (Array.isArray(data)) {
            return data[0] || null;
        }

        return data || null;
    }

    function formatCount(value) {
        const number = Number(value || 0);

        return new Intl.NumberFormat("en-GB").format(
            Number.isFinite(number) ? number : 0
        );
    }

    function formatDate(dateValue) {
        if (!dateValue) {
            return "";
        }

        const date = new Date(`${dateValue}T00:00:00`);

        if (Number.isNaN(date.getTime())) {
            return String(dateValue);
        }

        return new Intl.DateTimeFormat(
            "en-GB",
            {
                weekday: "short",
                day: "numeric",
                month: "long"
            }
        ).format(date);
    }

    function formatToday(dateValue) {
        if (!dateValue) {
            return "Dashboard updated";
        }

        const date = new Date(`${dateValue}T00:00:00`);

        if (Number.isNaN(date.getTime())) {
            return "Dashboard updated";
        }

        return `Club day: ${new Intl.DateTimeFormat(
            "en-GB",
            {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric"
            }
        ).format(date)}`;
    }

    function renderNextEvent(dashboard) {
        if (
            !elements.nextEvent ||
            !elements.nextEventTitle ||
            !elements.nextEventMeta
        ) {
            return;
        }

        if (!dashboard.next_event_title) {
            elements.nextEvent.hidden = true;
            return;
        }

        elements.nextEvent.hidden = false;
        elements.nextEventTitle.textContent =
            dashboard.next_event_title;

        const parts = [
            formatDate(dashboard.next_event_date),
            dashboard.next_event_time || ""
        ].filter(Boolean);

        elements.nextEventMeta.textContent =
            parts.join(" · ");
    }

    function renderDashboard(dashboard) {
        const role = String(
            dashboard.admin_role || ""
        ).trim();

        if (!ADMIN_ROLES.has(role)) {
            redirectUnauthorised();
            return;
        }

        if (elements.clubName) {
            elements.clubName.textContent =
                dashboard.club_name ||
                "Your club";
        }

        if (elements.roleBadge) {
            elements.roleBadge.textContent =
                ROLE_LABELS[role] || "Admin";
        }

        if (elements.activeMembers) {
            elements.activeMembers.textContent =
                formatCount(dashboard.active_members);
        }

        if (elements.pendingInvites) {
            elements.pendingInvites.textContent =
                formatCount(dashboard.pending_invites);
        }

        if (elements.todayBookings) {
            elements.todayBookings.textContent =
                formatCount(dashboard.today_bookings);
        }

        if (elements.upcomingEvents) {
            elements.upcomingEvents.textContent =
                formatCount(dashboard.upcoming_events);
        }

        if (elements.updated) {
            elements.updated.textContent =
                formatToday(dashboard.club_today);
        }

        renderNextEvent(dashboard);
    }

    function showError(error) {
        console.error(
            "Paryx dashboard failed to load:",
            error
        );

        if (elements.error) {
            elements.error.hidden = false;
            elements.error.textContent =
                "Dashboard could not load. " +
                getReadableError(error);
        }

        if (elements.roleBadge) {
            elements.roleBadge.textContent =
                "Unavailable";
        }

        if (elements.updated) {
            elements.updated.textContent =
                "Dashboard unavailable";
        }
    }

    async function loadDashboard(clubId) {
        if (!clubId) {
            throw new Error(
                "Staff club access required."
            );
        }

        const client = getClient();

        const {
            data,
            error
        } = await client.rpc(
            "get_admin_dashboard",
            {
                p_club_id:
                    clubId
            }
        );

        if (error) {
            throw error;
        }

        const dashboard =
            getDashboardRow(data);

        if (!dashboard) {
            throw new Error(
                "No admin dashboard data was returned."
            );
        }

        return dashboard;
    }

    async function initialiseAdminPage() {
        if (initialised) {
            return;
        }

        initialised = true;

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

            const clubContext =
                await window.Paryx
                    .clubContext
                    .ready;

            const activeClub =
                clubContext?.activeClub ||
                window.Paryx
                    .clubContext
                    .getActiveClub();

            const dashboard =
                await loadDashboard(
                    activeClub?.id
                );

            renderDashboard(dashboard);
        } catch (error) {
            if (isAccessDenied(error)) {
                redirectUnauthorised();
                return;
            }

            showError(error);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initialiseAdminPage,
            { once: true }
        );
    } else {
        initialiseAdminPage();
    }
})();
