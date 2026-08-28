(function () {
    "use strict";

    const P =
        window.ParyxMember;

    const elements = {
        form:
            document.getElementById(
                "accountDetailsForm"
            ),

        firstName:
            document.getElementById(
                "accountFirstName"
            ),

        lastName:
            document.getElementById(
                "accountLastName"
            ),

        displayName:
            document.getElementById(
                "accountDisplayName"
            ),

        phone:
            document.getElementById(
                "accountPhone"
            ),

        email:
            document.getElementById(
                "accountEmail"
            ),

        emailStatus:
            document.getElementById(
                "accountEmailStatus"
            ),

        save:
            document.getElementById(
                "accountSaveButton"
            ),

        error:
            document.getElementById(
                "accountDetailsError"
            ),

        success:
            document.getElementById(
                "accountDetailsSuccess"
            )
    };

    let context =
        null;

    function clean(value) {
        const text =
            String(
                value ||
                ""
            ).trim();

        return text ||
            null;
    }

    function showError(error) {
        elements.error.hidden =
            false;

        elements.error.textContent =
            P.readableError(
                error
            );
    }

    function clearError() {
        elements.error.hidden =
            true;

        elements.error.textContent =
            "";
    }

    function showSuccess(message) {
        elements.success.hidden =
            false;

        elements.success.textContent =
            message;

        window.setTimeout(
            function () {
                elements.success.hidden =
                    true;
            },
            3500
        );
    }

    function render(data) {
        context =
            data;

        const profile =
            data.profile ||
            {};

        const user =
            data.user ||
            {};

        elements.firstName.value =
            profile.first_name ||
            "";

        elements.lastName.value =
            profile.last_name ||
            "";

        elements.displayName.value =
            profile.display_name ||
            "";

        elements.phone.value =
            profile.phone ||
            "";

        elements.email.textContent =
            profile.email ||
            user.email ||
            "—";

        elements.emailStatus.textContent =
            user.email_confirmed_at
                ? "Verified"
                : "Not verified";
    }

    async function save(event) {
        event.preventDefault();

        if (
            !context?.user?.id
        ) {
            showError(
                new Error(
                    "Your Paryx account is not ready. Refresh and try again."
                )
            );

            return;
        }

        clearError();

        elements.save.disabled =
            true;

        elements.save.textContent =
            "Saving…";

        try {
            const firstName =
                clean(
                    elements
                        .firstName
                        .value
                );

            const lastName =
                clean(
                    elements
                        .lastName
                        .value
                );

            const requestedDisplayName =
                clean(
                    elements
                        .displayName
                        .value
                );

            const fallbackDisplayName =
                [
                    firstName,
                    lastName
                ]
                    .filter(Boolean)
                    .join(" ")
                    .trim();

            const displayName =
                requestedDisplayName ||
                fallbackDisplayName ||
                null;

            const phone =
                clean(
                    elements
                        .phone
                        .value
                );

            const {
                error
            } =
                await window
                    .supabaseClient
                    .from(
                        "profiles"
                    )
                    .update({
                        first_name:
                            firstName,
                        last_name:
                            lastName,
                        display_name:
                            displayName,
                        phone:
                            phone,
                        updated_at:
                            new Date()
                                .toISOString()
                    })
                    .eq(
                        "id",
                        context.user.id
                    );

            if (error) {
                throw error;
            }

            context.profile = {
                ...context.profile,
                first_name:
                    firstName,
                last_name:
                    lastName,
                display_name:
                    displayName ||
                    context.profile
                        ?.email ||
                    context.user.email ||
                    "Player",
                phone:
                    phone
            };

            elements.displayName.value =
                displayName ||
                "";

            showSuccess(
                "Your Paryx details have been updated."
            );
        } catch (error) {
            showError(
                error
            );
        } finally {
            elements.save.disabled =
                false;

            elements.save.textContent =
                "Save details";
        }
    }

    elements.form.addEventListener(
        "submit",
        save
    );

    P.ready
        .then(
            render
        )
        .catch(
            showError
        );
})();
