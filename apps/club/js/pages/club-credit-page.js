(function () {
    "use strict";

    window.Paryx =
        window.Paryx || {};

    const MANAGE_ROLES =
        new Set([
            "professional",
            "manager",
            "club_admin"
        ]);

    const ROLE_LABELS = {
        reception: "Reception",
        professional: "Professional",
        manager: "Manager",
        club_admin: "Club Admin"
    };

    const TYPE_LABELS = {
        competition_prize: "Competition prize",
        manual_credit: "Manual credit",
        manual_debit: "Manual debit",
        epos_purchase: "EPOS purchase",
        refund: "Refund",
        adjustment: "Adjustment"
    };

    const state = {
        clubId: null,
        clubName: null,
        role: null,
        canManage: false,
        moduleEnabled: false,
        summary: null,
        searchResults: [],
        searchTimer: null,
        activeMember: null
    };

    const elements = {
        clubName: document.getElementById("creditClubName"),
        roleBadge: document.getElementById("creditRoleBadge"),
        error: document.getElementById("creditError"),
        success: document.getElementById("creditSuccess"),
        moduleDisabled: document.getElementById("creditModuleDisabled"),
        workspace: document.getElementById("creditWorkspace"),
        memberCount: document.getElementById("creditMemberCount"),
        totalBalance: document.getElementById("creditTotalBalance"),
        monthCredits: document.getElementById("creditMonthCredits"),
        monthDebits: document.getElementById("creditMonthDebits"),
        search: document.getElementById("creditSearch"),
        clearSearch: document.getElementById("clearCreditSearch"),
        searchPrompt: document.getElementById("creditSearchPrompt"),
        searchResults: document.getElementById("creditSearchResults"),
        accountDialog: document.getElementById("creditAccountDialog"),
        closeAccountDialog: document.getElementById("closeCreditAccountDialog"),
        closeAccountButton: document.getElementById("closeCreditAccountButton"),
        accountName: document.getElementById("creditAccountName"),
        accountMeta: document.getElementById("creditAccountMeta"),
        accountBalance: document.getElementById("creditAccountBalance"),
        transactionFormSection: document.getElementById("creditTransactionFormSection"),
        transactionForm: document.getElementById("creditTransactionForm"),
        transactionType: document.getElementById("creditTransactionType"),
        amount: document.getElementById("creditAmount"),
        reference: document.getElementById("creditReference"),
        description: document.getElementById("creditDescription"),
        postTransaction: document.getElementById("postCreditTransaction"),
        history: document.getElementById("creditTransactionHistory")
    };

    function getClient() {
        if (
            window.supabaseClient &&
            typeof window.supabaseClient.rpc === "function"
        ) {
            return window.supabaseClient;
        }

        throw new Error("The Paryx data service is unavailable.");
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function clearMessages() {
        elements.error.hidden = true;
        elements.error.textContent = "";
        elements.success.hidden = true;
        elements.success.textContent = "";
    }

    function showError(error) {
        console.error("Paryx Club Credit error:", error);
        elements.error.hidden = false;
        elements.error.textContent =
            error?.message ||
            "Member Club Credit could not be updated.";
    }

    function showSuccess(message) {
        elements.success.hidden = false;
        elements.success.textContent = message;
    }

    function formatMoney(value, currency = "GBP") {
        return new Intl.NumberFormat(
            "en-GB",
            {
                style: "currency",
                currency: String(currency || "GBP")
            }
        ).format(Number(value || 0));
    }

    function formatDateTime(value) {
        if (!value) return "—";

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return String(value);
        }

        return new Intl.DateTimeFormat(
            "en-GB",
            {
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit"
            }
        ).format(date);
    }

    async function loadModuleState() {
        const { data, error } =
            await getClient().rpc(
                "get_my_club_modules",
                {
                    p_club_id: state.clubId
                }
            );

        if (error) throw error;

        const module =
            (Array.isArray(data) ? data : [])
                .find(function (item) {
                    return item.module_key === "member_credit";
                });

        state.moduleEnabled =
            module?.is_enabled === true;

        elements.moduleDisabled.hidden =
            state.moduleEnabled;

        elements.workspace.hidden =
            !state.moduleEnabled;

        return state.moduleEnabled;
    }

    async function loadSummary() {
        const { data, error } =
            await getClient().rpc(
                "club_credit_get_summary",
                {
                    p_club_id: state.clubId
                }
            );

        if (error) throw error;

        state.summary =
            Array.isArray(data)
                ? data[0] || null
                : data;

        renderSummary();
    }

    function renderSummary() {
        const summary = state.summary || {};
        const currency =
            summary.currency_code || "GBP";

        elements.memberCount.textContent =
            String(Number(summary.members_with_credit || 0));

        elements.totalBalance.textContent =
            formatMoney(summary.total_balance, currency);

        elements.monthCredits.textContent =
            formatMoney(summary.month_credits, currency);

        elements.monthDebits.textContent =
            formatMoney(summary.month_debits, currency);
    }

    async function searchMembers() {
        const search =
            String(elements.search.value || "").trim();

        if (!search) {
            state.searchResults = [];
            elements.searchPrompt.hidden = false;
            elements.searchResults.hidden = true;
            elements.searchResults.innerHTML = "";
            return;
        }

        const { data, error } =
            await getClient().rpc(
                "club_credit_search_members",
                {
                    p_club_id: state.clubId,
                    p_search: search
                }
            );

        if (error) throw error;

        state.searchResults =
            Array.isArray(data) ? data : [];

        renderSearchResults();
    }

    function renderSearchResults() {
        elements.searchPrompt.hidden = true;
        elements.searchResults.hidden = false;

        if (!state.searchResults.length) {
            elements.searchResults.innerHTML = `
                <div class="credit-empty">
                    No active club members match this search.
                </div>
            `;
            return;
        }

        elements.searchResults.innerHTML =
            state.searchResults
                .map(function (member) {
                    const currency =
                        member.currency_code || "GBP";

                    return `
                        <div class="credit-member-row">
                            <div>
                                <strong>
                                    ${escapeHtml(
                                        member.display_name ||
                                        member.email ||
                                        "Member"
                                    )}
                                </strong>
                                <small>${escapeHtml(member.email || "")}</small>
                            </div>

                            <div>
                                <span>
                                    ${escapeHtml(
                                        member.membership_number
                                            ? `Member ${member.membership_number}`
                                            : "Active member"
                                    )}
                                </span>
                                <small>
                                    ${Number(member.transaction_count || 0)}
                                    transaction${
                                        Number(member.transaction_count || 0) === 1
                                            ? ""
                                            : "s"
                                    }
                                </small>
                            </div>

                            <span class="credit-member-balance">
                                ${escapeHtml(
                                    formatMoney(member.balance, currency)
                                )}
                            </span>

                            <button
                                class="credit-button credit-button--secondary"
                                type="button"
                                data-credit-member="${escapeHtml(member.membership_id)}"
                            >
                                Open account
                            </button>
                        </div>
                    `;
                })
                .join("");
    }

    function memberById(membershipId) {
        return (
            state.searchResults.find(function (member) {
                return member.membership_id === membershipId;
            }) || null
        );
    }

    async function openAccount(membershipId) {
        const member = memberById(membershipId);

        if (!member) return;

        state.activeMember = member;

        elements.accountName.textContent =
            member.display_name ||
            member.email ||
            "Member";

        elements.accountMeta.textContent =
            [
                member.membership_number
                    ? `Member ${member.membership_number}`
                    : "Active member",
                member.email
            ]
                .filter(Boolean)
                .join(" · ");

        elements.accountBalance.textContent =
            formatMoney(member.balance, member.currency_code);

        elements.transactionFormSection.hidden =
            !state.canManage;

        elements.amount.value = "";
        elements.reference.value = "";
        elements.description.value = "";

        elements.history.innerHTML = `
            <div class="credit-empty">
                Loading account activity...
            </div>
        `;

        elements.accountDialog.showModal();

        await loadTransactions();
    }

    function closeAccount() {
        if (elements.accountDialog.open) {
            elements.accountDialog.close();
        }

        state.activeMember = null;
    }

    async function loadTransactions() {
        if (!state.activeMember) return;

        const { data, error } =
            await getClient().rpc(
                "club_credit_get_transactions",
                {
                    p_club_id: state.clubId,
                    p_membership_id:
                        state.activeMember.membership_id,
                    p_limit: 100
                }
            );

        if (error) throw error;

        renderTransactions(
            Array.isArray(data) ? data : []
        );
    }

    function renderTransactions(transactions) {
        if (!transactions.length) {
            elements.history.innerHTML = `
                <div class="credit-empty">
                    No club-credit transactions recorded yet.
                </div>
            `;
            return;
        }

        elements.history.innerHTML =
            transactions
                .map(function (item) {
                    const amount = Number(item.amount || 0);
                    const credit = amount > 0;
                    const currency =
                        item.currency_code ||
                        state.activeMember?.currency_code ||
                        "GBP";

                    return `
                        <div class="credit-history-row">
                            <div>
                                <strong>
                                    ${escapeHtml(
                                        TYPE_LABELS[item.transaction_type] ||
                                        item.transaction_type
                                    )}
                                </strong>
                                <small>
                                    ${escapeHtml(formatDateTime(item.created_at))}
                                </small>
                            </div>

                            <span>
                                ${escapeHtml(item.reference || "—")}
                            </span>

                            <span class="credit-history-amount ${
                                credit
                                    ? "credit-history-amount--credit"
                                    : "credit-history-amount--debit"
                            }">
                                ${credit ? "+" : ""}${escapeHtml(
                                    formatMoney(amount, currency)
                                )}
                            </span>

                            <span>
                                ${escapeHtml(
                                    item.description ||
                                    `Balance ${formatMoney(
                                        item.balance_after,
                                        currency
                                    )}`
                                )}
                            </span>
                        </div>
                    `;
                })
                .join("");
    }

    async function postTransaction(event) {
        event.preventDefault();

        if (!state.canManage || !state.activeMember) {
            return;
        }

        const rawType =
            elements.transactionType.value;

        const amount =
            Number(elements.amount.value);

        if (!Number.isFinite(amount) || amount <= 0) {
            showError(
                new Error("Enter an amount greater than zero.")
            );
            return;
        }

        let transactionType = rawType;
        let direction = null;

        if (rawType === "adjustment_credit") {
            transactionType = "adjustment";
            direction = "credit";
        }

        if (rawType === "adjustment_debit") {
            transactionType = "adjustment";
            direction = "debit";
        }

        clearMessages();
        elements.postTransaction.disabled = true;

        try {
            const { data, error } =
                await getClient().rpc(
                    "club_credit_post_transaction",
                    {
                        p_club_id: state.clubId,
                        p_membership_id:
                            state.activeMember.membership_id,
                        p_transaction_type:
                            transactionType,
                        p_amount: amount,
                        p_reference:
                            elements.reference.value || null,
                        p_description:
                            elements.description.value || null,
                        p_direction: direction
                    }
                );

            if (error) throw error;

            const result =
                Array.isArray(data)
                    ? data[0] || null
                    : data;

            const newBalance =
                Number(
                    result?.balance_after ??
                    state.activeMember.balance ??
                    0
                );

            state.activeMember.balance =
                newBalance;

            const searchMember =
                memberById(
                    state.activeMember.membership_id
                );

            if (searchMember) {
                searchMember.balance = newBalance;
                searchMember.transaction_count =
                    Number(searchMember.transaction_count || 0) + 1;
            }

            elements.accountBalance.textContent =
                formatMoney(
                    newBalance,
                    state.activeMember.currency_code
                );

            elements.amount.value = "";
            elements.reference.value = "";
            elements.description.value = "";

            await Promise.all([
                loadTransactions(),
                loadSummary()
            ]);

            renderSearchResults();

            showSuccess(
                transactionType === "competition_prize"
                    ? "Competition prize credited to the member account."
                    : "Club-credit transaction posted."
            );
        } catch (error) {
            showError(error);
        } finally {
            elements.postTransaction.disabled = false;
        }
    }

    function bindControls() {
        elements.search.addEventListener(
            "input",
            function () {
                window.clearTimeout(state.searchTimer);

                state.searchTimer =
                    window.setTimeout(
                        function () {
                            searchMembers().catch(showError);
                        },
                        180
                    );
            }
        );

        elements.clearSearch.addEventListener(
            "click",
            function () {
                elements.search.value = "";
                searchMembers();
                elements.search.focus();
            }
        );

        elements.searchResults.addEventListener(
            "click",
            function (event) {
                const button =
                    event.target.closest(
                        "[data-credit-member]"
                    );

                if (!button) return;

                openAccount(
                    button.dataset.creditMember
                ).catch(showError);
            }
        );

        elements.closeAccountDialog.addEventListener(
            "click",
            closeAccount
        );

        elements.closeAccountButton.addEventListener(
            "click",
            closeAccount
        );

        elements.transactionForm.addEventListener(
            "submit",
            postTransaction
        );
    }

    async function initialise() {
        bindControls();

        try {
            await window.Paryx.ready;

            if (!window.Paryx.clubContext) {
                throw new Error(
                    "Paryx club context is unavailable."
                );
            }

            const clubContext =
                await window.Paryx.clubContext.ready;

            const activeClub =
                clubContext?.activeClub ||
                window.Paryx.clubContext.getActiveClub();

            if (!activeClub?.id) {
                throw new Error(
                    "No active club is selected."
                );
            }

            state.clubId = activeClub.id;
            state.clubName =
                activeClub.name || "Your club";
            state.role = activeClub.role || null;
            state.canManage =
                MANAGE_ROLES.has(state.role);

            elements.clubName.textContent =
                state.clubName;

            elements.roleBadge.textContent =
                ROLE_LABELS[state.role] ||
                String(state.role || "Staff")
                    .replaceAll("_", " ");

            const enabled =
                await loadModuleState();

            if (!enabled) return;

            await loadSummary();
            elements.search.focus();
        } catch (error) {
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
