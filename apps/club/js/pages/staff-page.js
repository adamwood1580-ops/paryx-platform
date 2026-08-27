(function () {
    "use strict";

    window.Paryx =
        window.Paryx || {};

    const ROLE_LABELS = {
        starter: "Starter",
        reception: "Reception",
        professional: "Professional",
        greenkeeper: "Greenkeeper",
        manager: "Manager",
        club_admin: "Club Admin"
    };

    const OPERATIONAL_ROLES = [
        "reception",
        "starter",
        "professional",
        "greenkeeper"
    ];

    const ELEVATED_ROLES = [
        "manager",
        "club_admin"
    ];

    const elements = {};

    const state = {
        initialised: false,
        loading: false,
        clubId: null,
        clubName: "",
        adminRole: null,
        currentUserId: null,
        staff: []
    };

    function cacheElements() {
        [
            "staffAdminClubName",
            "staffAdminRoleBadge",
            "staffAdminError",
            "staffAdminSuccess",
            "staffInviteForm",
            "staffInviteFirstName",
            "staffInviteLastName",
            "staffInviteEmail",
            "staffInviteRole",
            "staffInviteRoleHint",
            "staffInviteSubmit",
            "staffDirectoryCount",
            "staffDirectoryRefresh",
            "staffDirectoryList"
        ].forEach(
            function (id) {
                elements[id] =
                    document.getElementById(id);
            }
        );
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
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

    function showError(error) {
        console.error(
            "Paryx staff management error:",
            error
        );

        elements.staffAdminError.hidden =
            false;

        elements.staffAdminError.textContent =
            readableError(error);
    }

    function clearError() {
        elements.staffAdminError.hidden =
            true;

        elements.staffAdminError.textContent =
            "";
    }

    function showSuccess(message) {
        elements.staffAdminSuccess.hidden =
            false;

        elements.staffAdminSuccess.textContent =
            message;

        window.setTimeout(
            function () {
                elements.staffAdminSuccess.hidden =
                    true;
            },
            5000
        );
    }

    function clearSuccess() {
        elements.staffAdminSuccess.hidden =
            true;

        elements.staffAdminSuccess.textContent =
            "";
    }

    function roleLabel(role) {
        return (
            ROLE_LABELS[role] ||
            String(role || "Staff")
        );
    }

    function statusLabel(status) {
        return String(status || "unknown")
            .replaceAll("_", " ")
            .replace(/\b\w/g, function (letter) {
                return letter.toUpperCase();
            });
    }

    function personName(staff) {
        const display =
            String(
                staff.display_name ||
                ""
            ).trim();

        if (display) {
            return display;
        }

        const name =
            [
                staff.first_name,
                staff.last_name
            ]
                .filter(Boolean)
                .join(" ")
                .trim();

        return (
            name ||
            staff.email ||
            "Staff user"
        );
    }

    function roleOptions(
        selectedRole
    ) {
        const roles =
            state.adminRole ===
            "club_admin"
                ? [
                    ...OPERATIONAL_ROLES,
                    ...ELEVATED_ROLES
                ]
                : OPERATIONAL_ROLES;

        /*
         * Managers may view an elevated role but cannot grant or
         * change one. Include the selected option disabled so the
         * current role still renders accurately.
         */
        if (
            !roles.includes(
                selectedRole
            )
        ) {
            roles.push(
                selectedRole
            );
        }

        return roles
            .filter(Boolean)
            .map(
                function (role) {
                    const restricted =
                        state.adminRole !==
                            "club_admin" &&
                        ELEVATED_ROLES.includes(
                            role
                        );

                    return `
                        <option
                            value="${escapeHtml(role)}"
                            ${
                                role === selectedRole
                                    ? "selected"
                                    : ""
                            }
                            ${
                                restricted
                                    ? "disabled"
                                    : ""
                            }
                        >
                            ${escapeHtml(
                                roleLabel(role)
                            )}
                        </option>
                    `;
                }
            )
            .join("");
    }

    function canManageStaff(staff) {
        if (
            staff.profile_id ===
            state.currentUserId
        ) {
            return false;
        }

        if (
            state.adminRole ===
            "club_admin"
        ) {
            return true;
        }

        return !ELEVATED_ROLES.includes(
            staff.role
        );
    }

    function renderStaff() {
        elements.staffDirectoryCount
            .textContent =
            new Intl.NumberFormat(
                "en-GB"
            ).format(
                state.staff.length
            );

        if (!state.staff.length) {
            elements.staffDirectoryList
                .innerHTML = `
                    <div class="staff-empty">
                        No ClubHub staff users are configured
                        for this club.
                    </div>
                `;

            return;
        }

        elements.staffDirectoryList
            .innerHTML =
            state.staff
                .map(
                    function (staff) {
                        const self =
                            staff.profile_id ===
                            state.currentUserId;

                        const manageable =
                            canManageStaff(
                                staff
                            );

                        const active =
                            staff.status ===
                            "active";

                        const invited =
                            [
                                "invited",
                                "pending"
                            ].includes(
                                staff.status
                            );

                        return `
                            <article
                                class="staff-user-card"
                                data-staff-membership-id="${escapeHtml(
                                    staff.membership_id
                                )}"
                            >
                                <div class="staff-user-card__header">
                                    <div class="staff-user-card__identity">
                                        <h3>
                                            ${escapeHtml(
                                                personName(
                                                    staff
                                                )
                                            )}
                                            ${
                                                self
                                                    ? "<small> · You</small>"
                                                    : ""
                                            }
                                        </h3>

                                        <span>
                                            ${escapeHtml(
                                                staff.email ||
                                                "No email"
                                            )}
                                        </span>
                                    </div>

                                    <span
                                        class="staff-user-status staff-user-status--${escapeHtml(
                                            staff.status
                                        )}"
                                    >
                                        ${escapeHtml(
                                            statusLabel(
                                                staff.status
                                            )
                                        )}
                                    </span>
                                </div>

                                <div class="staff-user-card__meta">
                                    <div class="staff-user-meta">
                                        <span>Role</span>
                                        <strong>
                                            ${escapeHtml(
                                                roleLabel(
                                                    staff.role
                                                )
                                            )}
                                        </strong>
                                    </div>

                                    <div class="staff-user-meta">
                                        <span>Club relationship</span>
                                        <strong>
                                            ${escapeHtml(
                                                statusLabel(
                                                    staff.membership_type
                                                )
                                            )}
                                        </strong>
                                    </div>

                                    <div class="staff-user-meta">
                                        <span>Member no.</span>
                                        <strong>
                                            ${escapeHtml(
                                                staff.membership_number ||
                                                "—"
                                            )}
                                        </strong>
                                    </div>
                                </div>

                                <div class="staff-user-card__controls">
                                    <label class="staff-role-control">
                                        <span>ClubHub role</span>

                                        <select
                                            class="staff-role-select"
                                            data-staff-role-select
                                            data-membership-id="${escapeHtml(
                                                staff.membership_id
                                            )}"
                                            ${
                                                manageable
                                                    ? ""
                                                    : "disabled"
                                            }
                                        >
                                            ${roleOptions(
                                                staff.role
                                            )}
                                        </select>
                                    </label>

                                    <div class="staff-user-card__actions">
                                        ${
                                            manageable
                                                ? `
                                                    <button
                                                        class="staff-secondary-button"
                                                        type="button"
                                                        data-save-staff-role
                                                        data-membership-id="${escapeHtml(
                                                            staff.membership_id
                                                        )}"
                                                    >
                                                        Save role
                                                    </button>
                                                `
                                                : ""
                                        }

                                        ${
                                            manageable &&
                                            !invited
                                                ? `
                                                    <button
                                                        class="${
                                                            active
                                                                ? "staff-danger-button"
                                                                : "staff-secondary-button"
                                                        }"
                                                        type="button"
                                                        data-staff-status="${active ? "suspended" : "active"}"
                                                        data-membership-id="${escapeHtml(
                                                            staff.membership_id
                                                        )}"
                                                        data-staff-name="${escapeHtml(
                                                            personName(
                                                                staff
                                                            )
                                                        )}"
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
                                            manageable
                                                ? `
                                                    <button
                                                        class="staff-text-button"
                                                        type="button"
                                                        data-remove-staff
                                                        data-membership-id="${escapeHtml(
                                                            staff.membership_id
                                                        )}"
                                                        data-staff-name="${escapeHtml(
                                                            personName(
                                                                staff
                                                            )
                                                        )}"
                                                    >
                                                        Remove staff access
                                                    </button>
                                                `
                                                : ""
                                        }
                                    </div>
                                </div>
                            </article>
                        `;
                    }
                )
                .join("");
    }

    function applyRoleUi() {
        const clubAdmin =
            state.adminRole ===
            "club_admin";

        elements.staffAdminRoleBadge
            .textContent =
            roleLabel(
                state.adminRole
            );

        document
            .querySelectorAll(
                "#staffInviteRole [data-club-admin-only]"
            )
            .forEach(
                function (option) {
                    option.hidden =
                        !clubAdmin;

                    option.disabled =
                        !clubAdmin;
                }
            );

        if (
            !clubAdmin &&
            ELEVATED_ROLES.includes(
                elements.staffInviteRole
                    .value
            )
        ) {
            elements.staffInviteRole.value =
                "reception";
        }

        elements.staffInviteRoleHint
            .textContent =
            clubAdmin
                ? "Club Admins can grant operational, Manager and Club Admin roles."
                : "Managers can grant operational staff roles. Manager and Club Admin access requires a Club Admin.";
    }

    async function loadAdminContext() {
        const accountContext =
            await window.Paryx.ready;

        const clubContext =
            await window.Paryx
                .clubContext
                .ready;

        const activeClub =
            clubContext?.activeClub ||
            window.Paryx.clubContext
                .getActiveClub();

        if (
            !activeClub?.id ||
            ![
                "manager",
                "club_admin"
            ].includes(
                activeClub.role
            )
        ) {
            throw new Error(
                "Admin access required."
            );
        }

        state.clubId =
            activeClub.id;

        state.clubName =
            activeClub.name ||
            "Your club";

        state.adminRole =
            activeClub.role;

        state.currentUserId =
            accountContext?.user?.id ||
            accountContext?.profile?.userId ||
            null;

        elements.staffAdminClubName
            .textContent =
            state.clubName;

        applyRoleUi();
    }

    async function loadStaff() {
        if (
            state.loading ||
            !state.clubId
        ) {
            return;
        }

        state.loading =
            true;

        elements.staffDirectoryRefresh
            .disabled =
            true;

        elements.staffDirectoryList
            .innerHTML = `
                <div class="staff-empty">
                    Loading staff…
                </div>
            `;

        try {
            const {
                data,
                error
            } =
                await window.supabaseClient
                    .rpc(
                        "admin_get_club_staff",
                        {
                            p_club_id:
                                state.clubId
                        }
                    );

            if (error) {
                throw error;
            }

            state.staff =
                Array.isArray(data)
                    ? data
                    : [];

            renderStaff();
        } catch (error) {
            showError(error);

            elements.staffDirectoryList
                .innerHTML = `
                    <div class="staff-empty">
                        Staff directory could not be loaded.
                    </div>
                `;
        } finally {
            state.loading =
                false;

            elements.staffDirectoryRefresh
                .disabled =
                false;
        }
    }

    async function inviteStaff(event) {
        event.preventDefault();

        clearError();
        clearSuccess();

        const firstName =
            elements.staffInviteFirstName
                .value
                .trim();

        const lastName =
            elements.staffInviteLastName
                .value
                .trim();

        const email =
            elements.staffInviteEmail
                .value
                .trim()
                .toLowerCase();

        const role =
            elements.staffInviteRole
                .value;

        if (
            !firstName ||
            !lastName ||
            !email ||
            !elements.staffInviteEmail
                .validity.valid
        ) {
            showError(
                new Error(
                    "First name, last name and a valid email address are required."
                )
            );

            return;
        }

        elements.staffInviteSubmit
            .disabled =
            true;

        elements.staffInviteSubmit
            .textContent =
            "Adding…";

        try {
            const redirectTo =
                new URL(
                    "set-password.html",
                    window.location.href
                ).href;

            const {
                data,
                error
            } =
                await window.supabaseClient
                    .functions
                    .invoke(
                        "admin-invite-staff",
                        {
                            body: {
                                clubId:
                                    state.clubId,
                                firstName,
                                lastName,
                                email,
                                role,
                                redirectTo
                            }
                        }
                    );

            if (error) {
                throw error;
            }

            if (data?.error) {
                throw new Error(
                    data.error
                );
            }

            elements.staffInviteForm
                .reset();

            applyRoleUi();

            showSuccess(
                data?.invited
                    ? `Invitation sent to ${email}.`
                    : `${email} already has a Paryx account and has been linked to ClubHub.`
            );

            await loadStaff();
        } catch (error) {
            showError(error);
        } finally {
            elements.staffInviteSubmit
                .disabled =
                false;

            elements.staffInviteSubmit
                .textContent =
                "Add staff user";
        }
    }

    async function saveRole(
        membershipId,
        button
    ) {
        const select =
            elements.staffDirectoryList
                .querySelector(
                    `[data-staff-role-select][data-membership-id="${CSS.escape(
                        membershipId
                    )}"]`
                );

        if (!select) {
            return;
        }

        clearError();
        clearSuccess();

        button.disabled =
            true;

        try {
            const {
                error
            } =
                await window.supabaseClient
                    .rpc(
                        "admin_update_staff_role",
                        {
                            p_club_id:
                                state.clubId,
                            p_membership_id:
                                membershipId,
                            p_role:
                                select.value
                        }
                    );

            if (error) {
                throw error;
            }

            showSuccess(
                "Staff role updated."
            );

            await loadStaff();
        } catch (error) {
            showError(error);
            button.disabled =
                false;
        }
    }

    async function changeStatus(
        membershipId,
        nextStatus,
        name,
        button
    ) {
        const action =
            nextStatus ===
            "active"
                ? "reactivate"
                : "suspend";

        if (
            !window.confirm(
                `Are you sure you want to ${action} ${name}?`
            )
        ) {
            return;
        }

        clearError();
        clearSuccess();

        button.disabled =
            true;

        try {
            const {
                error
            } =
                await window.supabaseClient
                    .rpc(
                        "admin_set_staff_status",
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
                nextStatus === "active"
                    ? "Staff access reactivated."
                    : "Staff access suspended."
            );

            await loadStaff();
        } catch (error) {
            showError(error);
            button.disabled =
                false;
        }
    }

    async function removeStaff(
        membershipId,
        name,
        button
    ) {
        if (
            !window.confirm(
                `Remove ClubHub staff access for ${name}?\n\nIf they are also a genuine club member, their member relationship is preserved.`
            )
        ) {
            return;
        }

        clearError();
        clearSuccess();

        button.disabled =
            true;

        try {
            const {
                error
            } =
                await window.supabaseClient
                    .rpc(
                        "admin_remove_staff_access",
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
                "ClubHub staff access removed."
            );

            await loadStaff();
        } catch (error) {
            showError(error);
            button.disabled =
                false;
        }
    }

    function bindControls() {
        elements.staffInviteForm
            .addEventListener(
                "submit",
                inviteStaff
            );

        elements.staffDirectoryRefresh
            .addEventListener(
                "click",
                loadStaff
            );

        elements.staffDirectoryList
            .addEventListener(
                "click",
                function (event) {
                    const saveRoleButton =
                        event.target.closest(
                            "[data-save-staff-role]"
                        );

                    if (saveRoleButton) {
                        saveRole(
                            saveRoleButton
                                .dataset
                                .membershipId,
                            saveRoleButton
                        );

                        return;
                    }

                    const statusButton =
                        event.target.closest(
                            "[data-staff-status]"
                        );

                    if (statusButton) {
                        changeStatus(
                            statusButton
                                .dataset
                                .membershipId,
                            statusButton
                                .dataset
                                .staffStatus,
                            statusButton
                                .dataset
                                .staffName ||
                                "this staff user",
                            statusButton
                        );

                        return;
                    }

                    const removeButton =
                        event.target.closest(
                            "[data-remove-staff]"
                        );

                    if (removeButton) {
                        removeStaff(
                            removeButton
                                .dataset
                                .membershipId,
                            removeButton
                                .dataset
                                .staffName ||
                                "this staff user",
                            removeButton
                        );
                    }
                }
            );
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
            await loadAdminContext();
            await loadStaff();
        } catch (error) {
            const message =
                readableError(error)
                    .toLowerCase();

            if (
                message.includes(
                    "admin access required"
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
