(function () {
    "use strict";

    // Paryx staff application namespace.
    window.Paryx = window.Paryx || {};

    const PAGE_SIZE = 30;

    const ROLE_LABELS = {
        member: "Member",
        starter: "Starter",
        reception: "Reception",
        professional: "Professional",
        greenkeeper: "Greenkeeper",
        manager: "Manager",
        club_admin: "Club Admin"
    };

    const TYPE_LABELS = {
        member: "Member",
        junior: "Junior",
        student: "Student",
        social: "Social",
        corporate: "Corporate",
        visitor: "Visitor",
        guest: "Guest",
        staff: "Staff"
    };

    const elements = {};

    const state = {
        initialised: false,
        loading: false,
        offset: 0,
        total: 0,
        search: "",
        status: "all",
        members: [],
        accessRequests: [],
        accessLoading: false,
        currentUserId: null,
        clubId: null,
        adminRole: null,
        debounceTimer: null
    };

    function cacheElements() {
        elements.clubName =
            document.getElementById("memberClubName");

        elements.error =
            document.getElementById("membersError");

        elements.search =
            document.getElementById("memberSearch");

        elements.status =
            document.getElementById("memberStatusFilter");

        elements.resultCount =
            document.getElementById("memberResultCount");

        elements.refresh =
            document.getElementById("memberRefreshBtn");

        elements.list =
            document.getElementById("memberList");

        elements.loadMore =
            document.getElementById("loadMoreMembersBtn");

        elements.accessCount =
            document.getElementById(
                "memberAccessRequestCount"
            );

        elements.accessRefresh =
            document.getElementById(
                "memberAccessRefreshBtn"
            );

        elements.accessList =
            document.getElementById(
                "memberAccessRequestList"
            );

        elements.accessDialog =
            document.getElementById(
                "memberAccessApprovalDialog"
            );

        elements.accessApprovalForm =
            document.getElementById(
                "memberAccessApprovalForm"
            );

        elements.accessApprovalIdentity =
            document.getElementById(
                "memberAccessApprovalIdentity"
            );

        elements.accessApprovalRequestId =
            document.getElementById(
                "memberAccessApprovalRequestId"
            );

        elements.accessApprovalMembershipNumber =
            document.getElementById(
                "memberAccessApprovalMembershipNumber"
            );

        elements.accessApprovalClose =
            document.getElementById(
                "memberAccessApprovalClose"
            );

        elements.accessApprovalCancel =
            document.getElementById(
                "memberAccessApprovalCancel"
            );

        elements.accessApprovalSubmit =
            document.getElementById(
                "memberAccessApprovalSubmit"
            );
    }

    function getClient() {
        if (
            window.supabaseClient &&
            typeof window.supabaseClient.rpc === "function"
        ) {
            return window.supabaseClient;
        }

        throw new Error(
            "The Paryx data service is unavailable."
        );
    }

    function getReadableError(error) {
        if (!error) {
            return "An unknown error occurred.";
        }

        if (
            typeof error.message === "string" &&
            error.message.trim()
        ) {
            return error.message.trim();
        }

        if (
            typeof error.details === "string" &&
            error.details.trim()
        ) {
            return error.details.trim();
        }

        return String(error);
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function memberName(member) {
        const display =
            String(member.display_name || "").trim();

        if (display) {
            return display;
        }

        const fullName = [
            member.first_name,
            member.last_name
        ]
            .filter(Boolean)
            .join(" ")
            .trim();

        return fullName || member.email || "Member";
    }

    function statusLabel(value) {
        const text = String(value || "").trim();

        if (!text) {
            return "Unknown";
        }

        return text
            .replaceAll("_", " ")
            .replace(/\b\w/g, function (letter) {
                return letter.toUpperCase();
            });
    }

    function formatHandicap(value) {
        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            return "Not set";
        }

        const number = Number(value);

        return Number.isFinite(number)
            ? number.toFixed(1)
            : String(value);
    }

    function showError(error) {
        console.error(
            "Paryx member directory error:",
            error
        );

        if (!elements.error) {
            return;
        }

        elements.error.hidden = false;
        elements.error.textContent =
            getReadableError(error);
    }

    function clearError() {
        if (elements.error) {
            elements.error.hidden = true;
            elements.error.textContent = "";
        }
    }

    function renderLoading(reset) {
        if (!elements.list) {
            return;
        }

        if (reset) {
            elements.list.innerHTML = `
                <div class="admin-member-loading">
                    Loading members...
                </div>
            `;
        }

        if (elements.refresh) {
            elements.refresh.disabled = true;
        }

        if (elements.loadMore) {
            elements.loadMore.disabled = true;
        }
    }

    function renderCount() {
        if (!elements.resultCount) {
            return;
        }

        elements.resultCount.textContent =
            new Intl.NumberFormat("en-GB")
                .format(state.total);
    }

    function getMemberAction(member) {
        const isSelf =
            member.profile_id === state.currentUserId;

        if (isSelf) {
            return null;
        }

        if (
            member.membership_role === "club_admin" &&
            state.adminRole !== "club_admin"
        ) {
            return null;
        }

        if (member.membership_status === "active") {
            return {
                label: "Suspend",
                nextStatus: "suspended",
                danger: true
            };
        }

        if (
            [
                "suspended",
                "expired",
                "cancelled"
            ].includes(member.membership_status)
        ) {
            return {
                label: "Reactivate",
                nextStatus: "active",
                danger: false
            };
        }

        return null;
    }

    function canRemoveMember(member) {
        const isSelf =
            member.profile_id === state.currentUserId;

        if (isSelf) {
            return false;
        }

        if (state.adminRole !== "club_admin") {
            return false;
        }

        return true;
    }

    function renderMemberCard(member) {
        const action =
            getMemberAction(member);

        const status =
            String(member.membership_status || "unknown");

        const role =
            ROLE_LABELS[member.membership_role] ||
            statusLabel(member.membership_role);

        const membershipType =
            TYPE_LABELS[member.membership_type] ||
            statusLabel(member.membership_type);

        const isSelf =
            member.profile_id === state.currentUserId;

        return `
            <article
                class="admin-member-card"
                data-membership-id="${escapeHtml(member.membership_id)}"
            >
                <div class="admin-member-card__top">
                    <div>
                        <h2 class="admin-member-card__name">
                            ${escapeHtml(memberName(member))}
                            ${isSelf ? '<small> · You</small>' : ""}
                        </h2>

                        <span class="admin-member-card__email">
                            ${escapeHtml(member.email || "No email")}
                        </span>
                    </div>

                    <span class="admin-member-status admin-member-status--${escapeHtml(status)}">
                        ${escapeHtml(statusLabel(status))}
                    </span>
                </div>

                <div class="admin-member-card__details">
                    <div class="admin-member-detail">
                        <span>Member no.</span>
                        <strong>${escapeHtml(member.membership_number || "—")}</strong>
                    </div>

                    <div class="admin-member-detail">
                        <span>Membership</span>
                        <strong>${escapeHtml(membershipType)}</strong>
                    </div>

                    <div class="admin-member-detail">
                        <span>Handicap</span>
                        <strong>${escapeHtml(formatHandicap(member.handicap_index))}</strong>
                    </div>

                    <div class="admin-member-detail">
                        <span>Role</span>
                        <strong>${escapeHtml(role)}</strong>
                    </div>
                </div>

                ${
                    action || canRemoveMember(member)
                        ? `
                            <div class="admin-member-card__actions">
                                ${
                                    action
                                        ? `
                                            <button
                                                class="admin-member-action ${action.danger ? "admin-member-action--danger" : ""}"
                                                type="button"
                                                data-member-status-action="${escapeHtml(action.nextStatus)}"
                                                data-membership-id="${escapeHtml(member.membership_id)}"
                                                data-member-name="${escapeHtml(memberName(member))}"
                                            >
                                                ${escapeHtml(action.label)}
                                            </button>
                                        `
                                        : ""
                                }

                                ${
                                    canRemoveMember(member)
                                        ? `
                                            <button
                                                class="admin-member-action admin-member-action--remove"
                                                type="button"
                                                data-member-remove
                                                data-membership-id="${escapeHtml(member.membership_id)}"
                                                data-member-name="${escapeHtml(memberName(member))}"
                                            >
                                                Remove from club
                                            </button>
                                        `
                                        : ""
                                }
                            </div>
                        `
                        : ""
                }
            </article>
        `;
    }

    function renderMembers(reset) {
        if (!elements.list) {
            return;
        }

        if (!state.members.length) {
            elements.list.innerHTML = `
                <div class="admin-member-empty">
                    No members match this search.
                </div>
            `;
        } else {
            const html = state.members
                .map(renderMemberCard)
                .join("");

            elements.list.innerHTML = html;
        }

        renderCount();

        if (elements.loadMore) {
            elements.loadMore.hidden =
                state.members.length >= state.total;

            elements.loadMore.disabled = false;
        }

        if (elements.refresh) {
            elements.refresh.disabled = false;
        }

        bindMemberActions();
    }

    function bindMemberActions() {
        document
            .querySelectorAll("[data-member-status-action]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    handleStatusAction
                );
            });

        document
            .querySelectorAll("[data-member-remove]")
            .forEach(function (button) {
                button.addEventListener(
                    "click",
                    handleRemoveMember
                );
            });
    }


    function formatRequestDate(value) {
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
            return String(value);
        }

        return new Intl.DateTimeFormat(
            "en-GB",
            {
                day: "numeric",
                month: "short",
                year: "numeric"
            }
        ).format(date);
    }

    function accessRequestName(request) {
        return (
            String(
                request.display_name ||
                ""
            ).trim() ||
            String(
                request.email ||
                ""
            ).trim() ||
            "Paryx player"
        );
    }

    function renderAccessRequests() {
        if (
            !elements.accessList ||
            !elements.accessCount
        ) {
            return;
        }

        elements.accessCount.textContent =
            String(
                state.accessRequests.length
            );

        if (!state.accessRequests.length) {
            elements.accessList.innerHTML = `
                <div class="admin-member-empty">
                    No pending member access requests.
                </div>
            `;

            return;
        }

        elements.accessList.innerHTML =
            state.accessRequests
                .map(function (request) {
                    const requestName =
                        accessRequestName(
                            request
                        );

                    const membershipNumber =
                        String(
                            request
                                .requested_membership_number ||
                            ""
                        ).trim();

                    const message =
                        String(
                            request.message ||
                            ""
                        ).trim();

                    return `
                        <article
                            class="admin-access-request"
                            data-access-request-id="${escapeHtml(request.request_id)}"
                        >
                            <div class="admin-access-request__top">
                                <div>
                                    <h3 class="admin-access-request__name">
                                        ${escapeHtml(requestName)}
                                    </h3>

                                    <span class="admin-access-request__email">
                                        ${escapeHtml(request.email || "No email")}
                                    </span>
                                </div>

                                <span class="admin-access-request__pending">
                                    Pending
                                </span>
                            </div>

                            <div class="admin-access-request__details">
                                <div class="admin-access-request__detail">
                                    <span>Membership no.</span>
                                    <strong>
                                        ${escapeHtml(membershipNumber || "Not supplied")}
                                    </strong>
                                </div>

                                <div class="admin-access-request__detail">
                                    <span>Requested</span>
                                    <strong>
                                        ${escapeHtml(formatRequestDate(request.created_at))}
                                    </strong>
                                </div>
                            </div>

                            ${
                                message
                                    ? `
                                        <p class="admin-access-request__message">
                                            ${escapeHtml(message)}
                                        </p>
                                    `
                                    : ""
                            }

                            <div class="admin-access-request__actions">
                                <button
                                    class="admin-access-request__reject"
                                    type="button"
                                    data-access-reject="${escapeHtml(request.request_id)}"
                                    data-access-name="${escapeHtml(requestName)}"
                                >
                                    Reject
                                </button>

                                <button
                                    class="admin-access-request__approve"
                                    type="button"
                                    data-access-approve="${escapeHtml(request.request_id)}"
                                >
                                    Approve
                                </button>
                            </div>
                        </article>
                    `;
                })
                .join("");
    }

    async function loadAccessRequests() {
        if (
            state.accessLoading ||
            !state.clubId
        ) {
            return;
        }

        state.accessLoading =
            true;

        if (elements.accessRefresh) {
            elements.accessRefresh.disabled =
                true;
        }

        if (elements.accessList) {
            elements.accessList.innerHTML = `
                <div class="admin-member-loading">
                    Loading access requests...
                </div>
            `;
        }

        try {
            const client =
                getClient();

            const {
                data,
                error
            } =
                await client.rpc(
                    "admin_get_member_access_requests",
                    {
                        p_club_id:
                            state.clubId
                    }
                );

            if (error) {
                throw error;
            }

            state.accessRequests =
                (
                    Array.isArray(data)
                        ? data
                        : []
                ).filter(
                    function (request) {
                        return (
                            String(
                                request.request_status ||
                                ""
                            ).toLowerCase() ===
                            "pending"
                        );
                    }
                );

            renderAccessRequests();
        } catch (error) {
            showError(error);

            if (elements.accessList) {
                elements.accessList.innerHTML = `
                    <div class="admin-member-empty">
                        Member access requests could not be loaded.
                    </div>
                `;
            }

            if (elements.accessCount) {
                elements.accessCount.textContent =
                    "!";
            }
        } finally {
            state.accessLoading =
                false;

            if (elements.accessRefresh) {
                elements.accessRefresh.disabled =
                    false;
            }
        }
    }

    function openAccessApproval(requestId) {
        const request =
            state.accessRequests.find(
                function (item) {
                    return (
                        item.request_id ===
                        requestId
                    );
                }
            );

        if (
            !request ||
            !elements.accessDialog
        ) {
            return;
        }

        elements.accessApprovalRequestId.value =
            request.request_id;

        elements.accessApprovalIdentity.textContent =
            [
                accessRequestName(
                    request
                ),
                request.email
            ]
                .filter(Boolean)
                .join(" · ");

        elements.accessApprovalMembershipNumber.value =
            String(
                request
                    .requested_membership_number ||
                ""
            ).trim();

        elements.accessDialog.showModal();

        window.setTimeout(
            function () {
                elements
                    .accessApprovalMembershipNumber
                    ?.focus();
            },
            0
        );
    }

    async function resolveAccessRequest(
        requestId,
        approve,
        membershipNumber
    ) {
        const client =
            getClient();

        const {
            error
        } =
            await client.rpc(
                "admin_resolve_member_access_request",
                {
                    p_club_id:
                        state.clubId,
                    p_request_id:
                        requestId,
                    p_approve:
                        Boolean(approve),
                    p_membership_number:
                        membershipNumber ||
                        null
                }
            );

        if (error) {
            throw error;
        }
    }

    async function rejectAccessRequest(
        requestId,
        requestName
    ) {
        const confirmed =
            window.confirm(
                `Reject the member access request from ${requestName || "this player"}?`
            );

        if (!confirmed) {
            return;
        }

        clearError();

        try {
            await resolveAccessRequest(
                requestId,
                false,
                null
            );

            await loadAccessRequests();
        } catch (error) {
            showError(error);
        }
    }

    async function submitAccessApproval(
        event
    ) {
        event.preventDefault();

        const requestId =
            elements
                .accessApprovalRequestId
                .value;

        if (!requestId) {
            return;
        }

        clearError();

        elements.accessApprovalSubmit.disabled =
            true;

        try {
            await resolveAccessRequest(
                requestId,
                true,
                elements
                    .accessApprovalMembershipNumber
                    .value
                    .trim() ||
                    null
            );

            elements.accessDialog.close();

            await Promise.all([
                loadAccessRequests(),
                loadMembers({
                    reset: true
                })
            ]);
        } catch (error) {
            showError(error);
        } finally {
            elements.accessApprovalSubmit.disabled =
                false;
        }
    }

    async function loadMembers(options = {}) {
        if (state.loading) {
            return;
        }

        const reset =
            options.reset !== false;

        if (reset) {
            state.offset = 0;
            state.members = [];
        }

        state.loading = true;
        clearError();
        renderLoading(reset);

        try {
            const client = getClient();

            const {
                data,
                error
            } = await client.rpc(
                "get_admin_members",
                {
                    p_club_id:
                        state.clubId,
                    p_search:
                        state.search || null,
                    p_status:
                        state.status === "all"
                            ? null
                            : state.status,
                    p_limit: PAGE_SIZE,
                    p_offset: state.offset
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
                    Number(rows[0].total_count || 0);
            } else if (reset) {
                state.total = 0;
            }

            state.members =
                reset
                    ? rows
                    : state.members.concat(rows);

            state.offset =
                state.members.length;

            renderMembers(reset);
        } catch (error) {
            showError(error);

            if (reset && elements.list) {
                elements.list.innerHTML = `
                    <div class="admin-member-empty">
                        Member directory could not be loaded.
                    </div>
                `;
            }
        } finally {
            state.loading = false;

            if (elements.refresh) {
                elements.refresh.disabled = false;
            }
        }
    }

    async function handleStatusAction(event) {
        const button = event.currentTarget;
        const membershipId =
            button.dataset.membershipId;
        const nextStatus =
            button.dataset.memberStatusAction;
        const memberNameValue =
            button.dataset.memberName || "this member";

        if (!membershipId || !nextStatus) {
            return;
        }

        const actionText =
            nextStatus === "active"
                ? "reactivate"
                : "suspend";

        const confirmed = window.confirm(
            `Are you sure you want to ${actionText} ${memberNameValue}?`
        );

        if (!confirmed) {
            return;
        }

        button.disabled = true;
        clearError();

        try {
            const client = getClient();

            const {
                error
            } = await client.rpc(
                "admin_set_member_status",
                {
                    p_club_id:
                        state.clubId,
                    p_membership_id:
                        membershipId,
                    p_status:
                        nextStatus
                }
            );

            if (error) {
                throw error;
            }

            await loadMembers({
                reset: true
            });
        } catch (error) {
            showError(error);
            button.disabled = false;
        }
    }

    async function handleRemoveMember(event) {
        const button =
            event.currentTarget;

        const membershipId =
            button.dataset.membershipId;

        const memberNameValue =
            button.dataset.memberName ||
            "this member";

        if (!membershipId) {
            return;
        }

        const confirmed =
            window.confirm(
                `Remove ${memberNameValue} from this club?\\n\\nTheir membership at this club will be deleted. Their Paryx login account is not deleted.`
            );

        if (!confirmed) {
            return;
        }

        button.disabled = true;
        clearError();

        try {
            const client =
                getClient();

            const {
                error
            } =
                await client.rpc(
                    "admin_remove_member",
                    {
                        p_club_id:
                            state.clubId,
                        p_membership_id:
                            membershipId
                    }
                );

            if (error) {
                throw error;
            }

            await loadMembers({
                reset: true
            });
        } catch (error) {
            showError(error);
            button.disabled = false;
        }
    }

    function bindControls() {
        elements.accessRefresh
            ?.addEventListener(
                "click",
                loadAccessRequests
            );

        elements.accessList
            ?.addEventListener(
                "click",
                function (event) {
                    const approveButton =
                        event.target.closest(
                            "[data-access-approve]"
                        );

                    if (approveButton) {
                        openAccessApproval(
                            approveButton
                                .dataset
                                .accessApprove
                        );

                        return;
                    }

                    const rejectButton =
                        event.target.closest(
                            "[data-access-reject]"
                        );

                    if (rejectButton) {
                        rejectAccessRequest(
                            rejectButton
                                .dataset
                                .accessReject,
                            rejectButton
                                .dataset
                                .accessName
                        );
                    }
                }
            );

        elements.accessApprovalForm
            ?.addEventListener(
                "submit",
                submitAccessApproval
            );

        [
            elements.accessApprovalClose,
            elements.accessApprovalCancel
        ].forEach(
            function (button) {
                button
                    ?.addEventListener(
                        "click",
                        function () {
                            elements
                                .accessDialog
                                ?.close();
                        }
                    );
            }
        );

        elements.search.addEventListener(
            "input",
            function () {
                state.search =
                    elements.search.value.trim();

                window.clearTimeout(
                    state.debounceTimer
                );

                state.debounceTimer =
                    window.setTimeout(
                        function () {
                            loadMembers({
                                reset: true
                            });
                        },
                        300
                    );
            }
        );

        elements.status.addEventListener(
            "change",
            function () {
                state.status =
                    elements.status.value;

                loadMembers({
                    reset: true
                });
            }
        );

        elements.refresh.addEventListener(
            "click",
            function () {
                loadMembers({
                    reset: true
                });
            }
        );

        elements.loadMore.addEventListener(
            "click",
            function () {
                loadMembers({
                    reset: false
                });
            }
        );
    }

    async function loadAdminContext() {
        if (!window.Paryx.clubContext) {
            throw new Error(
                "Paryx club context is unavailable."
            );
        }

        const clubContext =
            await window.Paryx
                .clubContext
                .ready;

        const activeClub =
            clubContext?.activeClub ||
            window.Paryx
                .clubContext
                .getActiveClub();

        if (
            !activeClub?.id ||
            !window.Paryx
                .clubContext
                .isAdminRole(
                    activeClub.role
                )
        ) {
            throw new Error(
                "Admin access required."
            );
        }

        state.clubId =
            activeClub.id;

        state.adminRole =
            activeClub.role;

        if (elements.clubName) {
            elements.clubName.textContent =
                activeClub.name ||
                "Your club";
        }
    }

    async function initialise() {
        if (state.initialised) {
            return;
        }

        state.initialised = true;
        cacheElements();
        bindControls();

        try {
            if (!window.Paryx.ready) {
                throw new Error(
                    "Paryx has not finished initialising."
                );
            }

            const context =
                await window.Paryx.ready;

            state.currentUserId =
                context?.user?.id ||
                context?.profile?.userId ||
                null;

            await loadAdminContext();

            await Promise.all([
                loadMembers({
                    reset: true
                }),
                loadAccessRequests()
            ]);
        } catch (error) {
            const message =
                getReadableError(error)
                    .toLowerCase();

            if (
                message.includes(
                    "admin access required"
                ) ||
                message.includes(
                    "staff club access required"
                )
            ) {
                window.location.replace(
                    "login.html?reason=access"
                );
                return;
            }

            showError(error);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initialise,
            { once: true }
        );
    } else {
        initialise();
    }
})();
