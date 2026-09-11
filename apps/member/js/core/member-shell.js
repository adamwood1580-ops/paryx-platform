(function () {
    "use strict";

    const mount = document.querySelector("[data-member-shell]");
    if (!mount) return;

    const P = window.ParyxMember;
    const page = document.body.dataset.page || "home";
    const items = [
        ["home", "home.html", "⌂", "Home"],
        ["book", "booking.html", "◷", "Book"],
        ["play", "play.html", "⛳", "Play"],
        ["calendar", "calendar.html", "□", "Calendar"],
        ["profile", "profile.html", "○", "Profile"]
    ];

    mount.innerHTML = `
        ${page === "notifications" ? "" : `
            <a class="notification-fab" href="notifications.html" aria-label="Notifications">
                <span aria-hidden="true">🔔</span>
                <b id="memberNotificationBadge" hidden>0</b>
            </a>
        `}
        <nav class="bottom-nav" aria-label="Paryx Player">
            ${items.map(function (item) {
                const [id, href, icon, label] = item;
                return `
                    <a href="${href}" class="${id === page ? "active" : ""}" ${id === page ? 'aria-current="page"' : ""}>
                        <i aria-hidden="true">${icon}</i>
                        <span>${label}</span>
                    </a>
                `;
            }).join("")}
        </nav>
    `;

    const badge = document.getElementById("memberNotificationBadge");
    let timer = null;

    async function loadSummary() {
        if (!badge || !P?.rpc) return;

        try {
            const summary = await P.rpc("player_notification_summary");
            const unread = Math.max(0, Number(summary?.unread_count || 0));

            badge.textContent = unread > 99 ? "99+" : String(unread);
            badge.hidden = unread === 0;
        } catch (error) {
            console.warn("Paryx notification summary warning:", error);
        }
    }

    function startPolling() {
        window.clearInterval(timer);
        timer = window.setInterval(function () {
            if (!document.hidden) loadSummary();
        }, 60000);
    }

    if (badge && P?.ready) {
        P.ready.then(function () {
            loadSummary();
            startPolling();
        }).catch(function () {
            // Auth/bootstrap handles its own visible errors.
        });

        window.addEventListener("paryx:notifications-changed", loadSummary);
        document.addEventListener("visibilitychange", function () {
            if (!document.hidden) loadSummary();
        });
    }
})();
