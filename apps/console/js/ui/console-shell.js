(function () {
    "use strict";

    const NAV = [
        {
            key: "dashboard",
            label: "Overview",
            href: "dashboard.html"
        },
        {
            key: "clubs",
            label: "Clubs",
            href: "clubs.html"
        },
        {
            key: "accounts",
            label: "Player Accounts",
            href: "accounts.html"
        },
        {
            key: "platformusers",
            label: "Console Users",
            href: "platform-users.html"
        },
        {
            key: "audit",
            label: "Audit",
            href: "audit.html"
        }
    ];

    const currentPage =
        String(
            document.body.dataset.page || ""
        )
            .trim()
            .toLowerCase();

    function roleLabel(role) {
        return String(role || "")
            .replace(/^platform_/, "")
            .replaceAll("_", " ");
    }

    function navMarkup() {
        return NAV.map(function (item) {
            return `
                <a
                    href="${item.href}"
                    class="${item.key === currentPage ? "is-active" : ""}"
                >
                    ${item.label}
                </a>
            `;
        }).join("");
    }

    function render() {
        const sidebar =
            document.querySelector(
                "[data-console-sidebar]"
            );

        const topbar =
            document.querySelector(
                "[data-console-topbar]"
            );

        if (sidebar) {
            sidebar.innerHTML = `
                <div class="console-brand">
                    <img
                        class="console-brand__mark"
                        src="../../club/assets/branding/paryx-mark.png"
                        alt=""
                    >
                    <div>
                        <strong>Paryx Console</strong>
                        <span>Platform control</span>
                    </div>
                </div>

                <nav
                    class="console-nav"
                    aria-label="Paryx Console"
                >
                    ${navMarkup()}
                </nav>

                <div class="console-sidebar__footer">
                    <span
                        id="consoleRole"
                        class="console-role"
                    >
                        Platform access
                    </span>

                    <a
                        id="consoleClubWorkspaceLink"
                        href="../../club/html/dashboard.html"
                        hidden
                    >
                        Club workspace
                    </a>

                    <span
                        id="consolePlatformOnlyNote"
                        class="console-sidebar__note"
                        hidden
                    >
                        Platform-only account
                    </span>

                    <button
                        id="consoleSignOut"
                        type="button"
                    >
                        Sign out
                    </button>
                </div>
            `;
        }

        if (topbar) {
            topbar.innerHTML = `
                <div class="console-topbar__identity">
                    <small>Paryx platform</small>
                    <strong id="consoleUserEmail">
                        Loading…
                    </strong>
                </div>

                <span
                    id="consoleTopbarRole"
                    class="console-badge"
                >
                    Checking access
                </span>
            `;
        }

        document
            .getElementById(
                "consoleSignOut"
            )
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

    async function hydrateClubWorkspaceLink() {
        const link =
            document.getElementById(
                "consoleClubWorkspaceLink"
            );

        const note =
            document.getElementById(
                "consolePlatformOnlyNote"
            );

        if (!link || !note) {
            return;
        }

        try {
            const {
                data,
                error
            } =
                await window.supabaseClient.rpc(
                    "get_my_staff_clubs"
                );

            if (error) {
                note.hidden = false;
                return;
            }

            const clubs =
                Array.isArray(data)
                    ? data
                    : [];

            if (clubs.length > 0) {
                link.hidden = false;
                note.hidden = true;
                return;
            }

            link.hidden = true;
            note.hidden = false;
        } catch (error) {
            link.hidden = true;
            note.hidden = false;
        }
    }

    async function hydrate() {
        const context =
            await window.ParyxConsole.ready;

        const email =
            context?.access?.email ||
            context?.user?.email ||
            "Paryx";

        const role =
            context?.access?.role ||
            "";

        const emailElement =
            document.getElementById(
                "consoleUserEmail"
            );

        const roleElement =
            document.getElementById(
                "consoleRole"
            );

        const topbarRole =
            document.getElementById(
                "consoleTopbarRole"
            );

        if (emailElement) {
            emailElement.textContent =
                email;
        }

        if (roleElement) {
            roleElement.textContent =
                roleLabel(role);
        }

        if (topbarRole) {
            topbarRole.textContent =
                roleLabel(role);
        }
    }

    render();

    hydrateClubWorkspaceLink();

    hydrate().catch(function (error) {
        console.error(
            "Paryx Console shell failed:",
            error
        );
    });
})();
