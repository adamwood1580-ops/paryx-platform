(function () {
    "use strict";

    const PAGE_SIZE = 50;

    const state = {
        rows: [],
        offset: 0,
        total: 0,
        search: "",
        loading: false,
        searchTimer: null,
        selected: null,
        canEditEntitlements: false,
        canDeleteAccounts: false,
        currentUserId: null
    };

    const elements = {
        error:
            document.getElementById(
                "accountError"
            ),

        success:
            document.getElementById(
                "accountSuccess"
            ),

        search:
            document.getElementById(
                "accountSearch"
            ),

        refresh:
            document.getElementById(
                "accountRefresh"
            ),

        count:
            document.getElementById(
                "accountResultCount"
            ),

        retentionPolicy:
            document.getElementById(
                "accountRetentionPolicy"
            ),

        table:
            document.getElementById(
                "accountTableBody"
            ),

        loadMore:
            document.getElementById(
                "accountLoadMore"
            ),

        dialog:
            document.getElementById(
                "accountDialog"
            ),

        dialogClose:
            document.getElementById(
                "accountDialogClose"
            ),

        dialogName:
            document.getElementById(
                "accountDialogName"
            ),

        dialogEmail:
            document.getElementById(
                "accountDialogEmail"
            ),

        dialogId:
            document.getElementById(
                "accountDialogId"
            ),

        memberClubs:
            document.getElementById(
                "accountDialogMemberClubs"
            ),

        visitorClubs:
            document.getElementById(
                "accountDialogVisitorClubs"
            ),

        consoleAccess:
            document.getElementById(
                "accountDialogConsoleAccess"
            ),

        clubList:
            document.getElementById(
                "accountClubList"
            ),

        readOnlyNote:
            document.getElementById(
                "accountReadOnlyNote"
            ),

        entitlementStatus:
            document.getElementById(
                "accountEntitlementStatus"
            ),

        entitlementForm:
            document.getElementById(
                "accountEntitlementForm"
            ),

        entitlementUserId:
            document.getElementById(
                "accountEntitlementUserId"
            ),

        plan:
            document.getElementById(
                "accountPlan"
            ),

        tier2Until:
            document.getElementById(
                "accountTier2Until"
            ),

        passUntil:
            document.getElementById(
                "accountPassUntil"
            ),

        grantTier2:
            document.getElementById(
                "grantTier2ThirtyDays"
            ),

        grantPass:
            document.getElementById(
                "grantOneDayPass"
            ),

        resetFree:
            document.getElementById(
                "resetFreeAccess"
            ),

        save:
            document.getElementById(
                "saveEntitlement"
            ),

        deleteSection:
            document.getElementById(
                "accountDeleteSection"
            ),

        deleteReason:
            document.getElementById(
                "accountDeleteReason"
            ),

        deleteBlocked:
            document.getElementById(
                "accountDeleteBlocked"
            ),

        deleteStatus:
            document.getElementById(
                "accountDeleteStatus"
            ),

        deleteButton:
            document.getElementById(
                "accountDeleteButton"
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

    function clearEntitlementStatus() {
        elements.entitlementStatus.textContent =
            "";

        elements.entitlementStatus.className =
            "console-success";

        elements.entitlementStatus.hidden =
            true;
    }


    function clearDeleteStatus() {
        if (!elements.deleteStatus) {
            return;
        }

        elements.deleteStatus.textContent = "";
        elements.deleteStatus.hidden = true;
    }

    function showDeleteStatus(message) {
        if (!elements.deleteStatus) {
            return;
        }

        elements.deleteStatus.textContent = message;
        elements.deleteStatus.hidden = false;
    }

    function showEntitlementStatus(
        text,
        type = "success"
    ) {
        elements.entitlementStatus.textContent =
            text;

        elements.entitlementStatus.className =
            type === "error"
                ? "console-error"
                : "console-success";

        elements.entitlementStatus.hidden =
            false;
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

    function displayName(row) {
        return (
            String(
                row.display_name ||
                ""
            ).trim() ||
            String(
                row.email ||
                ""
            ).trim() ||
            "Paryx player"
        );
    }

    function formatDateTime(value) {
        if (!value) {
            return "Never";
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

    function toLocalInput(value) {
        if (!value) {
            return "";
        }

        const date =
            new Date(value);

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {
            return "";
        }

        const local =
            new Date(
                date.getTime() -
                date.getTimezoneOffset() *
                60000
            );

        return local
            .toISOString()
            .slice(0, 16);
    }

    function fromLocalInput(value) {
        if (!value) {
            return null;
        }

        const date =
            new Date(value);

        return Number.isNaN(
            date.getTime()
        )
            ? null
            : date.toISOString();
    }

    function entitlementState(row) {
        const now =
            Date.now();

        const tier2Until =
            row.tier2_until
                ? new Date(
                    row.tier2_until
                ).getTime()
                : null;

        const passUntil =
            row.scorecard_pass_until
                ? new Date(
                    row.scorecard_pass_until
                ).getTime()
                : null;

        const tier2 =
            row.plan ===
                "tier2" &&
            (
                !tier2Until ||
                tier2Until >
                    now
            );

        const pass =
            passUntil &&
            passUntil >
                now;

        if (tier2) {
            return {
                label: "Tier 2",
                className:
                    "status-pill--active",
                detail:
                    row.tier2_until
                        ? `Until ${formatDateTime(
                            row.tier2_until
                        )}`
                        : "No expiry"
            };
        }

        if (pass) {
            return {
                label: "Pass",
                className:
                    "status-pill--warning",
                detail:
                    `Until ${formatDateTime(
                        row.scorecard_pass_until
                    )}`
            };
        }

        return {
            label: "Free",
            className:
                "status-pill--neutral",
            detail:
                "No scoring entitlement"
        };
    }

    function render() {
        elements.count.textContent =
            `${state.total} account${
                state.total === 1
                    ? ""
                    : "s"
            }`;

        if (!state.rows.length) {
            elements.table.innerHTML = `
                <tr>
                    <td colspan="6">
                        <div class="console-empty">
                            No Paryx accounts match this search.
                        </div>
                    </td>
                </tr>
            `;

            elements.loadMore.hidden =
                true;

            return;
        }

        elements.table.innerHTML =
            state.rows
                .map(
                    function (row) {
                        const access =
                            entitlementState(
                                row
                            );

                        return `
                            <tr>
                                <td>
                                    <strong>
                                        ${escapeHtml(
                                            displayName(
                                                row
                                            )
                                        )}
                                    </strong>

                                    <small>
                                        ${escapeHtml(
                                            row.email ||
                                            "No email"
                                        )}
                                    </small>
                                </td>

                                <td>
                                    <span
                                        class="status-pill ${escapeHtml(
                                            access.className
                                        )}"
                                    >
                                        ${escapeHtml(
                                            access.label
                                        )}
                                    </span>

                                    <small>
                                        ${escapeHtml(
                                            access.detail
                                        )}
                                    </small>
                                </td>

                                <td>
                                    ${Number(
                                        row.member_club_count ||
                                        0
                                    )}
                                </td>

                                <td>
                                    ${Number(
                                        row.visitor_club_count ||
                                        0
                                    )}
                                </td>

                                <td>
                                    ${escapeHtml(
                                        formatDateTime(
                                            row.last_sign_in_at
                                        )
                                    )}
                                </td>

                                <td>
                                    <button
                                        class="console-button console-button--secondary"
                                        type="button"
                                        data-account-open
                                        data-user-id="${escapeHtml(
                                            row.user_id
                                        )}"
                                    >
                                        View
                                    </button>
                                </td>
                            </tr>
                        `;
                    }
                )
                .join("");

        elements.loadMore.hidden =
            state.rows.length >=
            state.total;
    }

    async function loadRetentionPolicy() {
        if (!elements.retentionPolicy) {
            return;
        }

        try {
            const {
                data,
                error
            } =
                await window.supabaseClient
                    .rpc(
                        "platform_get_account_retention_policy"
                    );

            if (error) {
                throw error;
            }

            const policy =
                Array.isArray(data)
                    ? data[0]
                    : data;

            if (!policy) {
                elements.retentionPolicy.textContent =
                    "Retention policy unavailable.";
                return;
            }

            elements.retentionPolicy.textContent =
                policy.auto_delete_enabled
                    ? `Automatic deletion: ${Number(policy.inactive_months || 12)} months without Paryx activity. Active Console/staff accounts and live paid entitlements are excluded.`
                    : "Automatic inactive-account deletion is currently disabled.";
        } catch (error) {
            console.warn(
                "Paryx retention policy could not be loaded:",
                error
            );

            elements.retentionPolicy.textContent =
                "Retention policy unavailable.";
        }
    }

    async function loadAccounts(
        reset = true
    ) {
        if (state.loading) {
            return;
        }

        state.loading =
            true;

        clearMessages();

        if (reset) {
            state.offset =
                0;

            state.rows =
                [];

            elements.table.innerHTML = `
                <tr>
                    <td colspan="6">
                        <div class="console-empty">
                            Loading Paryx accounts…
                        </div>
                    </td>
                </tr>
            `;
        }

        elements.refresh.disabled =
            true;

        elements.loadMore.disabled =
            true;

        try {
            const {
                data,
                error
            } =
                await window
                    .supabaseClient
                    .rpc(
                        "platform_list_accounts",
                        {
                            p_search:
                                state.search ||
                                null,
                            p_limit:
                                PAGE_SIZE,
                            p_offset:
                                state.offset
                        }
                    );

            if (error) {
                throw error;
            }

            const rows =
                Array.isArray(data)
                    ? data
                    : [];

            if (rows.length) {
                state.total =
                    Number(
                        rows[0]
                            .total_count ||
                        0
                    );
            } else if (reset) {
                state.total =
                    0;
            }

            state.rows =
                reset
                    ? rows
                    : state.rows.concat(
                        rows
                    );

            state.offset =
                state.rows.length;

            render();
        } catch (error) {
            console.error(
                "Paryx account directory failed:",
                error
            );

            showMessage(
                elements.error,
                readableError(
                    error
                )
            );
        } finally {
            state.loading =
                false;

            elements.refresh.disabled =
                false;

            elements.loadMore.disabled =
                false;
        }
    }

    function selectedRow(
        userId
    ) {
        return (
            state.rows.find(
                function (row) {
                    return (
                        row.user_id ===
                        userId
                    );
                }
            ) ||
            null
        );
    }

    function applyEntitlementEditState() {
        const disabled =
            !state.canEditEntitlements;

        [
            elements.plan,
            elements.tier2Until,
            elements.passUntil,
            elements.grantTier2,
            elements.grantPass,
            elements.resetFree,
            elements.save
        ].forEach(
            function (element) {
                element.disabled =
                    disabled;
            }
        );

        elements.readOnlyNote.hidden =
            state.canEditEntitlements;
    }


    function applyDeleteState(row) {
        if (!elements.deleteSection) {
            return;
        }

        elements.deleteSection.hidden =
            !state.canDeleteAccounts;

        if (!state.canDeleteAccounts) {
            return;
        }

        elements.deleteReason.value = "";
        clearDeleteStatus();
        elements.deleteBlocked.hidden = true;
        elements.deleteBlocked.textContent = "";

        let blockedReason = "";

        if (
            row?.user_id &&
            row.user_id === state.currentUserId
        ) {
            blockedReason =
                "You cannot delete your own Paryx account from Console.";
        } else if (row?.console_active === true) {
            blockedReason =
                "Remove this account's active Paryx Console access before deleting it.";
        } else if (
            Number(row?.staff_club_count || 0) > 0
        ) {
            blockedReason =
                "Remove this account's active ClubHub staff access before deleting it.";
        }

        elements.deleteButton.disabled =
            Boolean(blockedReason);

        if (blockedReason) {
            elements.deleteBlocked.hidden = false;
            elements.deleteBlocked.textContent =
                blockedReason;
        }
    }

    function fillAccount(
        row
    ) {
        state.selected =
            row;

        elements.dialogName.textContent =
            displayName(
                row
            );

        elements.dialogEmail.textContent =
            row.email ||
            "No email";

        elements.dialogId.textContent =
            row.user_id;

        elements.memberClubs.textContent =
            String(
                row.member_club_count ||
                0
            );

        elements.visitorClubs.textContent =
            String(
                row.visitor_club_count ||
                0
            );

        elements.consoleAccess.textContent =
            row.console_role
                ? `${String(
                    row.console_role
                ).replace(
                    /^platform_/,
                    ""
                )}${
                    row.console_active
                        ? ""
                        : " · inactive"
                }`
                : "None";

        elements.entitlementUserId.value =
            row.user_id;

        elements.plan.value =
            row.plan ||
            "free";

        elements.tier2Until.value =
            toLocalInput(
                row.tier2_until
            );

        elements.passUntil.value =
            toLocalInput(
                row.scorecard_pass_until
            );

        applyEntitlementEditState();
        applyDeleteState(row);
    }

    function membershipLabel(row) {
        if (
            [
                "visitor",
                "guest",
                "staff"
            ].includes(
                row.membership_type
            )
        ) {
            return (
                String(
                    row.membership_type
                )
                    .replace(
                        /\b\w/g,
                        function (letter) {
                            return letter
                                .toUpperCase();
                        }
                    )
            );
        }

        return "Member";
    }

    async function loadAccountClubs(
        userId
    ) {
        elements.clubList.innerHTML = `
            <div class="console-empty">
                Loading club relationships…
            </div>
        `;

        const {
            data,
            error
        } =
            await window.supabaseClient
                .rpc(
                    "platform_get_account_clubs",
                    {
                        p_user_id:
                            userId
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
            elements.clubList.innerHTML = `
                <div class="console-empty">
                    This account has no club relationships.
                </div>
            `;

            return;
        }

        elements.clubList.innerHTML =
            rows
                .map(
                    function (row) {
                        const member =
                            ![
                                "visitor",
                                "guest",
                                "staff"
                            ].includes(
                                row.membership_type
                            );

                        return `
                            <article class="console-account-club">
                                <div>
                                    <strong>
                                        ${escapeHtml(
                                            row.club_name
                                        )}
                                    </strong>

                                    <span>
                                        ${escapeHtml(
                                            row.membership_number ||
                                            membershipLabel(
                                                row
                                            )
                                        )}
                                    </span>
                                </div>

                                <div class="console-account-club__badges">
                                    <span
                                        class="status-pill ${
                                            row.membership_status ===
                                            "active"
                                                ? "status-pill--active"
                                                : "status-pill--inactive"
                                        }"
                                    >
                                        ${escapeHtml(
                                            row.membership_status
                                        )}
                                    </span>

                                    <span
                                        class="status-pill ${
                                            member
                                                ? "status-pill--neutral"
                                                : "status-pill--warning"
                                        }"
                                    >
                                        ${escapeHtml(
                                            membershipLabel(
                                                row
                                            )
                                        )}
                                    </span>
                                </div>

                                ${
                                    row.renewal_date
                                        ? `
                                            <small>
                                                Renewal:
                                                ${escapeHtml(
                                                    new Intl.DateTimeFormat(
                                                        "en-GB",
                                                        {
                                                            dateStyle:
                                                                "medium"
                                                        }
                                                    ).format(
                                                        new Date(
                                                            `${row.renewal_date}T12:00:00`
                                                        )
                                                    )
                                                )}
                                            </small>
                                        `
                                        : ""
                                }
                            </article>
                        `;
                    }
                )
                .join("");
    }

    async function openAccount(
        userId
    ) {
        const row =
            selectedRow(
                userId
            );

        if (!row) {
            return;
        }

        clearMessages();
        clearEntitlementStatus();
        fillAccount(row);

        elements.dialog.showModal();

        try {
            await loadAccountClubs(
                userId
            );
        } catch (error) {
            elements.clubList.innerHTML = `
                <div class="console-empty">
                    ${escapeHtml(
                        readableError(
                            error
                        )
                    )}
                </div>
            `;
        }
    }

    function setFuture(
        element,
        amount,
        unit
    ) {
        const date =
            new Date();

        if (
            unit ===
            "days"
        ) {
            date.setDate(
                date.getDate() +
                amount
            );
        } else {
            date.setHours(
                date.getHours() +
                amount
            );
        }

        element.value =
            toLocalInput(
                date.toISOString()
            );
    }

    async function saveEntitlement(
        event
    ) {
        event.preventDefault();

        if (
            !state.canEditEntitlements ||
            !state.selected
        ) {
            return;
        }

        clearMessages();
        clearEntitlementStatus();

        elements.save.disabled =
            true;

        elements.save.textContent =
            "Saving…";

        try {
            const plan =
                elements.plan.value;

            const {
                data,
                error
            } =
                await window.supabaseClient
                    .rpc(
                        "platform_set_player_entitlement",
                        {
                            p_user_id:
                                state.selected
                                    .user_id,
                            p_plan:
                                plan,
                            p_tier2_until:
                                plan ===
                                    "tier2"
                                    ? fromLocalInput(
                                        elements
                                            .tier2Until
                                            .value
                                    )
                                    : null,
                            p_scorecard_pass_until:
                                fromLocalInput(
                                    elements
                                        .passUntil
                                        .value
                                )
                        }
                    );

            if (error) {
                throw error;
            }

            const updated =
                Array.isArray(data)
                    ? data[0]
                    : data;

            state.selected.plan =
                updated?.plan ||
                plan;

            state.selected.tier2_until =
                updated?.tier2_until ||
                null;

            state.selected.scorecard_pass_until =
                updated
                    ?.scorecard_pass_until ||
                null;

            const rowIndex =
                state.rows.findIndex(
                    function (row) {
                        return (
                            row.user_id ===
                            state.selected
                                .user_id
                        );
                    }
                );

            if (rowIndex >= 0) {
                state.rows[rowIndex] =
                    {
                        ...state.rows[
                            rowIndex
                        ],
                        plan:
                            state.selected
                                .plan,
                        tier2_until:
                            state.selected
                                .tier2_until,
                        scorecard_pass_until:
                            state.selected
                                .scorecard_pass_until
                    };
            }

            fillAccount(
                state.selected
            );

            render();

            showEntitlementStatus(
                "Player entitlement updated.",
                "success"
            );
        } catch (error) {
            console.error(
                "Paryx entitlement update failed:",
                error
            );

            showEntitlementStatus(
                readableError(
                    error
                ),
                "error"
            );
        } finally {
            elements.save.disabled =
                !state.canEditEntitlements;

            elements.save.textContent =
                "Save entitlement";
        }
    }

    async function deleteSelectedAccount() {
        if (
            !state.canDeleteAccounts ||
            !state.selected ||
            elements.deleteButton.disabled
        ) {
            return;
        }

        const reason =
            String(
                elements.deleteReason.value || ""
            ).trim();

        if (!reason) {
            showDeleteStatus(
                "Enter an audit reason before deleting the account."
            );
            elements.deleteReason.focus();
            return;
        }

        const account =
            state.selected;

        const confirmationText =
            String(
                account.email ||
                account.user_id
            ).trim();

        const firstConfirmation =
            window.confirm(
                `PERMANENT ACCOUNT DELETION\n\nDelete ${displayName(account)} from Paryx?\n\nThis removes the global login, profile, entitlements and private Paryx identity links. Club-owned membership records and historical club records are retained.\n\nThis action cannot be undone.`
            );

        if (!firstConfirmation) {
            return;
        }

        const typedConfirmation =
            window.prompt(
                `SECOND CONFIRMATION\n\nType the account email exactly to permanently delete this user:\n\n${confirmationText}`,
                ""
            );

        if (typedConfirmation === null) {
            return;
        }

        if (
            typedConfirmation.trim().toLowerCase() !==
            confirmationText.toLowerCase()
        ) {
            showDeleteStatus(
                "Deletion cancelled: the confirmation did not match the account."
            );
            return;
        }

        clearMessages();
        clearEntitlementStatus();
        clearDeleteStatus();

        elements.deleteButton.disabled = true;
        elements.deleteButton.textContent =
            "Deleting…";

        try {
            const {
                data,
                error
            } =
                await window.supabaseClient
                    .rpc(
                        "platform_delete_account",
                        {
                            p_user_id:
                                account.user_id,
                            p_confirmation:
                                typedConfirmation.trim(),
                            p_reason:
                                reason
                        }
                    );

            if (error) {
                throw error;
            }

            const result =
                Array.isArray(data)
                    ? data[0]
                    : data;

            elements.dialog.close();
            state.selected = null;

            await loadAccounts(true);

            showMessage(
                elements.success,
                `Paryx account deleted permanently${result?.email ? `: ${result.email}` : "."}`
            );
        } catch (error) {
            console.error(
                "Paryx account deletion failed:",
                error
            );

            showDeleteStatus(
                readableError(error)
            );
        } finally {
            elements.deleteButton.textContent =
                "Delete account permanently";

            if (state.selected) {
                applyDeleteState(
                    state.selected
                );
            }
        }
    }

    function bind() {
        elements.search.addEventListener(
            "input",
            function () {
                state.search =
                    elements.search
                        .value
                        .trim();

                window.clearTimeout(
                    state.searchTimer
                );

                state.searchTimer =
                    window.setTimeout(
                        function () {
                            loadAccounts(
                                true
                            );
                        },
                        280
                    );
            }
        );

        elements.refresh.addEventListener(
            "click",
            function () {
                loadAccounts(
                    true
                );
            }
        );

        elements.loadMore.addEventListener(
            "click",
            function () {
                loadAccounts(
                    false
                );
            }
        );

        elements.table.addEventListener(
            "click",
            function (event) {
                const button =
                    event.target.closest(
                        "[data-account-open]"
                    );

                if (button) {
                    openAccount(
                        button.dataset
                            .userId
                    );
                }
            }
        );

        elements.dialogClose
            .addEventListener(
                "click",
                function () {
                    elements.dialog
                        .close();
                }
            );

        elements.entitlementForm
            .addEventListener(
                "submit",
                saveEntitlement
            );

        elements.grantTier2
            .addEventListener(
                "click",
                function () {
                    elements.plan.value =
                        "tier2";

                    setFuture(
                        elements.tier2Until,
                        30,
                        "days"
                    );
                }
            );

        elements.grantPass
            .addEventListener(
                "click",
                function () {
                    setFuture(
                        elements.passUntil,
                        24,
                        "hours"
                    );
                }
            );

        elements.resetFree
            .addEventListener(
                "click",
                function () {
                    elements.plan.value =
                        "free";

                    elements.tier2Until.value =
                        "";

                    elements.passUntil.value =
                        "";
                }
            );

        elements.deleteButton
            ?.addEventListener(
                "click",
                deleteSelectedAccount
            );
    }

    async function initialise() {
        const context =
            await window.ParyxConsole.ready;

        state.currentUserId =
            context
                ?.user
                ?.id ||
            context
                ?.access
                ?.userId ||
            null;

        state.canEditEntitlements =
            [
                "platform_owner",
                "platform_admin"
            ].includes(
                context
                    ?.access
                    ?.role
            );

        state.canDeleteAccounts =
            context
                ?.access
                ?.role ===
            "platform_owner";

        applyEntitlementEditState();

        if (elements.deleteSection) {
            elements.deleteSection.hidden = true;
        }

        await Promise.all([
            loadRetentionPolicy(),
            loadAccounts(true)
        ]);
    }

    bind();

    initialise().catch(
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
