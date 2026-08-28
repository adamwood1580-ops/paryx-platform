(function () {
    "use strict";

    window.Paryx =
        window.Paryx || {};

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

    const SECTION_STAFF_ROLES = [
        "starter",
        "reception",
        "professional",
        "greenkeeper",
        "manager",
        "club_admin"
    ];

    const elements = {};

    const state = {
        initialised: false,
        loading: false,
        accessLoading: false,
        offset: 0,
        total: 0,
        search: "",
        status: "all",
        members: [],
        accessRequests: [],
        currentUserId: null,
        clubId: null,
        adminRole: null,
        debounceTimer: null
    };

    function cacheElements() {
        [
            "memberClubName",
            "membersError",
            "membersSuccess",
            "memberSearch",
            "memberStatusFilter",
            "memberResultCount",
            "memberRefreshBtn",
            "memberList",
            "loadMoreMembersBtn",
            "memberAccessRequestCount",
            "memberAccessRefreshBtn",
            "memberAccessRequestList",
            "memberAccessApprovalDialog",
            "memberAccessApprovalForm",
            "memberAccessApprovalIdentity",
            "memberAccessApprovalRequestId",
            "memberAccessApprovalMembershipNumber",
            "memberAccessApprovalClose",
            "memberAccessApprovalCancel",
            "memberAccessApprovalSubmit",
            "memberDetailsDialog",
            "memberDetailsForm",
            "memberDetailsIdentity",
            "memberDetailsMembershipId",
            "memberDetailsEmail",
            "memberDetailsHandicap",
            "memberDetailsRole",
            "memberDetailsNumber",
            "memberDetailsType",
            "memberDetailsStatus",
            "memberDetailsStatusHint",
            "memberDetailsJoinedAt",
            "memberDetailsStaffLink",
            "memberDetailsClose",
            "memberDetailsCancel",
            "memberDetailsSave"
        ].forEach(
            function (id) {
                elements[id] =
                    document.getElementById(id);
            }
        );
    }

    function getClient() {
        if (
            window.supabaseClient &&
            typeof window.supabaseClient.rpc ===
                "function"
        ) {
            return window.supabaseClient;
        }

        throw new Error(
            "The Paryx data service is unavailable."
        );
    }

    function readableError(error) {
        if (!error) {
            return "An unknown error occurred.";
        }

        if (
            typeof error.message ===
                "string" &&
            error.message.trim()
        ) {
            return error.message.trim();
        }

        if (
            typeof error.details ===
                "string" &&
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

    function showError(error) {
        console.error(
            "Paryx Members error:",
            error
        );

        elements.membersError.hidden =
            false;

        elements.membersError.textContent =
            readableError(error);
    }

    function clearError() {
        elements.membersError.hidden =
            true;

        elements.membersError.textContent =
            "";
    }

    function showSuccess(message) {
        elements.membersSuccess.hidden =
            false;

        elements.membersSuccess.textContent =
            message;

        window.setTimeout(
            function () {
                elements.membersSuccess.hidden =
                    true;
            },
            4500
        );
    }

    function memberName(member) {
        const display =
            String(
                member.display_name ||
                ""
            ).trim();

        if (display) {
            return display;
        }

        const fullName =
            [
                member.first_name,
                member.last_name
            ]
                .filter(Boolean)
                .join(" ")
                .trim();

        return (
            fullName ||
            member.email ||
            "Member"
        );
    }

    function statusLabel(value) {
        const text =
            String(value || "")
                .trim();

        if (!text) {
            return "Unknown";
        }

        return text
            .replaceAll("_", " ")
            .replace(
                /\b\w/g,
                function (letter) {
                    return letter
                        .toUpperCase();
                }
            );
    }

    function formatHandicap(value) {
        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            return "Not set";
        }

        const number =
            Number(value);

        return Number.isFinite(number)
            ? number.toFixed(1)
            : String(value);
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

    function memberById(membershipId) {
        return state.members.find(
            function (member) {
                return (
                    member.membership_id ===
                    membershipId
                );
            }
        ) || null;
    }

    function renderLoading(reset) {
        if (reset) {
            elements.memberList.innerHTML = `
                <div class="admin-member-loading">
                    Loading members...
                </div>
            `;
        }

        elements.memberRefreshBtn.disabled =
            true;

        elements.loadMoreMembersBtn.disabled =
            true;
    }

    function renderCount() {
        elements.memberResultCount.textContent =
            new Intl.NumberFormat(
                "en-GB"
            ).format(
                state.total
            );
    }

    function getMemberAction(member) {
        const isSelf =
            member.profile_id ===
            state.currentUserId;

        if (isSelf) {
            return null;
        }

        if (
            member.membership_role ===
                "club_admin" &&
            state.adminRole !==
                "club_admin"
        ) {
            return null;
        }

        if (
            member.membership_status ===
            "active"
        ) {
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
            ].includes(
                member.membership_status
            )
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
        if (
            member.profile_id ===
            state.currentUserId
        ) {
            return false;
        }

        return (
            state.adminRole ===
            "club_admin"
        );
    }

    function canEditMember(member) {
        if (
            member.membership_role ===
                "club_admin" &&
            state.adminRole !==
                "club_admin"
        ) {
            return false;
        }

        return true;
    }

    function renderMemberCard(member) {
        const action =
            getMemberAction(member);

        const status =
            String(
                member.membership_status ||
                "unknown"
            );

        const role =
            ROLE_LABELS[
                member.membership_role
            ] ||
            statusLabel(
                member.membership_role
            );

        const membershipType =
            TYPE_LABELS[
                member.membership_type
            ] ||
            statusLabel(
                member.membership_type
            );

        const isSelf =
            member.profile_id ===
            state.currentUserId;

        return `
            <article
                class="admin-member-card"
                data-membership-id="${escapeHtml(
                    member.membership_id
                )}"
            >
                <div class="admin-member-card__top">
                    <div>
                        <h2 class="admin-member-card__name">
                            ${escapeHtml(
                                memberName(
                                    member
                                )
                            )}
                            ${
                                isSelf
                                    ? '<small> · You</small>'
                                    : ""
                            }
                        </h2>

                        <span class="admin-member-card__email">
                            ${escapeHtml(
                                member.email ||
                                "No email"
                            )}
                        </span>
                    </div>

                    <span
                        class="admin-member-status admin-member-status--${escapeHtml(
                            status
                        )}"
                    >
                        ${escapeHtml(
                            statusLabel(
                                status
                            )
                        )}
                    </span>
                </div>

                <div class="admin-member-card__details">
                    <div class="admin-member-detail">
                        <span>Member no.</span>
                        <strong>
                            ${escapeHtml(
                                member.membership_number ||
                                "—"
                            )}
                        </strong>
                    </div>

                    <div class="admin-member-detail">
                        <span>Membership</span>
                        <strong>
                            ${escapeHtml(
                                membershipType
                            )}
                        </strong>
                    </div>

                    <div class="admin-member-detail">
                        <span>Handicap</span>
                        <strong>
                            ${escapeHtml(
                                formatHandicap(
                                    member.handicap_index
                                )
                            )}
                        </strong>
                    </div>

                    <div class="admin-member-detail">
                        <span>Role</span>
                        <strong>
                            ${escapeHtml(
                                role
                            )}
                        </strong>
                    </div>
                </div>

                <div class="admin-member-card__actions">
                    ${
                        canEditMember(member)
                            ? `
                                <button
                                    class="admin-member-action"
                                    type="button"
                                    data-member-edit
                                    data-membership-id="${escapeHtml(
                                        member.membership_id
                                    )}"
                                >
                                    Edit details
                                </button>
                            `
                            : ""
                    }

                    ${
                        action
                            ? `
                                <button
                                    class="admin-member-action ${
                                        action.danger
                                            ? "admin-member-action--danger"
                                            : ""
                                    }"
                                    type="button"
                                    data-member-status-action="${escapeHtml(
                                        action.nextStatus
                                    )}"
                                    data-membership-id="${escapeHtml(
                                        member.membership_id
                                    )}"
                                    data-member-name="${escapeHtml(
                                        memberName(
                                            member
                                        )
                                    )}"
                                >
                                    ${escapeHtml(
                                        action.label
                                    )}
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
                                    data-membership-id="${escapeHtml(
                                        member.membership_id
                                    )}"
                                    data-member-name="${escapeHtml(
                                        memberName(
                                            member
                                        )
                                    )}"
                                >
                                    Remove from club
                                </button>
                            `
                            : ""
                    }
                </div>
            </article>
        `;
    }

    function renderMembers() {
        if (!state.members.length) {
            elements.memberList.innerHTML = `
                <div class="admin-member-empty">
                    No members match this search.
                </div>
            `;
        } else {
            elements.memberList.innerHTML =
                state.members
                    .map(
                        renderMemberCard
                    )
                    .join("");
        }

        renderCount();

        elements.loadMoreMembersBtn.hidden =
            state.members.length >=
            state.total;

        elements.loadMoreMembersBtn.disabled =
            false;

        elements.memberRefreshBtn.disabled =
            false;
    }

    async function loadMembers(
        options = {}
    ) {
        if (state.loading) {
            return;
        }

        const reset =
            options.reset !==
            false;

        if (reset) {
            state.offset = 0;
            state.members = [];
        }

        state.loading =
            true;

        clearError();
        renderLoading(reset);

        try {
            const {
                data,
                error
            } =
                await getClient().rpc(
                    "get_admin_members",
                    {
                        p_club_id:
                            state.clubId,
                        p_search:
                            state.search ||
                            null,
                        p_status:
                            state.status ===
                                "all"
                                ? null
                                : state.status,
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

            state.members =
                reset
                    ? rows
                    : state.members
                        .concat(
                            rows
                        );

            state.offset =
                state.members.length;

            renderMembers();
        } catch (error) {
            showError(error);

            if (reset) {
                elements.memberList
                    .innerHTML = `
                        <div class="admin-member-empty">
                            Member directory could not be loaded.
                        </div>
                    `;
            }
        } finally {
            state.loading =
                false;

            elements.memberRefreshBtn
                .disabled =
                false;
        }
    }

    function accessRequestName(
        request
    ) {
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
        elements.memberAccessRequestCount
            .textContent =
            String(
                state.accessRequests.length
            );

        if (
            !state.accessRequests.length
        ) {
            elements.memberAccessRequestList
                .innerHTML = `
                    <div class="admin-member-empty">
                        No pending member access requests.
                    </div>
                `;

            return;
        }

        elements.memberAccessRequestList
            .innerHTML =
            state.accessRequests
                .map(
                    function (request) {
                        const name =
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
                                data-access-request-id="${escapeHtml(
                                    request.request_id
                                )}"
                            >
                                <div class="admin-access-request__top">
                                    <div>
                                        <h3 class="admin-access-request__name">
                                            ${escapeHtml(
                                                name
                                            )}
                                        </h3>

                                        <span class="admin-access-request__email">
                                            ${escapeHtml(
                                                request.email ||
                                                "No email"
                                            )}
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
                                            ${escapeHtml(
                                                membershipNumber ||
                                                "Not supplied"
                                            )}
                                        </strong>
                                    </div>

                                    <div class="admin-access-request__detail">
                                        <span>Requested</span>
                                        <strong>
                                            ${escapeHtml(
                                                formatRequestDate(
                                                    request.created_at
                                                )
                                            )}
                                        </strong>
                                    </div>
                                </div>

                                ${
                                    message
                                        ? `
                                            <p class="admin-access-request__message">
                                                ${escapeHtml(
                                                    message
                                                )}
                                            </p>
                                        `
                                        : ""
                                }

                                <div class="admin-access-request__actions">
                                    <button
                                        class="admin-access-request__reject"
                                        type="button"
                                        data-access-reject="${escapeHtml(
                                            request.request_id
                                        )}"
                                        data-access-name="${escapeHtml(
                                            name
                                        )}"
                                    >
                                        Reject
                                    </button>

                                    <button
                                        class="admin-access-request__approve"
                                        type="button"
                                        data-access-approve="${escapeHtml(
                                            request.request_id
                                        )}"
                                    >
                                        Approve
                                    </button>
                                </div>
                            </article>
                        `;
                    }
                )
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

        elements.memberAccessRefreshBtn
            .disabled =
            true;

        try {
            const {
                data,
                error
            } =
                await getClient().rpc(
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

            elements.memberAccessRequestList
                .innerHTML = `
                    <div class="admin-member-empty">
                        Member access requests could not be loaded.
                    </div>
                `;

            elements.memberAccessRequestCount
                .textContent =
                "!";
        } finally {
            state.accessLoading =
                false;

            elements.memberAccessRefreshBtn
                .disabled =
                false;
        }
    }

    function openAccessApproval(
        requestId
    ) {
        const request =
            state.accessRequests.find(
                function (item) {
                    return (
                        item.request_id ===
                        requestId
                    );
                }
            );

        if (!request) {
            return;
        }

        elements.memberAccessApprovalRequestId
            .value =
            request.request_id;

        elements.memberAccessApprovalIdentity
            .textContent =
            [
                accessRequestName(
                    request
                ),
                request.email
            ]
                .filter(Boolean)
                .join(" · ");

        elements.memberAccessApprovalMembershipNumber
            .value =
            String(
                request
                    .requested_membership_number ||
                ""
            ).trim();

        elements.memberAccessApprovalDialog
            .showModal();

        window.setTimeout(
            function () {
                elements
                    .memberAccessApprovalMembershipNumber
                    .focus();
            },
            0
        );
    }

    async function resolveAccessRequest(
        requestId,
        approve,
        membershipNumber
    ) {
        const {
            error
        } =
            await getClient().rpc(
                "admin_resolve_member_access_request",
                {
                    p_club_id:
                        state.clubId,
                    p_request_id:
                        requestId,
                    p_approve:
                        Boolean(
                            approve
                        ),
                    p_membership_number:
                        membershipNumber ||
                        null
                }
            );

        if (error) {
            throw error;
        }
    }

    async function submitAccessApproval(
        event
    ) {
        event.preventDefault();

        const requestId =
            elements
                .memberAccessApprovalRequestId
                .value;

        if (!requestId) {
            return;
        }

        clearError();

        elements.memberAccessApprovalSubmit
            .disabled =
            true;

        try {
            await resolveAccessRequest(
                requestId,
                true,
                elements
                    .memberAccessApprovalMembershipNumber
                    .value
                    .trim() ||
                    null
            );

            elements.memberAccessApprovalDialog
                .close();

            showSuccess(
                "Member access approved."
            );

            await Promise.all([
                loadAccessRequests(),
                loadMembers({
                    reset: true
                })
            ]);
        } catch (error) {
            showError(error);
        } finally {
            elements.memberAccessApprovalSubmit
                .disabled =
                false;
        }
    }

    async function rejectAccessRequest(
        requestId,
        name
    ) {
        if (
            !window.confirm(
                `Reject the member access request from ${name || "this player"}?`
            )
        ) {
            return;
        }

        clearError();

        try {
            await resolveAccessRequest(
                requestId,
                false,
                null
            );

            showSuccess(
                "Member access request rejected."
            );

            await loadAccessRequests();
        } catch (error) {
            showError(error);
        }
    }

    function openMemberDetails(
        membershipId
    ) {
        const member =
            memberById(
                membershipId
            );

        if (!member) {
            return;
        }

        const isSelf =
            member.profile_id ===
            state.currentUserId;

        elements.memberDetailsMembershipId
            .value =
            member.membership_id;

        elements.memberDetailsIdentity
            .textContent =
            memberName(
                member
            );

        elements.memberDetailsEmail
            .textContent =
            member.email ||
            "No email";

        elements.memberDetailsHandicap
            .textContent =
            formatHandicap(
                member.handicap_index
            );

        elements.memberDetailsRole
            .textContent =
            ROLE_LABELS[
                member.membership_role
            ] ||
            statusLabel(
                member.membership_role
            );

        elements.memberDetailsNumber
            .value =
            member.membership_number ||
            "";

        elements.memberDetailsType
            .value =
            [
                "member",
                "junior",
                "student",
                "social",
                "corporate"
            ].includes(
                member.membership_type
            )
                ? member.membership_type
                : "member";

        elements.memberDetailsStatus
            .value =
            member.membership_status ||
            "active";

        elements.memberDetailsJoinedAt
            .value =
            member.joined_at ||
            "";

        elements.memberDetailsStatus
            .disabled =
            isSelf;

        elements.memberDetailsStatusHint
            .textContent =
            isSelf
                ? "You cannot deactivate your own ClubHub membership here."
                : "";

        const staffManaged =
            SECTION_STAFF_ROLES.includes(
                member.membership_role
            );

        elements.memberDetailsStaffLink
            .textContent =
            staffManaged
                ? "Manage staff access"
                : "Grant ClubHub staff access";

        elements.memberDetailsStaffLink
            .href =
            `staff.html?email=${encodeURIComponent(
                member.email ||
                ""
            )}`;

        elements.memberDetailsDialog
            .showModal();
    }

    async function saveMemberDetails(
        event
    ) {
        event.preventDefault();

        const membershipId =
            elements
                .memberDetailsMembershipId
                .value;

        if (!membershipId) {
            return;
        }

        clearError();

        elements.memberDetailsSave
            .disabled =
            true;

        try {
            const member =
                memberById(
                    membershipId
                );

            const status =
                elements.memberDetailsStatus
                    .disabled
                    ? (
                        member
                            ?.membership_status ||
                        "active"
                    )
                    : elements
                        .memberDetailsStatus
                        .value;

            const {
                error
            } =
                await getClient().rpc(
                    "admin_update_member_details",
                    {
                        p_club_id:
                            state.clubId,
                        p_membership_id:
                            membershipId,
                        p_membership_number:
                            elements
                                .memberDetailsNumber
                                .value
                                .trim() ||
                            null,
                        p_membership_type:
                            elements
                                .memberDetailsType
                                .value,
                        p_status:
                            status,
                        p_joined_at:
                            elements
                                .memberDetailsJoinedAt
                                .value ||
                            null
                    }
                );

            if (error) {
                throw error;
            }

            elements.memberDetailsDialog
                .close();

            showSuccess(
                "Member details updated."
            );

            await loadMembers({
                reset: true
            });
        } catch (error) {
            showError(error);
        } finally {
            elements.memberDetailsSave
                .disabled =
                false;
        }
    }

    async function handleStatusAction(
        button
    ) {
        const membershipId =
            button.dataset
                .membershipId;

        const nextStatus =
            button.dataset
                .memberStatusAction;

        const name =
            button.dataset
                .memberName ||
            "this member";

        if (
            !membershipId ||
            !nextStatus
        ) {
            return;
        }

        const actionText =
            nextStatus ===
            "active"
                ? "reactivate"
                : "suspend";

        if (
            !window.confirm(
                `Are you sure you want to ${actionText} ${name}?`
            )
        ) {
            return;
        }

        button.disabled =
            true;

        clearError();

        try {
            const {
                error
            } =
                await getClient().rpc(
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

            showSuccess(
                nextStatus ===
                    "active"
                    ? "Member reactivated."
                    : "Member suspended."
            );

            await loadMembers({
                reset: true
            });
        } catch (error) {
            showError(error);

            button.disabled =
                false;
        }
    }

    async function handleRemoveMember(
        button
    ) {
        const membershipId =
            button.dataset
                .membershipId;

        const name =
            button.dataset
                .memberName ||
            "this member";

        if (!membershipId) {
            return;
        }

        if (
            !window.confirm(
                `Remove ${name} from this club?\n\nTheir member access will be removed, but their global Paryx account and historical booking records remain.`
            )
        ) {
            return;
        }

        button.disabled =
            true;

        clearError();

        try {
            const {
                error
            } =
                await getClient().rpc(
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

            showSuccess(
                "Member access removed from this club."
            );

            await loadMembers({
                reset: true
            });
        } catch (error) {
            showError(error);

            button.disabled =
                false;
        }
    }

    function bindControls() {
        elements.memberSearch
            .addEventListener(
                "input",
                function () {
                    state.search =
                        elements
                            .memberSearch
                            .value
                            .trim();

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

        elements.memberStatusFilter
            .addEventListener(
                "change",
                function () {
                    state.status =
                        elements
                            .memberStatusFilter
                            .value;

                    loadMembers({
                        reset: true
                    });
                }
            );

        elements.memberRefreshBtn
            .addEventListener(
                "click",
                function () {
                    loadMembers({
                        reset: true
                    });
                }
            );

        elements.loadMoreMembersBtn
            .addEventListener(
                "click",
                function () {
                    loadMembers({
                        reset: false
                    });
                }
            );

        elements.memberAccessRefreshBtn
            .addEventListener(
                "click",
                loadAccessRequests
            );

        elements.memberAccessRequestList
            .addEventListener(
                "click",
                function (event) {
                    const approve =
                        event.target.closest(
                            "[data-access-approve]"
                        );

                    if (approve) {
                        openAccessApproval(
                            approve.dataset
                                .accessApprove
                        );

                        return;
                    }

                    const reject =
                        event.target.closest(
                            "[data-access-reject]"
                        );

                    if (reject) {
                        rejectAccessRequest(
                            reject.dataset
                                .accessReject,
                            reject.dataset
                                .accessName
                        );
                    }
                }
            );

        elements.memberList
            .addEventListener(
                "click",
                function (event) {
                    const edit =
                        event.target.closest(
                            "[data-member-edit]"
                        );

                    if (edit) {
                        openMemberDetails(
                            edit.dataset
                                .membershipId
                        );

                        return;
                    }

                    const status =
                        event.target.closest(
                            "[data-member-status-action]"
                        );

                    if (status) {
                        handleStatusAction(
                            status
                        );

                        return;
                    }

                    const remove =
                        event.target.closest(
                            "[data-member-remove]"
                        );

                    if (remove) {
                        handleRemoveMember(
                            remove
                        );
                    }
                }
            );

        elements.memberAccessApprovalForm
            .addEventListener(
                "submit",
                submitAccessApproval
            );

        elements.memberDetailsForm
            .addEventListener(
                "submit",
                saveMemberDetails
            );

        [
            [
                elements
                    .memberAccessApprovalClose,
                elements
                    .memberAccessApprovalDialog
            ],
            [
                elements
                    .memberAccessApprovalCancel,
                elements
                    .memberAccessApprovalDialog
            ],
            [
                elements
                    .memberDetailsClose,
                elements
                    .memberDetailsDialog
            ],
            [
                elements
                    .memberDetailsCancel,
                elements
                    .memberDetailsDialog
            ]
        ].forEach(
            function (
                [
                    button,
                    dialog
                ]
            ) {
                button.addEventListener(
                    "click",
                    function () {
                        dialog.close();
                    }
                );
            }
        );
    }

    async function loadAdminContext() {
        if (
            !window.Paryx
                .clubContext
        ) {
            throw new Error(
                "Paryx club context is unavailable."
            );
        }

        const context =
            await window.Paryx
                .clubContext
                .ready;

        const activeClub =
            context?.activeClub ||
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

        elements.memberClubName
            .textContent =
            activeClub.name ||
            "Your club";
    }

    async function initialise() {
        if (state.initialised) {
            return;
        }

        state.initialised =
            true;

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
                readableError(error)
                    .toLowerCase();

            if (
                message.includes(
                    "admin access required"
                ) ||
                message.includes(
                    "staff club access required"
                )
            ) {
                window.location
                    .replace(
                        "login.html?reason=access"
                    );

                return;
            }

            showError(error);
        }
    }

    if (
        document.readyState ===
        "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            initialise,
            {
                once: true
            }
        );
    } else {
        initialise();
    }
})();
