(function () {
    "use strict";

    window.Paryx = window.Paryx || {};

    const BRANDING_BUCKET =
        "club-branding";

    const MAX_LOGO_BYTES =
        2 * 1024 * 1024;

    const DEFAULT_BRANDING = {
        primary: "#064831",
        secondary: "#022D1D",
        accent: "#E5C45F"
    };

    const ROLE_LABELS = {
        manager: "Manager",
        club_admin: "Club Admin"
    };

    const elements = {};

    const state = {
        clubId: null,
        role: null,
        config: null,
        currentLogoPath: null,
        pendingLogoFile: null,
        removeLogo: false,
        previewUrl: null,
        saving: false
    };

    function cacheElements() {
        [
            "settingsClubName",
            "settingsRoleBadge",
            "settingsError",
            "settingsSuccess",
            "clubSettingsForm",
            "clubName",
            "clubShortName",
            "clubTimezone",
            "clubEmail",
            "clubPhone",
            "clubWebsite",
            "addressLine1",
            "addressLine2",
            "townCity",
            "countyRegion",
            "postcode",
            "countryCode",
            "currencyCode",
            "defaultCourse",
            "clubLogoPreview",
            "clubLogoPlaceholder",
            "clubLogoFile",
            "removeClubLogo",
            "primaryColor",
            "primaryColorText",
            "secondaryColor",
            "secondaryColorText",
            "accentColor",
            "accentColorText",
            "resetBranding",
            "saveClubSettings",
            "settingsSaveHint"
        ].forEach(function (id) {
            elements[id] =
                document.getElementById(id);
        });
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

    function readableError(error) {
        return (
            error?.message ||
            error?.details ||
            String(error || "Unknown error")
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

    function showError(error) {
        console.error(
            "Paryx club settings error:",
            error
        );

        if (!elements.settingsError) {
            return;
        }

        elements.settingsSuccess.hidden = true;
        elements.settingsError.hidden = false;
        elements.settingsError.textContent =
            readableError(error);
    }

    function clearMessages() {
        if (elements.settingsError) {
            elements.settingsError.hidden = true;
            elements.settingsError.textContent = "";
        }

        if (elements.settingsSuccess) {
            elements.settingsSuccess.hidden = true;
            elements.settingsSuccess.textContent = "";
        }
    }

    function showSuccess(text) {
        clearMessages();
        elements.settingsSuccess.textContent = text;
        elements.settingsSuccess.hidden = false;
    }

    function setSaving(value) {
        state.saving = value === true;

        if (elements.saveClubSettings) {
            elements.saveClubSettings.disabled =
                state.saving;

            elements.saveClubSettings.textContent =
                state.saving
                    ? "Saving…"
                    : "Save changes";
        }

        if (elements.clubLogoFile) {
            elements.clubLogoFile.disabled =
                state.saving;
        }

        if (elements.removeClubLogo) {
            elements.removeClubLogo.disabled =
                state.saving;
        }

        if (elements.resetBranding) {
            elements.resetBranding.disabled =
                state.saving;
        }
    }

    function normaliseHex(value) {
        const text =
            String(value || "")
                .trim()
                .toUpperCase();

        if (!/^#[0-9A-F]{6}$/.test(text)) {
            return null;
        }

        return text;
    }

    function bindColourPair(
        picker,
        textInput
    ) {
        picker.addEventListener(
            "input",
            function () {
                textInput.value =
                    picker.value.toUpperCase();
            }
        );

        textInput.addEventListener(
            "input",
            function () {
                const value =
                    normaliseHex(
                        textInput.value
                    );

                if (value) {
                    picker.value = value;
                }
            }
        );
    }

    function setLogoPreview(url) {
        if (!url) {
            elements.clubLogoPreview.hidden = true;
            elements.clubLogoPreview.removeAttribute("src");
            elements.clubLogoPlaceholder.hidden = false;
            return;
        }

        elements.clubLogoPreview.src = url;
        elements.clubLogoPreview.hidden = false;
        elements.clubLogoPlaceholder.hidden = true;
    }

    function clearPreviewObjectUrl() {
        if (state.previewUrl) {
            URL.revokeObjectURL(
                state.previewUrl
            );

            state.previewUrl = null;
        }
    }

    function currentPublicLogoUrl(path) {
        if (!path) {
            return null;
        }

        return window.Paryx
            .clubContext
            .publicLogoUrl(path);
    }

    function rowFromRpc(data) {
        return Array.isArray(data)
            ? data[0]
            : data;
    }

    async function loadConfiguration() {
        const client =
            getClient();

        const {
            data,
            error
        } = await client.rpc(
            "get_club_configuration",
            {
                p_club_id:
                    state.clubId
            }
        );

        if (error) {
            throw error;
        }

        const row =
            rowFromRpc(data);

        if (!row) {
            throw new Error(
                "Club configuration could not be loaded."
            );
        }

        return row;
    }

    async function loadCourses() {
        const client =
            getClient();

        const {
            data,
            error
        } = await client.rpc(
            "get_club_courses_for_settings",
            {
                p_club_id:
                    state.clubId
            }
        );

        if (error) {
            throw error;
        }

        return Array.isArray(data)
            ? data
            : [];
    }

    function renderCourses(
        courses,
        selectedId
    ) {
        elements.defaultCourse.innerHTML =
            '<option value="">No default course</option>' +
            courses
                .map(function (course) {
                    const suffix =
                        Number(course.holes) === 9
                            ? " · 9 holes"
                            : "";

                    return `
                        <option
                            value="${escapeHtml(course.course_id)}"
                            ${course.course_id === selectedId ? "selected" : ""}
                        >
                            ${escapeHtml(course.course_name)}${suffix}
                        </option>
                    `;
                })
                .join("");
    }

    function renderConfiguration(config) {
        state.config = config;
        state.currentLogoPath =
            config.logo_path || null;
        state.pendingLogoFile = null;
        state.removeLogo = false;

        elements.settingsClubName.textContent =
            config.club_name;

        elements.settingsRoleBadge.textContent =
            ROLE_LABELS[state.role] ||
            state.role;

        elements.clubName.value =
            config.club_name || "";

        elements.clubShortName.value =
            config.short_name || "";

        elements.clubTimezone.value =
            config.club_timezone ||
            "Europe/London";

        elements.clubEmail.value =
            config.contact_email || "";

        elements.clubPhone.value =
            config.phone || "";

        elements.clubWebsite.value =
            config.website_url || "";

        elements.addressLine1.value =
            config.address_line_1 || "";

        elements.addressLine2.value =
            config.address_line_2 || "";

        elements.townCity.value =
            config.town_city || "";

        elements.countyRegion.value =
            config.county_region || "";

        elements.postcode.value =
            config.postcode || "";

        elements.countryCode.value =
            config.country_code || "GB";

        elements.currencyCode.value =
            config.currency_code || "GBP";

        const primary =
            normaliseHex(config.primary_color) ||
            DEFAULT_BRANDING.primary;

        const secondary =
            normaliseHex(config.secondary_color) ||
            DEFAULT_BRANDING.secondary;

        const accent =
            normaliseHex(config.accent_color) ||
            DEFAULT_BRANDING.accent;

        elements.primaryColor.value =
            primary;
        elements.primaryColorText.value =
            primary;

        elements.secondaryColor.value =
            secondary;
        elements.secondaryColorText.value =
            secondary;

        elements.accentColor.value =
            accent;
        elements.accentColorText.value =
            accent;

        clearPreviewObjectUrl();
        setLogoPreview(
            currentPublicLogoUrl(
                state.currentLogoPath
            )
        );
    }

    function logoExtension(file) {
        const map = {
            "image/png": "png",
            "image/jpeg": "jpg",
            "image/webp": "webp"
        };

        return map[file.type] || null;
    }

    function validateLogo(file) {
        const extension =
            logoExtension(file);

        if (!extension) {
            throw new Error(
                "Club logo must be a PNG, JPG or WebP image."
            );
        }

        if (file.size > MAX_LOGO_BYTES) {
            throw new Error(
                "Club logo must be 2 MB or smaller."
            );
        }

        return extension;
    }

    async function uploadPendingLogo() {
        if (!state.pendingLogoFile) {
            return state.removeLogo
                ? null
                : state.currentLogoPath;
        }

        const file =
            state.pendingLogoFile;

        const extension =
            validateLogo(file);

        const path =
            `${state.clubId}/logo-${Date.now()}.${extension}`;

        const client =
            getClient();

        const {
            error
        } = await client.storage
            .from(BRANDING_BUCKET)
            .upload(
                path,
                file,
                {
                    cacheControl: "3600",
                    upsert: false,
                    contentType: file.type
                }
            );

        if (error) {
            throw error;
        }

        return path;
    }

    async function removeOldLogo(
        oldPath,
        newPath
    ) {
        if (
            !oldPath ||
            oldPath === newPath
        ) {
            return;
        }

        try {
            await getClient()
                .storage
                .from(BRANDING_BUCKET)
                .remove([oldPath]);
        } catch (error) {
            console.warn(
                "Paryx saved the new configuration but could not remove the previous logo:",
                error
            );
        }
    }

    function formPayload(logoPath) {
        const primary =
            normaliseHex(
                elements.primaryColorText.value
            );

        const secondary =
            normaliseHex(
                elements.secondaryColorText.value
            );

        const accent =
            normaliseHex(
                elements.accentColorText.value
            );

        if (!primary || !secondary || !accent) {
            throw new Error(
                "Brand colours must use six-digit values such as #064831."
            );
        }

        const clubName =
            elements.clubName.value.trim();

        if (!clubName) {
            throw new Error(
                "Club name is required."
            );
        }

        return {
            p_club_id:
                state.clubId,
            p_club_name:
                clubName,
            p_short_name:
                elements.clubShortName.value.trim() || null,
            p_timezone:
                elements.clubTimezone.value,
            p_website_url:
                elements.clubWebsite.value.trim() || null,
            p_contact_email:
                elements.clubEmail.value.trim() || null,
            p_phone:
                elements.clubPhone.value.trim() || null,
            p_address_line_1:
                elements.addressLine1.value.trim() || null,
            p_address_line_2:
                elements.addressLine2.value.trim() || null,
            p_town_city:
                elements.townCity.value.trim() || null,
            p_county_region:
                elements.countyRegion.value.trim() || null,
            p_postcode:
                elements.postcode.value.trim() || null,
            p_country_code:
                elements.countryCode.value.trim().toUpperCase(),
            p_currency_code:
                elements.currencyCode.value.trim().toUpperCase(),
            p_default_course_id:
                elements.defaultCourse.value || null,
            p_logo_path:
                logoPath,
            p_primary_color:
                primary,
            p_secondary_color:
                secondary,
            p_accent_color:
                accent
        };
    }

    async function saveSettings(event) {
        event.preventDefault();

        if (state.saving) {
            return;
        }

        clearMessages();
        setSaving(true);

        const oldLogoPath =
            state.currentLogoPath;

        let uploadedLogoPath = null;

        try {
            const logoPath =
                await uploadPendingLogo();

            uploadedLogoPath =
                state.pendingLogoFile
                    ? logoPath
                    : null;

            const payload =
                formPayload(logoPath);

            const {
                data,
                error
            } = await getClient().rpc(
                "admin_update_club_configuration",
                payload
            );

            if (error) {
                throw error;
            }

            const updated =
                rowFromRpc(data);

            await removeOldLogo(
                oldLogoPath,
                updated?.logo_path || null
            );

            renderConfiguration(updated);

            const courses =
                await loadCourses();

            renderCourses(
                courses,
                updated.default_course_id || null
            );

            await window.Paryx
                .clubContext
                .refresh();

            showSuccess(
                "Club configuration saved. Paryx has applied the updated club identity."
            );

            elements.settingsSaveHint.textContent =
                "Saved for this club.";
        } catch (error) {
            if (uploadedLogoPath) {
                try {
                    await getClient()
                        .storage
                        .from(BRANDING_BUCKET)
                        .remove([
                            uploadedLogoPath
                        ]);
                } catch (cleanupError) {
                    console.warn(
                        "Paryx could not clean up the unsuccessful logo upload:",
                        cleanupError
                    );
                }
            }

            showError(error);
        } finally {
            setSaving(false);
        }
    }

    function bindEvents() {
        bindColourPair(
            elements.primaryColor,
            elements.primaryColorText
        );

        bindColourPair(
            elements.secondaryColor,
            elements.secondaryColorText
        );

        bindColourPair(
            elements.accentColor,
            elements.accentColorText
        );

        elements.resetBranding.addEventListener(
            "click",
            function () {
                elements.primaryColor.value =
                    DEFAULT_BRANDING.primary;
                elements.primaryColorText.value =
                    DEFAULT_BRANDING.primary;

                elements.secondaryColor.value =
                    DEFAULT_BRANDING.secondary;
                elements.secondaryColorText.value =
                    DEFAULT_BRANDING.secondary;

                elements.accentColor.value =
                    DEFAULT_BRANDING.accent;
                elements.accentColorText.value =
                    DEFAULT_BRANDING.accent;
            }
        );

        elements.clubLogoFile.addEventListener(
            "change",
            function () {
                clearMessages();

                const file =
                    elements.clubLogoFile.files?.[0] ||
                    null;

                if (!file) {
                    return;
                }

                try {
                    validateLogo(file);
                } catch (error) {
                    elements.clubLogoFile.value = "";
                    showError(error);
                    return;
                }

                clearPreviewObjectUrl();

                state.pendingLogoFile = file;
                state.removeLogo = false;
                state.previewUrl =
                    URL.createObjectURL(file);

                setLogoPreview(
                    state.previewUrl
                );
            }
        );

        elements.removeClubLogo.addEventListener(
            "click",
            function () {
                clearPreviewObjectUrl();
                state.pendingLogoFile = null;
                state.removeLogo = true;
                elements.clubLogoFile.value = "";
                setLogoPreview(null);
            }
        );

        elements.clubSettingsForm.addEventListener(
            "submit",
            saveSettings
        );
    }

    async function initialise() {
        cacheElements();
        bindEvents();
        setSaving(false);

        try {
            await window.Paryx.ready;

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
                    "Club management access required."
                );
            }

            state.clubId =
                activeClub.id;
            state.role =
                activeClub.role;

            const [
                config,
                courses
            ] = await Promise.all([
                loadConfiguration(),
                loadCourses()
            ]);

            renderConfiguration(config);
            renderCourses(
                courses,
                config.default_course_id || null
            );
        } catch (error) {
            showError(error);
            elements.clubSettingsForm.hidden = true;
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
