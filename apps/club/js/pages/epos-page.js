(function () {
    "use strict";

    window.Paryx =
        window.Paryx || {};

    const CONFIG_ROLES =
        new Set([
            "manager",
            "club_admin"
        ]);

    const MAPPING_ROLES =
        new Set([
            "professional",
            "manager",
            "club_admin"
        ]);

    const ROLE_LABELS = {
        professional:
            "Professional",
        manager:
            "Manager",
        club_admin:
            "Club Admin"
    };

    const state = {
        clubId: null,
        clubName: null,
        role: null,
        moduleEnabled: false,
        canConfigure: false,
        canMap: false,
        status: null,
        mappings: [],
        mappingSearchTimer: null,
        syncRuns: []
    };

    const elements = {
        clubName:
            document.getElementById(
                "eposClubName"
            ),

        roleBadge:
            document.getElementById(
                "eposRoleBadge"
            ),

        error:
            document.getElementById(
                "eposError"
            ),

        success:
            document.getElementById(
                "eposSuccess"
            ),

        moduleDisabled:
            document.getElementById(
                "eposModuleDisabled"
            ),

        workspace:
            document.getElementById(
                "eposWorkspace"
            ),

        connectionState:
            document.getElementById(
                "eposConnectionState"
            ),

        providerSummary:
            document.getElementById(
                "eposProviderSummary"
            ),

        mappedProducts:
            document.getElementById(
                "eposMappedProducts"
            ),

        mappingSummary:
            document.getElementById(
                "eposMappingSummary"
            ),

        lastSync:
            document.getElementById(
                "eposLastSync"
            ),

        lastSyncSummary:
            document.getElementById(
                "eposLastSyncSummary"
            ),

        syncHealth:
            document.getElementById(
                "eposSyncHealth"
            ),

        syncError:
            document.getElementById(
                "eposSyncError"
            ),

        providerName:
            document.getElementById(
                "eposProviderName"
            ),

        providerMeta:
            document.getElementById(
                "eposProviderMeta"
            ),

        configure:
            document.getElementById(
                "configureEposButton"
            ),

        manageMappings:
            document.getElementById(
                "manageMappingsButton"
            ),

        viewSyncHistory:
            document.getElementById(
                "viewSyncHistoryButton"
            ),

        configDialog:
            document.getElementById(
                "eposConfigDialog"
            ),

        configForm:
            document.getElementById(
                "eposConfigForm"
            ),

        closeConfig:
            document.getElementById(
                "closeEposConfigDialog"
            ),

        cancelConfig:
            document.getElementById(
                "cancelEposConfig"
            ),

        saveConfig:
            document.getElementById(
                "saveEposConfig"
            ),

        providerInput:
            document.getElementById(
                "eposProviderInput"
            ),

        merchantRef:
            document.getElementById(
                "eposMerchantRef"
            ),

        locationRef:
            document.getElementById(
                "eposLocationRef"
            ),

        apiBaseUrl:
            document.getElementById(
                "eposApiBaseUrl"
            ),

        salesSync:
            document.getElementById(
                "eposSalesSync"
            ),

        refundSync:
            document.getElementById(
                "eposRefundSync"
            ),

        productSync:
            document.getElementById(
                "eposProductSync"
            ),

        mappingsDialog:
            document.getElementById(
                "eposMappingsDialog"
            ),

        closeMappings:
            document.getElementById(
                "closeMappingsDialog"
            ),

        closeMappingsButton:
            document.getElementById(
                "closeMappingsButton"
            ),

        mappingSearch:
            document.getElementById(
                "eposMappingSearch"
            ),

        mappingPrompt:
            document.getElementById(
                "eposMappingPrompt"
            ),

        mappingResults:
            document.getElementById(
                "eposMappingResults"
            ),

        mappingEditor:
            document.getElementById(
                "eposMappingEditorDialog"
            ),

        mappingForm:
            document.getElementById(
                "eposMappingForm"
            ),

        mappingEditorTitle:
            document.getElementById(
                "eposMappingEditorTitle"
            ),

        closeMappingEditor:
            document.getElementById(
                "closeMappingEditor"
            ),

        cancelMappingEditor:
            document.getElementById(
                "cancelMappingEditor"
            ),

        stockProductId:
            document.getElementById(
                "eposMappingStockProductId"
            ),

        externalProductId:
            document.getElementById(
                "eposExternalProductId"
            ),

        externalSku:
            document.getElementById(
                "eposExternalSku"
            ),

        deleteMapping:
            document.getElementById(
                "deleteMappingButton"
            ),

        saveMapping:
            document.getElementById(
                "saveMappingButton"
            ),

        syncHistoryDialog:
            document.getElementById(
                "eposSyncHistoryDialog"
            ),

        closeSyncHistory:
            document.getElementById(
                "closeSyncHistoryDialog"
            ),

        closeSyncHistoryButton:
            document.getElementById(
                "closeSyncHistoryButton"
            ),

        syncHistoryList:
            document.getElementById(
                "eposSyncHistoryList"
            )
    };

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

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function clearMessages() {
        elements.error.hidden =
            true;

        elements.error.textContent =
            "";

        elements.success.hidden =
            true;

        elements.success.textContent =
            "";
    }

    function showError(error) {
        console.error(
            "Paryx EPOS error:",
            error
        );

        elements.error.hidden =
            false;

        elements.error.textContent =
            error?.message ||
            "EPOS integration could not be updated.";
    }

    function showSuccess(message) {
        elements.success.hidden =
            false;

        elements.success.textContent =
            message;
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
            return String(value);
        }

        return new Intl
            .DateTimeFormat(
                "en-GB",
                {
                    day:
                        "2-digit",

                    month:
                        "short",

                    year:
                        "numeric",

                    hour:
                        "2-digit",

                    minute:
                        "2-digit"
                }
            )
            .format(date);
    }

    function formatConnectionStatus(value) {
        const labels = {
            not_configured:
                "Not configured",

            awaiting_adapter:
                "Awaiting adapter",

            configured:
                "Configured",

            connected:
                "Connected",

            error:
                "Error",

            disabled:
                "Disabled"
        };

        return (
            labels[value] ||
            "Not configured"
        );
    }

    async function loadModuleState() {
        const {
            data,
            error
        } =
            await getClient().rpc(
                "get_my_club_modules",
                {
                    p_club_id:
                        state.clubId
                }
            );

        if (error) {
            throw error;
        }

        const module =
            (Array.isArray(data)
                ? data
                : [])
                .find(
                    function (item) {
                        return (
                            item.module_key ===
                            "epos_integration"
                        );
                    }
                );

        state.moduleEnabled =
            module?.is_enabled ===
            true;

        elements.moduleDisabled.hidden =
            state.moduleEnabled;

        elements.workspace.hidden =
            !state.moduleEnabled;

        return state.moduleEnabled;
    }

    async function loadStatus() {
        const {
            data,
            error
        } =
            await getClient().rpc(
                "epos_get_status",
                {
                    p_club_id:
                        state.clubId
                }
            );

        if (error) {
            throw error;
        }

        state.status =
            Array.isArray(data)
                ? data[0] || null
                : data;

        renderStatus();
    }

    function renderStatus() {
        const status =
            state.status || {};

        const connection =
            formatConnectionStatus(
                status.connection_status
            );

        elements.connectionState.textContent =
            connection;

        elements.providerSummary.textContent =
            status.provider_name ||
            "No provider selected";

        elements.mappedProducts.textContent =
            String(
                Number(
                    status.mapped_product_count ||
                    0
                )
            );

        elements.mappingSummary.textContent =
            `${Number(
                status.unmapped_product_count ||
                0
            )} stock product${
                Number(
                    status.unmapped_product_count ||
                    0
                ) === 1
                    ? ""
                    : "s"
            } unmapped`;

        elements.lastSync.textContent =
            status.last_sync_at
                ? formatDateTime(
                    status.last_sync_at
                )
                : "Never";

        elements.lastSyncSummary.textContent =
            status.last_sync_status
                ? `Last result: ${status.last_sync_status}`
                : "No completed sync";

        const hasError =
            Boolean(
                status.last_error
            );

        elements.syncHealth.textContent =
            hasError
                ? "Attention"
                : (
                    status.last_sync_status ===
                    "succeeded"
                        ? "Healthy"
                        : "Ready"
                );

        elements.syncError.textContent =
            status.last_error ||
            "No reported errors";

        elements.providerName.textContent =
            status.provider_name ||
            "Not configured";

        const meta = [];

        if (status.merchant_ref) {
            meta.push(
                `Account ${status.merchant_ref}`
            );
        }

        if (status.location_ref) {
            meta.push(
                `Location ${status.location_ref}`
            );
        }

        if (!meta.length) {
            meta.push(
                "Tell Paryx which EPOS provider the club uses."
            );
        }

        elements.providerMeta.textContent =
            meta.join(" · ");

        elements.configure.disabled =
            !state.canConfigure;

        elements.manageMappings.disabled =
            !state.canMap;
    }

    function openConfigDialog() {
        if (!state.canConfigure) {
            return;
        }

        const status =
            state.status || {};

        elements.providerInput.value =
            status.provider_name ||
            "";

        elements.merchantRef.value =
            status.merchant_ref ||
            "";

        elements.locationRef.value =
            status.location_ref ||
            "";

        elements.apiBaseUrl.value =
            status.api_base_url ||
            "";

        elements.salesSync.checked =
            status.sales_sync_enabled !==
            false;

        elements.refundSync.checked =
            status.refunds_sync_enabled !==
            false;

        elements.productSync.checked =
            status.product_sync_enabled ===
            true;

        elements.configDialog.showModal();
    }

    function closeConfigDialog() {
        if (
            elements.configDialog.open
        ) {
            elements.configDialog.close();
        }
    }

    async function saveConfig(event) {
        event.preventDefault();

        if (!state.canConfigure) {
            return;
        }

        clearMessages();

        elements.saveConfig.disabled =
            true;

        try {
            const {
                error
            } =
                await getClient().rpc(
                    "epos_save_connection",
                    {
                        p_club_id:
                            state.clubId,

                        p_provider_name:
                            elements.providerInput.value ||
                            null,

                        p_merchant_ref:
                            elements.merchantRef.value ||
                            null,

                        p_location_ref:
                            elements.locationRef.value ||
                            null,

                        p_api_base_url:
                            elements.apiBaseUrl.value ||
                            null,

                        p_sales_sync_enabled:
                            elements.salesSync.checked,

                        p_refunds_sync_enabled:
                            elements.refundSync.checked,

                        p_product_sync_enabled:
                            elements.productSync.checked
                    }
                );

            if (error) {
                throw error;
            }

            closeConfigDialog();

            await loadStatus();

            showSuccess(
                "EPOS configuration saved."
            );
        } catch (error) {
            showError(error);
        } finally {
            elements.saveConfig.disabled =
                false;
        }
    }

    async function openMappingsDialog() {
        if (!state.canMap) {
            return;
        }

        elements.mappingSearch.value =
            "";

        elements.mappingPrompt.hidden =
            false;

        elements.mappingResults.hidden =
            true;

        elements.mappingResults.innerHTML =
            "";

        elements.mappingsDialog.showModal();

        window.setTimeout(
            function () {
                elements.mappingSearch.focus();
            },
            50
        );
    }

    function closeMappingsDialog() {
        if (
            elements.mappingsDialog.open
        ) {
            elements.mappingsDialog.close();
        }
    }

    async function searchMappings() {
        const search =
            String(
                elements.mappingSearch.value ||
                ""
            ).trim();

        if (!search) {
            elements.mappingPrompt.hidden =
                false;

            elements.mappingResults.hidden =
                true;

            elements.mappingResults.innerHTML =
                "";

            return;
        }

        const {
            data,
            error
        } =
            await getClient().rpc(
                "epos_list_product_mappings",
                {
                    p_club_id:
                        state.clubId,

                    p_search:
                        search
                }
            );

        if (error) {
            throw error;
        }

        state.mappings =
            Array.isArray(data)
                ? data
                : [];

        renderMappingResults();
    }

    function renderMappingResults() {
        elements.mappingPrompt.hidden =
            true;

        elements.mappingResults.hidden =
            false;

        if (!state.mappings.length) {
            elements.mappingResults.innerHTML = `
                <div class="epos-empty">
                    No Stock Inventory records match this search.
                </div>
            `;

            return;
        }

        elements.mappingResults.innerHTML =
            state.mappings
                .map(
                    function (item) {
                        const mapped =
                            Boolean(
                                item.mapping_id
                            );

                        return `
                            <div class="epos-mapping-row">
                                <div>
                                    <strong>
                                        ${escapeHtml(
                                            item.product_name
                                        )}
                                    </strong>

                                    <small>
                                        ${escapeHtml(
                                            item.stock_sku
                                        )}
                                    </small>
                                </div>

                                <div>
                                    <span>
                                        ${escapeHtml(
                                            item.category ||
                                            "Uncategorised"
                                        )}
                                    </span>

                                    <span class="epos-mapping-state${
                                        mapped
                                            ? ""
                                            : " epos-mapping-state--unmapped"
                                    }">
                                        ${
                                            mapped
                                                ? "Mapped"
                                                : "Unmapped"
                                        }
                                    </span>
                                </div>

                                <div>
                                    <strong>
                                        ${escapeHtml(
                                            item.provider_product_id ||
                                            "—"
                                        )}
                                    </strong>

                                    <small>
                                        ${escapeHtml(
                                            item.provider_sku ||
                                            ""
                                        )}
                                    </small>
                                </div>

                                <button
                                    class="epos-button epos-button--secondary"
                                    type="button"
                                    data-map-stock-product="${escapeHtml(
                                        item.stock_product_id
                                    )}"
                                >
                                    ${
                                        mapped
                                            ? "Edit mapping"
                                            : "Map product"
                                    }
                                </button>
                            </div>
                        `;
                    }
                )
                .join("");
    }

    function openMappingEditor(
        stockProductId
    ) {
        const item =
            state.mappings.find(
                function (mapping) {
                    return (
                        mapping.stock_product_id ===
                        stockProductId
                    );
                }
            );

        if (!item) {
            return;
        }

        elements.mappingEditorTitle.textContent =
            item.product_name;

        elements.stockProductId.value =
            item.stock_product_id;

        elements.externalProductId.value =
            item.provider_product_id ||
            "";

        elements.externalSku.value =
            item.provider_sku ||
            "";

        elements.deleteMapping.hidden =
            !item.mapping_id;

        elements.mappingEditor.showModal();
    }

    function closeMappingEditor() {
        if (
            elements.mappingEditor.open
        ) {
            elements.mappingEditor.close();
        }
    }

    async function saveMapping(event) {
        event.preventDefault();

        if (!state.canMap) {
            return;
        }

        clearMessages();

        elements.saveMapping.disabled =
            true;

        try {
            const {
                error
            } =
                await getClient().rpc(
                    "epos_save_product_mapping",
                    {
                        p_club_id:
                            state.clubId,

                        p_stock_product_id:
                            elements.stockProductId.value,

                        p_provider_product_id:
                            elements.externalProductId.value,

                        p_provider_sku:
                            elements.externalSku.value ||
                            null
                    }
                );

            if (error) {
                throw error;
            }

            closeMappingEditor();

            await Promise.all([
                searchMappings(),
                loadStatus()
            ]);

            showSuccess(
                "EPOS product mapping saved."
            );
        } catch (error) {
            showError(error);
        } finally {
            elements.saveMapping.disabled =
                false;
        }
    }

    async function deleteMapping() {
        if (
            !state.canMap ||
            !elements.stockProductId.value
        ) {
            return;
        }

        const confirmed =
            window.confirm(
                "Delete this EPOS product mapping?"
            );

        if (!confirmed) {
            return;
        }

        clearMessages();

        elements.deleteMapping.disabled =
            true;

        try {
            const {
                error
            } =
                await getClient().rpc(
                    "epos_delete_product_mapping",
                    {
                        p_club_id:
                            state.clubId,

                        p_stock_product_id:
                            elements.stockProductId.value
                    }
                );

            if (error) {
                throw error;
            }

            closeMappingEditor();

            await Promise.all([
                searchMappings(),
                loadStatus()
            ]);

            showSuccess(
                "EPOS product mapping deleted."
            );
        } catch (error) {
            showError(error);
        } finally {
            elements.deleteMapping.disabled =
                false;
        }
    }

    async function openSyncHistory() {
        elements.syncHistoryList.innerHTML = `
            <div class="epos-empty">
                Loading sync history...
            </div>
        `;

        elements.syncHistoryDialog.showModal();

        try {
            const {
                data,
                error
            } =
                await getClient().rpc(
                    "epos_get_sync_runs",
                    {
                        p_club_id:
                            state.clubId,

                        p_limit:
                            50
                    }
                );

            if (error) {
                throw error;
            }

            state.syncRuns =
                Array.isArray(data)
                    ? data
                    : [];

            renderSyncHistory();
        } catch (error) {
            elements.syncHistoryList.innerHTML = `
                <div class="epos-empty">
                    Sync history could not be loaded.
                </div>
            `;

            showError(error);
        }
    }

    function closeSyncHistory() {
        if (
            elements.syncHistoryDialog.open
        ) {
            elements.syncHistoryDialog.close();
        }
    }

    function renderSyncHistory() {
        if (!state.syncRuns.length) {
            elements.syncHistoryList.innerHTML = `
                <div class="epos-empty">
                    No EPOS sync runs have been recorded yet.
                </div>
            `;

            return;
        }

        elements.syncHistoryList.innerHTML =
            state.syncRuns
                .map(
                    function (run) {
                        const status =
                            String(
                                run.status ||
                                ""
                            );

                        const badgeClass =
                            status === "failed"
                                ? " epos-sync-badge--failed"
                                : (
                                    status === "partial"
                                        ? " epos-sync-badge--partial"
                                        : ""
                                );

                        return `
                            <div class="epos-sync-row">
                                <div>
                                    <strong>
                                        ${escapeHtml(
                                            formatDateTime(
                                                run.started_at
                                            )
                                        )}
                                    </strong>

                                    <small>
                                        ${escapeHtml(
                                            run.sync_type
                                        )}
                                    </small>
                                </div>

                                <span class="epos-sync-badge${badgeClass}">
                                    ${escapeHtml(
                                        status ||
                                        "unknown"
                                    )}
                                </span>

                                <div>
                                    <span>
                                        ${Number(
                                            run.records_applied ||
                                            0
                                        )} applied ·
                                        ${Number(
                                            run.records_failed ||
                                            0
                                        )} failed
                                    </span>

                                    <small>
                                        ${escapeHtml(
                                            run.message ||
                                            ""
                                        )}
                                    </small>
                                </div>

                                <span>
                                    ${escapeHtml(
                                        run.provider_name ||
                                        "Provider"
                                    )}
                                </span>
                            </div>
                        `;
                    }
                )
                .join("");
    }

    function bindControls() {
        elements.configure.addEventListener(
            "click",
            openConfigDialog
        );

        elements.configForm.addEventListener(
            "submit",
            saveConfig
        );

        elements.closeConfig.addEventListener(
            "click",
            closeConfigDialog
        );

        elements.cancelConfig.addEventListener(
            "click",
            closeConfigDialog
        );

        elements.manageMappings.addEventListener(
            "click",
            function () {
                openMappingsDialog()
                    .catch(
                        showError
                    );
            }
        );

        elements.closeMappings.addEventListener(
            "click",
            closeMappingsDialog
        );

        elements.closeMappingsButton.addEventListener(
            "click",
            closeMappingsDialog
        );

        elements.mappingSearch.addEventListener(
            "input",
            function () {
                window.clearTimeout(
                    state.mappingSearchTimer
                );

                state.mappingSearchTimer =
                    window.setTimeout(
                        function () {
                            searchMappings()
                                .catch(
                                    showError
                                );
                        },
                        180
                    );
            }
        );

        elements.mappingResults.addEventListener(
            "click",
            function (event) {
                const button =
                    event.target.closest(
                        "[data-map-stock-product]"
                    );

                if (!button) {
                    return;
                }

                openMappingEditor(
                    button.dataset
                        .mapStockProduct
                );
            }
        );

        elements.mappingForm.addEventListener(
            "submit",
            saveMapping
        );

        elements.closeMappingEditor.addEventListener(
            "click",
            closeMappingEditor
        );

        elements.cancelMappingEditor.addEventListener(
            "click",
            closeMappingEditor
        );

        elements.deleteMapping.addEventListener(
            "click",
            deleteMapping
        );

        elements.viewSyncHistory.addEventListener(
            "click",
            openSyncHistory
        );

        elements.closeSyncHistory.addEventListener(
            "click",
            closeSyncHistory
        );

        elements.closeSyncHistoryButton.addEventListener(
            "click",
            closeSyncHistory
        );
    }

    async function initialise() {
        bindControls();

        try {
            await window.Paryx.ready;

            if (
                !window.Paryx.clubContext
            ) {
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

            if (!activeClub?.id) {
                throw new Error(
                    "No active club is selected."
                );
            }

            state.clubId =
                activeClub.id;

            state.clubName =
                activeClub.name ||
                "Your club";

            state.role =
                activeClub.role ||
                null;

            state.canConfigure =
                CONFIG_ROLES.has(
                    state.role
                );

            state.canMap =
                MAPPING_ROLES.has(
                    state.role
                );

            elements.clubName.textContent =
                state.clubName;

            elements.roleBadge.textContent =
                ROLE_LABELS[
                    state.role
                ] ||
                String(
                    state.role ||
                    "Staff"
                ).replaceAll(
                    "_",
                    " "
                );

            const enabled =
                await loadModuleState();

            if (!enabled) {
                return;
            }

            await loadStatus();

            window.Paryx.epos = {
                clubId:
                    state.clubId,

                refresh:
                    loadStatus
            };
        } catch (error) {
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
