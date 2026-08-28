(function () {
    "use strict";

    const state = {
        rows: [],
        role: null,
        isOwner: false,
        canManage: false,
        selectedClub: null
    };

    const elements = {
        search:
            document.getElementById(
                "clubSearch"
            ),

        table:
            document.getElementById(
                "clubTableBody"
            ),

        resultCount:
            document.getElementById(
                "clubResultCount"
            ),

        error:
            document.getElementById(
                "clubError"
            ),

        success:
            document.getElementById(
                "clubSuccess"
            ),

        createPanel:
            document.getElementById(
                "createClubPanel"
            ),

        createForm:
            document.getElementById(
                "createClubForm"
            ),

        createButton:
            document.getElementById(
                "createClubButton"
            ),

        name:
            document.getElementById(
                "newClubName"
            ),

        slug:
            document.getElementById(
                "newClubSlug"
            ),

        timezone:
            document.getElementById(
                "newClubTimezone"
            ),

        dialog:
            document.getElementById(
                "clubDetailDialog"
            ),

        detailForm:
            document.getElementById(
                "clubDetailForm"
            ),

        detailClose:
            document.getElementById(
                "clubDetailClose"
            ),

        detailCancel:
            document.getElementById(
                "clubDetailCancel"
            ),

        detailSave:
            document.getElementById(
                "clubDetailSave"
            ),

        detailReadOnly:
            document.getElementById(
                "clubDetailReadOnlyNote"
            ),

        detailId:
            document.getElementById(
                "clubDetailId"
            ),

        detailTitle:
            document.getElementById(
                "clubDetailTitle"
            ),

        detailSubtitle:
            document.getElementById(
                "clubDetailSubtitle"
            ),

        detailStatus:
            document.getElementById(
                "clubDetailStatus"
            ),

        detailCreated:
            document.getElementById(
                "clubDetailCreated"
            ),

        detailName:
            document.getElementById(
                "clubDetailName"
            ),

        detailSlug:
            document.getElementById(
                "clubDetailSlug"
            ),

        detailTimezone:
            document.getElementById(
                "clubDetailTimezone"
            ),

        metricMembers:
            document.getElementById(
                "clubMetricMembers"
            ),

        metricStaff:
            document.getElementById(
                "clubMetricStaff"
            ),

        metricCourses:
            document.getElementById(
                "clubMetricCourses"
            ),

        metricEvents:
            document.getElementById(
                "clubMetricEvents"
            ),

        metricTeeTimes:
            document.getElementById(
                "clubMetricTeeTimes"
            ),

        metricBookings:
            document.getElementById(
                "clubMetricBookings"
            ),

        metricPlayers:
            document.getElementById(
                "clubMetricPlayers"
            ),

        metricBookings30:
            document.getElementById(
                "clubMetricBookings30"
            ),

        metricRenewals:
            document.getElementById(
                "clubMetricRenewals"
            ),

        metricAccessRequests:
            document.getElementById(
                "clubMetricAccessRequests"
            ),

        adminName:
            document.getElementById(
                "clubDetailAdminName"
            ),

        adminEmail:
            document.getElementById(
                "clubDetailAdminEmail"
            )
    };

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function showMessage(
        target,
        message
    ) {
        target.textContent =
            message;

        target.hidden =
            false;
    }

    function clearMessages() {
        elements.error.hidden =
            true;

        elements.success.hidden =
            true;
    }

    function readableError(error) {
        if (
            error &&
            typeof error.message ===
                "string" &&
            error.message.trim()
        ) {
            return error.message.trim();
        }

        return String(
            error ||
            "An unknown error occurred."
        );
    }

    function slugify(value) {
        return String(value || "")
            .trim()
            .toLowerCase()
            .replace(
                /[^a-z0-9]+/g,
                "-"
            )
            .replace(
                /^-+|-+$/g,
                ""
            )
            .replace(
                /-+/g,
                "-"
            );
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
                dateStyle:
                    "medium"
            }
        ).format(date);
    }

    function render(rows) {
        elements.resultCount
            .textContent =
            `${rows.length} club${
                rows.length === 1
                    ? ""
                    : "s"
            }`;

        if (!rows.length) {
            elements.table.innerHTML = `
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

        elements.table.innerHTML =
            rows
                .map(
                    function (row) {
                        const active =
                            row.is_active ===
                            true;

                        return `
                            <tr>
                                <td>
                                    <strong>
                                        ${escapeHtml(
                                            row.club_name
                                        )}
                                    </strong>

                                    <small>
                                        ${escapeHtml(
                                            row.club_slug
                                        )}
                                    </small>
                                </td>

                                <td>
                                    <span
                                        class="status-pill ${
                                            active
                                                ? "status-pill--active"
                                                : "status-pill--inactive"
                                        }"
                                    >
                                        ${
                                            active
                                                ? "Active"
                                                : "Suspended"
                                        }
                                    </span>
                                </td>

                                <td>
                                    ${escapeHtml(
                                        row.club_timezone
                                    )}
                                </td>

                                <td>
                                    ${Number(
                                        row.member_count ||
                                        0
                                    )}
                                </td>

                                <td>
                                    ${Number(
                                        row.staff_count ||
                                        0
                                    )}
                                </td>

                                <td>
                                    ${Number(
                                        row.course_count ||
                                        0
                                    )}
                                </td>

                                <td>
                                    ${Number(
                                        row.upcoming_event_count ||
                                        0
                                    )}
                                </td>

                                <td>
                                    <div class="console-actions">
                                        <button
                                            class="console-button console-button--secondary"
                                            type="button"
                                            data-club-view
                                            data-club-id="${escapeHtml(
                                                row.club_id
                                            )}"
                                        >
                                            View
                                        </button>

                                        ${
                                            state.canManage
                                                ? `
                                                    <button
                                                        class="console-button ${
                                                            active
                                                                ? "console-button--danger"
                                                                : ""
                                                        }"
                                                        type="button"
                                                        data-club-action
                                                        data-club-id="${escapeHtml(
                                                            row.club_id
                                                        )}"
                                                        data-club-name="${escapeHtml(
                                                            row.club_name
                                                        )}"
                                                        data-active="${
                                                            active
                                                                ? "true"
                                                                : "false"
                                                        }"
                                                    >
                                                        ${
                                                            active
                                                                ? "Suspend"
                                                                : "Reactivate"
                                                        }
                                                    </button>
                                                `
                                                : ""
                                        }

                                        ${
                                            state.isOwner
                                                ? `
                                                    <button
                                                        class="console-button console-button--secondary console-delete-link"
                                                        type="button"
                                                        data-club-delete
                                                        data-club-id="${escapeHtml(
                                                            row.club_id
                                                        )}"
                                                        data-club-name="${escapeHtml(
                                                            row.club_name
                                                        )}"
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
                    }
                )
                .join("");
    }

    async function loadClubs() {
        clearMessages();

        const {
            data,
            error
        } =
            await window
                .supabaseClient
                .rpc(
                    "platform_list_clubs",
                    {
                        p_search:
                            elements
                                .search
                                .value
                                .trim() ||
                            null,
                        p_limit:
                            200,
                        p_offset:
                            0
                    }
                );

        if (error) {
            throw error;
        }

        state.rows =
            Array.isArray(data)
                ? data
                : [];

        render(
            state.rows
        );
    }

    async function changeClubState(
        button
    ) {
        const clubId =
            button.dataset
                .clubId;

        const clubName =
            button.dataset
                .clubName;

        const currentlyActive =
            button.dataset
                .active ===
            "true";

        const nextActive =
            !currentlyActive;

        const action =
            nextActive
                ? "reactivate"
                : "suspend";

        if (
            !window.confirm(
                `${action.charAt(0).toUpperCase() +
                action.slice(1)} ${clubName}?`
            )
        ) {
            return;
        }

        button.disabled =
            true;

        try {
            const {
                error
            } =
                await window
                    .supabaseClient
                    .rpc(
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
                elements.success,
                `${clubName} has been ${
                    nextActive
                        ? "reactivated"
                        : "suspended"
                }.`
            );

            await loadClubs();
        } catch (error) {
            showMessage(
                elements.error,
                readableError(
                    error
                )
            );
        } finally {
            button.disabled =
                false;
        }
    }

    async function deleteClub(button) {
        const clubId =
            button.dataset
                .clubId;

        const clubName =
            button.dataset
                .clubName;

        if (!clubId || !clubName) {
            return;
        }

        const firstConfirmed =
            window.confirm(
                `Permanently delete ${clubName}?\n\nThis removes the tenant and its club-owned data. This cannot be undone.`
            );

        if (!firstConfirmed) {
            return;
        }

        const typed =
            window.prompt(
                `Type the club name exactly to confirm deletion:\n\n${clubName}`
            );

        if (typed !== clubName) {
            if (typed !== null) {
                showMessage(
                    elements.error,
                    "Club name did not match. Nothing was deleted."
                );
            }

            return;
        }

        button.disabled =
            true;

        clearMessages();

        try {
            const {
                error
            } =
                await window
                    .supabaseClient
                    .rpc(
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
                elements.success,
                `${clubName} was permanently deleted.`
            );

            await loadClubs();
        } catch (error) {
            showMessage(
                elements.error,
                readableError(
                    error
                )
            );
        } finally {
            button.disabled =
                false;
        }
    }

    function setMetric(
        element,
        value
    ) {
        element.textContent =
            new Intl.NumberFormat(
                "en-GB"
            ).format(
                Number(
                    value ||
                    0
                )
            );
    }

    function applyDetailEditState() {
        [
            elements.detailName,
            elements.detailTimezone
        ].forEach(
            function (input) {
                input.disabled =
                    !state.canManage;
            }
        );

        elements.detailSave.hidden =
            !state.canManage;

        elements.detailReadOnly.hidden =
            state.canManage;
    }

    function renderClubDetail(detail) {
        state.selectedClub =
            detail;

        const active =
            detail.is_active ===
            true;

        elements.detailId.value =
            detail.club_id;

        elements.detailTitle
            .textContent =
            detail.club_name;

        elements.detailSubtitle
            .textContent =
            detail.club_slug;

        elements.detailName.value =
            detail.club_name;

        elements.detailSlug.value =
            detail.club_slug;

        elements.detailTimezone.value =
            detail.club_timezone;

        elements.detailStatus
            .textContent =
            active
                ? "Active"
                : "Suspended";

        elements.detailStatus
            .className =
            `status-pill ${
                active
                    ? "status-pill--active"
                    : "status-pill--inactive"
            }`;

        elements.detailCreated
            .textContent =
            `Created ${formatDate(
                detail.created_at
            )}`;

        setMetric(
            elements.metricMembers,
            detail.member_count
        );

        setMetric(
            elements.metricStaff,
            detail.staff_count
        );

        setMetric(
            elements.metricCourses,
            detail.course_count
        );

        setMetric(
            elements.metricEvents,
            detail.upcoming_event_count
        );

        setMetric(
            elements.metricTeeTimes,
            detail.today_tee_time_count
        );

        setMetric(
            elements.metricBookings,
            detail.today_booking_count
        );

        setMetric(
            elements.metricPlayers,
            detail.today_player_count
        );

        setMetric(
            elements.metricBookings30,
            detail.next_30_day_booking_count
        );

        setMetric(
            elements.metricRenewals,
            detail.renewals_due_90_count
        );

        setMetric(
            elements.metricAccessRequests,
            detail.pending_access_request_count
        );

        elements.adminName.textContent =
            detail.primary_admin_name ||
            "Not assigned";

        elements.adminEmail.textContent =
            detail.primary_admin_email ||
            "—";

        applyDetailEditState();
    }

    async function openClubDetail(
        clubId
    ) {
        clearMessages();

        elements.dialog.showModal();

        elements.detailTitle
            .textContent =
            "Loading…";

        try {
            const {
                data,
                error
            } =
                await window
                    .supabaseClient
                    .rpc(
                        "platform_get_club_detail",
                        {
                            p_club_id:
                                clubId
                        }
                    );

            if (error) {
                throw error;
            }

            const detail =
                Array.isArray(data)
                    ? data[0]
                    : data;

            if (!detail) {
                throw new Error(
                    "Club details were not returned."
                );
            }

            renderClubDetail(
                detail
            );
        } catch (error) {
            elements.dialog.close();

            showMessage(
                elements.error,
                readableError(
                    error
                )
            );
        }
    }

    async function saveClubDetail(
        event
    ) {
        event.preventDefault();

        if (
            !state.canManage ||
            !state.selectedClub
        ) {
            return;
        }

        clearMessages();

        elements.detailSave.disabled =
            true;

        elements.detailSave.textContent =
            "Saving…";

        try {
            const {
                error
            } =
                await window
                    .supabaseClient
                    .rpc(
                        "platform_update_club_details",
                        {
                            p_club_id:
                                state.selectedClub
                                    .club_id,
                            p_name:
                                elements
                                    .detailName
                                    .value
                                    .trim(),
                            p_timezone:
                                elements
                                    .detailTimezone
                                    .value
                                    .trim()
                        }
                    );

            if (error) {
                throw error;
            }

            showMessage(
                elements.success,
                "Club details updated."
            );

            await loadClubs();

            await openClubDetail(
                state.selectedClub
                    .club_id
            );
        } catch (error) {
            showMessage(
                elements.error,
                readableError(
                    error
                )
            );
        } finally {
            elements.detailSave.disabled =
                false;

            elements.detailSave.textContent =
                "Save club details";
        }
    }

    let searchTimer =
        null;

    let slugWasEdited =
        false;

    elements.search.addEventListener(
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
                                    elements.error,
                                    readableError(
                                        error
                                    )
                                );
                            }
                        );
                    },
                    250
                );
        }
    );

    elements.slug.addEventListener(
        "input",
        function () {
            slugWasEdited =
                true;
        }
    );

    elements.name.addEventListener(
        "input",
        function () {
            if (!slugWasEdited) {
                elements.slug.value =
                    slugify(
                        elements
                            .name
                            .value
                    );
            }
        }
    );

    elements.table.addEventListener(
        "click",
        function (event) {
            const viewButton =
                event.target.closest(
                    "[data-club-view]"
                );

            if (viewButton) {
                openClubDetail(
                    viewButton.dataset
                        .clubId
                );

                return;
            }

            const statusButton =
                event.target.closest(
                    "[data-club-action]"
                );

            if (statusButton) {
                changeClubState(
                    statusButton
                );

                return;
            }

            const deleteButton =
                event.target.closest(
                    "[data-club-delete]"
                );

            if (deleteButton) {
                deleteClub(
                    deleteButton
                );
            }
        }
    );

    elements.createForm.addEventListener(
        "submit",
        async function (event) {
            event.preventDefault();

            if (!state.canManage) {
                return;
            }

            clearMessages();

            elements.createButton.disabled =
                true;

            elements.createButton.textContent =
                "Creating…";

            try {
                const {
                    data,
                    error
                } =
                    await window
                        .supabaseClient
                        .rpc(
                            "platform_create_club",
                            {
                                p_name:
                                    elements
                                        .name
                                        .value
                                        .trim(),
                                p_slug:
                                    elements
                                        .slug
                                        .value
                                        .trim(),
                                p_timezone:
                                    elements
                                        .timezone
                                        .value
                                        .trim()
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
                    elements.success,
                    `${
                        row?.club_name ||
                        "The club"
                    } was created.`
                );

                elements.createForm.reset();

                elements.timezone.value =
                    "Europe/London";

                slugWasEdited =
                    false;

                await loadClubs();
            } catch (error) {
                showMessage(
                    elements.error,
                    readableError(
                        error
                    )
                );
            } finally {
                elements.createButton.disabled =
                    false;

                elements.createButton.textContent =
                    "Create club";
            }
        }
    );

    elements.detailForm
        .addEventListener(
            "submit",
            saveClubDetail
        );

    [
        elements.detailClose,
        elements.detailCancel
    ].forEach(
        function (button) {
            button.addEventListener(
                "click",
                function () {
                    elements.dialog
                        .close();
                }
            );
        }
    );

    window.ParyxConsole.ready
        .then(
            function (context) {
                state.role =
                    context
                        ?.access
                        ?.role ||
                    null;

                state.isOwner =
                    state.role ===
                    "platform_owner";

                state.canManage =
                    [
                        "platform_owner",
                        "platform_admin"
                    ].includes(
                        state.role
                    );

                elements.createPanel.hidden =
                    !state.canManage;

                return loadClubs();
            }
        )
        .catch(
            function (error) {
                showMessage(
                    elements.error,
                    readableError(
                        error
                    )
                );
            }
        );
})();
