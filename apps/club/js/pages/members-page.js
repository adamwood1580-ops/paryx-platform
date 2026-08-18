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
        currentUserId: null,
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
                    action
                        ? `
                            <div class="admin-member-card__actions">
                                <button
                                    class="admin-member-action ${action.danger ? "admin-member-action--danger" : ""}"
                                    type="button"
                                    data-member-status-action="${escapeHtml(action.nextStatus)}"
                                    data-membership-id="${escapeHtml(member.membership_id)}"
                                    data-member-name="${escapeHtml(memberName(member))}"
                                >
                                    ${escapeHtml(action.label)}
                                </button>
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

    function bindControls() {
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
        const client = getClient();

        const {
            data,
            error
        } = await client.rpc(
            "get_admin_dashboard"
        );

        if (error) {
            throw error;
        }

        const dashboard =
            Array.isArray(data)
                ? data[0]
                : data;

        if (!dashboard) {
            throw new Error(
                "Admin access required."
            );
        }

        state.adminRole =
            dashboard.admin_role;

        if (elements.clubName) {
            elements.clubName.textContent =
                dashboard.club_name ||
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
            await loadMembers({
                reset: true
            });
        } catch (error) {
            const message =
                getReadableError(error)
                    .toLowerCase();

            if (
                message.includes(
                    "admin access required"
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
