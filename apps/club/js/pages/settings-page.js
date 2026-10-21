(function () {
    "use strict";

    window.Paryx = window.Paryx || {};

    const BRANDING_FUNCTION =
        "admin-upload-club-logo";

    const MAX_LOGO_BYTES =
        2 * 1024 * 1024;

    const DEFAULT_BRANDING = {
        primary: "#064831",
        secondary: "#022D1D",
        accent: "#E5C45F"
    };

    const SETTINGS_ROLES = new Set([
        "greenkeeper",
        "manager",
        "club_admin"
    ]);

    const ROLE_LABELS = {
        greenkeeper: "Greenkeeper",
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
            "publicBookingEnabled",
            "publicBookingAdvanceDays",
            "publicBookingUrl",
            "publicBookingEmbed",
            "copyPublicBookingEmbed",
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

    async function edgeFunctionErrorMessage(
        error,
        fallback
    ) {
        let message =
            error?.message ||
            fallback;

        try {
            const response =
                error?.context;

            if (
                response &&
                typeof response.clone === "function"
            ) {
                const clone =
                    response.clone();

                const contentType =
                    clone.headers
                        ?.get("content-type") ||
                    "";

                if (
                    contentType.includes(
                        "application/json"
                    )
                ) {
                    const body =
                        await clone.json();

                    message =
                        body?.error ||
                        body?.message ||
                        message;
                } else {
                    const text =
                        await clone.text();

                    if (text.trim()) {
                        message =
                            text.trim();
                    }
                }
            }
        } catch {
            // Keep the original Functions error.
        }

        if (
            message ===
            "Failed to send a request to the Edge Function"
        ) {
            return (
                "The club-logo upload function could not be reached. " +
                "Deploy the admin-upload-club-logo Edge Function, then retry."
            );
        }

        return message;
    }

    async function invokeBrandingFunction(
        body
    ) {
        const client =
            getClient();

        if (
            !client.functions ||
            typeof client.functions.invoke !==
                "function"
        ) {
            throw new Error(
                "The Paryx upload service is unavailable."
            );
        }

        const {
            data: sessionData,
            error: sessionError
        } = await client.auth.getSession();

        const accessToken =
            sessionData?.session
                ?.access_token ||
            "";

        if (
            sessionError ||
            !accessToken
        ) {
            throw (
                sessionError ||
                new Error(
                    "Your ClubHub session is not ready. Sign in again and retry."
                )
            );
        }

        const {
            data,
            error
        } = await client.functions.invoke(
            BRANDING_FUNCTION,
            {
                headers: {
                    Authorization:
                        `Bearer ${accessToken}`
                },
                body
            }
        );

        if (error) {
            throw new Error(
                await edgeFunctionErrorMessage(
                    error,
                    "Club logo upload failed."
                )
            );
        }

        if (data?.error) {
            throw new Error(
                data.error
            );
        }

        return data || {};
    }

    function fileToBase64(file) {
        return new Promise(function (
            resolve,
            reject
        ) {
            const reader =
                new FileReader();

            reader.addEventListener(
                "load",
                function () {
                    const result =
                        String(
                            reader.result ||
                            ""
                        );

                    const commaIndex =
                        result.indexOf(",");

                    if (
                        commaIndex < 0 ||
                        !result
                            .slice(
                                commaIndex + 1
                            )
                            .trim()
                    ) {
                        reject(
                            new Error(
                                "The selected logo could not be read."
                            )
                        );
                        return;
                    }

                    resolve(
                        result.slice(
                            commaIndex + 1
                        )
                    );
                },
                { once: true }
            );

            reader.addEventListener(
                "error",
                function () {
                    reject(
                        reader.error ||
                        new Error(
                            "The selected logo could not be read."
                        )
                    );
                },
                { once: true }
            );

            reader.readAsDataURL(file);
        });
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

        if (elements.publicBookingEnabled) {
            elements.publicBookingEnabled.disabled =
                state.saving;
        }

        if (elements.publicBookingAdvanceDays) {
            elements.publicBookingAdvanceDays.disabled =
                state.saving ||
                !elements.publicBookingEnabled?.checked;
        }

        if (elements.copyPublicBookingEmbed) {
            elements.copyPublicBookingEmbed.disabled =
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

    async function loadPublicBookingWidget() {
        const { data, error } = await getClient().rpc(
            "admin_get_public_booking_widget",
            { p_club_id: state.clubId }
        );

        if (error) {
            throw error;
        }

        return rowFromRpc(data);
    }

    function widgetUrls(slug) {
        const safeSlug = String(slug || "").trim();
        if (!safeSlug) {
            return { url: "", embed: "" };
        }

        const widgetUrl = new URL(
            "../../widget/index.html",
            window.location.href
        );
        widgetUrl.searchParams.set("club", safeSlug);

        const embedScriptUrl = new URL(
            "../../widget/embed.js",
            window.location.href
        );

        return {
            url: widgetUrl.href,
            embed: `<script src="${embedScriptUrl.href}" data-paryx-club="${safeSlug}"></script>`
        };
    }

    function renderPublicBookingWidget(config) {
        const enabled = config?.public_booking_enabled === true;
        const days = Math.max(
            1,
            Math.min(
                14,
                Number(config?.public_booking_advance_days || 14)
            )
        );
        const urls = widgetUrls(config?.club_slug);

        elements.publicBookingEnabled.checked = enabled;
        elements.publicBookingAdvanceDays.value = String(days);
        elements.publicBookingAdvanceDays.disabled = !enabled;
        elements.publicBookingUrl.value = urls.url;
        elements.publicBookingEmbed.value = urls.embed;
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

        if (elements.clubLogoFile) {
            elements.clubLogoFile.value = "";
        }

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

        validateLogo(file);

        elements.settingsSaveHint.textContent =
            "Uploading club logo…";

        const base64 =
            await fileToBase64(file);

        const result =
            await invokeBrandingFunction({
                action: "upload",
                clubId: state.clubId,
                fileName:
                    file.name ||
                    "club-logo",
                mimeType:
                    file.type,
                base64
            });

        const path =
            String(
                result?.path ||
                ""
            ).trim();

        if (!path) {
            throw new Error(
                "The logo upload completed without returning a storage path."
            );
        }

        return path;
    }

    async function removeLogoPath(path) {
        const safePath =
            String(path || "")
                .trim();

        if (!safePath) {
            return;
        }

        await invokeBrandingFunction({
            action: "delete",
            clubId: state.clubId,
            path: safePath
        });
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
            await removeLogoPath(
                oldPath
            );
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
        let configurationSaved = false;

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

            configurationSaved = true;

            const updated =
                rowFromRpc(data);

            await removeOldLogo(
                oldLogoPath,
                updated?.logo_path || null
            );

            renderConfiguration(updated);

            let widgetWarning = null;

            try {
                const widgetDays = Number(
                    elements.publicBookingAdvanceDays.value || 14
                );

                const {
                    data: widgetData,
                    error: widgetError
                } = await getClient().rpc(
                    "admin_update_public_booking_widget",
                    {
                        p_club_id: state.clubId,
                        p_enabled: elements.publicBookingEnabled.checked,
                        p_advance_days: widgetDays
                    }
                );

                if (widgetError) {
                    throw widgetError;
                }

                renderPublicBookingWidget(
                    rowFromRpc(widgetData)
                );
            } catch (error) {
                widgetWarning = error;
                console.warn(
                    "Paryx saved the club configuration but could not save website booking settings:",
                    error
                );
            }

            const courses =
                await loadCourses();

            renderCourses(
                courses,
                updated.default_course_id || null
            );

            await window.Paryx
                .clubContext
                .refresh();

            if (widgetWarning) {
                showSuccess(
                    "Club details and branding were saved, including the logo. Website booking settings were not updated."
                );

                elements.settingsSaveHint.textContent =
                    "Branding saved; website booking settings need retrying.";
            } else {
                showSuccess(
                    "Club configuration saved. Paryx has applied the updated club identity."
                );

                elements.settingsSaveHint.textContent =
                    "Saved for this club.";
            }
        } catch (error) {
            if (uploadedLogoPath && !configurationSaved) {
                try {
                    await removeLogoPath(
                        uploadedLogoPath
                    );
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

    const HOTEL_FIELDS = {
        hotel_booking_days: "hotelBookingDays",
        society_booking_days: "societyBookingDays",
        member_booking_days: "hotelMemberDays",
        visitor_booking_days: "hotelVisitorDays",
        hotel_allocation_percent: "hotelAllocationPercent",
        member_allocation_percent: "hotelMemberPercent",
        hotel_release_days: "hotelReleaseDays",
        member_release_days: "hotelMemberReleaseDays"
    };

    const HOTEL_ROLE_NAMES = {
        starter: "Starter", reception: "Reception", professional: "Professional",
        greenkeeper: "Greenkeeper", manager: "Manager", club_admin: "Club Admin"
    };
    const HOTEL_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const hotelUI = {courses: [], enabled: false, busy: false};

    function hotelEsc(value) {
        return String(value ?? "").replace(/[&<>"']/g, function (char) {
            return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char];
        });
    }

    function hotelSelect(field, options, current) {
        return `<select data-hotel-field="${field}">${options.map(function (option) {
            return `<option value="${hotelEsc(option.value)}" ${String(option.value) === String(current) ? "selected" : ""}>${hotelEsc(option.label)}</option>`;
        }).join("")}</select>`;
    }

    function hotelRuleHtml(rule) {
        const special = !!rule.specific_date;
        const courses = [{value:"",label:"All courses"}].concat(hotelUI.courses.map(function (c) {
            return {value:c.id,label:c.name};
        }));
        return `<tr data-hotel-rule>
            <td>${hotelSelect("scope",[{value:"weekday",label:"Weekly"},{value:"date",label:"Specific date"}],special?"date":"weekday")}</td>
            <td><span data-weekday-wrap ${special?"hidden":""}>${hotelSelect("weekday",HOTEL_DAYS.map((label,value)=>({label,value})),rule.weekday??1)}</span>
                <span data-date-wrap ${special?"":"hidden"}><input type="date" data-hotel-field="specific_date" value="${hotelEsc(rule.specific_date||"")}" ${special?"required":"disabled"}></span></td>
            <td>${hotelSelect("course_id",courses,rule.course_id||"")}</td>
            <td><input type="time" data-hotel-field="start_time" value="${hotelEsc(rule.start_time||"09:00")}" required></td>
            <td><input type="time" data-hotel-field="end_time" value="${hotelEsc(rule.end_time||"11:00")}" required></td>
            <td>${hotelSelect("allocation",[{value:"hotel",label:"Hotel priority"},{value:"member",label:"Member priority"},{value:"general",label:"General"}],rule.allocation||"hotel")}</td>
            <td><button type="button" class="settings-secondary-button" data-remove-hotel-rule aria-label="Remove allocation">Remove</button></td>
        </tr>`;
    }

    function hotelRuleScope(row) {
        const special = row.querySelector('[data-hotel-field="scope"]').value === "date";
        row.querySelector("[data-weekday-wrap]").hidden = special;
        row.querySelector("[data-date-wrap]").hidden = !special;
        const date = row.querySelector('[data-hotel-field="specific_date"]');
        date.disabled = !special || hotelUI.busy;
        date.required = special;
        row.querySelector('[data-hotel-field="weekday"]').disabled = special || hotelUI.busy;
    }

    function hotelAddRule(rule) {
        const table = document.getElementById("hotelTimeRules");
        table.insertAdjacentHTML("beforeend",hotelRuleHtml(rule||{}));
        hotelRuleScope(table.lastElementChild);
    }

    function hotelRefreshMode() {
        const active = document.getElementById("hotelAllocationMode").value === "time_bands";
        const panel = document.getElementById("hotelTimeRulesPanel");
        panel.hidden = !active;
        panel.querySelectorAll("input, select, button").forEach(function (control) {
            control.disabled = !active || hotelUI.busy;
        });
        if (active) panel.querySelectorAll("[data-hotel-rule]").forEach(hotelRuleScope);
    }

    function hotelCollectRules() {
        const rules = [];
        document.querySelectorAll("#hotelTimeRules [data-hotel-rule]").forEach(function (row,i) {
            const get = (name) => row.querySelector(`[data-hotel-field="${name}"]`).value;
            const isDate = get("scope") === "date";
            const start = get("start_time"), end = get("end_time"), date = get("specific_date");
            if (!start || !end || start >= end) throw new Error(`Allocation ${i+1}: end time must be after start time.`);
            if (isDate && !date) throw new Error(`Allocation ${i+1}: choose a date.`);
            rules.push({course_id:get("course_id")||null,weekday:isDate?null:Number(get("weekday")),
                specific_date:isDate?date:null,start_time:start,end_time:end,allocation:get("allocation")});
        });
        if (rules.length > 200) throw new Error("A club can have at most 200 allocation rules.");
        for (let i=0;i<rules.length;i++) for (let j=i+1;j<rules.length;j++) {
            const a=rules[i], b=rules[j];
            if (a.course_id===b.course_id && a.weekday===b.weekday && a.specific_date===b.specific_date &&
                a.start_time<b.end_time && b.start_time<a.end_time) {
                throw new Error(`Allocations ${i+1} and ${j+1} overlap on the same course and date/day.`);
            }
        }
        return rules;
    }

    function hotelCollectPolicy() {
        const config={allocation_mode:document.getElementById("hotelAllocationMode").value,
            allocation_rules:hotelCollectRules()};
        Object.entries(HOTEL_FIELDS).forEach(function ([key,id]) {
            const input=document.getElementById(id);
            if (!input.checkValidity() || !input.value.trim()) throw new Error(`Invalid value for ${key.replaceAll("_"," ")}.`);
            config[key]=Number(input.value);
        });
        if (config.hotel_allocation_percent+config.member_allocation_percent>100) {
            throw new Error("Hotel and member allocations cannot exceed 100% combined.");
        }
        if (config.hotel_release_days>=config.hotel_booking_days ||
            config.member_release_days>=config.member_booking_days) {
            throw new Error("Release deadlines must be shorter than booking windows.");
        }
        return config;
    }

    function hotelCollectPermissions() {
        const data={};
        document.querySelectorAll("#hotelRolePermissions [data-hotel-role]").forEach(function (row) {
            const flags={};
            row.querySelectorAll("[data-hotel-permission]").forEach(function (input) {
                flags[input.dataset.hotelPermission]=input.checked;
            });
            if (flags.can_override && !(flags.can_manage_hotel||flags.can_manage_societies)) {
                throw new Error(`Override permission requires Hotel or Society access for ${row.dataset.hotelRole}.`);
            }
            data[row.dataset.hotelRole]=flags;
        });
        return data;
    }

    function hotelSetBusy(busy) {
        hotelUI.busy=busy;
        document.querySelectorAll("#hotelModeSection button, #hotelPolicyForm input, #hotelPolicyForm select, #hotelRolePermissions input")
            .forEach(function (element) {element.disabled=busy || !hotelUI.enabled ||
                (element.closest("#hotelPermissionsSection") && state.role!=="club_admin");});
        hotelRefreshMode();
    }

    async function loadHotelSettings() {
        const {data,error}=await getClient().rpc("club_hotel_mode_get",{p_club_id:state.clubId});
        if (error) throw error;
        const section=document.getElementById("hotelModeSection");
        section.hidden=false;
        const config=data?.config||{};
        hotelUI.enabled=config.enabled===true;
        hotelUI.courses=Array.isArray(data?.courses)?data.courses:[];
        const status=document.getElementById("hotelModeStatus");
        status.textContent=hotelUI.enabled?
            "Hotel Mode is enabled by Paryx Console. Booking rules are managed by your club.":
            "Hotel Mode is disabled in Paryx Console. ClubHub cannot activate it.";
        document.getElementById("hotelPolicyForm").hidden=!hotelUI.enabled;
        document.getElementById("hotelPermissionsSection").hidden=!hotelUI.enabled;
        Object.entries(HOTEL_FIELDS).forEach(function ([key,id]) {
            document.getElementById(id).value=String(config[key]??"");
        });
        document.getElementById("hotelAllocationMode").value=config.allocation_mode||"percentage";
        document.getElementById("hotelTimeRules").innerHTML="";
        (config.allocation_rules||[]).forEach(hotelAddRule);
        document.getElementById("hotelRolePermissions").innerHTML=Object.entries(HOTEL_ROLE_NAMES).map(function ([role,label]) {
            const entry=data?.permissions?.[role]||{};
            const flag=(key)=>entry[key]===true?"checked":"";
            return `<tr data-hotel-role="${role}"><th>${hotelEsc(label)}</th>
                <td><input type="checkbox" data-hotel-permission="can_manage_hotel" ${flag("can_manage_hotel")} aria-label="${hotelEsc(label)}: hotel bookings"></td>
                <td><input type="checkbox" data-hotel-permission="can_manage_societies" ${flag("can_manage_societies")} aria-label="${hotelEsc(label)}: society bookings"></td>
                <td><input type="checkbox" data-hotel-permission="can_override" ${flag("can_override")} aria-label="${hotelEsc(label)}: overrides"></td></tr>`;
        }).join("");
        document.getElementById("hotelSavePermissions").hidden=state.role!=="club_admin";
        hotelSetBusy(false);
    }

    async function hotelSavePolicy(event) {
        event.preventDefault();
        if (!hotelUI.enabled || hotelUI.busy) return;
        try {
            const config=hotelCollectPolicy();
            hotelSetBusy(true);
            const {error}=await getClient().rpc("club_hotel_mode_save_policy",{p_club_id:state.clubId,p_config:config});
            if (error) throw error;
            showSuccess("Hotel booking allocations saved for this club.");
            await loadHotelSettings();
        } catch (error) {showError(error);} finally {hotelSetBusy(false);}
    }

    async function hotelSavePermissions() {
        if (state.role!=="club_admin" || !hotelUI.enabled || hotelUI.busy) return;
        try {
            const permissions=hotelCollectPermissions();
            hotelSetBusy(true);
            const {error}=await getClient().rpc("club_hotel_mode_save_permissions",{p_club_id:state.clubId,p_permissions:permissions});
            if (error) throw error;
            showSuccess("Hotel Mode staff permissions saved.");
            await loadHotelSettings();
        } catch (error) {showError(error);} finally {hotelSetBusy(false);}
    }

    function bindHotelEvents() {
        document.getElementById("hotelAllocationMode").addEventListener("change",hotelRefreshMode);
        document.getElementById("hotelAddTimeRule").addEventListener("click",function () {hotelAddRule();});
        document.getElementById("hotelTimeRules").addEventListener("click",function (event) {
            const remove=event.target.closest("[data-remove-hotel-rule]");
            if (remove && !hotelUI.busy) remove.closest("[data-hotel-rule]").remove();
        });
        document.getElementById("hotelTimeRules").addEventListener("change",function (event) {
            if (event.target.matches('[data-hotel-field="scope"]')) hotelRuleScope(event.target.closest("[data-hotel-rule]"));
        });
        document.getElementById("hotelPolicyForm").addEventListener("submit",hotelSavePolicy);
        document.getElementById("hotelSavePermissions").addEventListener("click",hotelSavePermissions);
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

                elements.settingsSaveHint.textContent =
                    "New logo selected — choose Save changes to upload it.";
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
                elements.settingsSaveHint.textContent =
                    "Logo will be removed when you choose Save changes.";
            }
        );

        elements.publicBookingEnabled.addEventListener(
            "change",
            function () {
                elements.publicBookingAdvanceDays.disabled =
                    !elements.publicBookingEnabled.checked;
            }
        );

        elements.copyPublicBookingEmbed.addEventListener(
            "click",
            async function () {
                const value = elements.publicBookingEmbed.value.trim();
                if (!value) {
                    return;
                }

                try {
                    await navigator.clipboard.writeText(value);
                    showSuccess("Website booking embed code copied.");
                } catch (error) {
                    elements.publicBookingEmbed.focus();
                    elements.publicBookingEmbed.select();
                    showError(new Error("Copy was blocked by the browser. The embed code is selected so you can copy it manually."));
                }
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
        bindHotelEvents();
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
                !SETTINGS_ROLES.has(
                    String(activeClub.role || "")
                        .trim()
                        .toLowerCase()
                )
            ) {
                throw new Error(
                    "Club management access required."
                );
            }

            state.clubId =
                activeClub.id;
            state.role =
                String(activeClub.role).trim().toLowerCase();

            const [
                config,
                courses,
                publicBookingWidget
            ] = await Promise.all([
                loadConfiguration(),
                loadCourses(),
                loadPublicBookingWidget()
            ]);

            renderConfiguration(config);
            renderCourses(
                courses,
                config.default_course_id || null
            );
            renderPublicBookingWidget(publicBookingWidget);
            if (state.role === "manager" || state.role === "club_admin") {
                try {
                    await loadHotelSettings();
                } catch (hotelError) {
                    console.warn("Paryx Hotel Mode settings unavailable:",hotelError);
                    document.getElementById("hotelModeSection").hidden = false;
                    document.getElementById("hotelModeStatus").textContent =
                        "Hotel Mode settings could not load: " + readableError(hotelError);
                    document.getElementById("hotelPolicyForm").hidden = true;
                    document.getElementById("hotelPermissionsSection").hidden = true;
                }
            }
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
