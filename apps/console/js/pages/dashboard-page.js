(function () {
    "use strict";

    const ids = {
        error: "consoleError",
        totalClubs: "totalClubs",
        activeClubs: "activeClubs",
        totalPlayers: "totalPlayers",
        activeMemberships: "activeMemberships",
        todayBookings: "todayBookings",
        activeTier2: "activeTier2",
        activePasses: "activePasses",
        platformUsers: "platformUsers",
        recentAudit: "recentAudit"
    };

    function element(id) {
        return document.getElementById(id);
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function showError(error) {
        const target =
            element(ids.error);

        if (!target) {
            return;
        }

        target.hidden = false;
        target.textContent =
            error?.message ||
            String(error);
    }

    function formatAction(value) {
        return String(value || "")
            .replaceAll("_", " ");
    }

    function formatDate(value) {
        if (!value) {
            return "—";
        }

        const date =
            new Date(value);

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {
            return "—";
        }

        return new Intl.DateTimeFormat(
            "en-GB",
            {
                dateStyle: "medium",
                timeStyle: "short"
            }
        ).format(date);
    }

    async function load() {
        try {
            await window.ParyxConsole.ready;

            const [
                overviewResult,
                auditResult
            ] =
                await Promise.all([
                    window.supabaseClient.rpc(
                        "get_platform_console_overview"
                    ),
                    window.supabaseClient.rpc(
                        "platform_get_audit",
                        {
                            p_limit: 8
                        }
                    )
                ]);

            if (overviewResult.error) {
                throw overviewResult.error;
            }

            if (auditResult.error) {
                throw auditResult.error;
            }

            const overview =
                Array.isArray(
                    overviewResult.data
                )
                    ? overviewResult.data[0]
                    : overviewResult.data;

            element(ids.totalClubs).textContent =
                overview?.total_clubs ?? 0;

            element(ids.activeClubs).textContent =
                overview?.active_clubs ?? 0;

            element(ids.totalPlayers).textContent =
                overview?.total_player_accounts ?? 0;

            element(ids.activeMemberships).textContent =
                overview?.active_member_links ?? 0;

            element(ids.todayBookings).textContent =
                overview?.today_bookings ?? 0;

            element(ids.activeTier2).textContent =
                overview?.active_tier2 ?? 0;

            element(ids.activePasses).textContent =
                overview?.active_scorecard_passes ?? 0;

            element(ids.platformUsers).textContent =
                overview?.platform_users ?? 0;

            const rows =
                Array.isArray(
                    auditResult.data
                )
                    ? auditResult.data
                    : [];

            const target =
                element(ids.recentAudit);

            if (!rows.length) {
                target.innerHTML =
                    '<div class="console-empty">No platform activity recorded yet.</div>';

                return;
            }

            target.innerHTML = `
                <div class="console-table-wrap">
                    <table class="console-table">
                        <thead>
                            <tr>
                                <th>When</th>
                                <th>Action</th>
                                <th>Actor</th>
                                <th>Club</th>
                            </tr>
                        </thead>

                        <tbody>
                            ${rows.map(function (row) {
                                return `
                                    <tr>
                                        <td>${escapeHtml(formatDate(row.created_at))}</td>
                                        <td>${escapeHtml(formatAction(row.action))}</td>
                                        <td>${escapeHtml(row.actor_email || "System")}</td>
                                        <td>${escapeHtml(row.club_name || "—")}</td>
                                    </tr>
                                `;
                            }).join("")}
                        </tbody>
                    </table>
                </div>
            `;
        } catch (error) {
            console.error(
                "Paryx Console dashboard error:",
                error
            );

            showError(error);
        }
    }

    load();
})();
