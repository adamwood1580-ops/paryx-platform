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
            key: "platformusers",
            label: "Platform Users",
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
                        href="../../club/html/dashboard.html"
                    >
                        Club workspace
                    </a>

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

    hydrate().catch(function (error) {
        console.error(
            "Paryx Console shell failed:",
            error
        );
    });
})();
