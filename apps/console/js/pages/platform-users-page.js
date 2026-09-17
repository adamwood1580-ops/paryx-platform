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

    const testLoginPanel =
        document.getElementById(
            "testLoginPanel"
        );

    const testLoginForm =
        document.getElementById(
            "testLoginForm"
        );

    const testLoginSubmit =
        document.getElementById(
            "testLoginSubmit"
        );

    const testLoginClub =
        document.getElementById(
            "testLoginClub"
        );

    const testLoginRole =
        document.getElementById(
            "testLoginRole"
        );

    const testLoginInlineMessage =
        document.getElementById(
            "testLoginInlineMessage"
        );

    const state = {
        isOwner: false
    };

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

    function showTestLoginMessage(message, kind) {
        if (!testLoginInlineMessage) {
            return;
        }

        testLoginInlineMessage.textContent = message;
        testLoginInlineMessage.hidden = false;
        testLoginInlineMessage.setAttribute(
            "data-status",
            kind || "info"
        );
    }

    function clearTestLoginMessage() {
        if (!testLoginInlineMessage) {
            return;
        }

        testLoginInlineMessage.hidden = true;
        testLoginInlineMessage.textContent = "";
        testLoginInlineMessage.removeAttribute(
            "data-status"
        );
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
                                row.user_id === window.ParyxConsole?.context?.user?.id
                                    ? "<small>Current account</small>"
                                    : state.isOwner
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
                                        : "<small>Owner only</small>"
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
        if (!state.isOwner) {
            show(
                errorBox,
                "Only a Platform Owner can remove Console access."
            );

            return;
        }

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

    async function loadTestClubs() {
        if (!testLoginClub) {
            return;
        }

        const {
            data,
            error
        } =
            await window.supabaseClient.rpc(
                "platform_list_clubs",
                {
                    p_search: null,
                    p_limit: 250,
                    p_offset: 0
                }
            );

        if (error) {
            throw error;
        }

        const clubs =
            (Array.isArray(data) ? data : [])
                .filter(function (row) {
                    return row.is_active !== false;
                });

        testLoginClub.innerHTML =
            clubs.length
                ? clubs.map(function (row) {
                    return `<option value="${escapeHtml(row.club_id)}">${escapeHtml(row.club_name)}</option>`;
                }).join("")
                : '<option value="">No active clubs available</option>';

        return clubs.length;
    }

    async function initialise() {
        const context =
            await window.ParyxConsole.ready;

        const owner =
            context?.access?.role ===
            "platform_owner";

        state.isOwner =
            owner;

        if (!owner) {
            form.hidden = true;

            if (testLoginPanel) {
                testLoginPanel.hidden = true;
            }

            document
                .getElementById(
                    "ownerOnlyNote"
                )
                .hidden = false;
        } else {
            try {
                const clubCount =
                    await loadTestClubs();

                if (testLoginPanel) {
                    testLoginPanel.hidden = false;
                }

                if (clubCount > 0) {
                    testLoginSubmit.disabled = false;
                    showTestLoginMessage(
                        "Test-login creator is ready.",
                        "ready"
                    );
                } else {
                    testLoginSubmit.disabled = true;
                    showTestLoginMessage(
                        "No active clubs are available for a ClubHub test login.",
                        "error"
                    );
                }
            } catch (error) {
                if (testLoginPanel) {
                    testLoginPanel.hidden = false;
                }

                testLoginSubmit.disabled = true;
                showTestLoginMessage(
                    error?.message ||
                    "The club list could not be loaded.",
                    "error"
                );
            }
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

    async function createClubHubTestLogin() {
        clear();
        clearTestLoginMessage();

        if (!state.isOwner) {
            showTestLoginMessage(
                "Only a Platform Owner can create test logins.",
                "error"
            );
            return;
        }

        if (!testLoginForm.checkValidity()) {
            testLoginForm.reportValidity();
            showTestLoginMessage(
                "Complete all required fields before creating the test login.",
                "error"
            );
            return;
        }

        const firstName =
            document.getElementById(
                "testLoginFirstName"
            ).value.trim();

        const lastName =
            document.getElementById(
                "testLoginLastName"
            ).value.trim();

        const email =
            document.getElementById(
                "testLoginEmail"
            ).value.trim();

        const password =
            document.getElementById(
                "testLoginPassword"
            ).value;

        if (
            !email
                .split("@")[0]
                ?.toLowerCase()
                .includes("+test")
        ) {
            showTestLoginMessage(
                "Use a test email containing +test before the @ symbol, for example name+test1@example.com.",
                "error"
            );
            return;
        }

        if (!testLoginClub.value) {
            showTestLoginMessage(
                "Select an active club.",
                "error"
            );
            return;
        }

        testLoginSubmit.disabled = true;
        testLoginSubmit.textContent =
            "Creating…";

        showTestLoginMessage(
            "Creating the confirmed Paryx account and ClubHub staff access…",
            "working"
        );

        try {
            const {
                data: sessionData,
                error: sessionError
            } =
                await window.supabaseClient
                    .auth
                    .getSession();

            const accessToken =
                sessionData?.session?.access_token;

            if (
                sessionError ||
                !accessToken
            ) {
                throw (
                    sessionError ||
                    new Error(
                        "Your Paryx Console session is not ready. Sign in again and retry."
                    )
                );
            }

            const {
                data,
                error
            } =
                await window.supabaseClient
                    .functions
                    .invoke(
                        "admin-create-test-user",
                        {
                            headers: {
                                Authorization:
                                    `Bearer ${accessToken}`
                            },
                            body: {
                                firstName,
                                lastName,
                                email,
                                password,
                                clubId:
                                    testLoginClub.value,
                                role:
                                    testLoginRole.value
                            }
                        }
                    );

            if (error) {
                let message =
                    error.message ||
                    "Test login could not be created.";

                try {
                    const response =
                        error.context;

                    if (
                        response &&
                        typeof response.clone ===
                            "function"
                    ) {
                        const clone =
                            response.clone();

                        const contentType =
                            clone.headers?.get?.(
                                "content-type"
                            ) || "";

                        if (
                            contentType.includes(
                                "application/json"
                            )
                        ) {
                            const payload =
                                await clone.json();

                            message =
                                payload?.error ||
                                message;
                        } else {
                            const text =
                                await clone.text();

                            if (text.trim()) {
                                message =
                                    text.trim();
                            }
                        }
                    }
                } catch {
                    // Keep the Supabase Functions error message.
                }

                if (
                    message ===
                    "Failed to send a request to the Edge Function"
                ) {
                    message =
                        "The browser could not complete the Edge Function request. The v0.30.3 function includes the current Supabase CORS headers and sends your Console session explicitly. If this message remains after redeploying admin-create-test-user, check Supabase → Edge Functions → admin-create-test-user → Invocations: no invocation means the gateway/deployment is blocking the request; an invocation means open its log for the returned server error.";
                }

                throw new Error(message);
            }

            if (data?.error) {
                throw new Error(
                    data.error
                );
            }

            const roleLabel =
                testLoginRole.options[
                    testLoginRole.selectedIndex
                ]?.text ||
                testLoginRole.value;

            const clubLabel =
                testLoginClub.options[
                    testLoginClub.selectedIndex
                ]?.text ||
                "the selected club";

            showTestLoginMessage(
                `Created ${email}. The account is email-confirmed and has active ${roleLabel} access to ${clubLabel}.`,
                "success"
            );

            show(
                successBox,
                `ClubHub smoke-test login created for ${email}.`
            );

            document.getElementById(
                "testLoginPassword"
            ).value = "";
        } catch (error) {
            console.error(
                "Test login creation failed:",
                error
            );

            const message =
                error?.message ||
                "Test login could not be created.";

            showTestLoginMessage(
                message,
                "error"
            );

            show(
                errorBox,
                message
            );
        } finally {
            testLoginSubmit.disabled = false;
            testLoginSubmit.textContent =
                "Create ClubHub test login";
        }
    }

    if (testLoginForm) {
        testLoginForm.addEventListener(
            "submit",
            function (event) {
                event.preventDefault();
                createClubHubTestLogin();
            }
        );
    }

    if (testLoginSubmit) {
        testLoginSubmit.addEventListener(
            "click",
            function (event) {
                event.preventDefault();
                createClubHubTestLogin();
            }
        );
    }

    initialise().catch(function (error) {
        show(
            errorBox,
            error?.message ||
            "Platform users could not be loaded."
        );
    });
})();
