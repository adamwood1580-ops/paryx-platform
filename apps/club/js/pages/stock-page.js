(function () {
    "use strict";

    window.Paryx = window.Paryx || {};

    const VIEW_ROLES = new Set([
        "reception",
        "professional",
        "manager",
        "club_admin"
    ]);

    const MANAGE_ROLES = new Set([
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

    const MOVEMENT_LABELS = {
        opening: "Opening stock",
        receipt: "Stock received",
        adjustment_in: "Adjustment in",
        adjustment_out: "Adjustment out",
        return: "Customer return",
        stocktake: "Stocktake correction",
        sale: "Sale",
        epos_sale: "EPOS sale",
        epos_refund: "EPOS refund"
    };

    const state = {
        clubId: null,
        clubName: null,
        role: null,
        currency: "GBP",
        moduleEnabled: false,
        canManage: false,
        products: [],
        filteredProducts: [],
        productMap: new Map(),
        summary: null,
        activity: [],
        searchTimer: null
    };

    const elements = {
        clubName: document.getElementById("stockClubName"),
        roleBadge: document.getElementById("stockRoleBadge"),
        error: document.getElementById("stockError"),
        success: document.getElementById("stockSuccess"),
        disabled: document.getElementById("stockModuleDisabled"),
        workspace: document.getElementById("stockWorkspace"),
        activeProducts: document.getElementById("stockActiveProducts"),
        productDetail: document.getElementById("stockProductDetail"),
        lowCount: document.getElementById("stockLowCount"),
        outCount: document.getElementById("stockOutCount"),
        costValue: document.getElementById("stockCostValue"),
        retailValue: document.getElementById("stockRetailValue"),
        search: document.getElementById("stockSearch"),
        categoryFilter: document.getElementById("stockCategoryFilter"),
        supplierFilter: document.getElementById("stockSupplierFilter"),
        filter: document.getElementById("stockFilter"),
        productSelect: document.getElementById("stockProductSelect"),
        clearLookup: document.getElementById("clearStockLookup"),
        lookupPrompt: document.getElementById("stockLookupPrompt"),
        resultsCard: document.getElementById("stockResultsCard"),
        resultSummary: document.getElementById("stockResultSummary"),
        viewAudit: document.getElementById("viewStockAudit"),
        addProduct: document.getElementById("addStockProduct"),
        refresh: document.getElementById("refreshStock"),
        tableBody: document.getElementById("stockTableBody"),
        tableEmpty: document.getElementById("stockTableEmpty"),
        auditDialog: document.getElementById("stockAuditDialog"),
        closeAuditDialog: document.getElementById("closeStockAuditDialog"),
        closeAuditButton: document.getElementById("closeStockAuditButton"),
        activity: document.getElementById("stockActivity"),
        productDialog: document.getElementById("stockProductDialog"),
        productForm: document.getElementById("stockProductForm"),
        productDialogTitle: document.getElementById("stockProductDialogTitle"),
        closeProductDialog: document.getElementById("closeStockProductDialog"),
        productId: document.getElementById("stockProductId"),
        productName: document.getElementById("stockProductName"),
        productSku: document.getElementById("stockProductSku"),
        productBarcode: document.getElementById("stockProductBarcode"),
        productCategory: document.getElementById("stockProductCategory"),
        productSupplier: document.getElementById("stockProductSupplier"),
        productCost: document.getElementById("stockProductCost"),
        productPrice: document.getElementById("stockProductPrice"),
        productVat: document.getElementById("stockProductVat"),
        productReorder: document.getElementById("stockProductReorder"),
        productOpening: document.getElementById("stockProductOpening"),
        openingField: document.getElementById("stockOpeningQuantityField"),
        productDescription: document.getElementById("stockProductDescription"),
        productTracked: document.getElementById("stockProductTracked"),
        productActive: document.getElementById("stockProductActive"),
        saveProduct: document.getElementById("saveStockProduct"),
        adjustStock: document.getElementById("adjustStockButton"),
        removeProduct: document.getElementById("removeStockProductButton"),
        adjustmentDialog: document.getElementById("stockAdjustmentDialog"),
        adjustmentForm: document.getElementById("stockAdjustmentForm"),
        adjustmentTitle: document.getElementById("stockAdjustmentTitle"),
        closeAdjustmentDialog: document.getElementById("closeStockAdjustmentDialog"),
        adjustmentProductId: document.getElementById("stockAdjustmentProductId"),
        movementType: document.getElementById("stockMovementType"),
        adjustmentQuantity: document.getElementById("stockAdjustmentQuantity"),
        quantityLabel: document.getElementById("stockQuantityLabel"),
        adjustmentReference: document.getElementById("stockAdjustmentReference"),
        adjustmentNote: document.getElementById("stockAdjustmentNote"),
        adjustmentHint: document.getElementById("stockAdjustmentHint"),
        saveAdjustment: document.getElementById("saveStockAdjustment")
    };

    function getClient() {
        if (window.supabaseClient && typeof window.supabaseClient.rpc === "function") {
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
        console.error("Paryx Stock error:", error);
        elements.error.hidden = false;
        elements.error.textContent = error?.message || "Stock inventory could not be updated.";
    }

    function showSuccess(message) {
        elements.success.hidden = false;
        elements.success.textContent = message;
    }

    function toNumber(value, fallback = 0) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function formatMoney(value) {
        return new Intl.NumberFormat("en-GB", {
            style: "currency",
            currency: state.currency || "GBP"
        }).format(toNumber(value));
    }

    function formatDateTime(value) {
        if (!value) return "—";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat("en-GB", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit"
        }).format(date);
    }

    function movementLabel(value) {
        return MOVEMENT_LABELS[String(value || "")] || String(value || "Movement").replaceAll("_", " ");
    }

    function productStatus(product) {
        if (product.is_active !== true) {
            return { text: "Inactive", className: "stock-badge stock-badge--inactive" };
        }
        if (product.track_stock === true && toNumber(product.quantity_on_hand) <= 0) {
            return { text: "Out", className: "stock-badge stock-badge--out" };
        }
        if (
            product.track_stock === true &&
            toNumber(product.quantity_on_hand) <= toNumber(product.reorder_level)
        ) {
            return { text: "Low", className: "stock-badge stock-badge--low" };
        }
        return { text: "In stock", className: "stock-badge" };
    }

    function renderSummary() {
        const summary = state.summary || {};
        const total = toNumber(summary.total_product_count);
        elements.activeProducts.textContent = String(toNumber(summary.active_product_count));
        elements.productDetail.textContent = `${total} total product${total === 1 ? "" : "s"}`;
        elements.lowCount.textContent = String(toNumber(summary.low_stock_count));
        elements.outCount.textContent = String(toNumber(summary.out_of_stock_count));
        elements.costValue.textContent = formatMoney(summary.stock_cost_value);
        elements.retailValue.textContent = `Retail value ${formatMoney(summary.stock_retail_value)}`;
    }

    function normaliseLookup(value) {
        return String(value || "").trim().toLowerCase();
    }

    function uniqueSorted(values) {
        return Array.from(
            new Set(
                values
                    .map(function (value) {
                        return String(value || "").trim();
                    })
                    .filter(Boolean)
            )
        ).sort(function (a, b) {
            return a.localeCompare(b, "en-GB", { sensitivity: "base" });
        });
    }

    function populateLookupSelectors() {
        const selectedCategory = elements.categoryFilter.value;
        const selectedSupplier = elements.supplierFilter.value;
        const selectedProduct = elements.productSelect.value;

        const categories = uniqueSorted(
            state.products.map(function (product) {
                return product.category;
            })
        );

        const suppliers = uniqueSorted(
            state.products.map(function (product) {
                return product.supplier;
            })
        );

        elements.categoryFilter.innerHTML =
            '<option value="">All categories</option>' +
            categories.map(function (category) {
                return `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`;
            }).join("");

        elements.supplierFilter.innerHTML =
            '<option value="">All suppliers</option>' +
            suppliers.map(function (supplier) {
                return `<option value="${escapeHtml(supplier)}">${escapeHtml(supplier)}</option>`;
            }).join("");

        if (categories.includes(selectedCategory)) {
            elements.categoryFilter.value = selectedCategory;
        }

        if (suppliers.includes(selectedSupplier)) {
            elements.supplierFilter.value = selectedSupplier;
        }

        elements.productSelect.innerHTML =
            '<option value="">Select a product...</option>' +
            state.products
                .slice()
                .sort(function (a, b) {
                    return String(a.product_name || "").localeCompare(
                        String(b.product_name || ""),
                        "en-GB",
                        { sensitivity: "base" }
                    );
                })
                .map(function (product) {
                    return `<option value="${escapeHtml(product.product_id)}">${escapeHtml(product.product_name)} · ${escapeHtml(product.sku)}</option>`;
                })
                .join("");

        if (
            selectedProduct &&
            state.products.some(function (product) {
                return product.product_id === selectedProduct;
            })
        ) {
            elements.productSelect.value = selectedProduct;
        }
    }

    function lookupIsActive() {
        return Boolean(
            String(elements.search.value || "").trim() ||
            elements.categoryFilter.value ||
            elements.supplierFilter.value ||
            elements.filter.value !== "all" ||
            elements.productSelect.value
        );
    }

    function applyProductLookup() {
        const query = normaliseLookup(elements.search.value);
        const category = normaliseLookup(elements.categoryFilter.value);
        const supplier = normaliseLookup(elements.supplierFilter.value);
        const status = elements.filter.value || "all";
        const selectedProduct = elements.productSelect.value || "";

        state.filteredProducts = state.products.filter(function (product) {
            if (selectedProduct && product.product_id !== selectedProduct) {
                return false;
            }

            if (
                category &&
                normaliseLookup(product.category) !== category
            ) {
                return false;
            }

            if (
                supplier &&
                normaliseLookup(product.supplier) !== supplier
            ) {
                return false;
            }

            if (query) {
                const haystack = [
                    product.product_name,
                    product.sku,
                    product.barcode,
                    product.category,
                    product.supplier
                ]
                    .map(normaliseLookup)
                    .join(" ");

                if (!haystack.includes(query)) {
                    return false;
                }
            }

            const productState = productStatus(product).text;

            if (status === "low" && productState !== "Low") {
                return false;
            }

            if (status === "out" && productState !== "Out") {
                return false;
            }

            if (status === "inactive" && product.is_active === true) {
                return false;
            }

            return true;
        });

        renderProducts();
    }

    function renderProducts() {
        state.productMap = new Map(
            state.products.map(function (product) {
                return [product.product_id, product];
            })
        );

        const active = lookupIsActive();

        elements.lookupPrompt.hidden = active;
        elements.resultsCard.hidden = !active;

        if (!active) {
            elements.tableBody.innerHTML = "";
            elements.tableEmpty.hidden = true;
            elements.resultSummary.textContent = "0 records";
            return;
        }

        elements.resultSummary.textContent =
            `${state.filteredProducts.length} record${state.filteredProducts.length === 1 ? "" : "s"}`;

        if (!state.filteredProducts.length) {
            elements.tableBody.innerHTML = "";
            elements.tableEmpty.hidden = false;
            return;
        }

        elements.tableEmpty.hidden = true;

        elements.tableBody.innerHTML = state.filteredProducts.map(function (product) {
            const status = productStatus(product);
            const quantity = toNumber(product.quantity_on_hand);
            const reorder = toNumber(product.reorder_level);
            const quantityClass = quantity <= 0
                ? "stock-quantity--out"
                : (product.track_stock === true && quantity <= reorder ? "stock-quantity--low" : "");

            return `
                <tr>
                    <td><div class="stock-product-name">
                        <strong>${escapeHtml(product.product_name)}</strong>
                        <small>${escapeHtml(product.supplier || product.barcode || "")}</small>
                    </div></td>
                    <td>${escapeHtml(product.sku)}</td>
                    <td>${escapeHtml(product.category || "—")}</td>
                    <td class="stock-number ${quantityClass}">${product.track_stock === true ? quantity : "—"}</td>
                    <td class="stock-number">${product.track_stock === true ? reorder : "—"}</td>
                    <td class="stock-money">${formatMoney(product.cost_price)}</td>
                    <td class="stock-money">${formatMoney(product.sale_price)}</td>
                    <td><span class="${status.className}">${status.text}</span></td>
                    <td><button class="stock-button stock-button--secondary stock-button--compact" type="button" data-stock-product="${escapeHtml(product.product_id)}">${state.canManage ? "Manage" : "View"}</button></td>
                </tr>`;
        }).join("");
    }

    function renderActivity() {
        if (!state.activity.length) {
            elements.activity.innerHTML = '<div class="stock-empty">No stock movements recorded yet.</div>';
            return;
        }

        elements.activity.innerHTML = state.activity.map(function (item) {
            const delta = toNumber(item.quantity_delta);
            const deltaClass = delta > 0 ? "stock-activity-delta--positive" : "stock-activity-delta--negative";
            const deltaText = delta > 0 ? `+${delta}` : String(delta);
            return `
                <div class="stock-activity-row">
                    <div><strong>${escapeHtml(item.product_name)}</strong><small>${escapeHtml(item.sku)}</small></div>
                    <span>${escapeHtml(movementLabel(item.movement_type))}</span>
                    <span class="stock-activity-delta ${deltaClass}">${escapeHtml(deltaText)} → ${escapeHtml(item.quantity_after)}</span>
                    <div><span>${escapeHtml(item.reference || item.note || "—")}</span><small>${escapeHtml(formatDateTime(item.created_at))}</small></div>
                </div>`;
        }).join("");
    }

    async function loadModuleState() {
        const { data, error } = await getClient().rpc("get_my_club_modules", {
            p_club_id: state.clubId
        });
        if (error) throw error;
        const stockModule = (Array.isArray(data) ? data : []).find(function (item) {
            return item.module_key === "stock_inventory";
        });
        state.moduleEnabled = stockModule?.is_enabled === true;
        elements.disabled.hidden = state.moduleEnabled;
        elements.workspace.hidden = !state.moduleEnabled;
        return state.moduleEnabled;
    }

    async function loadSummary() {
        const { data, error } = await getClient().rpc("stock_get_summary", {
            p_club_id: state.clubId
        });
        if (error) throw error;
        state.summary = Array.isArray(data) ? data[0] || null : data;
        state.currency = String(state.summary?.currency_code || "GBP");
        renderSummary();
    }

    async function loadProducts() {
        const { data, error } = await getClient().rpc("stock_list_products", {
            p_club_id: state.clubId,
            p_search: null,
            p_filter: "all"
        });

        if (error) throw error;

        state.products = Array.isArray(data) ? data : [];
        populateLookupSelectors();
        applyProductLookup();
    }

    async function loadActivity() {
        const { data, error } = await getClient().rpc("stock_get_movements", {
            p_club_id: state.clubId,
            p_product_id: null,
            p_limit: 30
        });
        if (error) throw error;
        state.activity = Array.isArray(data) ? data : [];
        renderActivity();
    }

    async function refreshAll() {
        if (!state.moduleEnabled) return;
        clearMessages();
        await Promise.all([loadSummary(), loadProducts()]);
    }

    function setProductFormEditable(editable) {
        elements.productForm.querySelectorAll("input, select, textarea").forEach(function (field) {
            if (field.type !== "hidden") field.disabled = !editable;
        });
        elements.saveProduct.hidden = !editable;
        elements.adjustStock.hidden = !editable || !elements.productId.value;
        elements.removeProduct.hidden = !editable || !elements.productId.value;
    }

    async function openAuditDialog() {
        clearMessages();

        elements.activity.innerHTML =
            '<div class="stock-empty">Loading stock activity...</div>';

        elements.auditDialog.showModal();

        try {
            await loadActivity();
        } catch (error) {
            elements.activity.innerHTML =
                '<div class="stock-empty">Stock activity could not be loaded.</div>';
            showError(error);
        }
    }

    function closeAuditDialog() {
        if (elements.auditDialog.open) {
            elements.auditDialog.close();
        }
    }

    function openProductDialog(product = null) {
        clearMessages();
        const editing = Boolean(product);
        elements.productDialogTitle.textContent = editing ? "Manage product" : "Add product";
        elements.productId.value = product?.product_id || "";
        elements.productName.value = product?.product_name || "";
        elements.productSku.value = product?.sku || "";
        elements.productBarcode.value = product?.barcode || "";
        elements.productCategory.value = product?.category || "";
        elements.productSupplier.value = product?.supplier || "";
        elements.productCost.value = toNumber(product?.cost_price).toFixed(2);
        elements.productPrice.value = toNumber(product?.sale_price).toFixed(2);
        elements.productVat.value = toNumber(product?.vat_rate, 20).toFixed(2);
        elements.productReorder.value = String(toNumber(product?.reorder_level));
        elements.productOpening.value = "0";
        elements.productDescription.value = product?.description || "";
        elements.productTracked.checked = product ? product.track_stock === true : true;
        elements.productActive.checked = product ? product.is_active === true : true;
        elements.openingField.hidden = editing;
        setProductFormEditable(state.canManage);
        elements.productDialog.showModal();
    }

    function closeProductDialog() {
        if (elements.productDialog.open) elements.productDialog.close();
    }

    function adjustmentHint() {
        const type = elements.movementType.value;
        const hints = {
            receipt: "Enter the number of units received.",
            adjustment_in: "Enter the number of units to add.",
            adjustment_out: "Enter the number of units to remove.",
            return: "Enter the number of units returned to stock.",
            stocktake: "Enter the correction as a signed number. Example: -2 or 3."
        };
        elements.adjustmentHint.textContent = hints[type] || "";
        elements.quantityLabel.textContent = type === "stocktake" ? "Quantity change (+/-)" : "Quantity";
        if (type === "stocktake") {
            elements.adjustmentQuantity.removeAttribute("min");
        } else {
            elements.adjustmentQuantity.min = "1";
            if (toNumber(elements.adjustmentQuantity.value) <= 0) elements.adjustmentQuantity.value = "1";
        }
    }

    function openAdjustmentDialog(product) {
        if (!product || !state.canManage) return;
        elements.adjustmentProductId.value = product.product_id;
        elements.adjustmentTitle.textContent = `Adjust ${product.product_name}`;
        elements.movementType.value = "receipt";
        elements.adjustmentQuantity.value = "1";
        elements.adjustmentReference.value = "";
        elements.adjustmentNote.value = "";
        adjustmentHint();
        closeProductDialog();
        elements.adjustmentDialog.showModal();
    }

    function closeAdjustmentDialog() {
        if (elements.adjustmentDialog.open) elements.adjustmentDialog.close();
    }

    async function saveProduct(event) {
        event.preventDefault();
        if (!state.canManage) return;
        clearMessages();
        elements.saveProduct.disabled = true;
        try {
            const editing = Boolean(elements.productId.value);
            const { error } = await getClient().rpc("stock_save_product", {
                p_club_id: state.clubId,
                p_product_id: elements.productId.value || null,
                p_sku: elements.productSku.value,
                p_barcode: elements.productBarcode.value || null,
                p_name: elements.productName.value,
                p_description: elements.productDescription.value || null,
                p_category: elements.productCategory.value || null,
                p_supplier: elements.productSupplier.value || null,
                p_cost_price: toNumber(elements.productCost.value),
                p_sale_price: toNumber(elements.productPrice.value),
                p_vat_rate: toNumber(elements.productVat.value, 20),
                p_reorder_level: Math.max(0, Math.trunc(toNumber(elements.productReorder.value))),
                p_track_stock: elements.productTracked.checked,
                p_is_active: elements.productActive.checked,
                p_opening_quantity: editing ? null : Math.max(0, Math.trunc(toNumber(elements.productOpening.value)))
            });
            if (error) throw error;
            closeProductDialog();
            await refreshAll();
            showSuccess(editing ? "Product updated." : "Product added.");
        } catch (error) {
            showError(error);
        } finally {
            elements.saveProduct.disabled = false;
        }
    }

    async function removeProduct() {
        if (
            !state.canManage ||
            !elements.productId.value
        ) {
            return;
        }

        const product =
            state.productMap.get(
                elements.productId.value
            );

        if (!product) {
            showError(
                new Error(
                    "The selected product could not be found."
                )
            );
            return;
        }

        const confirmed =
            window.confirm(
                `Delete "${product.product_name}" from Stock Inventory?\n\n` +
                "This removes it from the live stock database. Historic stock movements remain available in Audit."
            );

        if (!confirmed) {
            return;
        }

        clearMessages();

        elements.removeProduct.disabled =
            true;

        try {
            const {
                data,
                error
            } =
                await getClient().rpc(
                    "stock_delete_product",
                    {
                        p_club_id:
                            state.clubId,

                        p_product_id:
                            product.product_id
                    }
                );

            if (error) {
                throw error;
            }

            if (data !== true) {
                throw new Error(
                    "Paryx did not confirm that the product was deleted."
                );
            }

            closeProductDialog();

            elements.search.value =
                "";

            elements.categoryFilter.value =
                "";

            elements.supplierFilter.value =
                "";

            elements.filter.value =
                "all";

            elements.productSelect.value =
                "";

            await refreshAll();

            applyProductLookup();

            showSuccess(
                "Product deleted from Stock Inventory."
            );
        } catch (error) {
            showError(error);
        } finally {
            elements.removeProduct.disabled =
                false;
        }
    }

    async function saveAdjustment(event) {
        event.preventDefault();
        if (!state.canManage) return;
        clearMessages();

        let quantity = Math.trunc(toNumber(elements.adjustmentQuantity.value));
        const movementType = elements.movementType.value;
        if (movementType === "adjustment_out") {
            quantity = -Math.abs(quantity);
        } else if (movementType !== "stocktake") {
            quantity = Math.abs(quantity);
        }
        if (!quantity) {
            showError(new Error("Quantity change cannot be zero."));
            return;
        }

        elements.saveAdjustment.disabled = true;
        try {
            const { error } = await getClient().rpc("stock_adjust_quantity", {
                p_club_id: state.clubId,
                p_product_id: elements.adjustmentProductId.value,
                p_quantity_delta: quantity,
                p_movement_type: movementType,
                p_reference: elements.adjustmentReference.value || null,
                p_note: elements.adjustmentNote.value || null
            });
            if (error) throw error;
            closeAdjustmentDialog();
            await refreshAll();
            showSuccess("Stock movement saved.");
        } catch (error) {
            showError(error);
        } finally {
            elements.saveAdjustment.disabled = false;
        }
    }

    function bindControls() {
        elements.addProduct.addEventListener("click", function () { openProductDialog(); });
        elements.refresh.addEventListener("click", function () { refreshAll().catch(showError); });
        [
            elements.categoryFilter,
            elements.supplierFilter,
            elements.filter
        ].forEach(function (control) {
            control.addEventListener("change", applyProductLookup);
        });

        elements.productSelect.addEventListener("change", function () {
            if (elements.productSelect.value) {
                elements.search.value = "";
                elements.categoryFilter.value = "";
                elements.supplierFilter.value = "";
                elements.filter.value = "all";
            }

            applyProductLookup();
        });

        elements.search.addEventListener("input", function () {
            window.clearTimeout(state.searchTimer);

            if (elements.search.value.trim()) {
                elements.productSelect.value = "";
            }

            state.searchTimer = window.setTimeout(applyProductLookup, 180);
        });

        elements.clearLookup.addEventListener("click", function () {
            elements.search.value = "";
            elements.categoryFilter.value = "";
            elements.supplierFilter.value = "";
            elements.filter.value = "all";
            elements.productSelect.value = "";

            applyProductLookup();
            elements.search.focus();
        });

        elements.viewAudit.addEventListener("click", openAuditDialog);
        elements.closeAuditDialog.addEventListener("click", closeAuditDialog);
        elements.closeAuditButton.addEventListener("click", closeAuditDialog);
        elements.tableBody.addEventListener("click", function (event) {
            const button = event.target.closest("[data-stock-product]");
            if (!button) return;
            const product = state.productMap.get(button.dataset.stockProduct);
            if (product) openProductDialog(product);
        });
        elements.productForm.addEventListener("submit", saveProduct);
        elements.adjustmentForm.addEventListener("submit", saveAdjustment);
        elements.adjustStock.addEventListener("click", function () {
            openAdjustmentDialog(state.productMap.get(elements.productId.value));
        });

        elements.removeProduct.addEventListener(
            "click",
            removeProduct
        );
        elements.closeProductDialog.addEventListener("click", closeProductDialog);
        elements.closeAdjustmentDialog.addEventListener("click", closeAdjustmentDialog);
        document.querySelectorAll("[data-close-product-dialog]").forEach(function (button) {
            button.addEventListener("click", closeProductDialog);
        });
        document.querySelectorAll("[data-close-adjustment-dialog]").forEach(function (button) {
            button.addEventListener("click", closeAdjustmentDialog);
        });
        elements.movementType.addEventListener("change", adjustmentHint);
    }

    async function initialise() {
        bindControls();
        try {
            await window.Paryx.ready;
            if (!window.Paryx.clubContext) throw new Error("Paryx club context is unavailable.");
            const clubContext = await window.Paryx.clubContext.ready;
            const activeClub = clubContext?.activeClub || window.Paryx.clubContext.getActiveClub();
            if (!activeClub?.id) throw new Error("No active club is selected.");

            state.clubId = activeClub.id;
            state.clubName = activeClub.name || "Your club";
            state.role = activeClub.role || null;
            state.canManage = MANAGE_ROLES.has(state.role);
            elements.clubName.textContent = state.clubName;
            elements.roleBadge.textContent = ROLE_LABELS[state.role] || String(state.role || "Staff").replaceAll("_", " ");
            elements.addProduct.hidden = !state.canManage;

            if (!VIEW_ROLES.has(state.role)) {
                elements.workspace.hidden = true;
                elements.disabled.hidden = true;
                throw new Error("Stock inventory access required.");
            }

            const enabled = await loadModuleState();
            if (!enabled) return;
            await refreshAll();

            window.Paryx.stock = {
                refresh: refreshAll,
                clubId: state.clubId
            };
        } catch (error) {
            showError(error);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialise, { once: true });
    } else {
        initialise();
    }
})();
