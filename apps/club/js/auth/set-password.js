(function () {
    "use strict";

    const form = document.getElementById("setPasswordForm");
    const newPassword = document.getElementById("newPassword");
    const confirmPassword = document.getElementById("confirmPassword");
    const newPasswordToggle =
        document.getElementById("newPasswordToggle");
    const confirmPasswordToggle =
        document.getElementById("confirmPasswordToggle");
    const submitButton =
        document.getElementById("setPasswordButton");
    const message =
        document.getElementById("setPasswordMessage");

    if (
        !form ||
        !newPassword ||
        !confirmPassword ||
        !newPasswordToggle ||
        !confirmPasswordToggle ||
        !submitButton ||
        !message
    ) {
        console.error("Set-password page elements are missing.");
        return;
    }

    function showMessage(text, type) {
        message.textContent = text;
        message.className =
            `auth-message auth-message--${type} is-visible`;
    }

    function clearMessage() {
        message.textContent = "";
        message.className = "auth-message";
    }

    function setLoading(isLoading) {
        submitButton.disabled = isLoading;
        submitButton.textContent =
            isLoading ? "Saving password…" : "Save password";
    }

    function configurePasswordToggle(button, input) {
        button.addEventListener("click", function () {
            const isVisible = input.type === "text";

            input.type = isVisible ? "password" : "text";
            button.textContent = isVisible ? "Show" : "Hide";
            button.setAttribute(
                "aria-pressed",
                String(!isVisible)
            );
        });
    }

    function validatePasswords() {
        if (newPassword.value.length < 8) {
            showMessage(
                "Your password must contain at least 8 characters.",
                "error"
            );
            newPassword.focus();
            return false;
        }

        if (newPassword.value !== confirmPassword.value) {
            showMessage(
                "The passwords do not match.",
                "error"
            );
            confirmPassword.focus();
            return false;
        }

        return true;
    }

    async function confirmInviteSession() {
        if (!window.supabaseClient) {
            showMessage(
                "The account service is unavailable. Refresh and try again.",
                "error"
            );
            submitButton.disabled = true;
            return;
        }

        const { data, error } =
            await window.supabaseClient.auth.getSession();

        if (error || !data.session) {
            showMessage(
                "This invitation link is invalid or has expired. Ask the club to send a new invitation.",
                "error"
            );
            submitButton.disabled = true;
        }
    }

    configurePasswordToggle(
        newPasswordToggle,
        newPassword
    );

    configurePasswordToggle(
        confirmPasswordToggle,
        confirmPassword
    );

    form.addEventListener("submit", async function (event) {
        event.preventDefault();
        clearMessage();

        if (!validatePasswords()) {
            return;
        }

        if (!window.supabaseClient) {
            showMessage(
                "The account service is unavailable. Refresh and try again.",
                "error"
            );
            return;
        }

        setLoading(true);

        try {
            const { error } =
                await window.supabaseClient.auth.updateUser({
                    password: newPassword.value
                });

            if (error) {
                throw error;
            }

            showMessage(
                "Password saved. Opening Paryx…",
                "success"
            );

            window.setTimeout(function () {
                window.location.href = "login.html";
            }, 900);
        } catch (error) {
            console.error("Password update error:", error);

            showMessage(
                error.message ||
                    "We could not save your password. Request a new invitation and try again.",
                "error"
            );
        } finally {
            setLoading(false);
        }
    });

    confirmInviteSession();
})();