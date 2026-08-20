(function () {
    "use strict";

    window.Paryx = window.Paryx || {};

    const ADMIN_ROLES = new Set([
        "manager",
        "club_admin"
    ]);

    const ROLE_LABELS = {
        manager: "Manager",
        club_admin: "Club Admin"
    };

    const state = {
        clubId: null,
        role: null,
        courses: [],
        selectedCourseId: null,
        config: null,
        editingTeeId: null,
        creatingCourse: false,
        scorecardImageDataUrl: null,
        scorecardExtraction: null
    };

    const elements = {
        clubName: document.getElementById("coursesClubName"),
        roleBadge: document.getElementById("coursesRoleBadge"),
        error: document.getElementById("coursesError"),
        success: document.getElementById("coursesSuccess"),
        addCourseButton: document.getElementById("addCourseButton"),
        courseList: document.getElementById("courseList"),
        emptyState: document.getElementById("courseEmptyState"),
        editor: document.getElementById("courseEditor"),
        editorTitle: document.getElementById("courseEditorTitle"),
        defaultBadge: document.getElementById("courseDefaultBadge"),
        courseForm: document.getElementById("courseForm"),
        courseName: document.getElementById("courseName"),
        courseHoles: document.getElementById("courseHoles"),
        courseActive: document.getElementById("courseActive"),
        saveCourseButton: document.getElementById("saveCourseButton"),
        holeDataSection: document.getElementById("holeDataSection"),
        holeTableBody: document.getElementById("holeTableBody"),
        holeParSummary: document.getElementById("holeParSummary"),
        copyMenToWomenButton: document.getElementById("copyMenToWomenButton"),
        saveHolesButton: document.getElementById("saveHolesButton"),
        teesSection: document.getElementById("teesSection"),
        addTeeButton: document.getElementById("addTeeButton"),
        teeList: document.getElementById("teeList"),
        teeEditorEmpty: document.getElementById("teeEditorEmpty"),
        teeEditor: document.getElementById("teeEditor"),
        teeForm: document.getElementById("teeForm"),
        teeName: document.getElementById("teeName"),
        teeColour: document.getElementById("teeColour"),
        teeDisplayOrder: document.getElementById("teeDisplayOrder"),
        teeActive: document.getElementById("teeActive"),
        teeMenPar: document.getElementById("teeMenPar"),
        teeMenCourseRating: document.getElementById("teeMenCourseRating"),
        teeMenSlope: document.getElementById("teeMenSlope"),
        teeWomenPar: document.getElementById("teeWomenPar"),
        teeWomenCourseRating: document.getElementById("teeWomenCourseRating"),
        teeWomenSlope: document.getElementById("teeWomenSlope"),
        saveTeeButton: document.getElementById("saveTeeButton"),
        yardageSection: document.getElementById("yardageSection"),
        teeYardageSummary: document.getElementById("teeYardageSummary"),
        teeYardageGrid: document.getElementById("teeYardageGrid"),
        saveYardagesButton: document.getElementById("saveYardagesButton"),
        scorecardImportButton: document.getElementById("scorecardImportButton"),
        scorecardImportDialog: document.getElementById("scorecardImportDialog"),
        scorecardImportClose: document.getElementById("scorecardImportClose"),
        scorecardImportError: document.getElementById("scorecardImportError"),
        scorecardUploadStep: document.getElementById("scorecardUploadStep"),
        scorecardReviewStep: document.getElementById("scorecardReviewStep"),
        scorecardImageInput: document.getElementById("scorecardImageInput"),
        scorecardPreviewWrap: document.getElementById("scorecardPreviewWrap"),
        scorecardPreview: document.getElementById("scorecardPreview"),
        scanScorecardButton: document.getElementById("scanScorecardButton"),
        rescanScorecardButton: document.getElementById("rescanScorecardButton"),
        scorecardReviewTitle: document.getElementById("scorecardReviewTitle"),
        scorecardReviewMeta: document.getElementById("scorecardReviewMeta"),
        scorecardWarnings: document.getElementById("scorecardWarnings"),
        scorecardHoleReview: document.getElementById("scorecardHoleReview"),
        scorecardTeeReview: document.getElementById("scorecardTeeReview"),
        applyScorecardButton: document.getElementById("applyScorecardButton")
    };

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

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function clearMessages() {
        if (elements.error) {
            elements.error.hidden = true;
            elements.error.textContent = "";
        }

        if (elements.success) {
            elements.success.hidden = true;
            elements.success.textContent = "";
        }
    }

    function showError(error) {
        console.error(
            "Paryx Courses error:",
            error
        );

        if (!elements.error) {
            return;
        }

        elements.error.hidden = false;
        elements.error.textContent =
            error?.message ||
            "Course data could not be updated.";
    }

    function showSuccess(message) {
        if (!elements.success) {
            return;
        }

        elements.success.hidden = false;
        elements.success.textContent = message;
    }

    function numberOrNull(value) {
        const text = String(value ?? "").trim();

        if (!text) {
            return null;
        }

        const number = Number(text);

        return Number.isFinite(number)
            ? number
            : null;
    }

    function courseById(courseId) {
        return state.courses.find(
            function (course) {
                return course.course_id === courseId;
            }
        ) || null;
    }

    function renderCourseList() {
        if (!elements.courseList) {
            return;
        }

        if (!state.courses.length) {
            elements.courseList.innerHTML = `
                <div class="courses-empty">
                    No courses configured yet.
                </div>
            `;
            return;
        }

        elements.courseList.innerHTML =
            state.courses
                .map(function (course) {
                    const active =
                        course.course_id ===
                        state.selectedCourseId;

                    const statusBadge =
                        course.is_active
                            ? ""
                            : `
                                <span class="course-list__badge course-list__badge--inactive">
                                    Inactive
                                </span>
                            `;

                    const defaultBadge =
                        course.is_default
                            ? `
                                <span class="course-list__badge course-list__badge--default">
                                    Default
                                </span>
                            `
                            : "";

                    const yardage =
                        course.total_yards
                            ? `${Number(course.total_yards).toLocaleString("en-GB")} yds`
                            : "Yardage incomplete";

                    return `
                        <button
                            class="course-list__item${active ? " is-active" : ""}"
                            type="button"
                            data-course-id="${escapeHtml(course.course_id)}"
                        >
                            <strong>${escapeHtml(course.course_name)}</strong>

                            <span class="course-list__meta">
                                <span>${Number(course.holes)} holes</span>
                                <span>${Number(course.tee_count || 0)} active tees</span>
                                <span>${escapeHtml(yardage)}</span>
                            </span>

                            <span class="course-list__meta">
                                ${defaultBadge}
                                ${statusBadge}
                            </span>
                        </button>
                    `;
                })
                .join("");
    }

    async function loadCourses() {
        const client = getClient();

        const {
            data,
            error
        } = await client.rpc(
            "admin_get_courses",
            {
                p_club_id:
                    state.clubId
            }
        );

        if (error) {
            throw error;
        }

        state.courses =
            Array.isArray(data)
                ? data
                : [];

        renderCourseList();
    }

    function normaliseConfiguration(data) {
        if (!data) {
            return null;
        }

        if (
            Array.isArray(data) &&
            data.length === 1
        ) {
            return data[0];
        }

        return data;
    }

    async function loadCourseConfiguration(courseId) {
        const client = getClient();

        const {
            data,
            error
        } = await client.rpc(
            "admin_get_course_configuration",
            {
                p_club_id:
                    state.clubId,
                p_course_id:
                    courseId
            }
        );

        if (error) {
            throw error;
        }

        const config =
            normaliseConfiguration(data);

        if (!config?.course?.id) {
            throw new Error(
                "The selected course could not be loaded."
            );
        }

        return config;
    }

    function showEditor() {
        elements.emptyState.hidden = true;
        elements.editor.hidden = false;
    }

    function showEmptyState() {
        elements.emptyState.hidden = false;
        elements.editor.hidden = true;
    }

    function renderNewCourse() {
        state.creatingCourse = true;
        state.selectedCourseId = null;
        state.config = null;
        state.editingTeeId = null;

        renderCourseList();
        showEditor();

        elements.editorTitle.textContent =
            "New course";

        elements.defaultBadge.hidden = true;
        elements.courseName.value = "";
        elements.courseHoles.value = "18";
        elements.courseActive.checked = true;

        elements.holeDataSection.hidden = true;
        elements.teesSection.hidden = true;

        elements.courseName.focus();
    }

    function renderHoleRows() {
        const holes =
            Array.isArray(state.config?.holes)
                ? state.config.holes
                : [];

        elements.holeTableBody.innerHTML =
            holes
                .map(function (hole) {
                    const maxSi =
                        Number(
                            state.config?.course?.holes ||
                            18
                        );

                    return `
                        <tr data-hole-number="${Number(hole.hole_number)}">
                            <td>${Number(hole.hole_number)}</td>
                            <td>
                                <input
                                    type="number"
                                    min="2"
                                    max="7"
                                    step="1"
                                    value="${hole.men_par ?? ""}"
                                    data-men-par
                                    aria-label="Hole ${Number(hole.hole_number)} men's par"
                                >
                            </td>
                            <td>
                                <input
                                    type="number"
                                    min="1"
                                    max="${maxSi}"
                                    step="1"
                                    value="${hole.men_stroke_index ?? ""}"
                                    data-men-si
                                    aria-label="Hole ${Number(hole.hole_number)} men's stroke index"
                                >
                            </td>
                            <td>
                                <input
                                    type="number"
                                    min="2"
                                    max="7"
                                    step="1"
                                    value="${hole.women_par ?? ""}"
                                    data-women-par
                                    aria-label="Hole ${Number(hole.hole_number)} women's par"
                                >
                            </td>
                            <td>
                                <input
                                    type="number"
                                    min="1"
                                    max="${maxSi}"
                                    step="1"
                                    value="${hole.women_stroke_index ?? ""}"
                                    data-women-si
                                    aria-label="Hole ${Number(hole.hole_number)} women's stroke index"
                                >
                            </td>
                        </tr>
                    `;
                })
                .join("");

        elements.holeTableBody
            .querySelectorAll("input")
            .forEach(function (input) {
                input.addEventListener(
                    "input",
                    updateHoleParSummary
                );
            });

        updateHoleParSummary();
    }

    function holeRowsPayload() {
        return Array.from(
            elements.holeTableBody
                .querySelectorAll(
                    "tr[data-hole-number]"
                )
        ).map(function (row) {
            return {
                hole_number:
                    Number(
                        row.dataset.holeNumber
                    ),
                hole_name:
                    null,
                men_par:
                    numberOrNull(
                        row.querySelector(
                            "[data-men-par]"
                        )?.value
                    ),
                men_stroke_index:
                    numberOrNull(
                        row.querySelector(
                            "[data-men-si]"
                        )?.value
                    ),
                women_par:
                    numberOrNull(
                        row.querySelector(
                            "[data-women-par]"
                        )?.value
                    ),
                women_stroke_index:
                    numberOrNull(
                        row.querySelector(
                            "[data-women-si]"
                        )?.value
                    )
            };
        });
    }

    function completedParTotal(values) {
        if (
            !values.length ||
            values.some(
                function (value) {
                    return value === null;
                }
            )
        ) {
            return null;
        }

        return values.reduce(
            function (sum, value) {
                return sum + value;
            },
            0
        );
    }

    function updateHoleParSummary() {
        const rows = holeRowsPayload();

        const menTotal = completedParTotal(
            rows.map(function (row) {
                return row.men_par;
            })
        );

        const womenTotal = completedParTotal(
            rows.map(function (row) {
                return row.women_par;
            })
        );

        const parts = [];

        parts.push(
            menTotal === null
                ? "Men par incomplete"
                : `Men par ${menTotal}`
        );

        parts.push(
            womenTotal === null
                ? "Women par incomplete"
                : `Women par ${womenTotal}`
        );

        elements.holeParSummary.textContent =
            parts.join(" · ");
    }

    function renderTeeList() {
        const tees =
            Array.isArray(state.config?.tees)
                ? state.config.tees
                : [];

        if (!tees.length) {
            elements.teeList.innerHTML = `
                <div class="courses-empty">
                    No tees configured yet.
                </div>
            `;
            return;
        }

        elements.teeList.innerHTML =
            tees
                .map(function (tee) {
                    const active =
                        tee.id ===
                        state.editingTeeId;

                    const status =
                        tee.is_active
                            ? ""
                            : `
                                <span class="tee-list__badge tee-list__badge--inactive">
                                    Inactive
                                </span>
                            `;

                    const ratings = [];

                    if (tee.ratings?.men) {
                        ratings.push(
                            `Men ${tee.ratings.men.course_rating}/${tee.ratings.men.slope_rating}`
                        );
                    }

                    if (tee.ratings?.women) {
                        ratings.push(
                            `Women ${tee.ratings.women.course_rating}/${tee.ratings.women.slope_rating}`
                        );
                    }

                    return `
                        <button
                            class="tee-list__item${active ? " is-active" : ""}"
                            type="button"
                            data-tee-id="${escapeHtml(tee.id)}"
                        >
                            <strong>${escapeHtml(tee.name)}</strong>

                            <span class="tee-list__meta">
                                <span>${tee.total_yards ? `${Number(tee.total_yards).toLocaleString("en-GB")} yds` : "Yardage incomplete"}</span>
                                ${status}
                            </span>

                            <span class="tee-list__meta">
                                ${escapeHtml(ratings.join(" · ") || "No WHS rating")}
                            </span>
                        </button>
                    `;
                })
                .join("");
    }

    function derivedHolePar(gender) {
        const holes =
            Array.isArray(state.config?.holes)
                ? state.config.holes
                : [];

        const key =
            gender === "women"
                ? "women_par"
                : "men_par";

        return completedParTotal(
            holes.map(function (hole) {
                return hole[key] ?? null;
            })
        );
    }

    function findTee(teeId) {
        return (
            state.config?.tees || []
        ).find(function (tee) {
            return tee.id === teeId;
        }) || null;
    }

    function renderYardageGrid(tee) {
        const holeCount =
            Number(
                state.config?.course?.holes ||
                18
            );

        const byHole = new Map(
            (tee?.distances || [])
                .map(function (item) {
                    return [
                        Number(item.hole_number),
                        item.yards
                    ];
                })
        );

        elements.teeYardageGrid.innerHTML =
            Array.from(
                { length: holeCount },
                function (_, index) {
                    const holeNumber =
                        index + 1;

                    const yards =
                        byHole.get(holeNumber);

                    return `
                        <label class="tee-yardage-item">
                            <span>Hole ${holeNumber}</span>
                            <input
                                class="tee-yardage-input"
                                type="number"
                                min="20"
                                max="900"
                                step="1"
                                value="${yards ?? ""}"
                                data-yardage-hole="${holeNumber}"
                                aria-label="Hole ${holeNumber} yardage"
                            >
                        </label>
                    `;
                }
            ).join("");

        elements.teeYardageGrid
            .querySelectorAll(
                "[data-yardage-hole]"
            )
            .forEach(function (input) {
                input.addEventListener(
                    "input",
                    updateYardageSummary
                );
            });

        updateYardageSummary();
    }

    function yardagePayload() {
        return Array.from(
            elements.teeYardageGrid
                .querySelectorAll(
                    "[data-yardage-hole]"
                )
        ).map(function (input) {
            return {
                hole_number:
                    Number(
                        input.dataset.yardageHole
                    ),
                yards:
                    numberOrNull(
                        input.value
                    )
            };
        });
    }

    function updateYardageSummary() {
        const rows = yardagePayload();
        const completed = rows.filter(
            function (row) {
                return row.yards !== null;
            }
        );

        const total = completed.reduce(
            function (sum, row) {
                return sum + (row.yards || 0);
            },
            0
        );

        if (!completed.length) {
            elements.teeYardageSummary.textContent =
                "No hole yardages entered yet.";
            return;
        }

        const complete =
            completed.length === rows.length;

        elements.teeYardageSummary.textContent =
            `${total.toLocaleString("en-GB")} yards` +
            (complete
                ? " total"
                : ` · ${completed.length}/${rows.length} holes entered`);
    }

    function renderTeeEditor(tee) {
        const isNew = !tee?.id;

        state.editingTeeId =
            tee?.id || null;

        elements.teeEditorEmpty.hidden = true;
        elements.teeEditor.hidden = false;

        elements.teeName.value =
            tee?.name || "";

        elements.teeColour.value =
            tee?.colour || "";

        elements.teeDisplayOrder.value =
            tee?.display_order ??
            (state.config?.tees?.length || 0);

        elements.teeActive.checked =
            tee?.is_active !== false;

        const men =
            tee?.ratings?.men || null;

        const women =
            tee?.ratings?.women || null;

        elements.teeMenPar.value =
            men?.par ??
            (isNew
                ? derivedHolePar("men") ?? ""
                : "");

        elements.teeMenCourseRating.value =
            men?.course_rating ?? "";

        elements.teeMenSlope.value =
            men?.slope_rating ?? "";

        elements.teeWomenPar.value =
            women?.par ??
            (isNew
                ? derivedHolePar("women") ?? ""
                : "");

        elements.teeWomenCourseRating.value =
            women?.course_rating ?? "";

        elements.teeWomenSlope.value =
            women?.slope_rating ?? "";

        elements.yardageSection.hidden =
            isNew;

        elements.saveYardagesButton.disabled =
            isNew;

        renderYardageGrid(tee || null);
        renderTeeList();

        elements.teeName.focus();
    }

    function renderCourseConfiguration() {
        if (!state.config?.course) {
            showEmptyState();
            return;
        }

        state.creatingCourse = false;
        showEditor();

        const course =
            state.config.course;

        elements.editorTitle.textContent =
            course.name;

        elements.defaultBadge.hidden =
            !course.is_default;

        elements.courseName.value =
            course.name || "";

        elements.courseHoles.value =
            String(course.holes || 18);

        elements.courseActive.checked =
            course.is_active === true;

        elements.holeDataSection.hidden = false;
        elements.teesSection.hidden = false;

        renderHoleRows();
        renderTeeList();

        const tees =
            Array.isArray(state.config.tees)
                ? state.config.tees
                : [];

        const selectedTee =
            findTee(state.editingTeeId) ||
            tees[0] ||
            null;

        if (selectedTee) {
            renderTeeEditor(selectedTee);
        } else {
            state.editingTeeId = null;
            elements.teeEditor.hidden = true;
            elements.teeEditorEmpty.hidden = false;
        }

        renderCourseList();
    }

    async function selectCourse(courseId) {
        clearMessages();

        state.selectedCourseId =
            courseId;

        state.creatingCourse = false;
        state.editingTeeId = null;

        renderCourseList();

        state.config =
            await loadCourseConfiguration(
                courseId
            );

        renderCourseConfiguration();
    }

    async function saveCourse(event) {
        event.preventDefault();
        clearMessages();

        elements.saveCourseButton.disabled = true;
        elements.saveCourseButton.textContent =
            "Saving…";

        try {
            const client = getClient();

            const {
                data,
                error
            } = await client.rpc(
                "admin_save_course",
                {
                    p_club_id:
                        state.clubId,
                    p_course_id:
                        state.creatingCourse
                            ? null
                            : state.selectedCourseId,
                    p_name:
                        elements.courseName.value.trim(),
                    p_holes:
                        Number(
                            elements.courseHoles.value
                        ),
                    p_is_active:
                        elements.courseActive.checked
                }
            );

            if (error) {
                throw error;
            }

            const courseId =
                Array.isArray(data)
                    ? data[0]
                    : data;

            if (!courseId) {
                throw new Error(
                    "Paryx did not return the saved course."
                );
            }

            state.selectedCourseId =
                courseId;

            state.creatingCourse = false;

            await loadCourses();

            state.config =
                await loadCourseConfiguration(
                    courseId
                );

            renderCourseConfiguration();
            showSuccess("Course saved.");
        } catch (error) {
            showError(error);
        } finally {
            elements.saveCourseButton.disabled = false;
            elements.saveCourseButton.textContent =
                "Save course";
        }
    }

    async function saveHoleData() {
        clearMessages();

        elements.saveHolesButton.disabled = true;
        elements.saveHolesButton.textContent =
            "Saving…";

        try {
            const client = getClient();
            const payload = holeRowsPayload();

            const {
                error
            } = await client.rpc(
                "admin_save_course_holes",
                {
                    p_club_id:
                        state.clubId,
                    p_course_id:
                        state.selectedCourseId,
                    p_holes:
                        payload
                }
            );

            if (error) {
                throw error;
            }

            state.config =
                await loadCourseConfiguration(
                    state.selectedCourseId
                );

            renderCourseConfiguration();
            showSuccess("Hole data saved.");
        } catch (error) {
            showError(error);
        } finally {
            elements.saveHolesButton.disabled = false;
            elements.saveHolesButton.textContent =
                "Save hole data";
        }
    }

    function ratingPayload(prefix) {
        const isMen =
            prefix === "men";

        const par = numberOrNull(
            isMen
                ? elements.teeMenPar.value
                : elements.teeWomenPar.value
        );

        const rating = numberOrNull(
            isMen
                ? elements.teeMenCourseRating.value
                : elements.teeWomenCourseRating.value
        );

        const slope = numberOrNull(
            isMen
                ? elements.teeMenSlope.value
                : elements.teeWomenSlope.value
        );

        const supplied =
            [par, rating, slope]
                .filter(function (value) {
                    return value !== null;
                })
                .length;

        if (supplied !== 0 && supplied !== 3) {
            throw new Error(
                `${isMen ? "Men's" : "Women's"} rating needs Par, Course Rating and Slope.`
            );
        }

        return {
            par,
            rating,
            slope
        };
    }

    async function saveTee(event) {
        event.preventDefault();
        clearMessages();

        elements.saveTeeButton.disabled = true;
        elements.saveTeeButton.textContent =
            "Saving…";

        try {
            const men = ratingPayload("men");
            const women = ratingPayload("women");

            const client = getClient();

            const {
                data,
                error
            } = await client.rpc(
                "admin_save_tee",
                {
                    p_club_id:
                        state.clubId,
                    p_course_id:
                        state.selectedCourseId,
                    p_tee_id:
                        state.editingTeeId,
                    p_name:
                        elements.teeName.value.trim(),
                    p_colour:
                        elements.teeColour.value.trim() || null,
                    p_display_order:
                        numberOrNull(
                            elements.teeDisplayOrder.value
                        ) ?? 0,
                    p_is_active:
                        elements.teeActive.checked,
                    p_men_par:
                        men.par,
                    p_men_course_rating:
                        men.rating,
                    p_men_slope:
                        men.slope,
                    p_women_par:
                        women.par,
                    p_women_course_rating:
                        women.rating,
                    p_women_slope:
                        women.slope
                }
            );

            if (error) {
                throw error;
            }

            const teeId =
                Array.isArray(data)
                    ? data[0]
                    : data;

            state.editingTeeId = teeId;

            state.config =
                await loadCourseConfiguration(
                    state.selectedCourseId
                );

            await loadCourses();
            renderCourseConfiguration();
            showSuccess("Tee and WHS ratings saved.");
        } catch (error) {
            showError(error);
        } finally {
            elements.saveTeeButton.disabled = false;
            elements.saveTeeButton.textContent =
                "Save tee & ratings";
        }
    }

    async function saveYardages() {
        clearMessages();

        if (!state.editingTeeId) {
            showError(
                new Error(
                    "Save the tee before entering yardages."
                )
            );
            return;
        }

        elements.saveYardagesButton.disabled = true;
        elements.saveYardagesButton.textContent =
            "Saving…";

        try {
            const client = getClient();

            const {
                error
            } = await client.rpc(
                "admin_save_tee_distances",
                {
                    p_club_id:
                        state.clubId,
                    p_course_id:
                        state.selectedCourseId,
                    p_tee_id:
                        state.editingTeeId,
                    p_distances:
                        yardagePayload()
                }
            );

            if (error) {
                throw error;
            }

            state.config =
                await loadCourseConfiguration(
                    state.selectedCourseId
                );

            await loadCourses();
            renderCourseConfiguration();
            showSuccess("Tee yardages saved.");
        } catch (error) {
            showError(error);
        } finally {
            elements.saveYardagesButton.disabled = false;
            elements.saveYardagesButton.textContent =
                "Save yardages";
        }
    }

    function copyMenToWomen() {
        elements.holeTableBody
            .querySelectorAll(
                "tr[data-hole-number]"
            )
            .forEach(function (row) {
                const menPar =
                    row.querySelector(
                        "[data-men-par]"
                    );

                const menSi =
                    row.querySelector(
                        "[data-men-si]"
                    );

                const womenPar =
                    row.querySelector(
                        "[data-women-par]"
                    );

                const womenSi =
                    row.querySelector(
                        "[data-women-si]"
                    );

                womenPar.value =
                    menPar.value;

                womenSi.value =
                    menSi.value;
            });

        updateHoleParSummary();
    }


    function scorecardNumber(value) {
    if (
        value === null ||
        value === undefined ||
        (
            typeof value === "string" &&
            value.trim() === ""
        )
    ) {
        return null;
    }

    const number =
        Number(value);

    return Number.isFinite(number)
        ? number
        : null;
}

    function normaliseTeeKey(value) {
        return String(value || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "");
    }

    function resetScorecardImporter() {
        state.scorecardImageDataUrl = null;
        state.scorecardExtraction = null;

        elements.scorecardImportError.hidden = true;
        elements.scorecardImportError.textContent = "";

        elements.scorecardImageInput.value = "";
        elements.scorecardPreview.removeAttribute("src");
        elements.scorecardPreviewWrap.hidden = true;

        elements.scanScorecardButton.disabled = true;
        elements.scanScorecardButton.textContent =
            "Scan scorecard";

        elements.scorecardUploadStep.hidden = false;
        elements.scorecardReviewStep.hidden = true;

        elements.scorecardHoleReview.innerHTML = "";
        elements.scorecardTeeReview.innerHTML = "";
        elements.scorecardWarnings.innerHTML = "";
        elements.scorecardWarnings.hidden = true;
    }

    function openScorecardImporter() {
        clearMessages();

        if (!state.selectedCourseId) {
            showError(
                new Error(
                    "Save the course before importing a scorecard."
                )
            );
            return;
        }

        resetScorecardImporter();

        if (
            typeof elements.scorecardImportDialog
                .showModal === "function"
        ) {
            elements.scorecardImportDialog.showModal();
        } else {
            elements.scorecardImportDialog.setAttribute(
                "open",
                ""
            );
        }
    }

    function closeScorecardImporter() {
        if (
            typeof elements.scorecardImportDialog
                .close === "function"
        ) {
            elements.scorecardImportDialog.close();
        } else {
            elements.scorecardImportDialog.removeAttribute(
                "open"
            );
        }

        resetScorecardImporter();
    }

    function readImageElement(url) {
        return new Promise(function (resolve, reject) {
            const image = new Image();

            image.onload = function () {
                resolve(image);
            };

            image.onerror = function () {
                reject(
                    new Error(
                        "Paryx could not read this image. Use a JPEG, PNG or WebP scorecard image."
                    )
                );
            };

            image.src = url;
        });
    }

    async function prepareScorecardImage(file) {
        if (!file) {
            throw new Error(
                "Choose a scorecard image first."
            );
        }

        const allowedTypes =
            new Set([
                "image/jpeg",
                "image/png",
                "image/webp"
            ]);

        if (
            file.type &&
            !allowedTypes.has(file.type)
        ) {
            throw new Error(
                "Use a JPEG, PNG or WebP scorecard image."
            );
        }

        const objectUrl =
            URL.createObjectURL(file);

        try {
            const image =
                await readImageElement(
                    objectUrl
                );

            const maxDimension = 1800;

            const scale =
                Math.min(
                    1,
                    maxDimension /
                        Math.max(
                            image.naturalWidth,
                            image.naturalHeight
                        )
                );

            const width =
                Math.max(
                    1,
                    Math.round(
                        image.naturalWidth *
                        scale
                    )
                );

            const height =
                Math.max(
                    1,
                    Math.round(
                        image.naturalHeight *
                        scale
                    )
                );

            const canvas =
                document.createElement(
                    "canvas"
                );

            canvas.width = width;
            canvas.height = height;

            const context =
                canvas.getContext("2d", {
                    alpha: false
                });

            if (!context) {
                throw new Error(
                    "Image preparation is not supported by this browser."
                );
            }

            context.fillStyle = "#ffffff";
            context.fillRect(
                0,
                0,
                width,
                height
            );

            context.drawImage(
                image,
                0,
                0,
                width,
                height
            );

            return canvas.toDataURL(
                "image/jpeg",
                0.86
            );
        } finally {
            URL.revokeObjectURL(
                objectUrl
            );
        }
    }

    async function handleScorecardImageChange() {
        elements.scorecardImportError.hidden = true;

        const file =
            elements.scorecardImageInput
                .files?.[0] ||
            null;

        if (!file) {
            state.scorecardImageDataUrl = null;
            elements.scorecardPreviewWrap.hidden = true;
            elements.scanScorecardButton.disabled = true;
            return;
        }

        elements.scanScorecardButton.disabled = true;
        elements.scanScorecardButton.textContent =
            "Preparing image…";

        try {
            state.scorecardImageDataUrl =
                await prepareScorecardImage(
                    file
                );

            elements.scorecardPreview.src =
                state.scorecardImageDataUrl;

            elements.scorecardPreviewWrap.hidden =
                false;

            elements.scanScorecardButton.disabled =
                false;
        } catch (error) {
            state.scorecardImageDataUrl = null;

            elements.scorecardImportError.hidden =
                false;

            elements.scorecardImportError.textContent =
                error?.message ||
                "The image could not be prepared.";
        } finally {
            elements.scanScorecardButton.textContent =
                "Scan scorecard";
        }
    }

    function renderScorecardExtraction(extraction) {
        const holeCount =
            Number(
                state.config?.course?.holes ||
                extraction?.holes_count ||
                18
            );

        const holeMap =
            new Map(
                (extraction?.holes || [])
                    .map(function (hole) {
                        return [
                            Number(hole.hole_number),
                            hole
                        ];
                    })
            );

        elements.scorecardHoleReview.innerHTML =
            Array.from(
                { length: holeCount },
                function (_, index) {
                    const number =
                        index + 1;

                    const hole =
                        holeMap.get(number) ||
                        {};

                    function display(value) {
                        return value === null ||
                            value === undefined
                            ? "—"
                            : escapeHtml(value);
                    }

                    return `
                        <tr>
                            <td>${number}</td>
                            <td>${display(hole.men_par)}</td>
                            <td>${display(hole.men_stroke_index)}</td>
                            <td>${display(hole.women_par)}</td>
                            <td>${display(hole.women_stroke_index)}</td>
                        </tr>
                    `;
                }
            ).join("");

        const tees =
            Array.isArray(extraction?.tees)
                ? extraction.tees
                : [];

        if (!tees.length) {
            elements.scorecardTeeReview.innerHTML = `
                <div class="courses-empty">
                    No tee rows were confidently recognised.
                </div>
            `;
        } else {
            elements.scorecardTeeReview.innerHTML =
                tees.map(function (tee, index) {
                    const yards =
                        (tee.yardages || [])
                            .map(function (item) {
                                return scorecardNumber(
                                    item.yards
                                );
                            })
                            .filter(function (value) {
                                return value !== null;
                            });

                    const total =
                        yards.reduce(
                            function (sum, value) {
                                return sum + value;
                            },
                            0
                        );

                    const ratingParts = [];

                    if (
                        tee.men_course_rating !== null &&
                        tee.men_course_rating !== undefined &&
                        tee.men_slope !== null &&
                        tee.men_slope !== undefined
                    ) {
                        ratingParts.push(
                            `Men ${tee.men_course_rating}/${tee.men_slope}`
                        );
                    }

                    if (
                        tee.women_course_rating !== null &&
                        tee.women_course_rating !== undefined &&
                        tee.women_slope !== null &&
                        tee.women_slope !== undefined
                    ) {
                        ratingParts.push(
                            `Women ${tee.women_course_rating}/${tee.women_slope}`
                        );
                    }

                    return `
                        <label class="scorecard-tee-card">
                            <input
                                type="checkbox"
                                data-scorecard-tee-index="${index}"
                                checked
                            >

                            <span>
                                <strong>${escapeHtml(tee.name || tee.colour || `Tee ${index + 1}`)}</strong>

                                <span>
                                    ${
                                        total
                                            ? `${total.toLocaleString("en-GB")} yds`
                                            : "Yardage incomplete"
                                    }
                                    ${
                                        ratingParts.length
                                            ? ` · ${escapeHtml(ratingParts.join(" · "))}`
                                            : ""
                                    }
                                </span>
                            </span>
                        </label>
                    `;
                }).join("");
        }

        const warnings =
            Array.isArray(extraction?.warnings)
                ? extraction.warnings
                    .filter(Boolean)
                : [];

        if (warnings.length) {
            elements.scorecardWarnings.hidden = false;

            elements.scorecardWarnings.innerHTML = `
                <strong>Check these items</strong>
                <ul>
                    ${warnings.map(function (warning) {
                        return `<li>${escapeHtml(warning)}</li>`;
                    }).join("")}
                </ul>
            `;
        } else {
            elements.scorecardWarnings.hidden = true;
            elements.scorecardWarnings.innerHTML = "";
        }

        elements.scorecardReviewTitle.textContent =
            extraction?.course_name
                ? `Scorecard recognised: ${extraction.course_name}`
                : "Scorecard extracted";

        elements.scorecardReviewMeta.textContent =
            `${(extraction?.holes || []).length} hole rows · ${tees.length} tee rows`;

        elements.scorecardUploadStep.hidden = true;
        elements.scorecardReviewStep.hidden = false;
    }

    async function scanScorecardImage() {
        if (!state.scorecardImageDataUrl) {
            return;
        }

        elements.scorecardImportError.hidden = true;
        elements.scanScorecardButton.disabled = true;
        elements.scanScorecardButton.textContent =
            "Scanning…";

        try {
            const client = getClient();

            if (
                !client.functions ||
                typeof client.functions.invoke !==
                    "function"
            ) {
                throw new Error(
                    "Scorecard scanning is not available in this Paryx build."
                );
            }

            const {
                data,
                error
            } =
                await client.functions.invoke(
                    "scan-course-scorecard",
                    {
                        body: {
                            clubId:
                                state.clubId,
                            courseId:
                                state.selectedCourseId,
                            courseName:
                                state.config?.course?.name ||
                                null,
                            holeCount:
                                Number(
                                    state.config?.course?.holes ||
                                    18
                                ),
                            imageDataUrl:
                                state.scorecardImageDataUrl
                        }
                    }
                );

            if (error) {
    let errorMessage =
        error?.message ||
        "Scorecard scanning failed.";

    try {
        if (
            error?.context &&
            typeof error.context.json ===
                "function"
        ) {
            const errorBody =
                await error.context.json();

            errorMessage =
                errorBody?.error ||
                errorBody?.message ||
                errorMessage;
        }
    } catch (parseError) {
        console.warn(
            "Could not read Edge Function error response:",
            parseError
        );
    }

    throw new Error(
        errorMessage
    );
}

            if (!data?.extraction) {
                throw new Error(
                    data?.error ||
                    "Paryx could not extract scorecard data from this image."
                );
            }

            state.scorecardExtraction =
                data.extraction;

            renderScorecardExtraction(
                state.scorecardExtraction
            );
        } catch (error) {
            console.error(
                "Scorecard scan failed:",
                error
            );

            elements.scorecardImportError.hidden =
                false;

            elements.scorecardImportError.textContent =
                error?.message ||
                "Scorecard scanning failed. Check the image and try again.";
        } finally {
            elements.scanScorecardButton.disabled = false;
            elements.scanScorecardButton.textContent =
                "Scan scorecard";
        }
    }

    function mergeImportedHoleData(extraction) {
        const current =
            Array.isArray(state.config?.holes)
                ? state.config.holes
                : [];

        const importedMap =
            new Map(
                (extraction?.holes || [])
                    .map(function (hole) {
                        return [
                            Number(hole.hole_number),
                            hole
                        ];
                    })
            );

        return current.map(function (hole) {
            const imported =
                importedMap.get(
                    Number(hole.hole_number)
                ) ||
                {};

            function importedOrCurrent(
                importedValue,
                currentValue
            ) {
                const parsed =
                    scorecardNumber(
                        importedValue
                    );

                return parsed === null
                    ? currentValue ?? null
                    : parsed;
            }

            return {
                hole_number:
                    Number(
                        hole.hole_number
                    ),

                hole_name:
                    hole.hole_name ||
                    null,

                men_par:
                    importedOrCurrent(
                        imported.men_par,
                        hole.men_par
                    ),

                men_stroke_index:
                    importedOrCurrent(
                        imported.men_stroke_index,
                        hole.men_stroke_index
                    ),

                women_par:
                    importedOrCurrent(
                        imported.women_par,
                        hole.women_par
                    ),

                women_stroke_index:
                    importedOrCurrent(
                        imported.women_stroke_index,
                        hole.women_stroke_index
                    )
            };
        });
    }

    function teeMatchForImport(importedTee) {
        const importedName =
            normaliseTeeKey(
                importedTee?.name
            );

        const importedColour =
            normaliseTeeKey(
                importedTee?.colour
            );

        return (
            state.config?.tees ||
            []
        ).find(function (tee) {
            const teeName =
                normaliseTeeKey(
                    tee.name
                );

            const teeColour =
                normaliseTeeKey(
                    tee.colour
                );

            return (
                importedName &&
                importedName === teeName
            ) || (
                importedColour &&
                (
                    importedColour === teeColour ||
                    importedColour === teeName
                )
            );
        }) || null;
    }

    function completeRating(
        importedTee,
        gender,
        existingTee,
        mergedHoles
    ) {
        const prefix =
            gender === "women"
                ? "women"
                : "men";

        const existing =
            existingTee?.ratings?.[prefix] ||
            null;

        const importedPar =
            scorecardNumber(
                importedTee?.[
                    `${prefix}_par`
                ]
            );

        const importedRating =
            scorecardNumber(
                importedTee?.[
                    `${prefix}_course_rating`
                ]
            );

        const importedSlope =
            scorecardNumber(
                importedTee?.[
                    `${prefix}_slope`
                ]
            );

        const derivedPar =
            completedParTotal(
                mergedHoles.map(function (hole) {
                    return hole[
                        `${prefix}_par`
                    ] ?? null;
                })
            );

        const par =
            importedPar ??
            scorecardNumber(
                existing?.par
            ) ??
            derivedPar;

        const rating =
            importedRating ??
            scorecardNumber(
                existing?.course_rating
            );

        const slope =
            importedSlope ??
            scorecardNumber(
                existing?.slope_rating
            );

        if (
            par !== null &&
            rating !== null &&
            slope !== null
        ) {
            return {
                par,
                rating,
                slope
            };
        }

        return {
            par: null,
            rating: null,
            slope: null
        };
    }

    function distancePayloadForImport(
        importedTee,
        existingTee
    ) {
        const holeCount =
            Number(
                state.config?.course?.holes ||
                18
            );

        const importedMap =
            new Map(
                (importedTee?.yardages || [])
                    .map(function (item) {
                        return [
                            Number(item.hole_number),
                            scorecardNumber(
                                item.yards
                            )
                        ];
                    })
            );

        const existingMap =
            new Map(
                (existingTee?.distances || [])
                    .map(function (item) {
                        return [
                            Number(item.hole_number),
                            scorecardNumber(
                                item.yards
                            )
                        ];
                    })
            );

        return Array.from(
            { length: holeCount },
            function (_, index) {
                const holeNumber =
                    index + 1;

                const imported =
                    importedMap.has(
                        holeNumber
                    )
                        ? importedMap.get(
                            holeNumber
                        )
                        : null;

                return {
                    hole_number:
                        holeNumber,

                    yards:
                        imported ??
                        existingMap.get(
                            holeNumber
                        ) ??
                        null
                };
            }
        );
    }

    async function applyScorecardExtraction() {
        const extraction =
            state.scorecardExtraction;

        if (!extraction) {
            return;
        }

        elements.scorecardImportError.hidden = true;
        elements.applyScorecardButton.disabled = true;
        elements.applyScorecardButton.textContent =
            "Applying…";

        try {
            const client = getClient();

            const mergedHoles =
                mergeImportedHoleData(
                    extraction
                );

            const {
                error: holeError
            } =
                await client.rpc(
                    "admin_save_course_holes",
                    {
                        p_club_id:
                            state.clubId,
                        p_course_id:
                            state.selectedCourseId,
                        p_holes:
                            mergedHoles
                    }
                );

            if (holeError) {
                throw holeError;
            }

            const selectedIndexes =
                new Set(
                    Array.from(
                        elements.scorecardTeeReview
                            .querySelectorAll(
                                "[data-scorecard-tee-index]:checked"
                            )
                    ).map(function (input) {
                        return Number(
                            input.dataset.scorecardTeeIndex
                        );
                    })
                );

            const tees =
                Array.isArray(
                    extraction.tees
                )
                    ? extraction.tees
                    : [];

            for (
                let index = 0;
                index < tees.length;
                index += 1
            ) {
                if (
                    !selectedIndexes.has(
                        index
                    )
                ) {
                    continue;
                }

                const importedTee =
                    tees[index];

                const existingTee =
                    teeMatchForImport(
                        importedTee
                    );

                const men =
                    completeRating(
                        importedTee,
                        "men",
                        existingTee,
                        mergedHoles
                    );

                const women =
                    completeRating(
                        importedTee,
                        "women",
                        existingTee,
                        mergedHoles
                    );

                const teeName =
                    String(
                        importedTee.name ||
                        importedTee.colour ||
                        existingTee?.name ||
                        `Tee ${index + 1}`
                    ).trim();

                const {
                    data: teeData,
                    error: teeError
                } =
                    await client.rpc(
                        "admin_save_tee",
                        {
                            p_club_id:
                                state.clubId,
                            p_course_id:
                                state.selectedCourseId,
                            p_tee_id:
                                existingTee?.id ||
                                null,
                            p_name:
                                teeName,
                            p_colour:
                                String(
                                    importedTee.colour ||
                                    existingTee?.colour ||
                                    ""
                                ).trim() ||
                                null,
                            p_display_order:
                                existingTee?.display_order ??
                                index,
                            p_is_active:
                                existingTee?.is_active !==
                                false,
                            p_men_par:
                                men.par,
                            p_men_course_rating:
                                men.rating,
                            p_men_slope:
                                men.slope,
                            p_women_par:
                                women.par,
                            p_women_course_rating:
                                women.rating,
                            p_women_slope:
                                women.slope
                        }
                    );

                if (teeError) {
                    throw teeError;
                }

                const teeId =
                    Array.isArray(teeData)
                        ? teeData[0]
                        : teeData;

                if (!teeId) {
                    throw new Error(
                        `Paryx could not save the ${teeName} tee.`
                    );
                }

                const distances =
                    distancePayloadForImport(
                        importedTee,
                        existingTee
                    );

                const {
                    error: distanceError
                } =
                    await client.rpc(
                        "admin_save_tee_distances",
                        {
                            p_club_id:
                                state.clubId,
                            p_course_id:
                                state.selectedCourseId,
                            p_tee_id:
                                teeId,
                            p_distances:
                                distances
                        }
                    );

                if (distanceError) {
                    throw distanceError;
                }
            }

            state.editingTeeId = null;

            state.config =
                await loadCourseConfiguration(
                    state.selectedCourseId
                );

            await loadCourses();
            renderCourseConfiguration();

            closeScorecardImporter();

            showSuccess(
                "Scorecard data imported. Review the course and tee values before using them for play."
            );
        } catch (error) {
            console.error(
                "Scorecard import failed:",
                error
            );

            elements.scorecardImportError.hidden =
                false;

            elements.scorecardImportError.textContent =
                error?.message ||
                "Scorecard data could not be applied.";
        } finally {
            elements.applyScorecardButton.disabled = false;
            elements.applyScorecardButton.textContent =
                "Apply to course";
        }
    }

    function bindEvents() {
        elements.addCourseButton.addEventListener(
            "click",
            function () {
                clearMessages();
                renderNewCourse();
            }
        );

        elements.courseList.addEventListener(
            "click",
            function (event) {
                const button =
                    event.target.closest(
                        "[data-course-id]"
                    );

                if (!button) {
                    return;
                }

                selectCourse(
                    button.dataset.courseId
                ).catch(showError);
            }
        );

        elements.courseForm.addEventListener(
            "submit",
            saveCourse
        );

        elements.saveHolesButton.addEventListener(
            "click",
            saveHoleData
        );

        elements.copyMenToWomenButton.addEventListener(
            "click",
            copyMenToWomen
        );

        elements.addTeeButton.addEventListener(
            "click",
            function () {
                clearMessages();
                renderTeeEditor(null);
            }
        );

        elements.teeList.addEventListener(
            "click",
            function (event) {
                const button =
                    event.target.closest(
                        "[data-tee-id]"
                    );

                if (!button) {
                    return;
                }

                const tee = findTee(
                    button.dataset.teeId
                );

                if (tee) {
                    clearMessages();
                    renderTeeEditor(tee);
                }
            }
        );

        elements.teeForm.addEventListener(
            "submit",
            saveTee
        );

        elements.saveYardagesButton.addEventListener(
            "click",
            saveYardages
        );

        elements.scorecardImportButton.addEventListener(
            "click",
            openScorecardImporter
        );

        elements.scorecardImportClose.addEventListener(
            "click",
            closeScorecardImporter
        );

        elements.scorecardImageInput.addEventListener(
            "change",
            handleScorecardImageChange
        );

        elements.scanScorecardButton.addEventListener(
            "click",
            scanScorecardImage
        );

        elements.rescanScorecardButton.addEventListener(
            "click",
            resetScorecardImporter
        );

        elements.applyScorecardButton.addEventListener(
            "click",
            applyScorecardExtraction
        );

        elements.scorecardImportDialog.addEventListener(
            "click",
            function (event) {
                if (
                    event.target ===
                    elements.scorecardImportDialog
                ) {
                    closeScorecardImporter();
                }
            }
        );
    }

    async function initialise() {
        try {
            clearMessages();

            const appContext =
                await window.Paryx.ready;

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
                    "Staff club access required."
                );
            }

            const role =
                String(
                    activeClub.role || ""
                )
                    .trim()
                    .toLowerCase();

            if (!ADMIN_ROLES.has(role)) {
                throw new Error(
                    "Club management access required."
                );
            }

            state.clubId =
                activeClub.id;

            state.role = role;

            elements.clubName.textContent =
                activeClub.name ||
                "Your club";

            elements.roleBadge.textContent =
                ROLE_LABELS[role] ||
                "Admin";

            bindEvents();
            await loadCourses();

            const defaultCourse =
                state.courses.find(
                    function (course) {
                        return course.is_default;
                    }
                );

            const firstCourse =
                defaultCourse ||
                state.courses[0] ||
                null;

            if (firstCourse) {
                await selectCourse(
                    firstCourse.course_id
                );
            } else {
                renderNewCourse();
            }
        } catch (error) {
            showError(error);

            if (elements.roleBadge) {
                elements.roleBadge.textContent =
                    "Unavailable";
            }
        }
    }

    initialise();
})();
