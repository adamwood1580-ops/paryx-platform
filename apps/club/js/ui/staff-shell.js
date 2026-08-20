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

    const ROLE_LABELS = {
        starter: "Starter",
        reception: "Reception",
        professional: "Professional",
        greenkeeper: "Greenkeeper",
        manager: "Manager",
        club_admin: "Club Admin"
    };

    const currentPage =
        String(
            document.body.dataset.page || ""
        )
            .trim()
            .toLowerCase();

    const sidebar =
        document.querySelector(
            "[data-staff-sidebar]"
        );

    const header =
        document.querySelector(
            "[data-staff-header]"
        );

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function navMarkup() {
        return NAV_ITEMS
            .map(function (item) {
                const active =
                    item.key === currentPage ||
                    (
                        currentPage === "importmembers" &&
                        item.key === "members"
                    );

                if (!item.href) {
                    return `
                        <span
                            class="staff-nav__item staff-nav__item--disabled"
                            aria-disabled="true"
                        >
                            ${item.label}
                            <small>Planned</small>
                        </span>
                    `;
                }

                return `
                    <a
                        class="staff-nav__item${active ? " is-active" : ""}"
                        href="${item.href}"
                    >
                        ${item.label}
                    </a>
                `;
            })
            .join("");
    }

    function renderShell() {
        if (sidebar) {
            sidebar.innerHTML = `
                <div class="staff-brand">
                    <img
                        src="../assets/branding/paryx-mark.png"
                        alt=""
                        class="staff-brand__logo"
                        aria-hidden="true"
                    >
                    <div>
                        <strong>Paryx</strong>
                        <span>Golf club management</span>
                    </div>
                </div>

                <nav
                    class="staff-nav"
                    aria-label="Paryx navigation"
                >
                    ${navMarkup()}
                </nav>

                <div class="staff-sidebar__footer">
                    <span id="staffRole">
                        Staff workspace
                    </span>

                    <button
                        id="staffSignOut"
                        type="button"
                    >
                        Sign out
                    </button>
                </div>
            `;
        }

        if (header) {
            header.innerHTML = `
                <label class="staff-club-switcher">
                    <span class="staff-topbar__label">
                        Current club
                    </span>

                    <select
                        id="staffClubSelect"
                        class="staff-club-switcher__select"
                        aria-label="Current club"
                        disabled
                    >
                        <option value="">
                            Loading club…
                        </option>
                    </select>
                </label>

                <div
                    class="staff-topbar__user"
                    id="staffUserName"
                >
                    Paryx
                </div>
            `;
        }

        document
            .getElementById("staffSignOut")
            ?.addEventListener(
                "click",
                async function () {
                    try {
                        await window
                            .supabaseClient
                            ?.auth
                            ?.signOut();
                    } finally {
                        window.location.replace(
                            "login.html"
                        );
                    }
                }
            );
    }

    function populateClubSelector(
        clubs,
        activeClub
    ) {
        const select =
            document.getElementById(
                "staffClubSelect"
            );

        if (!select) {
            return;
        }

        select.innerHTML =
            clubs
                .map(function (club) {
                    return `
                        <option
                            value="${escapeHtml(club.id)}"
                            ${club.id === activeClub?.id ? "selected" : ""}
                        >
                            ${escapeHtml(club.name)}
                        </option>
                    `;
                })
                .join("");

        select.disabled =
            clubs.length <= 1;

        select.addEventListener(
            "change",
            function () {
                const clubId =
                    select.value;

                if (!clubId) {
                    return;
                }

                try {
                    window.Paryx
                        .clubContext
                        .setActiveClub(
                            clubId
                        );

                    select.disabled = true;

                    /*
                     * Reloading gives every page service a clean
                     * selected-club context and prevents stale data
                     * from the previously selected tenant.
                     */
                    window.location.reload();
                } catch (error) {
                    console.error(
                        "Paryx could not change clubs:",
                        error
                    );
                }
            },
            { once: false }
        );
    }

    async function hydrateUserContext() {
        try {
            const accountContext =
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

            const clubs =
                clubContext?.clubs ||
                window.Paryx
                    .clubContext
                    .getClubs();

            const displayName =
                accountContext?.profile?.displayName ||
                accountContext?.user?.email ||
                "Paryx user";

            const user =
                document.getElementById(
                    "staffUserName"
                );

            const role =
                document.getElementById(
                    "staffRole"
                );

            if (user) {
                user.textContent =
                    displayName;
            }

            if (role) {
                role.textContent =
                    ROLE_LABELS[
                        activeClub?.role
                    ] ||
                    String(
                        activeClub?.role ||
                        "staff"
                    ).replaceAll("_", " ");
            }

            populateClubSelector(
                clubs,
                activeClub
            );
        } catch (error) {
            console.warn(
                "Paryx staff shell could not load club context:",
                error
            );

            const select =
                document.getElementById(
                    "staffClubSelect"
                );

            if (select) {
                select.innerHTML = `
                    <option value="">
                        Club unavailable
                    </option>
                `;
                select.disabled = true;
            }
        }
    }

    renderShell();

    if (window.Paryx.ready) {
        hydrateUserContext();
    }
})();
