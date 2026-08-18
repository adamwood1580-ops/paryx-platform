(function () {
    "use strict";

    window.Paryx = window.Paryx || {};

    const NAV_ITEMS = [
        { key: "dashboard", label: "Dashboard", href: "dashboard.html" },
        { key: "teesheet", label: "Tee Sheet", href: null },
        { key: "members", label: "Members", href: "members.html" },
        { key: "competitions", label: "Competitions", href: null },
        { key: "courses", label: "Courses", href: null },
        { key: "communications", label: "Communications", href: null },
        { key: "reports", label: "Reports", href: null },
        { key: "settings", label: "Settings", href: null }
    ];

    const currentPage = String(document.body.dataset.page || "").toLowerCase();
    const sidebar = document.querySelector("[data-staff-sidebar]");
    const header = document.querySelector("[data-staff-header]");

    function navMarkup() {
        return NAV_ITEMS.map((item) => {
            const active = item.key === currentPage ||
                (currentPage === "importmembers" && item.key === "members");
            if (!item.href) {
                return `<span class="staff-nav__item staff-nav__item--disabled" aria-disabled="true">${item.label}<small>Planned</small></span>`;
            }
            return `<a class="staff-nav__item${active ? " is-active" : ""}" href="${item.href}">${item.label}</a>`;
        }).join("");
    }

    function renderShell() {
        if (sidebar) {
            sidebar.innerHTML = `
                <div class="staff-brand">
                    <img src="../assets/branding/paryx-mark.png" alt="" class="staff-brand__logo" aria-hidden="true">
                    <div><strong>Paryx</strong><span>Golf club management</span></div>
                </div>
                <nav class="staff-nav" aria-label="Paryx navigation">${navMarkup()}</nav>
                <div class="staff-sidebar__footer">
                    <span id="staffRole">Staff workspace</span>
                    <button id="staffSignOut" type="button">Sign out</button>
                </div>
            `;
        }

        if (header) {
            header.innerHTML = `
                <div>
                    <span class="staff-topbar__label">Current club</span>
                    <strong id="staffClubName">Loading club…</strong>
                </div>
                <div class="staff-topbar__user" id="staffUserName">Paryx</div>
            `;
        }

        document.getElementById("staffSignOut")?.addEventListener("click", async function () {
            try {
                await window.supabaseClient?.auth?.signOut();
            } finally {
                window.location.replace("login.html");
            }
        });
    }

    async function hydrateUserContext() {
        try {
            const context = await window.Paryx.ready;
            const profile = context?.profile || {};
            const clubName = profile?.club?.name || "Your club";
            const displayName = profile?.displayName || context?.user?.email || "Paryx user";
            const role = profile?.membership?.role || "staff";

            const club = document.getElementById("staffClubName");
            const user = document.getElementById("staffUserName");
            const roleEl = document.getElementById("staffRole");
            if (club) club.textContent = clubName;
            if (user) user.textContent = displayName;
            if (roleEl) roleEl.textContent = role.replace(/_/g, " ");
        } catch (error) {
            console.warn("Paryx staff shell could not load account context:", error);
        }
    }

    renderShell();
    if (window.Paryx.ready) hydrateUserContext();
})();
