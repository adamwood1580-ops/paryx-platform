(function () {
    "use strict";

    const state = {
        rows: [],
        role: null,
        isOwner: false,
        canManage: false,
        selectedClub: null,
        moduleCatalog: []
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

        courseName:
            document.getElementById(
                "newCourseName"
            ),

        courseHoles:
            document.getElementById(
                "newCourseHoles"
            ),

        singleCourseMode:
            document.getElementById(
                "newSingleCourseMode"
            ),

        adminFirstName:
            document.getElementById(
                "newAdminFirstName"
            ),

        adminLastName:
            document.getElementById(
                "newAdminLastName"
            ),

        adminEmail:
            document.getElementById(
                "newAdminEmail"
            ),

        newModuleGrid:
            document.getElementById(
                "newModuleGrid"
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

        detailModuleGrid:
            document.getElementById(
                "detailModuleGrid"
            ),

        moduleReadOnly:
            document.getElementById(
                "clubModuleReadOnlyNote"
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

    function moduleMap(rows) {
        const result = {};

        state.moduleCatalog.forEach(function (module) {
            result[module.module_key] =
                module.required === true ||
                module.default_enabled === true;
        });

        (Array.isArray(rows)
            ? rows
            : []
        ).forEach(
            function (row) {
                result[row.module_key] =
                    row.is_enabled === true;
            }
        );

        return result;
    }

    function updateModuleStateLabel(element, enabled) {
        if (!element) {
            return;
        }

        element.textContent =
            enabled
                ? "Enabled"
                : "Disabled";

        element.className =
            `console-module-state ${
                enabled
                    ? "console-module-state--enabled"
                    : ""
            }`;
    }

    function moduleInput(grid, moduleKey) {
        return grid.querySelector(
            `[data-module-key="${moduleKey}"]`
        );
    }

    function updateGridStateLabels(grid) {
        grid.querySelectorAll("[data-module-key]")
            .forEach(function (input) {
                updateModuleStateLabel(
                    grid.querySelector(
                        `[data-module-state="${input.dataset.moduleKey}"]`
                    ),
                    input.checked
                );
            });
    }

    function enforceModuleDependencies(grid, changedInput) {
        if (changedInput.checked) {
            const dependency =
                changedInput.dataset.dependsOn;

            if (dependency) {
                const requiredInput =
                    moduleInput(grid, dependency);

                if (requiredInput) {
                    requiredInput.checked = true;
                }
            }
        }

        if (!changedInput.checked) {
            grid.querySelectorAll("[data-module-key]")
                .forEach(function (input) {
                    if (
                        input.dataset.dependsOn ===
                        changedInput.dataset.moduleKey
                    ) {
                        input.checked = false;
                    }
                });
        }

        updateGridStateLabels(grid);
    }

    function renderModuleGrid(grid, rows, mode) {
        const configured = moduleMap(rows);

        grid.innerHTML = state.moduleCatalog
            .map(function (module) {
                const enabled =
                    module.required === true ||
                    configured[module.module_key] === true;

                const disabled =
                    module.required === true ||
                    (mode === "detail" && !state.canManage);

                const dependency = module.depends_on
                    ? ` · Requires ${
                        state.moduleCatalog.find(function (candidate) {
                            return candidate.module_key === module.depends_on;
                        })?.label || module.depends_on
                    }`
                    : "";

                return `
                    <label class="console-module-card">
                        <span class="console-module-card__body">
                            <span class="console-module-card__title-line">
                                <strong>${escapeHtml(module.label)}</strong>
                                <span
                                    class="console-module-state ${enabled ? "console-module-state--enabled" : ""}"
                                    data-module-state="${escapeHtml(module.module_key)}"
                                >${enabled ? "Enabled" : "Disabled"}</span>
                            </span>
                            <small>
                                ${escapeHtml(module.description)}${escapeHtml(dependency)}
                                ${module.required ? " · Required" : ""}
                            </small>
                        </span>
                        <span class="console-switch">
                            <input
                                type="checkbox"
                                data-module-key="${escapeHtml(module.module_key)}"
                                data-depends-on="${escapeHtml(module.depends_on || "")}"
                                ${enabled ? "checked" : ""}
                                ${disabled ? "disabled" : ""}
                            />
                            <span class="console-switch__track" aria-hidden="true"></span>
                        </span>
                    </label>
                `;
            })
            .join("");

        grid.onchange = function (event) {
            const input = event.target.closest("[data-module-key]");
            if (input) {
                enforceModuleDependencies(grid, input);
            }
        };
    }

    function collectModules(grid) {
        const values = {};

        grid.querySelectorAll("[data-module-key]")
            .forEach(function (input) {
                values[input.dataset.moduleKey] =
                    input.checked;
            });

        values.dashboard = true;
        return values;
    }

    function renderCreateModules() {
        renderModuleGrid(
            elements.newModuleGrid,
            [],
            "create"
        );
    }

    async function loadModuleCatalog() {
        const { data, error } =
            await window.supabaseClient.rpc(
                "platform_get_module_catalog"
            );

        if (error) {
            throw error;
        }

        state.moduleCatalog =
            Array.isArray(data)
                ? data
                : [];

        if (!state.moduleCatalog.length) {
            throw new Error(
                "The Paryx module catalogue is unavailable."
            );
        }

        renderCreateModules();
    }

    function renderDetailModules(rows) {
        renderModuleGrid(
            elements.detailModuleGrid,
            rows,
            "detail"
        );
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

        elements.detailModuleGrid
            .querySelectorAll("[data-module-key]")
            .forEach(function (input) {
                input.disabled =
                    !state.canManage ||
                    input.dataset.moduleKey === "dashboard";
            });

        elements.detailSave.hidden =
            !state.canManage;

        elements.detailReadOnly.hidden =
            state.canManage;

        elements.moduleReadOnly.hidden =
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
            const [
                detailResponse,
                moduleResponse
            ] =
                await Promise.all([
                    window
                        .supabaseClient
                        .rpc(
                            "platform_get_club_detail",
                            {
                                p_club_id:
                                    clubId
                            }
                        ),

                    window
                        .supabaseClient
                        .rpc(
                            "platform_get_club_modules",
                            {
                                p_club_id:
                                    clubId
                            }
                        )
                ]);

            if (detailResponse.error) {
                throw detailResponse.error;
            }

            if (moduleResponse.error) {
                throw moduleResponse.error;
            }

            const detail =
                Array.isArray(
                    detailResponse.data
                )
                    ? detailResponse.data[0]
                    : detailResponse.data;

            if (!detail) {
                throw new Error(
                    "Club details were not returned."
                );
            }

            renderClubDetail(
                detail
            );

            renderDetailModules(
                moduleResponse.data
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
                        "platform_update_club_configuration_v2",
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
                                    .trim(),

                            p_modules:
                                collectModules(
                                    elements.detailModuleGrid
                                )
                        }
                    );

            if (error) {
                throw error;
            }

            showMessage(
                elements.success,
                "Club configuration updated."
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
                "Save configuration";
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
                            "platform_provision_club",
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
                                        .trim(),

                                p_course_name:
                                    elements
                                        .courseName
                                        .value
                                        .trim(),

                                p_course_holes:
                                    Number(
                                        elements
                                            .courseHoles
                                            .value
                                    ),

                                p_single_course_mode:
                                    elements
                                        .singleCourseMode
                                        .checked,

                                p_modules:
                                    collectModules(
                                        elements.newModuleGrid
                                    )
                            }
                        );

                if (error) {
                    throw error;
                }

                const row =
                    Array.isArray(data)
                        ? data[0]
                        : data;

                if (!row?.club_id) {
                    throw new Error(
                        "Paryx did not return the provisioned club."
                    );
                }

                const invitation =
                    await window
                        .supabaseClient
                        .functions
                        .invoke(
                            "admin-invite-staff",
                            {
                                body: {
                                    clubId:
                                        row.club_id,
                                    firstName:
                                        elements.adminFirstName.value.trim(),
                                    lastName:
                                        elements.adminLastName.value.trim(),
                                    email:
                                        elements.adminEmail.value.trim(),
                                    role:
                                        "club_admin",
                                    redirectTo:
                                        new URL(
                                            "../../club/html/set-password.html",
                                            window.location.href
                                        ).href
                                }
                            }
                        );

                if (invitation.error || invitation.data?.error) {
                    const invitationError =
                        invitation.data?.error ||
                        invitation.error?.message ||
                        "Initial Club Admin invitation failed.";

                    throw new Error(
                        `${row.club_name || "The club"} and its first course were created, but the administrator could not be linked: ${invitationError}`
                    );
                }

                showMessage(
                    elements.success,
                    `${row.club_name || "The club"} was provisioned and its first Club Admin was invited.`
                );

                elements.createForm.reset();

                elements.timezone.value =
                    "Europe/London";

                elements.singleCourseMode.checked =
                    true;

                renderCreateModules();

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
            async function (context) {
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

                await loadModuleCatalog();
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
