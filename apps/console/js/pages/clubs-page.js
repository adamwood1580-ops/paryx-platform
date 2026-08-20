(function () {
    "use strict";

    const state = {
        rows: [],
        isOwner: false
    };

    const search =
        document.getElementById(
            "clubSearch"
        );

    const tableBody =
        document.getElementById(
            "clubTableBody"
        );

    const resultCount =
        document.getElementById(
            "clubResultCount"
        );

    const errorBox =
        document.getElementById(
            "clubError"
        );

    const successBox =
        document.getElementById(
            "clubSuccess"
        );

    const createForm =
        document.getElementById(
            "createClubForm"
        );

    const createButton =
        document.getElementById(
            "createClubButton"
        );

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function showMessage(
        element,
        text
    ) {
        element.textContent = text;
        element.hidden = false;
    }

    function clearMessages() {
        errorBox.hidden = true;
        successBox.hidden = true;
    }

    function slugify(value) {
        return String(value || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .replace(/-+/g, "-");
    }

    function render(rows) {
        resultCount.textContent =
            `${rows.length} club${rows.length === 1 ? "" : "s"}`;

        if (!rows.length) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="8">
                        <div class="console-empty">
                            No clubs found.
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML =
            rows.map(function (row) {
                const active =
                    row.is_active === true;

                return `
                    <tr>
                        <td>
                            <strong>${escapeHtml(row.club_name)}</strong>
                            <small>${escapeHtml(row.club_slug)}</small>
                        </td>
                        <td>
                            <span class="status-pill ${active ? "status-pill--active" : "status-pill--inactive"}">
                                ${active ? "Active" : "Suspended"}
                            </span>
                        </td>
                        <td>${escapeHtml(row.club_timezone)}</td>
                        <td>${Number(row.member_count || 0)}</td>
                        <td>${Number(row.staff_count || 0)}</td>
                        <td>${Number(row.course_count || 0)}</td>
                        <td>${Number(row.upcoming_event_count || 0)}</td>
                        <td>
                            <div class="console-actions">
                                <button
                                    class="console-button ${active ? "console-button--danger" : ""}"
                                    type="button"
                                    data-club-action
                                    data-club-id="${escapeHtml(row.club_id)}"
                                    data-club-name="${escapeHtml(row.club_name)}"
                                    data-active="${active ? "true" : "false"}"
                                >
                                    ${active ? "Suspend" : "Reactivate"}
                                </button>

                                ${
                                    state.isOwner
                                        ? `
                                            <button
                                                class="console-button console-button--secondary console-delete-link"
                                                type="button"
                                                data-club-delete
                                                data-club-id="${escapeHtml(row.club_id)}"
                                                data-club-name="${escapeHtml(row.club_name)}"
                                            >
                                                Delete
                                            </button>
                                        `
                                        : ""
                                }
                            </div>
                        </td>
                    </tr>
                `;
            }).join("");
    }

    async function loadClubs() {
        clearMessages();

        const {
            data,
            error
        } =
            await window.supabaseClient.rpc(
                "platform_list_clubs",
                {
                    p_search:
                        search.value.trim() ||
                        null,
                    p_limit: 200,
                    p_offset: 0
                }
            );

        if (error) {
            throw error;
        }

        state.rows =
            Array.isArray(data)
                ? data
                : [];

        render(state.rows);
    }

    async function changeClubState(button) {
        const clubId =
            button.dataset.clubId;

        const clubName =
            button.dataset.clubName;

        const currentlyActive =
            button.dataset.active === "true";

        const nextActive =
            !currentlyActive;

        const action =
            nextActive
                ? "reactivate"
                : "suspend";

        if (
            !window.confirm(
                `${action.charAt(0).toUpperCase() + action.slice(1)} ${clubName}?`
            )
        ) {
            return;
        }

        button.disabled = true;

        try {
            const {
                error
            } =
                await window.supabaseClient.rpc(
                    "platform_set_club_active",
                    {
                        p_club_id:
                            clubId,
                        p_is_active:
                            nextActive,
                        p_reason:
                            "Changed from Paryx Console"
                    }
                );

            if (error) {
                throw error;
            }

            showMessage(
                successBox,
                `${clubName} has been ${nextActive ? "reactivated" : "suspended"}.`
            );

            await loadClubs();
        } catch (error) {
            console.error(
                "Club status update failed:",
                error
            );

            showMessage(
                errorBox,
                error?.message ||
                "The club could not be updated."
            );
        } finally {
            button.disabled = false;
        }
    }

    async function deleteClub(button) {
        const clubId =
            button.dataset.clubId;

        const clubName =
            button.dataset.clubName;

        if (!clubId || !clubName) {
            return;
        }

        const firstConfirmed =
            window.confirm(
                `Permanently delete ${clubName}?\\n\\nThis removes the tenant and its club-owned data. This cannot be undone.`
            );

        if (!firstConfirmed) {
            return;
        }

        const typed =
            window.prompt(
                `Type the club name exactly to confirm deletion:\\n\\n${clubName}`
            );

        if (typed !== clubName) {
            if (typed !== null) {
                showMessage(
                    errorBox,
                    "Club name did not match. Nothing was deleted."
                );
            }

            return;
        }

        button.disabled = true;
        clearMessages();

        try {
            const {
                error
            } =
                await window.supabaseClient.rpc(
                    "platform_delete_club",
                    {
                        p_club_id:
                            clubId,
                        p_confirmation:
                            typed
                    }
                );

            if (error) {
                throw error;
            }

            showMessage(
                successBox,
                `${clubName} was permanently deleted.`
            );

            await loadClubs();
        } catch (error) {
            console.error(
                "Club deletion failed:",
                error
            );

            showMessage(
                errorBox,
                error?.message ||
                "The club could not be deleted."
            );
        } finally {
            button.disabled = false;
        }
    }

    tableBody.addEventListener(
        "click",
        function (event) {
            const statusButton =
                event.target.closest(
                    "[data-club-action]"
                );

            if (statusButton) {
                changeClubState(statusButton);
                return;
            }

            const deleteButton =
                event.target.closest(
                    "[data-club-delete]"
                );

            if (deleteButton) {
                deleteClub(deleteButton);
            }
        }
    );

    let searchTimer = null;

    search.addEventListener(
        "input",
        function () {
            window.clearTimeout(
                searchTimer
            );

            searchTimer =
                window.setTimeout(
                    function () {
                        loadClubs().catch(
                            function (error) {
                                showMessage(
                                    errorBox,
                                    error?.message ||
                                    "Club search failed."
                                );
                            }
                        );
                    },
                    250
                );
        }
    );

    const nameInput =
        document.getElementById(
            "newClubName"
        );

    const slugInput =
        document.getElementById(
            "newClubSlug"
        );

    let slugWasEdited = false;

    slugInput.addEventListener(
        "input",
        function () {
            slugWasEdited = true;
        }
    );

    nameInput.addEventListener(
        "input",
        function () {
            if (!slugWasEdited) {
                slugInput.value =
                    slugify(
                        nameInput.value
                    );
            }
        }
    );

    createForm.addEventListener(
        "submit",
        async function (event) {
            event.preventDefault();
            clearMessages();

            createButton.disabled = true;
            createButton.textContent =
                "Creating…";

            try {
                const {
                    data,
                    error
                } =
                    await window.supabaseClient.rpc(
                        "platform_create_club",
                        {
                            p_name:
                                nameInput.value.trim(),
                            p_slug:
                                slugInput.value.trim(),
                            p_timezone:
                                document.getElementById(
                                    "newClubTimezone"
                                ).value.trim()
                        }
                    );

                if (error) {
                    throw error;
                }

                const row =
                    Array.isArray(data)
                        ? data[0]
                        : data;

                showMessage(
                    successBox,
                    `${row?.club_name || "The club"} was created.`
                );

                createForm.reset();
                document.getElementById(
                    "newClubTimezone"
                ).value =
                    "Europe/London";

                slugWasEdited = false;

                await loadClubs();
            } catch (error) {
                console.error(
                    "Club creation failed:",
                    error
                );

                showMessage(
                    errorBox,
                    error?.message ||
                    "The club could not be created."
                );
            } finally {
                createButton.disabled = false;
                createButton.textContent =
                    "Create club";
            }
        }
    );

    window.ParyxConsole.ready
        .then(function (context) {
            state.isOwner =
                context?.access?.role ===
                "platform_owner";

            return loadClubs();
        })
        .catch(function (error) {
            showMessage(
                errorBox,
                error?.message ||
                "Paryx Console access could not be verified."
            );
        });
})();
