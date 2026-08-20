(function () {
    "use strict";

    const ids = {
        error: "consoleError",
        totalClubs: "totalClubs",
        activeClubs: "activeClubs",
        totalUsers: "totalUsers",
        activeMemberships: "activeMemberships",
        totalCourses: "totalCourses",
        platformUsers: "platformUsers",
        recentAudit: "recentAudit"
    };

    function element(id) {
        return document.getElementById(id);
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

        return new Intl.DateTimeFormat(
            "en-GB",
            {
                dateStyle: "medium",
                timeStyle: "short"
            }
        ).format(
            new Date(value)
        );
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

            element(ids.totalUsers).textContent =
                overview?.total_auth_users ?? 0;

            element(ids.activeMemberships).textContent =
                overview?.active_memberships ?? 0;

            element(ids.totalCourses).textContent =
                overview?.total_courses ?? 0;

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
                                        <td>${formatDate(row.created_at)}</td>
                                        <td>${formatAction(row.action)}</td>
                                        <td>${row.actor_email || "System"}</td>
                                        <td>${row.club_name || "—"}</td>
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
