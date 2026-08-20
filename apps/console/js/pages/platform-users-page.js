(function () {
    "use strict";

    const errorBox =
        document.getElementById(
            "platformUserError"
        );

    const successBox =
        document.getElementById(
            "platformUserSuccess"
        );

    const tableBody =
        document.getElementById(
            "platformUserTableBody"
        );

    const form =
        document.getElementById(
            "platformUserForm"
        );

    const submit =
        document.getElementById(
            "platformUserSubmit"
        );

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function roleLabel(value) {
        return String(value || "")
            .replace(/^platform_/, "")
            .replaceAll("_", " ");
    }

    function show(
        box,
        message
    ) {
        box.textContent = message;
        box.hidden = false;
    }

    function clear() {
        errorBox.hidden = true;
        successBox.hidden = true;
    }

    function render(rows) {
        if (!rows.length) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="6">
                        <div class="console-empty">
                            No platform users configured.
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
                        <td>
                            <strong>${escapeHtml(row.display_name || row.email)}</strong>
                            <small>${escapeHtml(row.email)}</small>
                        </td>
                        <td>${escapeHtml(roleLabel(row.role))}</td>
                        <td>
                            <span class="status-pill ${row.is_active ? "status-pill--active" : "status-pill--inactive"}">
                                ${row.is_active ? "Active" : "Inactive"}
                            </span>
                        </td>
                        <td>${new Date(row.created_at).toLocaleDateString("en-GB")}</td>
                        <td>${new Date(row.updated_at).toLocaleDateString("en-GB")}</td>
                        <td>
                            ${
                                row.user_id !== window.ParyxConsole?.context?.user?.id
                                    ? `
                                        <button
                                            class="console-button console-button--secondary console-delete-link"
                                            type="button"
                                            data-platform-user-remove
                                            data-user-id="${escapeHtml(row.user_id)}"
                                            data-user-email="${escapeHtml(row.email)}"
                                        >
                                            Remove access
                                        </button>
                                    `
                                    : "<small>Current account</small>"
                            }
                        </td>
                    </tr>
                `;
            }).join("");
    }

    async function loadUsers() {
        const {
            data,
            error
        } =
            await window.supabaseClient.rpc(
                "platform_list_platform_users"
            );

        if (error) {
            throw error;
        }

        render(
            Array.isArray(data)
                ? data
                : []
        );
    }

    async function removePlatformAccess(button) {
        const userId =
            button.dataset.userId;

        const email =
            button.dataset.userEmail ||
            "this account";

        if (!userId) {
            return;
        }

        if (
            !window.confirm(
                `Remove Paryx Console access from ${email}?\\n\\nThis does not delete the person's normal Paryx account or club memberships.`
            )
        ) {
            return;
        }

        clear();
        button.disabled = true;

        try {
            const {
                error
            } =
                await window.supabaseClient.rpc(
                    "platform_remove_user_access",
                    {
                        p_user_id:
                            userId
                    }
                );

            if (error) {
                throw error;
            }

            show(
                successBox,
                `Paryx Console access removed from ${email}.`
            );

            await loadUsers();
        } catch (error) {
            console.error(
                "Platform access removal failed:",
                error
            );

            show(
                errorBox,
                error?.message ||
                "Platform access could not be removed."
            );
        } finally {
            button.disabled = false;
        }
    }

    async function initialise() {
        const context =
            await window.ParyxConsole.ready;

        const owner =
            context?.access?.role ===
            "platform_owner";

        if (!owner) {
            form.hidden = true;

            document
                .getElementById(
                    "ownerOnlyNote"
                )
                .hidden = false;
        }

        await loadUsers();
    }

    tableBody.addEventListener(
        "click",
        function (event) {
            const button =
                event.target.closest(
                    "[data-platform-user-remove]"
                );

            if (button) {
                removePlatformAccess(button);
            }
        }
    );

    form.addEventListener(
        "submit",
        async function (event) {
            event.preventDefault();
            clear();

            submit.disabled = true;
            submit.textContent =
                "Saving…";

            try {
                const {
                    error
                } =
                    await window.supabaseClient.rpc(
                        "platform_set_user_access",
                        {
                            p_email:
                                document.getElementById(
                                    "platformUserEmail"
                                ).value.trim(),

                            p_role:
                                document.getElementById(
                                    "platformUserRole"
                                ).value,

                            p_is_active:
                                document.getElementById(
                                    "platformUserActive"
                                ).checked
                        }
                    );

                if (error) {
                    throw error;
                }

                show(
                    successBox,
                    "Platform access updated."
                );

                await loadUsers();
            } catch (error) {
                console.error(
                    "Platform user update failed:",
                    error
                );

                show(
                    errorBox,
                    error?.message ||
                    "Platform access could not be updated."
                );
            } finally {
                submit.disabled = false;
                submit.textContent =
                    "Save platform access";
            }
        }
    );

    initialise().catch(function (error) {
        show(
            errorBox,
            error?.message ||
            "Platform users could not be loaded."
        );
    });
})();
