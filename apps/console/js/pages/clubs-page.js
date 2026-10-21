(function () {
    "use strict";

    const state = {
        rows: [],
        role: null,
        isOwner: false,
        canManage: false,
        selectedClub: null,
        moduleCatalog: [],
        hotelData: null,
        hotelCourses: []
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

        hotelRoles: document.getElementById("hotelModeRolePermissions"),
        hotelAllocationMode: document.getElementById("hotelAllocationMode"),
        hotelTimeRulesPanel: document.getElementById("hotelTimeRulesPanel"),
        hotelTimeRules: document.getElementById("hotelTimeRules"),
        hotelAddTimeRule: document.getElementById("hotelAddTimeRule"),
        hotelReadOnly: document.getElementById("hotelModeReadOnlyNote"),

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

    const HOTEL_ROLE_LABELS = {
        starter: "Starter",
        reception: "Reception",
        professional: "Professional",
        greenkeeper: "Greenkeeper",
        manager: "Manager",
        club_admin: "Club Admin"
    };

    const HOTEL_INPUTS = {
        hotel_booking_days: "hotelBookingDays",
        society_booking_days: "societyBookingDays",
        member_booking_days: "hotelMemberDays",
        visitor_booking_days: "hotelVisitorDays",
        hotel_allocation_percent: "hotelAllocationPercent",
        member_allocation_percent: "hotelMemberPercent",
        hotel_release_days: "hotelReleaseDays",
        member_release_days: "memberReleaseDays"
    };

    const HOTEL_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    function hotelRuleSelect(name, options, current) {
        return `<select data-rule-field="${name}">${options.map(function (option) {
            return `<option value="${escapeHtml(String(option.value))}" ${String(option.value) === String(current) ? "selected" : ""}>${escapeHtml(option.text)}</option>`;
        }).join("")}</select>`;
    }

    function hotelRuleMarkup(rule) {
        const dateRule = !!rule.specific_date;
        const courseOptions = [{ value: "", text: "All courses" }].concat(
            state.hotelCourses.map(function (course) {
                return { value: course.id, text: course.name };
            })
        );
        const weekdays = HOTEL_WEEKDAYS.map(function (day, i) {
            return { value: i, text: day };
        });
        return `<tr data-hotel-time-rule>
            <td>${hotelRuleSelect("scope", [{value:"weekday",text:"Weekly"},{value:"date",text:"Specific date"}], dateRule ? "date" : "weekday")}</td>
            <td>
                <span data-rule-weekday ${dateRule ? "hidden" : ""}>${hotelRuleSelect("weekday",weekdays, rule.weekday ?? 1)}</span>
                <span data-rule-date ${dateRule ? "" : "hidden"}><input type="date" data-rule-field="specific_date" value="${escapeHtml(rule.specific_date || "")}" ${dateRule ? "required" : "disabled"} /></span>
            </td>
            <td>${hotelRuleSelect("course_id",courseOptions,rule.course_id || "")}</td>
            <td><input type="time" data-rule-field="start_time" value="${escapeHtml(rule.start_time || "09:00")}" required /></td>
            <td><input type="time" data-rule-field="end_time" value="${escapeHtml(rule.end_time || "11:00")}" required /></td>
            <td>${hotelRuleSelect("allocation", [
                {value:"hotel",text:"Hotel priority"},{value:"member",text:"Member priority"},{value:"general",text:"General"}
            ],rule.allocation || "hotel")}</td>
            <td><button type="button" class="console-button hotel-rule-remove" data-remove-hotel-rule>Remove</button></td>
        </tr>`;
    }

    function hotelUpdateRuleScope(row) {
        const dateRule = row.querySelector('[data-rule-field="scope"]').value === "date";
        row.querySelector("[data-rule-weekday]").hidden = dateRule;
        row.querySelector("[data-rule-date]").hidden = !dateRule;
        const dateInput = row.querySelector('[data-rule-field="specific_date"]');
        dateInput.disabled = !dateRule || !state.canManage;
        dateInput.required = dateRule;
        row.querySelector('[data-rule-field="weekday"]').disabled = dateRule || !state.canManage;
    }

    function hotelRefreshAllocationMode() {
        const active = elements.hotelAllocationMode.value === "time_bands";
        elements.hotelTimeRulesPanel.hidden = !active;
        elements.hotelTimeRulesPanel.querySelectorAll("input,select,button")
            .forEach(function (field) { field.disabled = !active || !state.canManage; });
        if (active) elements.hotelTimeRules.querySelectorAll("[data-hotel-time-rule]")
            .forEach(hotelUpdateRuleScope);
    }

    function hotelAddRule(rule) {
        elements.hotelTimeRules.insertAdjacentHTML("beforeend",hotelRuleMarkup(rule || {}));
        const row = elements.hotelTimeRules.lastElementChild;
        hotelUpdateRuleScope(row);
        applyHotelEditState();
    }

    function hotelCollectRules() {
        const rules = [];
        elements.hotelTimeRules.querySelectorAll("[data-hotel-time-rule]").forEach(function (row, i) {
            const field = function (name) {
                return row.querySelector(`[data-rule-field="${name}"]`).value;
            };
            const dateRule = field("scope") === "date";
            const start = field("start_time");
            const end = field("end_time");
            const special = field("specific_date");
            if (!start || !end || start >= end) {
                throw new Error(`Rule ${i+1}: end time must be later than start time.`);
            }
            if (dateRule && !special) {
                throw new Error(`Rule ${i+1}: choose a specific date.`);
            }
            rules.push({
                course_id: field("course_id") || null,
                weekday: dateRule ? null : Number(field("weekday")),
                specific_date: dateRule ? special : null,
                start_time: start,
                end_time: end,
                allocation: field("allocation")
            });
        });
        if (rules.length > 200) throw new Error("Maximum 200 time allocations per club.");
        for (let i=0;i<rules.length;i++) for (let j=i+1;j<rules.length;j++) {
            const a = rules[i], b = rules[j];
            if (a.course_id === b.course_id && a.weekday === b.weekday &&
                a.specific_date === b.specific_date && a.start_time < b.end_time &&
                b.start_time < a.end_time) {
                throw new Error(`Time allocations ${i+1} and ${j+1} overlap for the same day and course.`);
            }
        }
        return rules;
    }

    function renderHotelMode(data) {
        state.hotelData = data;
        state.hotelCourses = Array.isArray(data?.courses) ? data.courses : [];
        const config = data?.config || {};
        document.getElementById("hotelModeEnabled").checked =
            config.enabled === true;

        Object.entries(HOTEL_INPUTS).forEach(function ([key, id]) {
            document.getElementById(id).value = String(config[key] ?? "");
        });

        elements.hotelAllocationMode.value = config.allocation_mode || "percentage";
        elements.hotelTimeRules.innerHTML = "";
        (config.allocation_rules || []).forEach(hotelAddRule);
        hotelRefreshAllocationMode();

        const permissions = data?.permissions || {};
        elements.hotelRoles.innerHTML = Object.entries(HOTEL_ROLE_LABELS)
            .map(function ([role, label]) {
                const entry = permissions[role] || {};
                const checked = function (key) {
                    return entry[key] === true ? "checked" : "";
                };
                return `<tr data-hotel-role="${role}">
                    <th scope="row">${escapeHtml(label)}</th>
                    <td><input aria-label="${escapeHtml(label)} Hotel bookings" type="checkbox" data-hotel-access="can_manage_hotel" ${checked("can_manage_hotel")} /></td>
                    <td><input aria-label="${escapeHtml(label)} Society groups" type="checkbox" data-hotel-access="can_manage_societies" ${checked("can_manage_societies")} /></td>
                    <td><input aria-label="${escapeHtml(label)} Overrides" type="checkbox" data-hotel-access="can_override" ${checked("can_override")} /></td>
                </tr>`;
            }).join("");
        applyHotelEditState();
    }

    function applyHotelEditState() {
        const inputs = document.getElementById("hotelModeConsolePanel")
            .querySelectorAll("input, select, button");
        inputs.forEach(function (input) { input.disabled = !state.canManage; });
        hotelRefreshAllocationMode();
        elements.hotelReadOnly.hidden = state.canManage;
    }

    function collectHotelMode() {
        const config = {
            enabled: document.getElementById("hotelModeEnabled").checked,
            allocation_mode: elements.hotelAllocationMode.value
        };
        if (config.allocation_mode === "time_bands") {
            config.allocation_rules = hotelCollectRules();
        }
        Object.entries(HOTEL_INPUTS).forEach(function ([key, id]) {
            const element = document.getElementById(id);
            if (!element.checkValidity() || !element.value.trim()) {
                throw new Error(`Enter a valid value for ${key.replaceAll("_", " ")}.`);
            }
            config[key] = Number(element.value);
        });
        if (config.hotel_allocation_percent + config.member_allocation_percent > 100) {
            throw new Error("Hotel and member allocations cannot exceed 100% combined.");
        }
        if (config.hotel_release_days >= config.hotel_booking_days ||
            config.member_release_days >= config.member_booking_days) {
            throw new Error("A release deadline must be earlier than its booking window.");
        }

        const permissions = {};
        elements.hotelRoles.querySelectorAll("[data-hotel-role]")
            .forEach(function (row) {
                const access = {};
                row.querySelectorAll("[data-hotel-access]")
                    .forEach(function (input) {
                        access[input.dataset.hotelAccess] = input.checked;
                    });
                if (access.can_override &&
                    !access.can_manage_hotel && !access.can_manage_societies) {
                    throw new Error("Override access needs Hotel or Society access for " +
                        HOTEL_ROLE_LABELS[row.dataset.hotelRole] + ".");
                }
                permissions[row.dataset.hotelRole] = access;
            });
        return { config, permissions };
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
        applyHotelEditState();
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
                moduleResponse,
                hotelResponse
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
                        ),
                    window.supabaseClient.rpc("platform_hotel_mode_get", {
                        p_club_id: clubId
                    })
                ]);

            if (detailResponse.error) {
                throw detailResponse.error;
            }

            if (moduleResponse.error) {
                throw moduleResponse.error;
            }

            if (hotelResponse.error) {
                throw hotelResponse.error;
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
            renderHotelMode(hotelResponse.data);
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
            const hotelPayload = collectHotelMode();
            const {
                error
            } =
                await window
                    .supabaseClient
                        .rpc(
                        "platform_update_club_configuration_hotel",
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
                                ),
                            p_hotel_config: hotelPayload.config,
                            p_hotel_permissions: hotelPayload.permissions
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

    elements.hotelAllocationMode.addEventListener("change", hotelRefreshAllocationMode);
    elements.hotelAddTimeRule.addEventListener("click",function () { hotelAddRule(); });
    elements.hotelTimeRules.addEventListener("click",function (event) {
        const remove = event.target.closest("[data-remove-hotel-rule]");
        if (remove && state.canManage) remove.closest("[data-hotel-time-rule]").remove();
    });
    elements.hotelTimeRules.addEventListener("change",function (event) {
        if (event.target.matches('[data-rule-field="scope"]')) {
            hotelUpdateRuleScope(event.target.closest("[data-hotel-time-rule]"));
        }
    });

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
