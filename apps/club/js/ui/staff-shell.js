(function () {
    "use strict";

    window.Paryx = window.Paryx || {};

    const THEME_STORAGE_KEY = "paryx_clubhub_theme";

    function currentTheme() {
        return document.documentElement.dataset.theme === "dark"
            ? "dark"
            : "light";
    }

    function updateThemeToggle() {
        const button = document.getElementById("staffThemeToggle");

        if (!button) {
            return;
        }

        const dark = currentTheme() === "dark";
        const label = button.querySelector(".staff-theme-toggle__label");

        button.setAttribute("aria-pressed", dark ? "true" : "false");
        button.setAttribute(
            "aria-label",
            dark ? "Switch to light mode" : "Switch to dark mode"
        );

        if (label) {
            label.textContent = dark ? "Light mode" : "Dark mode";
        }
    }

    function setTheme(theme, persist) {
        const nextTheme = theme === "dark" ? "dark" : "light";
        document.documentElement.dataset.theme = nextTheme;

        const themeMeta = document.querySelector('meta[name="theme-color"]');
        if (themeMeta) {
            themeMeta.setAttribute(
                "content",
                nextTheme === "dark" ? "#0d1712" : "#064831"
            );
        }

        if (persist !== false) {
            try {
                window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
            } catch (error) {
                console.warn("ClubHub could not save the theme preference:", error);
            }
        }

        updateThemeToggle();
    }

    const NAV_ITEMS = [
        {
            key: "dashboard",
            label: "Dashboard",
            href: "dashboard.html",
            moduleKey: "dashboard",
            roles: ["manager", "club_admin"]
        },
        {
            key: "teesheet",
            label: "Tee Sheet",
            href: "tee-sheet.html",
            moduleKey: "tee_sheet",
            roles: [
                "starter",
                "reception",
                "professional",
                "greenkeeper",
                "manager",
                "club_admin"
            ]
        },
        {
            key: "members",
            label: "Members",
            href: "members.html",
            moduleKey: "members",
            roles: ["manager", "club_admin"]
        },
        {
            key: "credit",
            label: "Club Credit",
            href: "club-credit.html",
            moduleKey: "member_credit",
            roles: [
                "reception",
                "professional",
                "manager",
                "club_admin"
            ]
        },
        {
            key: "staff",
            label: "Staff",
            href: "staff.html",
            moduleKey: "members",
            adminOnly: true
        },
        {
            key: "calendar",
            label: "Calendar",
            href: "calendar.html",
            moduleKey: "calendar",
            roles: ["manager", "club_admin"]
        },
        {
            key: "competitions",
            label: "Competitions",
            href: "competitions.html",
            moduleKey: "competitions",
            roles: [
                "reception",
                "professional",
                "manager",
                "club_admin"
            ]
        },
        {
            key: "courses",
            label: "Courses",
            href: "courses.html",
            moduleKey: "courses",
            roles: ["greenkeeper", "manager", "club_admin"]
        },
        {
            key: "stock",
            label: "Stock",
            href: "stock.html",
            moduleKey: "stock_inventory",
            roles: [
                "reception",
                "professional",
                "manager",
                "club_admin"
            ]
        },
        {
            key: "epos",
            label: "EPOS",
            href: "epos.html",
            moduleKey: "epos_integration",
            roles: [
                "professional",
                "manager",
                "club_admin"
            ]
        },
        {
            key: "settings",
            label: "Settings",
            href: "settings.html",
            moduleKey: "settings",
            roles: ["greenkeeper", "manager", "club_admin"]
        }
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
                        ${item.adminOnly ? 'data-staff-admin-only="true"' : ""}
                        ${item.moduleKey ? `data-club-module="${item.moduleKey}" hidden` : ""}
                        ${Array.isArray(item.roles) ? `data-staff-roles="${item.roles.join(",")}"` : ""}
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
                        id="staffThemeToggle"
                        class="staff-theme-toggle"
                        type="button"
                        aria-pressed="false"
                        aria-label="Switch to dark mode"
                    >
                        <span
                            class="staff-theme-toggle__track"
                            aria-hidden="true"
                        >
                            <span class="staff-theme-toggle__thumb"></span>
                        </span>
                        <span class="staff-theme-toggle__label">Dark mode</span>
                    </button>

                    <a
                        id="staffConsoleLink"
                        class="staff-console-link"
                        href="../../console/html/dashboard.html"
                        hidden
                    >
                        Paryx Console
                    </a>

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
                <div class="staff-club-identity">
                    <img
                        id="staffClubLogo"
                        class="staff-club-identity__logo"
                        alt=""
                        hidden
                    >

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
                </div>

                <div
                    class="staff-topbar__user"
                    id="staffUserName"
                >
                    Paryx
                </div>
            `;
        }

        updateThemeToggle();

        document
            .getElementById("staffThemeToggle")
            ?.addEventListener(
                "click",
                function () {
                    setTheme(
                        currentTheme() === "dark" ? "light" : "dark"
                    );
                }
            );

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

    function updateClubLogo(activeClub) {
        const logo =
            document.getElementById(
                "staffClubLogo"
            );

        if (!logo) {
            return;
        }

        const url =
            activeClub?.branding?.logoUrl ||
            "";

        if (!url) {
            logo.hidden = true;
            logo.removeAttribute("src");
            logo.alt = "";
            return;
        }

        logo.src = url;
        logo.alt = `${activeClub.name} logo`;
        logo.hidden = false;
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

        select.onchange =
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
            };
    }

    function applyActiveClubUi(activeClub) {
        if (!activeClub) {
            return;
        }

        updateClubLogo(activeClub);

        const clubs =
            window.Paryx
                .clubContext
                ?.getClubs?.() ||
            [];

        populateClubSelector(
            clubs,
            activeClub
        );

        const role =
            document.getElementById(
                "staffRole"
            );

        if (role) {
            role.textContent =
                ROLE_LABELS[
                    activeClub.role
                ] ||
                String(
                    activeClub.role ||
                    "staff"
                ).replaceAll("_", " ");
        }

        const canAdminister =
            [
                "manager",
                "club_admin"
            ].includes(
                activeClub.role
            );

        document
            .querySelectorAll(
                "[data-staff-admin-only]"
            )
            .forEach(
                function (item) {
                    item.hidden =
                        !canAdminister;
                }
            );

        hydrateClubModules(activeClub);
    }

    function hydrateClubModules(activeClub) {
        const moduleLinks = Array.from(
            document.querySelectorAll("[data-club-module]")
        );

        if (!moduleLinks.length) {
            return;
        }

        moduleLinks.forEach(function (link) {
            link.hidden = true;
        });

        if (!activeClub?.id) {
            return;
        }

        const enabled = new Set(
            Array.isArray(activeClub.modules)
                ? activeClub.modules
                : []
        );

        moduleLinks.forEach(function (link) {
            const moduleKey = String(link.dataset.clubModule || "");
            const allowedRoles = String(link.dataset.staffRoles || "")
                .split(",")
                .map(function (role) { return role.trim(); })
                .filter(Boolean);

            const roleAllowed =
                !allowedRoles.length ||
                allowedRoles.includes(activeClub.role);

            const adminAllowed =
                link.dataset.staffAdminOnly !== "true" ||
                ["manager", "club_admin"].includes(
                    activeClub.role
                );

            link.hidden = !(
                enabled.has(moduleKey) &&
                roleAllowed &&
                adminAllowed
            );
        });

        const activeLink = moduleLinks.find(function (link) {
            return link.classList.contains("is-active");
        });

        if (activeLink?.hidden) {
            const fallbackLink =
                moduleLinks.find(function (link) {
                    return !link.hidden;
                });

            if (fallbackLink?.getAttribute("href")) {
                window.location.replace(
                    fallbackLink.getAttribute("href")
                );
            } else {
                window.location.replace(
                    "login.html?reason=access"
                );
            }
        }
    }

    async function hydratePlatformConsoleLink() {
        const link =
            document.getElementById(
                "staffConsoleLink"
            );

        if (!link) {
            return;
        }

        try {
            const {
                data,
                error
            } =
                await window.supabaseClient.rpc(
                    "get_my_platform_access"
                );

            if (error) {
                return;
            }

            const access =
                Array.isArray(data)
                    ? data[0]
                    : data;

            if (
                access &&
                access.is_active === true
            ) {
                link.hidden = false;
            }
        } catch (error) {
            /*
             * Console is optional for ordinary club staff.
             * A missing migration/RPC must never break the club workspace.
             */
        }
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

            const displayName =
                accountContext?.profile?.displayName ||
                accountContext?.user?.email ||
                "Paryx user";

            const user =
                document.getElementById(
                    "staffUserName"
                );

            if (user) {
                user.textContent =
                    displayName;
            }

            applyActiveClubUi(
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
                        Access denied
                    </option>
                `;
                select.disabled = true;
            }

            const main =
                document.querySelector("main");

            if (
                main &&
                !document.getElementById(
                    "clubHubAccessDenied"
                )
            ) {
                const notice =
                    document.createElement("section");

                notice.id =
                    "clubHubAccessDenied";

                notice.className =
                    "admin-error";

                notice.setAttribute(
                    "role",
                    "alert"
                );

                notice.textContent =
                    "ClubHub is available only to authorised staff at an active club. Contact your club administrator if you require access.";

                main.prepend(notice);
            }
        }
    }

    renderShell();

    hydratePlatformConsoleLink();

    window.addEventListener(
        "paryx:club-changed",
        function (event) {
            applyActiveClubUi(
                event.detail?.club || null
            );
        }
    );

    if (window.Paryx.ready) {
        hydrateUserContext();
    }
})();
