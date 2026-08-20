(function () {
    "use strict";

    const tableBody =
        document.getElementById(
            "auditTableBody"
        );

    const errorBox =
        document.getElementById(
            "auditError"
        );

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function formatAction(value) {
        return String(value || "")
            .replaceAll("_", " ");
    }

    function formatDate(value) {
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

            const {
                data,
                error
            } =
                await window.supabaseClient.rpc(
                    "platform_get_audit",
                    {
                        p_limit: 200
                    }
                );

            if (error) {
                throw error;
            }

            const rows =
                Array.isArray(data)
                    ? data
                    : [];

            if (!rows.length) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="6">
                            <div class="console-empty">
                                No platform audit entries yet.
                            </div>
                        </td>
                    </tr>
                `;
                return;
            }

            tableBody.innerHTML =
                rows.map(function (row) {
                    return `
                        <tr>
                            <td>${formatDate(row.created_at)}</td>
                            <td>${escapeHtml(formatAction(row.action))}</td>
                            <td>
                                ${escapeHtml(row.actor_email || "System")}
                                <small>${escapeHtml(row.actor_role || "")}</small>
                            </td>
                            <td>${escapeHtml(row.club_name || "—")}</td>
                            <td>${escapeHtml(row.target_email || "—")}</td>
                            <td class="audit-details">${escapeHtml(JSON.stringify(row.details || {}))}</td>
                        </tr>
                    `;
                }).join("");
        } catch (error) {
            console.error(
                "Audit load failed:",
                error
            );

            errorBox.hidden = false;
            errorBox.textContent =
                error?.message ||
                "Audit history could not be loaded.";
        }
    }

    load();
})();
